import { Maximize2, Minimize2, Minus, Moon, Settings2, SquarePen, Sun } from 'lucide-react'
import { ASSISTANT_NAME } from '../../lib/constants.js'
import { statusLabel } from '../../lib/ui.js'
import { IconButton, StatusDot } from '../ui/primitives.jsx'

export function ChatHeader({ health, theme, onNewChat, onOpenSettings, onClose, expanded, onToggleExpanded }) {
  return (
    <header className="chat-header">
      <div className="chat-header-identity flex min-w-0 flex-1 items-center gap-2.5">
        <h2 id="chatbot-heading" tabIndex={-1} className="truncate text-[1.05rem] font-medium tracking-[-0.025em]">{ASSISTANT_NAME}</h2>
        <span className="connection-label" title={statusLabel(health.state)}>
          <StatusDot state={health.state} />
          {statusLabel(health.state)}
        </span>
      </div>
      <IconButton label="New chat" onClick={() => onNewChat()}>
        <SquarePen size={18} />
      </IconButton>
      {onToggleExpanded && <IconButton className="chat-expand-control" label={expanded ? 'Collapse chat' : 'Expand chat'} onClick={onToggleExpanded}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</IconButton>}
      <IconButton label={theme.resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={theme.toggle}>
        {theme.resolved === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </IconButton>
      <IconButton label="Settings" onClick={onOpenSettings}>
        <Settings2 size={18} />
      </IconButton>
      {onClose && <IconButton label="Minimize chatbot" onClick={onClose}><Minus size={19} /></IconButton>}
    </header>
  )
}
