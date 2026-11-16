import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCitationAnnotations, buildReferences, remarkSourceCitations, safeSourceUrl } from '../src/lib/citations.js'
// Legacy hosted-agent parser (rollback path). Fixtures do not invoke Azure or depend on .env.
process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://test.services.ai.azure.com/api/projects/test'
process.env.FOUNDRY_AGENT_NAME = 'test-agent'
const { parseResponse } = await import('../server/hostedAgent.js')

const sources = [
  { refId: '0', document: 'https://storage.example/guides/Recruitment%20Guide.pdf', sections: ['EMP-01', 'EMP-02'], excerpt: 'Confirm the role before applying.', cited: true },
  { refId: '1', document: 'Courses_and_eligibility.txt', sections: ['APP-01'], excerpt: 'Review the entry requirements.', cited: true },
]

test('source labels use readable document names and never link private search URIs', () => {
  const references = buildReferences([{ ...sources[0], uri: 'https://private.search.windows.net/index' }])
  assert.equal(references[0].title, 'Recruitment Guide')
  assert.equal(references[0].url, null)
  assert.equal(safeSourceUrl('javascript:alert(1)'), null)
  assert.equal(safeSourceUrl('data:text/html,test'), null)
})

test('grouped section citations share a badge per document and preserve inline code and links', () => {
  const tree = { type: 'root', children: [{ type: 'paragraph', children: [
    { type: 'text', value: 'Confirm the role.【EMP-01 / EMP-02 / APP-01】 ' },
    { type: 'inlineCode', value: '【EMP-01】' },
    { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: '[APP-01]' }] },
    { type: 'text', value: '【EMP-99】' },
  ] }] }
  remarkSourceCitations({ references: buildReferences(sources) })(tree)
  const children = tree.children[0].children
  assert.deepEqual(children.filter((node) => node.type === 'link').map((node) => node.url), ['#source-document-1', '#source-document-2', 'https://example.com', '#source-unavailable'])
  assert.equal(children.find((node) => node.type === 'inlineCode').value, '【EMP-01】')
  assert.equal(children.find((node) => node.url === 'https://example.com').children[0].value, '[APP-01]')
})

test('Foundry ref IDs and numbered citations resolve to the real returned source', () => {
  const tree = { type: 'root', children: [{ type: 'text', value: 'A【0†source】 B[2] C【notice】' }] }
  remarkSourceCitations({ references: buildReferences(sources) })(tree)
  assert.deepEqual(tree.children.filter((node) => node.type === 'link').map((node) => node.url), ['#source-document-1', '#source-document-2'])
  assert.ok(tree.children.some((node) => node.value?.includes('【notice】')))
})

test('real agent section-and-step markers render as citations, including bold Markdown content', () => {
  const tree = { type: 'root', children: [{ type: 'strong', children: [{ type: 'text', value: '[EMP-01, Step A1] [EMP-02, Steps A4–A5; APP-01]' }] }] }
  remarkSourceCitations({ references: buildReferences(sources) })(tree)
  assert.deepEqual(tree.children[0].children.filter((node) => node.type === 'link').map((node) => node.url), ['#source-document-1', '#source-document-1', '#source-document-2'])
})

test('real section headings provide human source titles instead of repeated storage filenames', () => {
  const references = buildReferences([{ ...sources[0], citedSections: ['EMP-02'], excerpt: '06. EMPLOYER ROLE REVIEW [EMP-02]\nConfirm the role before publication.' }])
  assert.equal(references[0].title, 'Employer role review')
})

test('URL annotations keep prose and replace markers without changing the cited claim', () => {
  const text = 'Read this policy.【0†source】'
  const references = buildReferences([], [{ title: 'Policy', url: 'https://example.com/policy', ranges: [{ startIndex: 17, endIndex: text.length }] }])
  assert.equal(applyCitationAnnotations(text, references), 'Read this policy. [source](#source-reference-1)')
  references[0].ranges = [{ startIndex: 10, endIndex: 16 }]
  assert.equal(applyCitationAnnotations('Read this policy.', references), 'Read this policy [source](#source-reference-1).')
})

