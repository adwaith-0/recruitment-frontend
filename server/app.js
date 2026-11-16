// Express app for the API bridge between the React frontend and Microsoft Foundry.
// The browser never sees Azure credentials, Foundry response IDs or retrieved raw tool output.
//
// Routing for POST /api/chat:
//   1. Validate input and resolve the caller's session + thread (server-side state only).
//   2. Standalone greeting/acknowledgement  -> predefined reply. No Foundry, LLM, MCP or Search call.
//   3. Anything else                        -> daily question limit (per visitor + per IP backstop),
//                                              concurrency cap, then the Prompt Agent with mandatory
//                                              knowledge-base retrieval and the evidence gate (grounding.js).

import express from 'express'
import { BridgeError, fromAuthError } from './errors.js'
import { classifyGreeting } from './greetings.js'
import { clientIp, ConcurrencyLimiter, DailyQuota, dailyLimitReached } from './limits.js'
import { SessionStore } from './sessions.js'

const THREAD_ID = /^[A-Za-z0-9_-]{1,64}$/
const ROLES = new Set(['employer', 'apprentice'])

/**
 * @param {{ config: object, agent: { kind: string, respond: Function }, getAccessToken: Function,
 *           sessions?: SessionStore, logger?: (line: string) => void }} deps
 */
