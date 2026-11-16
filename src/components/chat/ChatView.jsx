import { ArrowDown } from 'lucide-react'
import { useAutoScroll } from '../../hooks/useAutoScroll.js'
import { useChat } from '../../state/useChat.js'
import { ChatHeader } from '../layout/ChatHeader.jsx'
import { Composer } from './Composer.jsx'
import { ErrorCard } from './ErrorCard.jsx'
import { MessageBubble } from './MessageBubble.jsx'
import { TypingIndicator } from './TypingIndicator.jsx'
import { WelcomeScreen } from './WelcomeScreen.jsx'

export function ChatView({ health, theme, onOpenSettings, onClose, expanded, onToggleExpanded, compact = false }) {
  const { active, sendMessage, retry, stop, newChat, dismissError } = useChat()
  const isEmpty = active.messages.length === 0 && !active.pending
  let questionForReply = ''
  const messagesWithQuestions = []
  for (const message of active.messages) {
    if (message.author === 'user') questionForReply = message.text
    messagesWithQuestions.push({ message, question: questionForReply })
  }
  const lastMessage = active.messages.at(-1)
  const latestReplyId = lastMessage?.author === 'assistant' ? lastMessage.id : null
  const { ref, onScroll, showJump, scrollToBottom, pin } = useAutoScroll([
    active.id, active.messages.length, active.pending, Boolean(active.error),
  ], { resetToTop: isEmpty, revealId: latestReplyId })
  const send = (text, role) => { pin(); sendMessage(text, role) }
  const composer = (
    <Composer compact={compact} conversationId={active.id} pending={active.pending} onSend={send} onStop={() => stop(active.id)} />
  )

  return (
    <div className="chat-shell">
      <ChatHeader health={health} theme={theme} onNewChat={newChat} onOpenSettings={onOpenSettings} onClose={onClose} expanded={expanded} onToggleExpanded={onToggleExpanded} />
      <div className="chat-content">
        <div ref={ref} onScroll={onScroll} className="chat-scroll scrollbar-thin">
          {isEmpty ? (
            <WelcomeScreen compact={compact} onAsk={send}>{!compact && composer}</WelcomeScreen>
          ) : (
            <div className="conversation" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation">
              {messagesWithQuestions.map(({ message, question }, index) => <MessageBubble key={message.id} message={message} question={question} onAsk={send} showFollowUps={index === active.messages.length - 1 && !active.pending && !active.error} />)}
              {active.pending && <TypingIndicator since={active.pendingSince} />}
              {active.error && !active.pending && (
                <ErrorCard error={active.error} onRetry={() => retry(active.id)} onNewChat={() => newChat()} onDismiss={() => dismissError(active.id)} />
              )}
            </div>
          )}
        </div>
        {showJump && !isEmpty && (
          <button type="button" onClick={() => scrollToBottom()} className="jump-button" aria-label="Jump to latest message" title="Jump to latest">
            <ArrowDown size={18} />
          </button>
        )}
      </div>
      {(!isEmpty || compact) && <div className="conversation-composer">{composer}</div>}
    </div>
  )
}