test('bridge preserves repeated URL annotation ranges across output parts and trimmed whitespace', () => {
  const response = parseResponse({ id: 'response_test', output: [{ type: 'message', role: 'assistant', content: [
    { type: 'output_text', text: '  One [1]', annotations: [{ type: 'url_citation', title: 'Policy', url: 'https://example.com', start_index: 6, end_index: 9 }] },
    { type: 'output_text', text: 'Two [1]', annotations: [{ type: 'url_citation', title: 'Policy', url: 'https://example.com', start_index: 4, end_index: 7 }] },
  ] }] })
  assert.equal(response.text, 'One [1]\n\nTwo [1]')
  assert.equal(response.citations.length, 1)
  assert.deepEqual(response.citations[0].ranges, [{ startIndex: 4, endIndex: 7 }, { startIndex: 13, endIndex: 16 }])
  assert.equal((applyCitationAnnotations(response.text, buildReferences([], response.citations)).match(/#source-reference-1/g) ?? []).length, 2)
})

test('bridge associates section citations with their actual retrieved passage', () => {
  const response = parseResponse({ id: 'response_test', output: [
    { type: 'function_call', call_id: 'retrieve', name: 'knowledge_base_retrieve' },
    { type: 'function_call_output', call_id: 'retrieve', output: JSON.stringify([{ ref_id: 0, content: '[EMP-01] Recruitment\nConfirm the role before applying.' }, { ref_id: 1, content: '[APP-01] Entry requirements' }]) },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Confirm the role.【EMP-01】' }] },
  ] })
  assert.equal(response.sources.length, 1)
  assert.equal(response.sources[0].refId, '0')
  assert.equal(response.sources[0].cited, true)
  assert.match(response.sources[0].excerpt, /Confirm the role/)
})

test('citation chips are labelled by knowledge base, and adjacent same-base chips collapse to one', async () => {
  const { citationLabel, remarkCollapseCitations } = await import('../src/lib/citations.js')
  const references = buildReferences([
    { refId: '1', title: 'Apprentices', knowledgeSource: 'Apprentice guidance', excerpt: 'a', sections: [] },
    { refId: '2', title: 'Contact', knowledgeSource: 'Apprentice guidance', excerpt: 'b', sections: [] },
    { refId: '3', title: 'Employers', knowledgeSource: 'Employer guidance', excerpt: 'c', sections: [] },
  ])
  assert.equal(citationLabel(references[0]), 'Apprentice guidance')
  assert.equal(citationLabel({}), 'Knowledge base')
  const tree = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Choose a course. [1] [2] [3] Then register. [2]' }] }] }
  remarkSourceCitations({ references })(tree)
  remarkCollapseCitations({ references })(tree)
  const links = tree.children[0].children.filter((n) => n.type === 'link').map((n) => n.url)
  assert.deepEqual(links, ['#source-document-1', '#source-document-3', '#source-document-2'])
})

test('a list citing one knowledge base on every item shows the chip only on the last item', async () => {
  const { remarkCollapseCitations } = await import('../src/lib/citations.js')
  const references = buildReferences([{ refId: '1', title: 'Employers', knowledgeSource: 'Employer guidance', excerpt: 'a', sections: [] }])
  const item = (text) => ({ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }] })
  const tree = { type: 'root', children: [{ type: 'list', ordered: true, children: [item('Tell us. [1]'), item('Screening. [1]'), item('Offer. [1]')] }] }
  remarkSourceCitations({ references })(tree)
  remarkCollapseCitations({ references })(tree)
  const counts = tree.children[0].children.map((li) => li.children[0].children.filter((n) => n.type === 'link').length)
  assert.deepEqual(counts, [0, 0, 1])
})
