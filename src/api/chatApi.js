// Browser-side API client. Talks ONLY to the local bridge (/api, proxied by Vite).
// No Azure credentials or tokens ever reach this code.

export class ChatApiError extends Error {
  constructor({ code, message, hint, retryable, retryAfter, toolIssues, upstreamStatus, status }) {
    super(message || 'Request failed.')
    this.code = code || 'unknown_error'
    this.hint = hint
    this.retryable = retryable ?? true
    this.retryAfter = retryAfter
    this.toolIssues = toolIssues
    this.upstreamStatus = upstreamStatus
    this.status = status
  }

  toPlain() {
    return {
      code: this.code,
      message: this.message,
      hint: this.hint,
      retryable: this.retryable,
      retryAfter: this.retryAfter,
      toolIssues: this.toolIssues,
      upstreamStatus: this.upstreamStatus,
      status: this.status,
    }
  }
}

async function readJson(res) {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Send one message through the bridge. The bridge keeps the Foundry conversation state for
 * this browser session (HttpOnly cookie) and thread; the browser never handles Foundry IDs.
 * @param {{ message: string, threadId: string, role?: 'employer'|'apprentice', signal?: AbortSignal }} args
 * @returns {Promise<{routed, text, sources, citations, toolCalls, toolIssues, grounding, status, incompleteReason}>}
 */
export async function sendChatMessage({ message, threadId, role, signal }) {
  let res
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ message, threadId, role: role || undefined }),
      signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new ChatApiError({ code: 'cancelled', message: 'You stopped this response.', retryable: true })
    }
    throw new ChatApiError({
      code: 'bridge_unreachable',
      message: 'Can’t reach the local API bridge.',
      hint: 'Start it with `npm run dev:api` (or `npm run dev:all`) and try again.',
      retryable: true,
    })
  }

  const data = await readJson(res)
  if (!res.ok) {
    if (data?.error) throw new ChatApiError({ ...data.error, status: res.status })
    throw new ChatApiError({
      code: res.status === 502 || res.status === 504 ? 'bridge_unreachable' : 'http_error',
      message:
        res.status === 502 || res.status === 504
          ? 'Can’t reach the local API bridge.'
          : `Request failed (HTTP ${res.status}).`,
      hint:
        res.status === 502 || res.status === 504
          ? 'Start it with `npm run dev:api` (or `npm run dev:all`) and try again.'
          : undefined,
      status: res.status,
    })
  }
  if (!data || typeof data.text !== 'string') {
    throw new ChatApiError({ code: 'invalid_response', message: 'The bridge returned an unexpected response.' })
  }
  return data
}

/** Ask the bridge to forget a thread's server-side agent context. Best effort; never throws. */
export function resetThread(threadId) {
  if (!threadId) return
  fetch(`/api/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {})
}

/** Connection / auth status of the bridge. Never throws. */
export async function fetchHealth(signal) {
  try {
    const res = await fetch('/api/health', { signal, headers: { Accept: 'application/json' } })
    const data = await readJson(res)
    if (!res.ok || !data) return { state: 'offline' }
    return { state: data.ok ? 'online' : 'auth', ...data }
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    return { state: 'offline' }
  }
}
