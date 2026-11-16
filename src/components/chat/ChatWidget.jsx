import { MessageCircle, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChatView } from './ChatView.jsx'

export function ChatWidget({ health, theme, onOpenSettings }) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const launcherRef = useRef(null)
  const panelRef = useRef(null)
  const close = useCallback(() => {
    setOpen(false)
    launcherRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (!open) return
    const focusTarget = window.matchMedia('(pointer: fine)').matches
      ? panelRef.current?.querySelector('textarea')
      : panelRef.current?.querySelector('#chatbot-heading')
    focusTarget?.focus({ preventScroll: true })
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  return (
    <>
      <section id="recruitment-chatbot" ref={panelRef} className={`chatbot-panel${expanded ? ' chatbot-panel-expanded' : ''}`} hidden={!open} role="dialog" aria-modal="false" aria-labelledby="chatbot-heading">
        <ChatView compact health={health} theme={theme} onOpenSettings={onOpenSettings} onClose={close} expanded={expanded} onToggleExpanded={() => setExpanded((current) => !current)} />
      </section>
      <button ref={launcherRef} type="button" className={`chatbot-launcher${open ? ' chatbot-launcher-open' : ''}`} onClick={() => open ? close() : setOpen(true)} aria-label={open ? 'Close chatbot' : 'Open chatbot'} aria-expanded={open} aria-controls="recruitment-chatbot">
        {!open && <span className="chatbot-launcher-label" aria-hidden="true">Chat with us</span>}
        {open ? <X size={25} aria-hidden="true" /> : <MessageCircle size={28} strokeWidth={1.8} aria-hidden="true" />}
      </button>
    </>
  )
}