export function createApp({
  config,
  agent,
  getAccessToken,
  sessions = new SessionStore({ ttlMs: config.sessionTtlMs }),
  logger = console.log,
  now = Date.now,
}) {
  const visitorQuota = new DailyQuota({ limit: config.dailyQuestionLimit ?? 1000, now })
  const ipQuota = new DailyQuota({ limit: config.dailyQuestionLimitPerIp ?? 3000, now })
  const limiter = new ConcurrencyLimiter({
    max: config.maxConcurrentRequests ?? 10,
    maxQueue: config.maxQueuedRequests ?? 20,
    timeoutMs: config.queueTimeoutMs ?? 30_000,
  })
  const sweep = setInterval(() => {
    visitorQuota.sweep()
    ipQuota.sweep()
  }, 60 * 60_000)
  sweep.unref?.()

  const app = express()
  app.disable('x-powered-by')
  if (config.trustProxy) app.set('trust proxy', 1)
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' })
    next()
  })
  app.use(express.json({ limit: '64kb' }))

  const log = (route, status, ms, extra) => {
    // Never log message content: it can contain personal recruitment information.
    const parts = [`[api] ${route} ${status}`]
    if (ms != null) parts.push(`${ms}ms`)
    for (const [k, v] of Object.entries(extra ?? {})) if (v != null && v !== '') parts.push(`${k}=${v}`)
    logger(parts.join(' '))
  }

  app.get('/api/health', async (_req, res) => {
    const info = {
      agent: config.agentName,
      agentKind: agent.kind,
      knowledgeBase: agent.kind === 'prompt' ? config.knowledgeBase : undefined,
      project: config.projectEndpoint.split('/').pop(),
      authMode: config.authMode,
    }
    try {
      await getAccessToken()
      res.json({ ok: true, auth: 'ok', ...info })
    } catch (err) {
      res.status(200).json({ ok: false, auth: 'failed', authError: fromAuthError(err).toJSON().error, ...info })
    }
  })

  app.post('/api/chat', async (req, res) => {
    const { message, threadId, role } = req.body ?? {}
    const started = Date.now()
    let thread
    let ownsThread = false
    let release = null
    let charged = null
    try {
      if (typeof message !== 'string' || !message.trim()) {
        throw new BridgeError(400, 'invalid_message', 'Message must be a non-empty string.')
      }
      if (message.length > config.maxMessageChars) {
        throw new BridgeError(400, 'message_too_long', `Message exceeds ${config.maxMessageChars} characters.`)
      }
      if (typeof threadId !== 'string' || !THREAD_ID.test(threadId)) {
        throw new BridgeError(400, 'invalid_thread_id', 'threadId is required and has an invalid format.')
      }
      if (role != null && !ROLES.has(role)) {
        throw new BridgeError(400, 'invalid_role', 'role must be "employer" or "apprentice".')
      }

      const sid = sessions.resolve(req, res)
      const text = message.trim()

      // Deterministic greeting route: no external call of any kind.
      const greeting = classifyGreeting(text)
      if (greeting) {
        log('chat', 200, Date.now() - started, { route: 'greeting' })
        return res.json({
          routed: 'greeting',
          text: greeting.text,
          sources: [],
          citations: [],
          toolCalls: [],
          toolIssues: [],
          grounding: { status: 'not_required' },
          status: 'completed',
          incompleteReason: null,
        })
      }

      thread = sessions.thread(sid, threadId)
      if (thread.busy) {
        throw new BridgeError(409, 'thread_busy', 'This conversation is already waiting for a reply.', {
          hint: 'Wait for the current reply, or stop it, before sending another message.',
          retryable: true,
        })
      }

      // Daily question limit: per visitor (session) and per client IP (backstop if cookies are cleared).
      const keys = { visitor: `s:${sid}`, ip: `ip:${clientIp(req)}` }
      if (visitorQuota.remaining(keys.visitor) <= 0) throw dailyLimitReached(visitorQuota.limit)
      if (ipQuota.remaining(keys.ip) <= 0) throw dailyLimitReached()

      thread.busy = true
      ownsThread = true

      // Abort the upstream call if the browser goes away (e.g. user pressed Stop).
      const controller = new AbortController()
      res.on('close', () => {
        if (!res.writableFinished) controller.abort()
      })

      // Concurrency cap: wait briefly for a free slot, otherwise report that the service is busy.
      release = await limiter.acquire(controller.signal)
      visitorQuota.take(keys.visitor)
      ipQuota.take(keys.ip)
      charged = keys

      const isFollowUp = Boolean(thread.previousResponseId)
      const result = await agent.respond({ message: text, thread, role: role || undefined, signal: controller.signal })
      thread.updatedAt = Date.now()
      const g = result.payload.grounding ?? {}
      log('chat', 200, Date.now() - started, {
        route: agent.kind,
        turn: isFollowUp ? 'follow-up' : 'first',
        grounding: g.status,
        docs: g.documentsRetrieved,
        cited: g.citedSources,
        removed: g.removedCitations || undefined,
        accepted: result.accept,
        tokensIn: result.payload.usage?.inputTokens,
      })
      res.set('X-Questions-Remaining-Today', String(visitorQuota.remaining(keys.visitor)))
      res.json({ routed: agent.kind, ...result.payload })
    } catch (err) {
      const e = err instanceof BridgeError
        ? err
        : new BridgeError(500, 'internal_error', 'Unexpected error in the API bridge.', { hint: err?.message })
      // Don't charge the visitor for questions that failed for reasons outside their control.
      if (charged && (e.status >= 500 || e.status === 429 || e.code === 'cancelled' || e.code === 'conversation_expired')) {
        visitorQuota.refund(charged.visitor)
        ipQuota.refund(charged.ip)
      }
      if (e.code === 'conversation_expired' && thread) {
        thread.previousResponseId = null
        thread.documents.clear()
        thread.roleSent = null
      }
      if (e.code !== 'cancelled') {
        log('chat', e.status, Date.now() - started, {
          code: e.code,
          active: e.code === 'server_busy' ? `${limiter.active}/${limiter.max}` : undefined,
          upstream: e.upstreamStatus,
          upstreamCode: e.upstreamCode ?? e.diagnostics?.upstreamCode,
          requestId: e.upstreamRequestId,
          // Tool error text is from Foundry/MCP (never contains our token); trimmed for logs.
          toolError: e.diagnostics?.firstError ? JSON.stringify(String(e.diagnostics.firstError).slice(0, 200)) : undefined,
        })
      }
      if (!res.headersSent && !res.writableEnded) {
        if (e.retryAfter) res.set('Retry-After', String(e.retryAfter))
        res.status(e.status).json(e.toJSON())
      }
    } finally {
      release?.()
      if (ownsThread) thread.busy = false
    }
  })

  // Forget the server-side Foundry context of a chat (used when the user clears or deletes it).
  app.delete('/api/threads/:threadId', (req, res) => {
    if (!THREAD_ID.test(req.params.threadId)) {
      return res.status(400).json(new BridgeError(400, 'invalid_thread_id', 'Invalid thread id.').toJSON())
    }
    const sid = sessions.resolve(req, res)
    sessions.reset(sid, req.params.threadId)
    res.status(204).end()
  })

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Unknown API route.' } })
  })

  // Hosted mode: the same server serves the built React app (no Azure values are in it).
  if (config.staticDir) {
    // index.html is always revalidated so visitors get new deployments immediately; Vite's hashed
    // /assets files never change content, so they can be cached for a long time.
    app.use(express.static(config.staticDir, {
      index: 'index.html',
      setHeaders(res, filePath) {
        res.set('Cache-Control', /[\\/]assets[\\/]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache')
      },
    }))
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
      res.set('Cache-Control', 'no-cache')
      res.sendFile('index.html', { root: config.staticDir })
    })
  }

  // Malformed JSON bodies, etc.
  app.use((err, _req, res, _next) => {
    const status = err?.status && err.status < 500 ? err.status : 500
    res.status(status).json({ error: { code: status === 500 ? 'internal_error' : 'bad_request', message: status === 500 ? 'Unexpected error in the API bridge.' : err.message } })
  })

  return app
}
