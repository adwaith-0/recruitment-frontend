// Response fixtures shaped like real recruitment-source-agent Responses API output
// (captured structure from a live call; content shortened and synthetic).

export const EMPLOYERS_URL = 'https://ragstorage4u.blob.core.windows.net/employer-docs/employers--ac_09ddbeb42f29aa03caa7.md'
export const APPRENTICES_URL = 'https://ragstorage4u.blob.core.windows.net/apprentice-docs/apprentices--ac_e8d1f357baa51852ce43.md'

const employerSnippet =
  '# Employers\n\nCanonical source URL: <https://apprenticeshipconnect.co.uk/apprenticeship-recruitment/>\n\n' +
  'Source ID: `ac_09ddbeb42f29aa03caa7`\n\nCaptured: 2026-11-09T11:07:52.538000Z\n\n' +
  'Step 1: Tell us what you need\n\nStep 2: Candidate sourcing and screening'
const apprenticeSnippet =
  '# Apprentices\n\nCanonical source URL: <https://apprenticeshipconnect.co.uk/apprenticeship-eligibility/>\n\n' +
  'Source ID: `ac_e8d1f357baa51852ce43`\n\nCaptured: 2026-11-09T11:07:51.480000Z\n\nStep 1: Choose your course'

export function kbDocument(url, snippet) {
  return { id: crypto.randomUUID(), url, title: url, metadata: 'application/json', knowledgeSourceIndex: '0', content: JSON.stringify({ uid: 'x', blob_url: url, snippet }) }
}

export function mcpCall(documents, extra = {}) {
  return {
    type: 'mcp_call',
    id: `mcp_${Math.random().toString(36).slice(2)}`,
    server_label: 'knowledge-base',
    name: 'knowledge_base_retrieve',
    arguments: '{"query_variants":["employer recruitment process"]}',
    output: documents == null ? null : JSON.stringify({ documents }),
    error: null,
    status: 'completed',
    ...extra,
  }
}

export function message(text, annotations = []) {
  return { type: 'message', role: 'assistant', phase: 'final_answer', status: 'completed', content: [{ type: 'output_text', text, annotations }] }
}

/** Annotate every occurrence of `marker` in `text` with a url_citation to `url`. */
export function annotate(text, marker, url) {
  const out = []
  let i = text.indexOf(marker)
  while (i !== -1) {
    out.push({ type: 'url_citation', url, title: url, start_index: i, end_index: i + marker.length })
    i = text.indexOf(marker, i + 1)
  }
  return out
}

export function response(output, extra = {}) {
  return {
    id: `resp_${Math.random().toString(36).slice(2)}`,
    object: 'response',
    status: 'completed',
    agent_reference: { type: 'agent_reference', name: 'recruitment-source-agent', version: '2' },
    output: [{ type: 'mcp_list_tools', server_label: 'knowledge-base', tools: [{ name: 'knowledge_base_retrieve' }] }, ...output],
    usage: { input_tokens: 100, output_tokens: 20 },
    ...extra,
  }
}

export const employerDocs = [kbDocument(EMPLOYERS_URL, employerSnippet), kbDocument(EMPLOYERS_URL, employerSnippet.replace('Step 1', 'Step 3: You make an offer\n\nStep 1'))]
export const apprenticeDocs = [kbDocument(APPRENTICES_URL, apprenticeSnippet)]

/** A grounded employer answer citing the employer document (by annotation) - like the live agent. */
export function groundedEmployerResponse() {
  const marker = '【7:0†ac_09ddbeb42f29aa03caa7】'
  const text = `First, tell Apprenticeship Connect what you need. ${marker}\n\nThen candidates are sourced and screened. ${marker}`
  return response([mcpCall(employerDocs), message(text, annotate(text, marker, EMPLOYERS_URL))])
}

/** Foundry's 400 for an MCP connection that fails authentication (as reproduced live). */
export const toolUserError = {
  error: { message: 'A user error occurred while executing a tool call.', type: 'invalid_request_error', param: null, code: 'tool_user_error', request_id: 'req_test' },
}
