import { AlertTriangle, ArrowUpRight, BookOpen, Check, CircleAlert, Copy, Download, FileText, ListChecks } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { buildReferences } from '../../lib/citations.js'
import { formatFull } from '../../lib/format.js'
import { cx } from '../../lib/ui.js'
import { buildGuideMarkdown, followUpSuggestions, hasActionPlan } from '../../lib/responseExperience.js'
import { courseActions } from '../../lib/courseLinks.js'
import { CourseLinks } from './CourseLinks.jsx'
import { Markdown } from './Markdown.jsx'

export const MessageBubble = memo(function MessageBubble({ message, question, onAsk, showFollowUps }) {
  return message.author === 'user' ? <UserMessage message={message} /> : <AssistantMessage message={message} question={question} onAsk={onAsk} showFollowUps={showFollowUps} />
})

function UserMessage({ message }) {
  const failed = message.status === 'failed'
  return (
    <div className="user-message" data-message-id={message.id}>
      <div className={cx('user-bubble', failed && 'user-bubble-failed')} title={formatFull(message.createdAt)}>{message.text}</div>
      {failed && <span className="message-status"><CircleAlert size={12} /> Not answered</span>}
      {message.status === 'stopped' && <span className="message-status">Stopped</span>}
    </div>
  )
}

// Honest status notes derived from the bridge's evidence gate; never shown for greetings.
function GroundingNote({ grounding, textLength }) {
  // Only annotate real answers, not fixed refusal/fallback messages.
  if (!grounding || !['cited', 'uncited'].includes(grounding.status)) return null
  const notes = []
  if (grounding.removedCitations > 0) notes.push('Some citations could not be matched to retrieved documents and were removed.')
  if (grounding.status === 'uncited' && textLength > 280) notes.push('This reply has no document citations. Treat it as unverified.')
  if (!notes.length) return null
  return <p className="message-status"><AlertTriangle size={13} aria-hidden="true" /> {notes.join(' ')}</p>
}

function AssistantMessage({ message, question = '', onAsk, showFollowUps }) {
  const [copyState, setCopyState] = useState('idle')
  const [view, setView] = useState('guide')
  const [progress, setProgress] = useState({})
  const [downloaded, setDownloaded] = useState(false)
  const references = useMemo(() => buildReferences(message.sources, message.citations), [message.sources, message.citations])
  const isPlan = useMemo(() => hasActionPlan(message.text), [message.text])
  const suggestions = useMemo(() => followUpSuggestions(question), [question])
  const courses = useMemo(() => courseActions(message.text, question, references), [message.text, question, references])
  const updateProgress = useCallback((id, value) => setProgress((current) => ({ ...current, [id]: value })), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text)
      setCopyState('copied')
    } catch { setCopyState('failed') }
  }

  const download = () => {
    const guide = buildGuideMarkdown({ text: message.text, references, progress })
    const url = URL.createObjectURL(new Blob([guide], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'my-apprenticeship-guide.md'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setDownloaded(true)
  }

  return (
    <article className="assistant-message" data-message-id={message.id} aria-label="Assistant response">
      <div className="response-heading">
        <span className="response-kind">{isPlan ? <ListChecks size={14} /> : <BookOpen size={14} />}{isPlan ? 'Your step-by-step guide' : 'Your answer'}</span>
        {isPlan && <div className="response-view-toggle" role="group" aria-label="Answer view">
          <button type="button" aria-pressed={view === 'guide'} onClick={() => setView('guide')}><ListChecks size={12} />Guide</button>
          <button type="button" aria-pressed={view === 'text'} onClick={() => setView('text')}><FileText size={12} />Text</button>
        </div>}
      </div>
      {message.toolIssues?.length > 0 && (
        <details className="tool-warning">
          <summary><AlertTriangle size={14} /> Some sources could not be checked</summary>
          <ul>{message.toolIssues.map((issue, index) => <li key={index}>{issue.tool}: {issue.message}</li>)}</ul>
        </details>
      )}
      <GroundingNote grounding={message.grounding} textLength={message.text.length} />
      <Markdown text={message.text} references={references} interactive={isPlan && view === 'guide'} progress={progress} onProgress={updateProgress} />
      <CourseLinks {...courses} />
      {message.incompleteReason && <p className="message-status"><AlertTriangle size={13} /> Response cut short ({message.incompleteReason.replace(/_/g, ' ')}).</p>}
      <div className="message-actions">
        <button type="button" onClick={copy} aria-label={copyState === 'copied' ? 'Reply copied' : 'Copy reply'} title="Copy reply">
          {copyState === 'copied' ? <Check size={14} /> : <Copy size={14} strokeWidth={1.7} />}<span>{copyState === 'copied' ? 'Copied' : 'Copy'}</span>
        </button>
        <button type="button" onClick={download} aria-label="Download guide"><Download size={14} strokeWidth={1.7} /><span>{downloaded ? 'Downloaded' : 'Save guide'}</span></button>
        <span className="sr-only" role="status">{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Could not copy. Select the reply to copy it.' : downloaded ? 'Guide downloaded with sources.' : ''}</span>
      </div>
      {showFollowUps && onAsk && <div className="response-follow-ups" aria-label="Suggested follow-up questions">
        <p>Where next?</p>
        {suggestions.map((suggestion) => <button type="button" key={suggestion.label} onClick={() => onAsk(suggestion.prompt)}>{suggestion.label}<ArrowUpRight size={13} aria-hidden="true" /></button>)}
      </div>}
    </article>
  )
}
