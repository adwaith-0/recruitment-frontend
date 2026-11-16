// Evidence gate for the Prompt Agent (recruitment-source-agent).
//
// The model's text is released to the browser only when the response shows a SUCCESSFUL
// call to the Foundry IQ knowledge_base_retrieve MCP tool. Citations are kept only when they
// resolve to a document that was actually retrieved in this conversation; anything else is
// removed and counted. Sources shown in the UI are built exclusively from retrieved content.
//
// Decision table (see README "Grounding"):
//   tool/MCP/auth failure, or no successful retrieval   -> 503 knowledge_unavailable (no model text)
//   no knowledge-base call at all                        -> 502 retrieval_missing (no model text)
//   retrieval succeeded with zero documents              -> fixed "couldn't find verified information" reply
//   documents retrieved                                  -> model text with validated citations

import { BridgeError, knowledgeUnavailable } from './errors.js'

export const NO_EVIDENCE_MESSAGE =
  "I couldn't find verified information about that in our current documents. Please contact the recruitment team for confirmation."

export const OUT_OF_SCOPE_MESSAGE =
  "I can only help with Apprenticeship Connect's apprenticeship and recruitment guidance. Are you looking for an apprenticeship or hoping to recruit apprentices?"

const FALLBACK_PATTERN = /couldn[’']t find verified information/i
const OUT_OF_SCOPE_PATTERN = /I can only help with Apprenticeship Connect[’']s apprenticeship and recruitment guidance/i
const CODE_BLOCK = /```|~~~/
// Longest reply allowed without a valid citation (clarifying question, acknowledgement, recap).
const MAX_UNCITED_CHARS = 450
// Optional horizontal whitespace before the marker is consumed so removed markers leave no gaps.
const MARKER = /[ \t]*(?:【[^】\n]{1,200}】|\[\d{1,3}\](?!\())/g
const SOURCE_ID = /\bac_[0-9a-f]{8,40}\b/i
const MAX_EXCERPT = 6000
const MAX_THREAD_DOCUMENTS = 80

const KNOWLEDGE_SOURCE_LABELS = {
  'employer-docs': 'Employer guidance',
  'apprentice-docs': 'Apprentice guidance',
  policesshared: 'Policies',
}

/**
 * Reads every knowledge-base MCP interaction from a Responses API output array.
 * @returns {{ calls: Array<{ ok: boolean, error: string|null, documents: Array<{url: string, snippet: string}> }>, listErrors: string[] }}
 */
export function extractRetrieval(output, { serverLabel, toolName }) {
  const calls = []
  const listErrors = []
  for (const item of Array.isArray(output) ? output : []) {
    if (item?.server_label && item.server_label !== serverLabel) continue
    if (item?.type === 'mcp_list_tools' && item.error) listErrors.push(stringifyError(item.error))
    if (item?.type !== 'mcp_call' || item.name !== toolName) continue
    if (item.error || item.status === 'failed' || item.status === 'incomplete') {
      calls.push({ ok: false, error: stringifyError(item.error) || `status ${item.status}`, documents: [] })
      continue
    }
    const parsed = parseToolOutput(item.output)
    calls.push(parsed.ok ? { ok: true, error: null, documents: parsed.documents } : { ok: false, error: parsed.error, documents: [] })
  }
  return { calls, listErrors }
}

/**
 * knowledge_base_retrieve output as delivered inside Foundry Agent Service:
 *   {"documents":[{"id","url","title","content":"{\"uid\",\"blob_url\",\"snippet\"}", ...}]}
 * Also accepts the raw MCP shape returned by the search service directly:
 *   [{"ref_id":0,"content":"..."}]
 */
export function parseToolOutput(output) {
  const raw = typeof output === 'string' ? output : JSON.stringify(output ?? null)
  // A successful call with no matches returns an empty body (observed live: "\n").
  if (!raw.trim() || raw.trim() === 'null') return { ok: true, error: null, documents: [] }
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Knowledge-base tool returned an unreadable result.', documents: [] }
  }
  const items = Array.isArray(value?.documents) ? value.documents : Array.isArray(value) ? value : null
  if (!items) {
    return { ok: false, error: value?.error ? stringifyError(value.error) : 'Unexpected knowledge-base tool result.', documents: [] }
  }
  const documents = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    let content = item.content
    if (typeof content === 'string' && content.trim().startsWith('{')) {
      try {
        content = JSON.parse(content)
      } catch {
        // Plain-text content; used as the snippet below.
      }
    }
    const snippet = typeof content === 'string' ? content : typeof content?.snippet === 'string' ? content.snippet : ''
    const url = item.url || content?.blob_url || null
    if (!snippet.trim()) continue
    documents.push({ url: url || `kb-ref:${item.ref_id ?? item.id ?? documents.length}`, snippet })
  }
  return { ok: true, error: null, documents }
}

/** Human-meaningful metadata taken from the document content itself (never invented). */
export function describeDocument(url, snippet) {
  const title = snippet.match(/^#\s+(.+?)\s*$/m)?.[1]
  const publicUrl = snippet.match(/Canonical source URL:\s*<?(https:\/\/[^\s>]+)>?/i)?.[1] ?? null
  const sourceId = snippet.match(/Source ID:\s*`?(ac_[0-9a-f]+)`?/i)?.[1] ?? null
  const captured = snippet.match(/Captured:\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null
  let container = null
  let fileName = null
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean)
    container = path[0] ?? null
    fileName = decodeURIComponent(path.at(-1) ?? '')
  } catch {
    // kb-ref: placeholder URL
  }
  return {
    title: title || prettifyFileName(fileName) || 'Knowledge base document',
    publicUrl,
    sourceId,
    captured,
    knowledgeSource: KNOWLEDGE_SOURCE_LABELS[container] ?? null,
  }
}

/** Merge documents into a url-keyed map (the conversation's verified evidence pool). */
export function mergeDocuments(target, documents) {
  for (const doc of documents) {
    let entry = target.get(doc.url)
    if (!entry) {
      entry = { url: doc.url, snippets: [], ...describeDocument(doc.url, doc.snippet) }
      target.set(doc.url, entry)
    } else {
      target.delete(doc.url) // re-insert to keep most recently retrieved last
      target.set(doc.url, entry)
      const meta = describeDocument(doc.url, doc.snippet)
      for (const key of ['publicUrl', 'sourceId', 'captured']) entry[key] ??= meta[key]
    }
    if (!entry.snippets.includes(doc.snippet)) entry.snippets.push(doc.snippet)
  }
  while (target.size > MAX_THREAD_DOCUMENTS) target.delete(target.keys().next().value)
  return target
}

/**
 * Validate a Prompt Agent response and turn it into the bridge's client payload.
 * @param {object} data Responses API JSON
 * @param {{ serverLabel: string, toolName: string, knownDocuments?: Map<string, object> }} options
 * @returns {{ payload: object, accept: boolean, documents: Array }}
 */
export function groundResponse(data, { serverLabel, toolName, knownDocuments = new Map() }) {
  const output = Array.isArray(data?.output) ? data.output : []
  const { calls, listErrors } = extractRetrieval(output, { serverLabel, toolName })
  const okCalls = calls.filter((c) => c.ok)
  const failed = calls.filter((c) => !c.ok)
  const diagnostics = { retrievalCalls: calls.length, failedCalls: failed.length, listErrors: listErrors.length }

  if (!okCalls.length) {
    if (failed.length || listErrors.length || data?.error?.code === 'tool_user_error') {
      const err = knowledgeUnavailable()
      err.diagnostics = { ...diagnostics, upstreamCode: data?.error?.code, firstError: failed[0]?.error || listErrors[0] }
      throw err
    }
    if (data?.status === 'failed') throw agentFailed(data, diagnostics)
    const err = new BridgeError(502, 'retrieval_missing', 'The assistant did not search our documents, so its answer was withheld.', {
      hint: 'Please try again. Answers are only shown when they are based on retrieved documents.',
      retryable: true,
    })
    err.diagnostics = diagnostics
    throw err
  }
  if (data?.status === 'failed') throw agentFailed(data, diagnostics)

  const documents = okCalls.flatMap((c) => c.documents)
  const base = {
    toolCalls: calls.map((c) => ({ name: 'Knowledge base search', status: c.ok ? 'completed' : 'failed' })),
    // Partial failures are reported without upstream details (those go to server logs).
    toolIssues: failed.length ? [{ tool: 'Knowledge base search', message: 'One of the document searches failed; the answer uses the searches that succeeded.' }] : [],
    citations: [],
    agentVersion: data.agent_reference?.version ?? null,
    status: data.status || 'completed',
    incompleteReason: data.status === 'incomplete' ? data.incomplete_details?.reason || 'unknown' : null,
    usage: data.usage ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens } : null,
  }

  if (!documents.length) {
    return {
      accept: false,
      documents,
      payload: { ...base, text: NO_EVIDENCE_MESSAGE, sources: [], grounding: { status: 'no_evidence', documentsRetrieved: 0, citedSources: 0, removedCitations: 0 } },
    }
  }

  const pool = mergeDocuments(new Map([...knownDocuments].map(([k, v]) => [k, { ...v, snippets: [...v.snippets] }])), documents)
  const singleCallDocs = okCalls.length === 1 ? okCalls[0].documents : null
  const { text, cited, removed } = rewriteCitations(assistantParts(output), pool, singleCallDocs)

  if (!text) {
    throw new BridgeError(502, 'empty_response', 'The agent returned no text output.', {
      hint: base.incompleteReason ? `Response incomplete: ${base.incompleteReason}.` : undefined,
      retryable: true,
    })
  }

  const docCount = new Set(documents.map((d) => d.url)).size
  const withheld = (status, message) => ({
    accept: false,
    documents,
    payload: { ...base, text: message, sources: [], grounding: { status, documentsRetrieved: docCount, citedSources: 0, removedCitations: removed } },
  })
  // Scope enforcement: the assistant never outputs code, whatever the model produced.
  if (CODE_BLOCK.test(text)) return withheld('out_of_scope', OUT_OF_SCOPE_MESSAGE)
  const outOfScope = OUT_OF_SCOPE_PATTERN.test(text)
  const notFound = FALLBACK_PATTERN.test(text)
  // A substantive (long) reply must be backed by at least one valid citation. Short uncited replies
  // are allowed: clarifying questions, acknowledgements and recaps of what the user said.
  if (!outOfScope && !notFound && cited.length === 0 && text.length > MAX_UNCITED_CHARS) {
    return withheld('withheld_uncited', NO_EVIDENCE_MESSAGE)
  }
  const sources = notFound || outOfScope ? [] : cited.map((entry, index) => toSource(entry, index))
  if (outOfScope) {
    return { accept: true, documents, payload: { ...base, text: OUT_OF_SCOPE_MESSAGE, sources: [], grounding: { status: 'out_of_scope', documentsRetrieved: docCount, citedSources: 0, removedCitations: removed } } }
  }
  return {
    accept: true,
    documents,
    payload: {
      ...base,
      text: notFound ? stripCitationMarkers(text) : text,
      sources,
      grounding: {
        status: notFound ? 'not_found' : sources.length ? 'cited' : 'uncited',
        documentsRetrieved: docCount,
        citedSources: sources.length,
        removedCitations: removed,
      },
    },
  }
}

/** Final assistant message parts (text + url_citation annotations), in order. */
function assistantParts(output) {
  const messages = output.filter((item) => item?.type === 'message' && (!item.role || item.role === 'assistant'))
  const finals = messages.filter((m) => m.phase === 'final_answer')
  const parts = []
  for (const message of finals.length ? finals : messages) {
    for (const part of message.content ?? []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') parts.push(part)
      else if (part?.type === 'refusal' && part.refusal) parts.push({ text: part.refusal, annotations: [] })
    }
  }
  return parts
}

/**
 * Replace citation markers with [n] (n = index into the returned sources) when they resolve to
 * retrieved evidence; drop them otherwise. Foundry's url_citation annotations are preferred
 * because the platform generates them from the actual tool result.
 */
function rewriteCitations(parts, pool, singleCallDocs) {
  const order = new Map() // url -> number
  let removed = 0
  const texts = parts.map((part) => {
    const annotations = (part.annotations ?? []).filter(
      (a) => a?.type === 'url_citation' && Number.isInteger(a.start_index) && Number.isInteger(a.end_index),
    )
    return part.text.replace(MARKER, (match, matchOffset) => {
      const marker = match.trimStart()
      const offset = matchOffset + match.length - marker.length
      if (marker.startsWith('[')) {
        removed++ // bare [n] markers are not produced by the tool; never let them map to a source
        return ''
      }
      const end = offset + marker.length
      let url = annotations.find((a) => a.start_index < end && a.end_index > offset)?.url
      if (!url || !pool.has(url)) url = resolveBySourceId(marker, pool) ?? url
      if ((!url || !pool.has(url)) && singleCallDocs) {
        const index = Number(marker.match(/^【\d+:(\d+)†/)?.[1])
        if (Number.isInteger(index)) url = singleCallDocs[index]?.url ?? url
      }
      if (!url || !pool.has(url)) {
        removed++
        return ''
      }
      if (!order.has(url)) order.set(url, order.size + 1)
      return ` [${order.get(url)}]`
    })
  })
  const text = texts
    .join('\n\n')
    .replace(/(\[(\d+)\])(?:\s*\[\2\])+/g, '$1')
    .trim()
  return { text, cited: [...order.keys()].map((url) => pool.get(url)), removed }
}

function agentFailed(data, diagnostics) {
  const err = new BridgeError(502, 'agent_failed', 'The assistant could not complete this response.', {
    hint: 'Please try again.',
    retryable: true,
  })
  err.diagnostics = { ...diagnostics, upstreamCode: data?.error?.code }
  return err
}

function resolveBySourceId(marker, pool) {
  const id = marker.match(SOURCE_ID)?.[0]?.toLowerCase()
  if (!id) return null
  for (const entry of pool.values()) if (entry.sourceId?.toLowerCase() === id) return entry.url
  return null
}

function stripCitationMarkers(text) {
  return text.replace(/\s*\[\d+\]/g, '').trim()
}

function toSource(entry, index) {
  const excerpt = entry.snippets.map(cleanSnippet).filter(Boolean).join('\n\n…\n\n')
  return {
    refId: String(index + 1),
    document: entry.title,
    title: entry.title,
    publicUrl: entry.publicUrl,
    sourceId: entry.sourceId,
    captured: entry.captured,
    knowledgeSource: entry.knowledgeSource,
    sections: [],
    cited: true,
    excerpt: excerpt.length > MAX_EXCERPT ? `${excerpt.slice(0, MAX_EXCERPT).trimEnd()}…` : excerpt,
  }
}

function cleanSnippet(snippet) {
  return snippet
    .replace(/^Canonical source URL:.*$/gim, '')
    .replace(/^Source ID:.*$/gim, '')
    .replace(/^Captured:.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function prettifyFileName(name) {
  if (!name) return null
  return name
    .replace(/\.(md|pdf|docx?|txt|html?)$/i, '')
    .replace(/--ac_[0-9a-f]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim()
}

function stringifyError(err) {
  if (!err) return ''
  if (typeof err === 'string') return err.slice(0, 500)
  return String(err.message || err.code || JSON.stringify(err)).slice(0, 500)
}
