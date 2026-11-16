import assert from 'node:assert/strict'
import test from 'node:test'
import { describeDocument, groundResponse, NO_EVIDENCE_MESSAGE, parseToolOutput } from '../server/grounding.js'
import {
  annotate, APPRENTICES_URL, apprenticeDocs, EMPLOYERS_URL, employerDocs, groundedEmployerResponse, mcpCall, message, response,
} from './fixtures/foundry.js'

const opts = { serverLabel: 'knowledge-base', toolName: 'knowledge_base_retrieve' }

test('grounded answer: platform annotations become numbered citations to real retrieved documents', () => {
  const { payload, accept, documents } = groundResponse(groundedEmployerResponse(), opts)
  assert.equal(accept, true)
  assert.equal(documents.length, 2)
  assert.equal(payload.grounding.status, 'cited')
  assert.equal(payload.text, 'First, tell Apprenticeship Connect what you need. [1]\n\nThen candidates are sourced and screened. [1]')
  assert.equal(payload.sources.length, 1)
  const [source] = payload.sources
  assert.equal(source.title, 'Employers')
  assert.equal(source.publicUrl, 'https://apprenticeshipconnect.co.uk/apprenticeship-recruitment/')
  assert.equal(source.sourceId, 'ac_09ddbeb42f29aa03caa7')
  assert.equal(source.captured, '2026-11-09')
  assert.equal(source.knowledgeSource, 'Employer guidance')
  assert.match(source.excerpt, /Step 3: You make an offer/) // both retrieved chunks of the document
  assert.doesNotMatch(source.excerpt, /Canonical source URL|Source ID/)
  assert.ok(!JSON.stringify(payload).includes('ragstorage4u'), 'private storage URLs are never sent to the browser')
})

test('fabricated citations (not in retrieved evidence) are removed and counted', () => {
  const fake = '【7:9†ac_ffffffffffffffffffff】'
  const text = `Employers pay no fees. ${fake} See also [3].`
  const data = response([mcpCall(employerDocs), message(text, annotate(text, fake, 'https://evil.example/fees.md'))])
  const { payload } = groundResponse(data, opts)
  assert.equal(payload.sources.length, 0)
  assert.equal(payload.grounding.removedCitations, 2)
  assert.equal(payload.grounding.status, 'uncited')
  assert.equal(payload.text, 'Employers pay no fees. See also.')
})

test('markers without annotations resolve by Source ID or by index within a single retrieval', () => {
  const text = 'Choose a course. 【3:0†ac_e8d1f357baa51852ce43】 Register interest. 【3:0†source】'
  const { payload } = groundResponse(response([mcpCall(apprenticeDocs), message(text)]), opts)
  assert.equal(payload.text, 'Choose a course. [1] Register interest. [1]')
  assert.equal(payload.sources[0].knowledgeSource, 'Apprentice guidance')
})

test('citations to documents retrieved earlier in the same conversation stay valid', () => {
  const known = new Map()
  const first = groundResponse(groundedEmployerResponse(), opts)
  for (const d of first.documents) known.set(d.url, { url: d.url, snippets: [d.snippet], ...describeDocument(d.url, d.snippet) })
  const marker = '【9:0†ac_09ddbeb42f29aa03caa7】'
  const text = `As mentioned, you make an offer. ${marker}`
  const data = response([mcpCall(apprenticeDocs), message(text, annotate(text, marker, EMPLOYERS_URL))])
  const { payload } = groundResponse(data, { ...opts, knownDocuments: known })
  assert.equal(payload.sources[0].title, 'Employers')
})

test('empty retrieval returns the fixed source-unavailable reply and is not accepted into context', () => {
  const data = response([mcpCall([]), message('Employers usually pay £500 per apprentice.')])
  const { payload, accept } = groundResponse(data, opts)
  assert.equal(accept, false)
  assert.equal(payload.text, NO_EVIDENCE_MESSAGE)
  assert.equal(payload.grounding.status, 'no_evidence')
  assert.deepEqual(payload.sources, [])
})

test('Test F shape: a successful call with an empty body ("\\n", observed live) is "no evidence", not an outage', () => {
  const data = response([{ ...mcpCall([]), output: '\n' }, message('The CEO likes pizza.')])
  const { payload, accept } = groundResponse(data, opts)
  assert.equal(accept, false)
  assert.equal(payload.text, NO_EVIDENCE_MESSAGE)
  assert.ok(!payload.text.includes('pizza'))
})

test('"not found" replies drop sources even when documents were retrieved', () => {
  const marker = '【1:0†ac_09ddbeb42f29aa03caa7】'
  const text = `I couldn't find verified information about that in our current documents. Please contact the recruitment team for confirmation. ${marker}`
  const { payload } = groundResponse(response([mcpCall(employerDocs), message(text, annotate(text, marker, EMPLOYERS_URL))]), opts)
  assert.equal(payload.grounding.status, 'not_found')
  assert.deepEqual(payload.sources, [])
  assert.ok(!payload.text.includes('['))
})

test('MCP call error (e.g. HTTP 401 from the knowledge base) -> knowledge_unavailable, model text withheld', () => {
  const data = response([
    mcpCall(null, { error: { code: -32006, message: 'HTTP_401: Authentication failed when connecting to the MCP server' }, status: 'failed' }),
    message('Here is an answer from memory.'),
  ])
  assert.throws(() => groundResponse(data, opts), (err) => {
    assert.equal(err.code, 'knowledge_unavailable')
    assert.equal(err.status, 503)
    assert.ok(!JSON.stringify(err.toJSON()).includes('memory'), 'unsourced model text is not leaked')
    assert.ok(!JSON.stringify(err.toJSON()).includes('401'), 'upstream detail stays in server logs')
    return true
  })
})

