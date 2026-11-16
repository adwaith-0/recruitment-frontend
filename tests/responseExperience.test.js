import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGuideMarkdown, followUpSuggestions, hasActionPlan, highlightMatches, remarkActionPlans } from '../src/lib/responseExperience.js'

test('procedural replies qualify for a checklist while course rankings and code samples do not', () => {
  assert.equal(hasActionPlan('Your next steps:\n\n1. **Choose a course.** Review the options.\n2. **Prepare your documents.** Keep them ready.'), true)
  assert.equal(hasActionPlan('1. Business administration\n2. Early years education'), false)
  assert.equal(hasActionPlan('```md\n1. Choose a course\n2. Prepare a profile\n```'), false)
  assert.equal(hasActionPlan('1. Prepare a profile.'), false)
})

test('checklist enhancement keeps original nested content and citations intact', () => {
  const first = { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Choose a course. [APP-01]' }] }, { type: 'list', ordered: false, children: [] }] }
  const second = { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Prepare your application.' }] }] }
  const list = { type: 'list', ordered: true, children: [first, second] }
  const tree = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Your next steps:' }] }, list] }
  remarkActionPlans()(tree)
  assert.equal(list.data.hProperties['data-action-plan'], 'plan-0')
  assert.equal(list.children[0], first)
  assert.equal(first.children[0].children[0].value, 'Choose a course. [APP-01]')
  assert.equal(first.children[1].type, 'list')
})

test('follow-up buttons ask contextual questions rather than claim completed actions', () => {
  assert.equal(followUpSuggestions('I want to hire apprentices.')[0].label, 'Build a hiring brief')
  assert.equal(followUpSuggestions('Which courses can I study?')[0].label, 'Compare my options')
  assert.equal(followUpSuggestions('How can I apply?')[0].label, 'Help me prepare')
  assert.match(followUpSuggestions('I want to hire apprentices.')[0].prompt, /missing details one at a time/)
})

test('guide downloads include the answer, knowledge base names only, and local checklist notes', () => {
  const references = [
    { number: 1, title: 'Apprentices', knowledgeSource: 'Apprentice guidance', sections: [], excerpt: 'Actual returned source text.', url: 'https://example.com/a' },
    { number: 2, title: 'Contact', knowledgeSource: 'Apprentice guidance', sections: [], excerpt: 'Other text.', url: null },
  ]
  const guide = buildGuideMarkdown({ text: 'Choose a course. [1] [2]\n\nRegister. [2]', references, progress: { 'plan-0': { total: 3, checked: [0, 2] } } })
  assert.match(guide, /Choose a course\. \(Apprentice guidance\)\n/)
  assert.match(guide, /Register\. \(Apprentice guidance\)/)
  assert.equal((guide.match(/^- Apprentice guidance$/gm) ?? []).length, 1)
  assert.match(guide, /steps 1, 3 marked, out of 3/)
  assert.doesNotMatch(guide, /Actual returned source text|example\.com/)
  assert.match(guide, /do not submit an application/)
})

test('source search highlights literal punctuation and preserves every character', () => {
  const source = 'Apply (online). Then apply (online).'
  const result = highlightMatches(source, '(ONLINE)')
  assert.equal(result.count, 2)
  assert.equal(result.parts.map((part) => part.text).join(''), source)
  assert.equal(highlightMatches(source, 'not found').count, 0)
  assert.equal(highlightMatches(source, '').parts[0].text, source)
})
