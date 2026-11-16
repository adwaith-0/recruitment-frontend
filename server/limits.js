// Usage limits for the public site.
//
// DailyQuota: counts questions per key (visitor session, client IP) per UTC calendar day.
// ConcurrencyLimiter: caps how many questions are being answered at once; extra requests wait in a
// short queue and are rejected if the queue is full or the wait is too long.
//
// State is in memory (single App Service instance). It resets if the app restarts.

import { BridgeError } from './errors.js'

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10)

export class DailyQuota {
  constructor({ limit, now = Date.now, maxKeys = 50_000 }) {
    this.limit = limit
    this.now = now
    this.maxKeys = maxKeys
    this.counts = new Map() // key -> { day, count }
  }

  #entry(key) {
    const day = utcDay(this.now())
    let entry = this.counts.get(key)
    if (!entry || entry.day !== day) {
      entry = { day, count: 0 }
      this.counts.set(key, entry)
      if (this.counts.size > this.maxKeys) this.sweep()
    }
    return entry
  }

  remaining(key) {
    return Math.max(0, this.limit - this.#entry(key).count)
  }

  take(key) {
    this.#entry(key).count++
  }

  refund(key) {
    const entry = this.#entry(key)
    if (entry.count > 0) entry.count--
  }

  /** Drop counters from previous days. */
  sweep() {
    const day = utcDay(this.now())
    for (const [key, entry] of this.counts) if (entry.day !== day) this.counts.delete(key)
  }
}

export class ConcurrencyLimiter {
  constructor({ max, maxQueue, timeoutMs }) {
    this.max = max
    this.maxQueue = maxQueue
    this.timeoutMs = timeoutMs
    this.active = 0
    this.queue = []
  }

  /** Resolves to a release() function once a slot is free. */
  acquire(signal) {
    if (this.active < this.max) {
      this.active++
      return Promise.resolve(this.#releaser())
    }
    if (this.queue.length >= this.maxQueue) return Promise.reject(busy())
    return new Promise((resolve, reject) => {
      const waiter = {
        grant: () => {
          cleanup()
          this.active++
          resolve(this.#releaser())
        },
      }
      const leave = (err) => {
        cleanup()
        this.queue = this.queue.filter((w) => w !== waiter)
        reject(err)
      }
      const timer = setTimeout(() => leave(busy()), this.timeoutMs)
      const onAbort = () => leave(new BridgeError(499, 'cancelled', 'The request was cancelled.'))
      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.queue.push(waiter)
    })
  }

  #releaser() {
    let released = false
    return () => {
      if (released) return
      released = true
      this.active--
      this.queue.shift()?.grant()
    }
  }
}

function busy() {
  return new BridgeError(503, 'server_busy', 'The assistant is busy answering other questions right now.', {
    hint: 'Please try again in a moment.',
    retryable: true,
    retryAfter: 10,
  })
}

export function dailyLimitReached(limit) {
  const message = limit ? `You’ve reached today’s limit of ${limit} questions.` : 'Today’s question limit has been reached on your network.'
  return new BridgeError(429, 'daily_limit_reached', message, {
    hint: 'Please come back tomorrow. The limit resets at midnight UTC.',
    retryable: false,
  })
}

/** Client IP behind the App Service front end (X-Forwarded-For may include a port). */
export function clientIp(req) {
  let ip = String(req.ip || req.socket?.remoteAddress || 'unknown')
  const v4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/)
  if (v4WithPort) ip = v4WithPort[1]
  const v6WithPort = ip.match(/^\[([^\]]+)\](?::\d+)?$/)
  if (v6WithPort) ip = v6WithPort[1]
  return ip.replace(/^::ffff:/, '')
}
