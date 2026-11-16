// One authenticated JSON POST to a Foundry data-plane endpoint.
// The Entra ID token is attached here and never returned, logged or sent to the browser.

import { BridgeError, fromAuthError, fromUpstreamResponse } from './errors.js'

const MAX_RETRY_WAIT_MS = 20_000

/**
 * POST with one bounded retry on HTTP 429. A 429 is returned before Foundry creates a response,
 * so retrying cannot duplicate a turn. Waits honour Retry-After (capped) and stop on abort.
 */
export async function postFoundry(url, body, options) {
  try {
    return await postOnce(url, body, options)
  } catch (err) {
    if (err?.code !== 'rate_limited' || options.retryOn429 === false) throw err
    const waitMs = Math.min((err.retryAfter ?? 5) * 1000, MAX_RETRY_WAIT_MS)
    if ((err.retryAfter ?? 5) * 1000 > MAX_RETRY_WAIT_MS) throw err
    await sleep(waitMs, options.signal)
    return postOnce(url, body, options)
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new BridgeError(499, 'cancelled', 'The request was cancelled.'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new BridgeError(499, 'cancelled', 'The request was cancelled.'))
    }, { once: true })
  })
}

async function postOnce(url, body, { getAccessToken, clearCachedToken, timeoutMs, signal, fetchImpl = fetch }) {
  let token
  try {
    token = await getAccessToken()
  } catch (err) {
    throw fromAuthError(err)
  }

  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  let res
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: combined,
    })
  } catch (err) {
    if (timeout.aborted) {
      throw new BridgeError(504, 'timeout', 'The agent did not respond in time.', {
        hint: `No response within ${Math.round(timeoutMs / 1000)}s. Please try again.`,
        retryable: true,
      })
    }
    if (signal?.aborted) throw new BridgeError(499, 'cancelled', 'The request was cancelled.')
    throw new BridgeError(502, 'network_error', 'Could not reach the Foundry agent endpoint.', {
      hint: err?.cause?.code || err?.message,
      retryable: true,
    })
  }

  const raw = await res.text()
  let data = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    // Non-JSON body; handled below.
  }

  if (!res.ok) {
    if (res.status === 401) clearCachedToken?.()
    const err = fromUpstreamResponse(res, data, raw)
    // Request ID helps developers correlate with Foundry logs; it is not a secret.
    err.upstreamRequestId = data?.error?.request_id || res.headers.get?.('x-request-id') || undefined
    err.upstreamCode = data?.error?.code
    throw err
  }
  if (!data || typeof data !== 'object') {
    throw new BridgeError(502, 'invalid_response', 'The agent returned a response that is not valid JSON.')
  }
  return { data, headers: res.headers }
}
