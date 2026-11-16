import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, ExternalLink, FileText, Globe, Search, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Modal } from '../ui/Modal.jsx'
import { highlightMatches } from '../../lib/responseExperience.js'

function documentDetails(reference) {
  const parts = [reference.knowledgeSource, reference.captured && `Captured ${reference.captured}`]
  if (reference.sections.length) parts.push(reference.sections.join(', '))
  return parts.filter(Boolean).join(' · ')
}

function SourcePassage({ text }) {
  const [query, setQuery] = useState('')
  const excerptRef = useRef(null)
  const result = useMemo(() => highlightMatches(text, query), [text, query])
  useEffect(() => {
    if (query.trim()) excerptRef.current?.querySelector('mark')?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    else excerptRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [query])
  return <>
    <div className="source-search">
      <Search size={15} aria-hidden="true" />
      <input type="search" aria-label="Search this source" placeholder="Find a detail in this source" value={query} onChange={(event) => setQuery(event.target.value)} />
      {query && <button type="button" aria-label="Clear source search" onClick={() => setQuery('')}><X size={13} /></button>}
    </div>
    {query.trim() && <p className="source-search-count" role="status">{result.count ? `${result.count} ${result.count === 1 ? 'match' : 'matches'}` : 'No matches in this excerpt.'}</p>}
    <blockquote ref={excerptRef} className="source-excerpt scrollbar-thin">{result.parts.map((part, index) => part.match ? <mark className="source-match" key={index}>{part.text}</mark> : part.text)}</blockquote>
  </>
}

export function Sources({ references, openKey, onToggle }) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  if (!references.length) return null
  const currentIndex = references.findIndex((reference) => reference.key === openKey)
  const open = references[currentIndex]
  const cited = references.some((reference) => reference.cited || reference.kind !== 'document')

  return (
    <div className="sources">
      <button type="button" className="sources-trigger" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}>
        <BookOpen size={15} strokeWidth={1.7} aria-hidden="true" />
        <span>{cited ? 'Sources' : 'Related sources'}</span>
        <span className="source-count">{references.length}</span>
        <ChevronDown size={13} className={expanded ? 'rotate-180' : ''} aria-hidden="true" />
      </button>
      {expanded && (
        <div id={listId} className="source-list">
          {references.map((reference) => {
            const Icon = reference.kind === 'web' ? Globe : FileText
            return (
              <button type="button" key={reference.key} className="source-row" onClick={() => onToggle(reference.key)}>
                <span className="source-icon"><Icon size={16} strokeWidth={1.6} aria-hidden="true" /></span>
                <span className="source-row-text"><span>{reference.title}</span><small>{reference.kind === 'document' ? documentDetails(reference) || (reference.url ? new URL(reference.url).hostname : 'Document') : reference.url ? new URL(reference.url).hostname : 'Document'}</small></span>
                <span className="source-count">{reference.number}</span>
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            )
          })}
        </div>
      )}
      <Modal open={Boolean(open)} onClose={() => onToggle(null)} title={open?.title || 'Source'} description={open ? `Source ${open.number} of ${references.length}` : undefined} className="source-dialog">
        {open && (
          <>
            <div className="source-preview-meta"><span>{open.kind === 'web' ? 'Web source' : open.knowledgeSource || 'Document source'}</span>{open.captured && <span>Captured {open.captured}</span>}{open.sections.length > 0 && <span>{open.sections.join(' · ')}</span>}</div>
            {open.excerpt ? (
              <SourcePassage key={open.key} text={open.excerpt} />
            ) : <p className="source-empty">{open.url ? 'Open the original page to read this source.' : 'The response included this reference without a preview.'}</p>}
            <div className="source-preview-footer">
              {open.url ? <a href={open.url} target="_blank" rel="noopener noreferrer" className="source-original" aria-label={`Open original page for ${open.title} (opens in a new tab)`}>Open original <ExternalLink size={13} aria-hidden="true" /></a> : <span>Retrieved document excerpt</span>}
              <div className="source-pagination">
                <button type="button" aria-label="Previous source" disabled={currentIndex === 0} onClick={() => onToggle(references[currentIndex - 1].key)}><ArrowLeft size={16} /></button>
                <span>{open.number} / {references.length}</span>
                <button type="button" aria-label="Next source" disabled={currentIndex === references.length - 1} onClick={() => onToggle(references[currentIndex + 1].key)}><ArrowRight size={16} /></button>
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
