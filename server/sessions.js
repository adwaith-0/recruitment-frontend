// Server-side conversation state, isolated per browser session.
//
// The browser holds only an opaque, random, HttpOnly session cookie and its own chat
// thread IDs. Foundry response IDs and retrieved evidence stay on the server, keyed by
// (session, thread), so one user cannot continue or read another user's Foundry
// conversation by guessing or replaying IDs.
//
// Storage is in memory: state is lost when the bridge restarts (the UI then reports an
// expired conversation and starts a new one). A multi-instance deployment needs a shared
// store such as Redis and a real user identity in front of this bridge.

import { randomBytes } from 'node:crypto'

export const SESSION_COOKIE = 'rai_sid'
const SID = /^[A-Za-z0-9_-]{43}$/

export class SessionStore {
  constructor({ ttlMs = 2 * 60 * 60 * 1000, maxSessions = 5000, maxThreadsPerSession = 50, now = Date.now } = {}) {
    this.ttlMs = ttlMs
    this.maxSessions = maxSessions
    this.maxThreadsPerSession = maxThreadsPerSession
    this.now = now
    this.sessions = new Map() // sid -> { threads: Map<threadId, Thread>, lastSeen }
  }

  /** Returns the caller's session id, issuing a new cookie when absent, unknown or expired. */
  resolve(req, res) {
    const sid = readCookie(req.headers.cookie, SESSION_COOKIE)
    const existing = sid && SID.test(sid) ? this.sessions.get(sid) : null
    if (existing && this.now() - existing.lastSeen <= this.ttlMs) {
      existing.lastSeen = this.now()
      return sid
    }
    const fresh = randomBytes(32).toString('base64url')
    this.sessions.set(fresh, { threads: new Map(), lastSeen: this.now() })
    this.#evictSessions()
    res.append(
      'Set-Cookie',
      `${SESSION_COOKIE}=${fresh}; Path=/api; HttpOnly; SameSite=Strict${req.secure ? '; Secure' : ''}`,
    )
    return fresh
  }

  thread(sid, threadId) {
    const session = this.sessions.get(sid)
    if (!session) return null
    let thread = session.threads.get(threadId)
    if (thread && this.now() - thread.updatedAt > this.ttlMs) {
      session.threads.delete(threadId)
      thread = null
    }
    if (!thread) {
      thread = { previousResponseId: null, roleSent: null, documents: new Map(), busy: false, updatedAt: this.now() }
      session.threads.set(threadId, thread)
      if (session.threads.size > this.maxThreadsPerSession) {
        const oldest = [...session.threads.entries()].filter(([, t]) => !t.busy).sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0]
        if (oldest) session.threads.delete(oldest[0])
      }
    }
    return thread
  }

  /** Forget a thread's Foundry context (used when the user clears or deletes a chat). */
  reset(sid, threadId) {
    return this.sessions.get(sid)?.threads.delete(threadId) ?? false
  }

  sweep() {
    const cutoff = this.now() - this.ttlMs
    for (const [sid, session] of this.sessions) {
      if (session.lastSeen < cutoff) this.sessions.delete(sid)
      else for (const [id, t] of session.threads) if (!t.busy && t.updatedAt < cutoff) session.threads.delete(id)
    }
  }

  #evictSessions() {
    while (this.sessions.size > this.maxSessions) {
      this.sessions.delete(this.sessions.keys().next().value)
    }
  }
}

export function readCookie(header, name) {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}
