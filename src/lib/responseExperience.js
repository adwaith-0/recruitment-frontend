const actionVerb = /^(?:step\s+\d+\s*[:.\-–]\s*)?(?:choose|review|check|prepare|collect|gather|complete|create|confirm|submit|find|select|contact|speak|talk|decide|identify|outline|define|register|apply|wait|explore|start|tell|set|provide|upload|book|schedule|attend|assess|meet|agree|enrol|enroll|share|research|consider|build|ask|make|read|compare|discuss|verify|ensure|understand|list|get)\b/i

export function plainText(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/【[^】]+】|\[[A-Z]{2,12}-\d{2,3}[^\]\n]*\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim()
}

function nodeText(node) {
  return typeof node.value === 'string' ? node.value : (node.children ?? []).map(nodeText).join(' ')
}

export function isActionList(items, context = '') {
  if (items.length < 2 || items.length > 12) return false
  const actions = items.filter((item) => actionVerb.test(plainText(item))).length
  return actions >= 2 || (actions >= 1 && /\b(?:steps?|checklist|process|plan|getting started)\b/i.test(context))
}

export function hasActionPlan(text) {
  const withoutCode = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
  const items = [...withoutCode.matchAll(/^\d{1,2}[.)]\s+(.+)$/gm)].map((match) => match[1])
  return isActionList(items, withoutCode.slice(0, withoutCode.search(/^\d{1,2}[.)]\s+/m)))
}

// Enhance existing Markdown lists; never synthesize steps or rewrite their claims.
export function remarkActionPlans() {
  return (tree) => {
    let context = ''
    let index = 0
    for (const node of tree.children ?? []) {
      if (['heading', 'paragraph'].includes(node.type)) context = nodeText(node)
      if (node.type !== 'list' || !node.ordered) continue
      const items = node.children.map((item) => nodeText(item.children?.[0] ?? item))
      if (!isActionList(items, context)) continue
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, 'data-action-plan': `plan-${index++}` } }
    }
  }
}

export function followUpSuggestions(question) {
  if (/\b(hir(?:e|ing)|recruit|employer|staff|headcount|business)\b/i.test(question)) {
    return [
      { label: 'Build a hiring brief', prompt: 'Help me draft an apprentice hiring brief using what we have discussed. Ask for missing details one at a time.' },
      { label: 'Explain funding', prompt: 'What does your knowledge base say about apprenticeship funding for employers? Cite the relevant sources and explain anything I need to verify.' },
      { label: 'Make it a checklist', prompt: 'Turn the guidance we just discussed into a short preparation checklist, keeping the source citations.' },
    ]
  }
  if (/\b(course|qualification|training|study|learn)\b/i.test(question)) {
    return [
      { label: 'Compare my options', prompt: 'Help me compare suitable apprenticeship course options from the knowledge base. Ask about my interests first, and cite the course information.' },
      { label: 'Entry requirements', prompt: 'Explain the entry requirements for the apprenticeship options we discussed, using the sources. Flag any requirements that still need checking.' },
      { label: 'Plan my next steps', prompt: 'Give me a short step-by-step preparation plan based on our conversation, with the relevant sources.' },
    ]
  }
  return [
    { label: 'Help me prepare', prompt: 'Help me prepare for the next step we discussed. Ask me for any missing details one at a time.' },
    { label: 'Explain the process', prompt: 'Explain the application process as a short step-by-step guide, citing the relevant knowledge base sections.' },
    { label: 'What should I check?', prompt: 'Which details from your last answer should I check with the provider before proceeding? Cite the sources where available.' },
  ]
}

// Sources are identified only by knowledge base name (e.g. "Apprentice guidance").
const knowledgeBaseName = (reference) => reference.knowledgeSource || 'Knowledge base'

export function buildGuideMarkdown({ text, references, progress = {} }) {
  const body = text
    .replace(/\s*\[(\d{1,3})\](?!\()/g, (marker, n) => {
      const reference = references[Number(n) - 1]
      return reference ? ` (${knowledgeBaseName(reference)})` : marker
    })
    .replace(/( \(([^()]+)\))(?:\s*\(\2\))+/g, '$1')
  const parts = ['# Your apprenticeship guide', '', body]
  const checklists = Object.values(progress).filter((plan) => plan.checked.length)
  if (checklists.length) {
    parts.push('', '## My preparation checklist')
    checklists.forEach((plan, index) => {
      parts.push(`- Checklist ${index + 1}: steps ${plan.checked.map((step) => step + 1).join(', ')} marked, out of ${plan.total}.`)
    })
    parts.push('', 'These marks track personal preparation. They do not submit an application or complete a recruitment action.')
  }
  if (references.length) {
    parts.push('', '## Sources')
    for (const name of new Set(references.map(knowledgeBaseName))) parts.push(`- ${name}`)
  }
  parts.push('', 'AI can make mistakes. Check important details with the recruitment team.')
  return parts.join('\n')
}

export function highlightMatches(text, query) {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return { parts: [{ text, match: false }], count: 0 }
  const haystack = text.toLocaleLowerCase()
  const parts = []
  let cursor = 0
  let count = 0
  let start = haystack.indexOf(needle)
  while (start !== -1) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), match: false })
    parts.push({ text: text.slice(start, start + needle.length), match: true })
    count++
    cursor = start + needle.length
    start = haystack.indexOf(needle, cursor)
  }
  parts.push({ text: text.slice(cursor), match: false })
  return { parts, count }
}
