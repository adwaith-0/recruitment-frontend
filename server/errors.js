// Maps credential and upstream failures to stable, user-meaningful error codes.
// Error bodies never include tokens or request headers.

export class BridgeError extends Error {
  constructor(status, code, message, { hint, retryable = false, retryAfter, toolIssues, upstreamStatus } = {}) {
    super(message)
    this.status = status
    this.code = code
    this.hint = hint
    this.retryable = retryable
    this.retryAfter = retryAfter
    this.toolIssues = toolIssues
    this.upstreamStatus = upstreamStatus
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        hint: this.hint,
        retryable: this.retryable,
        retryAfter: this.retryAfter,
        toolIssues: this.toolIssues?.length ? this.toolIssues : undefined,
        upstreamStatus: this.upstreamStatus,
      },
    }
  }
}

/** Safe, user-facing error when document retrieval cannot be performed. Details go to server logs only. */
export function knowledgeUnavailable({ upstreamStatus } = {}) {
  return new BridgeError(
    503,
    'knowledge_unavailable',
    'Our document search is unavailable right now, so I can’t give you a verified answer.',
    {
      hint: 'Please try again shortly. If this keeps happening, contact the recruitment team.',
      retryable: true,
      upstreamStatus,
    },
  )
}

export function fromAuthError(err) {
  const name = err?.name || ''
  const detail = String(err?.message || '').split('\n')[0].slice(0, 300)
  const notLoggedIn = /az login|not logged in|please run|not installed|CredentialUnavailable/i.test(
    `${name} ${err?.message}`,
  )
  return new BridgeError(401, 'auth_failed', 'Could not get an Azure access token for the Foundry agent.', {
    hint: notLoggedIn
      ? 'Sign in with `az login` (and select the subscription that hosts recruitment-ai-lab), then restart the API bridge.'
      : detail,
    retryable: true,
  })
}

export function fromUpstreamResponse(res, data, raw) {
  const upstream = data?.error || {}
  const upstreamMessage =
    (typeof upstream === 'string' ? upstream : upstream.message) ||
    data?.message ||
    (raw && raw.length < 500 ? raw : '') ||
    res.statusText
  const upstreamStatus = res.status
  const retryAfterHeader = res.headers.get('retry-after')
  const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) || undefined : undefined

  switch (res.status) {
    case 400:
      // Foundry reports MCP connection/authentication failures (for example the knowledge-base
      // server rejecting the connection's credentials) as tool_user_error. Never fall back to
      // an unsourced answer: report the knowledge base as unavailable.
      if (upstream.code === 'tool_user_error') return knowledgeUnavailable({ upstreamStatus })
      if (/previous_response_id|previous response/i.test(upstreamMessage)) {
        return new BridgeError(409, 'conversation_expired', 'The agent no longer has this conversation’s context.', {
          hint: 'Start a new chat to continue. (The agent could not find the previous response in this thread.)',
          upstreamStatus,
        })
      }
      return new BridgeError(400, upstream.code || 'bad_request', 'The agent rejected the request.', {
        hint: upstreamMessage,
        upstreamStatus,
      })
    case 401:
      return new BridgeError(401, 'unauthorized', 'Azure rejected the access token.', {
        hint: 'Your `az login` session may have expired. Run `az login` again and retry.',
        retryable: true,
        upstreamStatus,
      })
    case 403:
      return new BridgeError(403, 'forbidden', 'Your Azure account is not allowed to invoke this agent.', {
        hint: `You likely need the "Foundry User" (formerly Azure AI User) role on the Foundry project. Upstream: ${upstreamMessage}`,
        upstreamStatus,
      })
    case 404:
      return new BridgeError(404, 'agent_not_found', 'The Foundry agent was not found.', {
        hint: `Check FOUNDRY_AGENT_NAME, FOUNDRY_AGENT_KIND and FOUNDRY_PROJECT_ENDPOINT. Upstream: ${upstreamMessage}`,
        upstreamStatus,
      })
    case 408:
    case 504:
      return new BridgeError(504, 'timeout', 'The agent timed out.', {
        hint: upstreamMessage,
        retryable: true,
        upstreamStatus,
      })
    case 429:
      return new BridgeError(429, 'rate_limited', 'The agent is receiving too many requests right now.', {
        hint: retryAfter ? `Try again in about ${retryAfter}s.` : 'Wait a moment and try again.',
        retryable: true,
        retryAfter,
        upstreamStatus,
      })
    default:
      if (res.status >= 500) {
        return new BridgeError(502, 'upstream_error', `The agent service returned an error (HTTP ${res.status}).`, {
          hint: upstreamMessage,
          retryable: true,
          upstreamStatus,
        })
      }
      return new BridgeError(502, 'upstream_error', `Unexpected response from the agent (HTTP ${res.status}).`, {
        hint: upstreamMessage,
        upstreamStatus,
      })
  }
}
