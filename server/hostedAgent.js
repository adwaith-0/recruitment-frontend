// ROLLBACK ONLY: adapter for the previous Foundry *hosted* agent (recruitment-maf-test).
// Selected with FOUNDRY_AGENT_KIND=hosted. It has no evidence gate: the hosted agent is
// responsible for its own tool use, which is why the Prompt Agent replaced it.

import { BridgeError } from './errors.js'
import { postFoundry } from './foundryHttp.js'

const ROLE_CONTEXT = {
  employer:
    'Conversation context from the Recruitment AI app: the user selected the EMPLOYER journey. ' +
    'They represent an organisation that wants to recruit apprentices (role, number of apprentices, ' +
    'location, qualifications, start date). Tailor guidance accordingly.',
  apprentice:
    'Conversation context from the Recruitment AI app: the user selected the APPRENTICE journey. ' +
    'They are an individual looking for an apprenticeship (courses, eligibility, application process). ' +
    'Tailor guidance accordingly.',
}

export function createHostedAgent({ config, url, getAccessToken, clearCachedToken, fetchImpl }) {
  return {
    kind: 'hosted',
    async respond({ message, thread, role, signal }) {
      const input = []
      if (role && ROLE_CONTEXT[role] && role !== thread.roleSent) {
        input.push({ type: 'message', role: 'developer', content: ROLE_CONTEXT[role] })
      }
      input.push({ type: 'message', role: 'user', content: message })
      const body = { input }
      if (thread.previousResponseId) body.previous_response_id = thread.previousResponseId
      if (thread.agentSessionId) body.agent_session_id = thread.agentSessionId

      const { data, headers } = await postFoundry(url, body, {
        getAccessToken,
        clearCachedToken,
        timeoutMs: config.requestTimeoutMs,
        signal,
        fetchImpl,
      })
      const { responseId, agentSessionId, ...payload } = parseResponse(data, headers)
      thread.previousResponseId = responseId
      thread.agentSessionId = agentSessionId ?? thread.agentSessionId
      if (role) thread.roleSent = role
      return { payload: { ...payload, grounding: { status: 'legacy_hosted' } }, responseId, accept: true }
    },
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export function parseResponse(data, headers) {
  const output = Array.isArray(data.output) ? data.output : []
  const textParts = []
  const urlCitations = []
  const toolCalls = []
  const toolIssues = []
  const retrieved = new Map() // ref_id -> source

  const callsById = new Map()
  for (const item of output) {
    if (item?.type === 'function_call') {
      const call = { id: item.call_id, name: item.name, status: item.status || 'completed' }
      callsById.set(item.call_id, call)
      toolCalls.push(call)
    }
  }

  for (const item of output) {
    switch (item?.type) {
      case 'message': {
        if (item.role && item.role !== 'assistant') break
        for (const part of item.content ?? []) {
          if (part?.type === 'output_text' && typeof part.text === 'string') {
            const offset = textParts.reduce((length, text) => length + text.length + 2, 0)
            textParts.push(part.text)
            for (const a of part.annotations ?? []) collectAnnotation(a, urlCitations, offset)
          } else if (part?.type === 'refusal' && part.refusal) {
            textParts.push(part.refusal)
          }
        }
        break
      }
      case 'function_call_output': {
        const call = callsById.get(item.call_id)
        const result = parseToolOutput(item.output)
        if (result.error) {
          if (call) call.status = 'failed'
          toolIssues.push({ tool: friendlyToolName(call?.name), message: result.error })
        }
        for (const src of result.sources) {
          if (!retrieved.has(src.refId)) retrieved.set(src.refId, src)
        }
        break
      }
      case 'mcp_call': {
        toolCalls.push({ id: item.id, name: item.name, status: item.error ? 'failed' : 'completed' })
        if (item.error) toolIssues.push({ tool: friendlyToolName(item.name), message: stringifyError(item.error) })
        break
      }
      case 'mcp_list_tools': {
        if (item.error) {
          toolIssues.push({ tool: item.server_label || 'MCP server', message: stringifyError(item.error) })
        }
        break
      }
      default:
        break
    }
  }

  const rawText = textParts.join('\n\n')
  const text = rawText.trim()
  const leadingWhitespace = rawText.length - rawText.trimStart().length
  if (leadingWhitespace) {
    for (const citation of urlCitations) {
      for (const range of citation.ranges ?? []) {
        range.startIndex -= leadingWhitespace
        range.endIndex -= leadingWhitespace
      }
    }
  }
  const sources = selectCitedSources(text, [...retrieved.values()])

  const status = data.status || 'completed'
  if (status === 'failed') {
    const msg = data.error?.message || 'The agent reported that the response failed.'
    throw new BridgeError(502, data.error?.code || 'agent_failed', msg, {
      hint: toolIssues.length ? `Tool issue: ${toolIssues[0].message}` : undefined,
      retryable: true,
      toolIssues,
    })
  }
  if (!text) {
    throw new BridgeError(502, 'empty_response', 'The agent returned no text output.', {
      hint:
        status === 'incomplete'
          ? `Response incomplete: ${data.incomplete_details?.reason || 'unknown reason'}.`
          : toolIssues[0]?.message,
      retryable: true,
      toolIssues,
    })
  }

  return {
    responseId: data.id,
    agentSessionId: data.agent_session_id || headers?.get?.('x-agent-session-id') || null,
    agentVersion: data.agent_reference?.version ?? null,
    status,
    incompleteReason: status === 'incomplete' ? data.incomplete_details?.reason || 'unknown' : null,
    text,
    citations: urlCitations,
    sources,
    toolCalls: toolCalls.map(({ name, status: s }) => ({ name: friendlyToolName(name), status: s })),
    toolIssues,
    usage: data.usage
      ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
      : null,
  }
}

function collectAnnotation(a, list, offset = 0) {
  if (!a || typeof a !== 'object') return
  if (a.type === 'url_citation' && a.url) {
    let citation = list.find((c) => c.url === a.url)
    if (!citation) {
      citation = { title: a.title || a.url, url: a.url, ranges: [] }
      list.push(citation)
    }
    if (Number.isInteger(a.start_index) && Number.isInteger(a.end_index)) {
      citation.ranges.push({ startIndex: offset + a.start_index, endIndex: offset + a.end_index })
    }
  } else if (a.type === 'file_citation' || a.type === 'container_file_citation') {
    const title = a.filename || a.file_id
    if (title && !list.some((c) => c.title === title)) list.push({ title, url: null })
  }
}

/**
 * Foundry IQ knowledge_base_retrieve returns newline-delimited JSON:
 *  - an array of { ref_id, content } passages
 *  - one { kind: "reference", ref_id, uri, sourceData: { snippet, metadata_storage_path } } per passage
 * Anything that doesn't parse that way and looks like an error is surfaced as a tool issue.
 */
function parseToolOutput(output) {
  const textOut = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  const passages = new Map()
  const refs = new Map()
  let parsedAny = false

  for (const line of textOut.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) continue
    let value
    try {
      value = JSON.parse(trimmed)
    } catch {
      continue
    }
    parsedAny = true
    const values = Array.isArray(value) ? value : [value]
    for (const v of values) {
      if (!v || typeof v !== 'object' || v.ref_id === undefined) continue
      if (v.kind === 'reference') refs.set(v.ref_id, v)
      else if (typeof v.content === 'string') passages.set(v.ref_id, v.content)
    }
  }

  const sources = []
  for (const refId of new Set([...passages.keys(), ...refs.keys()])) {
    const ref = refs.get(refId)
    const content = passages.get(refId) || ref?.sourceData?.snippet || ''
    sources.push({
      refId: String(refId),
      document: ref?.sourceData?.metadata_storage_path || ref?.sourceData?.title || 'Knowledge base',
      uri: ref?.uri || null,
      sections: [...new Set([...content.matchAll(/\[([A-Z]{2,12}-\d{2,3})\]/g)].map((m) => m[1]))],
      excerpt: tidyExcerpt(content),
    })
  }

  let error = null
  if (!parsedAny && looksLikeError(textOut)) error = textOut.slice(0, 600)
  return { sources, error }
}

function looksLikeError(s) {
  return /^\s*(error|exception|failed|failure)\b/i.test(s) ||
    /\b(HTTP\s*)?(4\d\d|5\d\d)\b.*\b(error|bad request|unauthori[sz]ed|forbidden|not found)\b/i.test(s) ||
    /api-version/i.test(s)
}

/** Prefer sources whose sections are cited in the answer; otherwise return all retrieved passages. */
function selectCitedSources(text, sources) {
  if (!sources.length) return []
  const cited = new Set([...text.matchAll(/\b([A-Z]{2,12}-\d{2,3})\b/g)].map((m) => m[1]))
  if (!cited.size) return sources.slice(0, 8).map((s) => ({ ...s, cited: false }))
  const matched = sources.filter((s) => s.sections.some((sec) => cited.has(sec)))
  const list = matched.length ? matched : sources.slice(0, 8)
  return list.map((s) => ({ ...s, cited: matched.length > 0, citedSections: s.sections.filter((section) => cited.has(section)) }))
}

function tidyExcerpt(content) {
  const clean = content
    .replace(/={6,}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return clean.length > 6000 ? `${clean.slice(0, 6000).trimEnd()}…` : clean
}

function friendlyToolName(name) {
  if (!name) return 'Tool'
  if (/knowledge_base_retrieve/i.test(name)) return 'Knowledge base search'
  return name.replace(/___/g, ' › ').replace(/_/g, ' ')
}

function stringifyError(err) {
  if (typeof err === 'string') return err
  return err?.message || JSON.stringify(err)
}