test('mcp_list_tools failure -> knowledge_unavailable', () => {
  const data = { id: 'r', status: 'completed', output: [{ type: 'mcp_list_tools', server_label: 'knowledge-base', error: { message: 'HTTP_401' } }, message('From memory.')] }
  assert.throws(() => groundResponse(data, opts), { code: 'knowledge_unavailable' })
})

test('an answer without any knowledge-base call is withheld', () => {
  const data = response([message('Apprenticeships last 12 months.')])
  assert.throws(() => groundResponse(data, opts), { code: 'retrieval_missing', status: 502 })
})

test('calls to another MCP server label do not count as retrieval', () => {
  const data = response([{ ...mcpCall(employerDocs), server_label: 'web' }, message('Answer.')])
  assert.throws(() => groundResponse(data, opts), { code: 'retrieval_missing' })
})

test('partial failure keeps the answer but reports a generic tool issue', () => {
  const ok = groundedEmployerResponse()
  ok.output.splice(1, 0, mcpCall(null, { error: { message: 'timeout' }, status: 'failed' }))
  const { payload } = groundResponse(ok, opts)
  assert.equal(payload.toolIssues.length, 1)
  assert.ok(!payload.toolIssues[0].message.includes('timeout'))
  assert.equal(payload.toolCalls.filter((c) => c.status === 'failed').length, 1)
})

test('parseToolOutput accepts the raw MCP ref_id shape and rejects unreadable output', () => {
  const raw = parseToolOutput(JSON.stringify([{ ref_id: 0, content: '# Contact\n\nSource ID: `ac_63f3914ad8210ac58bd9`' }]))
  assert.equal(raw.ok, true)
  assert.equal(raw.documents[0].url, 'kb-ref:0')
  assert.equal(parseToolOutput('Error: unauthorized').ok, false)
})

test('describeDocument only reports metadata present in the document', () => {
  const meta = describeDocument(APPRENTICES_URL, 'Plain text without headers')
  assert.equal(meta.title, 'Apprentices')
  assert.equal(meta.publicUrl, null)
  assert.equal(meta.captured, null)
})

test('Markdown structure (hard line breaks, lists) survives citation rewriting', () => {
  const marker = '【7:0†ac_09ddbeb42f29aa03caa7】'
  const text = `1. **Tell us what you need**  \n   We align the role. ${marker}\n2. **Screening**  \n   Candidates are screened.${marker}`
  const { payload } = groundResponse(response([mcpCall(employerDocs), message(text, annotate(text, marker, EMPLOYERS_URL))]), opts)
  assert.equal(payload.text, '1. **Tell us what you need**  \n   We align the role. [1]\n2. **Screening**  \n   Candidates are screened. [1]')
})

import { OUT_OF_SCOPE_MESSAGE } from '../server/grounding.js'

test('scope: a reply containing code is never released, even with retrieved documents', () => {
  const text = 'Here is a Python script:\n\n```python\nprint("hello")\n```'
  const { payload, accept } = groundResponse(response([mcpCall(employerDocs), message(text)]), opts)
  assert.equal(accept, false)
  assert.equal(payload.text, OUT_OF_SCOPE_MESSAGE)
  assert.equal(payload.grounding.status, 'out_of_scope')
  assert.deepEqual(payload.sources, [])
})

test('scope: the model’s out-of-scope refusal is normalised to the exact message without sources', () => {
  const marker = '【1:0†ac_09ddbeb42f29aa03caa7】'
  const text = `I can only help with Apprenticeship Connect's apprenticeship and recruitment guidance. ${marker} Anything else?`
  const { payload } = groundResponse(response([mcpCall(employerDocs), message(text, annotate(text, marker, EMPLOYERS_URL))]), opts)
  assert.equal(payload.text, OUT_OF_SCOPE_MESSAGE)
  assert.equal(payload.grounding.status, 'out_of_scope')
})

test('a long reply with no valid citation is withheld (knowledge-base-only answers)', () => {
  const text = 'Apprenticeships are a great way to learn. '.repeat(14)
  const { payload, accept } = groundResponse(response([mcpCall(employerDocs), message(text)]), opts)
  assert.equal(accept, false)
  assert.equal(payload.text, NO_EVIDENCE_MESSAGE)
  assert.equal(payload.grounding.status, 'withheld_uncited')
})

test('a short clarifying question without citations is allowed', () => {
  const text = 'Do you mean an IT apprenticeship, or IT roles you want to recruit for?'
  const { payload, accept } = groundResponse(response([mcpCall(employerDocs), message(text)]), opts)
  assert.equal(accept, true)
  assert.equal(payload.text, text)
  assert.equal(payload.grounding.status, 'uncited')
})

test('policy documents are labelled "Policies"', () => {
  const meta = describeDocument('https://ragstorage4u.blob.core.windows.net/policesshared/complaints-policy--ac_99623f14f4ee1909a6d9.md', '# Complaints Policy\n\nCanonical source URL: <https://apprenticeshipconnect.co.uk/wp-content/uploads/2024/03/Complaints-Policy.pdf>\n\nSource ID: `ac_99623f14f4ee1909a6d9`\n\nCaptured: 2026-11-09T11:09:32Z')
  assert.equal(meta.knowledgeSource, 'Policies')
  assert.equal(meta.title, 'Complaints Policy')
  assert.equal(meta.publicUrl, 'https://apprenticeshipconnect.co.uk/wp-content/uploads/2024/03/Complaints-Policy.pdf')
})
