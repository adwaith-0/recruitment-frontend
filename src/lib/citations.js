export const SOURCE_PREFIX = '#source-'

export function safeSourceUrl(value) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

export function sourceTitle(source) {
  const sections = source.citedSections?.length ? source.citedSections : source.sections ?? []
  for (const section of sections) {
    const heading = (source.excerpt ?? '').split('\n').find((line) => /^\s*(?:\d{1,2}[.)]|#{1,6})\s+/.test(line) && line.trim().endsWith(`[${section}]`))
    if (heading) {
      const title = heading.replace(/^\s*(?:\d{1,2}[.)]|#{1,6})\s+/, '').replace(/\s*\[[^\]]+\]\s*$/, '').trim()
      return title === title.toUpperCase() ? title.charAt(0) + title.slice(1).toLowerCase().replace(/\bai\b/g, 'AI') : title
    }
  }
  let title = source.title || source.document || 'Knowledge base'
  try { title = decodeURIComponent(title) } catch { /* Keep the original title. */ }
  title = title.split(/[\\/]/).pop().split(/[?#]/)[0]
    .replace(/\.(pdf|docx?|txt|md|html?|csv)$/i, '')
    .replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return title || 'Knowledge base'
}

export function buildReferences(sources = [], citations = []) {
  const references = sources.map((source, index) => ({
    ...source,
    key: `document-${index + 1}`,
    number: index + 1,
    kind: 'document',
    title: sourceTitle(source),
    sections: source.sections ?? [],
    // Search-index and storage URIs are private locators, never shown as links. Only the
    // public page URL recorded inside the retrieved document itself (publicUrl) is linked.
    url: safeSourceUrl(source.publicUrl),
  }))
  for (const citation of citations) {
    const url = safeSourceUrl(citation.url)
    const existing = references.find((reference) => url ? reference.url === url : reference.kind === 'file' && reference.title === citation.title)
    if (existing) {
      existing.ranges.push(...(citation.ranges ?? []))
      continue
    }
    references.push({
      ...citation,
      key: `reference-${references.length + 1}`,
      number: references.length + 1,
      kind: url ? 'web' : 'file',
      title: citation.title && citation.title !== citation.url ? citation.title : (url ? new URL(url).hostname.replace(/^www\./, '') : 'Document'),
      sections: [],
      url,
      ranges: [...(citation.ranges ?? [])],
    })
  }
  return references
}

/** The knowledge base a cited document came from, e.g. "Apprentice guidance". */
export function citationLabel(reference) {
  return reference?.knowledgeSource || 'Knowledge base'
}

/**
 * Runs after remarkSourceCitations: when several citations in a row point to the same knowledge
 * base, keep one chip (e.g. "[1] [2]" from two apprentice documents -> one "Apprentice guidance").
 */
export function remarkCollapseCitations({ references }) {
  const byKey = new Map(references.map((reference) => [reference.key, reference]))
  const labelOf = (node) => {
    if (node?.type !== 'link' || !node.url?.startsWith(SOURCE_PREFIX)) return null
    const reference = byKey.get(node.url.slice(SOURCE_PREFIX.length))
    return reference ? citationLabel(reference) : null
  }
  // All citation chips inside a node (deep), as { parent, node } pairs.
  const chipsIn = (node, out = []) => {
    for (const child of node.children ?? []) {
      if (labelOf(child)) out.push({ parent: node, node: child })
      else chipsIn(child, out)
    }
    return out
  }
  // In a list where every item cites the same single knowledge base, keep the chip on the last item only.
  function collapseList(list) {
    const items = list.children ?? []
    if (items.length < 2) return
    const perItem = items.map((item) => chipsIn(item))
    const labels = new Set(perItem.flat().map(({ node }) => labelOf(node)))
    if (labels.size !== 1 || perItem.some((chips) => !chips.length)) return
    for (const chips of perItem.slice(0, -1)) {
      for (const { parent, node } of chips) parent.children = parent.children.filter((child) => child !== node)
    }
  }
  function walk(node) {
    if (!node.children || ['code', 'inlineCode'].includes(node.type)) return
    if (node.type === 'list') collapseList(node)
    const kept = []
    for (const child of node.children) {
      const label = labelOf(child)
      if (label) {
        // Look back past whitespace-only text to the previous kept node.
        let i = kept.length - 1
        while (i >= 0 && kept[i].type === 'text' && !kept[i].value.trim()) i--
        if (i >= 0 && labelOf(kept[i]) === label) {
          kept.length = i + 1
          continue
        }
      }
      walk(child)
      kept.push(child)
    }
    node.children = kept
  }
  return walk
}

export function shortSourceTitle(title) {
  if (title.length <= 27) return title
  return `${title.slice(0, 25).replace(/\s+\S*$/, '').trimEnd()}…`
}

function citationLink(reference) {
  return { type: 'link', url: `${SOURCE_PREFIX}${reference.key}`, children: [{ type: 'text', value: reference.title }] }
}

// Apply real URL-annotation positions before Markdown parsing. Keep the cited
// words when the range describes prose rather than a generated citation marker.
export function applyCitationAnnotations(text, references) {
  const ranges = references.flatMap((reference) => (reference.ranges ?? []).map((range) => ({ ...range, reference })))
    .filter(({ startIndex, endIndex }) => Number.isInteger(startIndex) && Number.isInteger(endIndex) && startIndex >= 0 && endIndex > startIndex && endIndex <= text.length)
    .sort((a, b) => a.startIndex - b.startIndex)
  let cursor = 0
  let output = ''
  for (const { startIndex, endIndex, reference } of ranges) {
    if (startIndex < cursor) continue
    const original = text.slice(startIndex, endIndex)
    const isMarker = /^(?:【[^】]+】|[^]+|\[\d+\])$/.test(original)
    output += text.slice(cursor, startIndex) + (isMarker ? '' : original)
    output += ` [source](${SOURCE_PREFIX}${reference.key})`
    cursor = endIndex
  }
  return output + text.slice(cursor)
}

// Work on Markdown text nodes so code blocks, inline code, and existing links
// retain their literal content. Only known marker formats become citations.
export function remarkSourceCitations({ references }) {
  const bySection = new Map()
  const byRefId = new Map()
  for (const reference of references) {
    for (const section of reference.sections) if (!bySection.has(section)) bySection.set(section, reference)
    if (reference.refId != null) byRefId.set(String(reference.refId), reference)
  }
  const markerPattern = /【([^】\n]{1,180})】|\[([A-Z]{2,12}-\d{2,3}\b[^\]\n]{0,160})\]|\[(\d{1,3})\]/g

  function splitText(value) {
    const nodes = []
    let cursor = 0
    for (const match of value.matchAll(markerPattern)) {
      const inner = match[1] ?? match[2] ?? match[3]
      const sections = inner.match(/\b[A-Z]{2,12}-\d{2,3}\b/g)
      const codes = sections || (/^\d{1,3}(?:†[^\n]*)?$/.test(inner) ? [inner.replace(/†.*$/, '')] : [])
      if (!codes.length) continue
      nodes.push({ type: 'text', value: value.slice(cursor, match.index) })
      const seen = new Set()
      for (const code of codes) {
        const reference = bySection.get(code) || (match[3] ? references[Number(code) - 1] : byRefId.get(code))
        if (reference && !seen.has(reference.key)) {
          nodes.push(citationLink(reference))
          seen.add(reference.key)
        } else if (!reference) {
          nodes.push({ type: 'link', url: '#source-unavailable', children: [{ type: 'text', value: code }] })
        }
      }
      cursor = match.index + match[0].length
    }
    nodes.push({ type: 'text', value: value.slice(cursor) })
    return nodes
  }

  function walk(node) {
    if (!node.children || ['link', 'code', 'inlineCode'].includes(node.type)) return
    node.children = node.children.flatMap((child) => {
      if (child.type === 'text') return splitText(child.value)
      walk(child)
      return [child]
    })
  }
  return walk
}
