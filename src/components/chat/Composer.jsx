import { ArrowUp, Square } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MAX_MESSAGE_CHARS } from '../../lib/constants.js'
import { cx } from '../../lib/ui.js'

export function Composer({ conversationId, pending, onSend, onStop, compact = false }) {
  const [drafts, setDrafts] = useState({})
  const value = drafts[conversationId] ?? ''
  const setValue = (next) => setDrafts((current) => ({ ...current, [conversationId]: next }))
  const ref = useRef(null)

  useLayoutEffect(() => {
    const input = ref.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`
  }, [value])

  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) ref.current?.focus()
  }, [conversationId])

  const tooLong = value.length > MAX_MESSAGE_CHARS
  const canSend = !pending && Boolean(value.trim()) && !tooLong
  const submit = () => {
    if (!canSend) return
    onSend(value)
    setValue('')
  }

  return (
    <div className="composer-wrap">
      <form className={cx('composer', tooLong && 'composer-invalid')} onSubmit={(event) => { event.preventDefault(); submit() }}>
        <label htmlFor="composer" className="sr-only">Message Recruitment Assistant</label>
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={compact ? 'Ask us a question…' : 'Ask anything about apprenticeships'}
          aria-describedby="composer-help composer-error"
          aria-invalid={tooLong || undefined}
          className="scrollbar-thin"
        />
        <div className="composer-toolbar">
          <span className="composer-context">Recruitment Assistant</span>
          <span id="composer-help" className="sr-only">Enter to send. Shift + Enter for a new line.</span>
          {pending ? (
            <button type="button" onClick={onStop} className="send-button" aria-label="Stop response" title="Stop response">
              <Square size={14} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" disabled={!canSend} className="send-button" aria-label="Send message" title="Send message">
              <ArrowUp size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
      <p id="composer-error" className="composer-error" role={tooLong ? 'alert' : undefined}>
        {tooLong && `${value.length.toLocaleString()} / ${MAX_MESSAGE_CHARS.toLocaleString()} characters. Shorten your message to send it.`}
      </p>
      <p className="composer-disclaimer">AI can make mistakes. Check important details and sources.</p>
    </div>
  )
}
