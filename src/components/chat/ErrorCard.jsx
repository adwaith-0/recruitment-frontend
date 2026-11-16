import { CalendarClock, CircleSlash, DatabaseZap, FileSearch, Hourglass, KeyRound, PlugZap, RotateCcw, ShieldAlert, SquarePen, TimerOff, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'

const KIND = {
  cancelled: { icon: CircleSlash, tone: 'neutral', title: 'Response stopped' },
  bridge_unreachable: { icon: PlugZap, title: 'API bridge not reachable' },
  auth_failed: { icon: KeyRound, title: 'Azure sign-in required' },
  unauthorized: { icon: KeyRound, title: 'Azure sign-in expired' },
  forbidden: { icon: ShieldAlert, title: 'Access denied' },
  timeout: { icon: TimerOff, title: 'The agent took too long' },
  rate_limited: { icon: TimerOff, title: 'Too many requests' },
  conversation_expired: { icon: SquarePen, title: 'Conversation context expired' },
  knowledge_unavailable: { icon: DatabaseZap, title: 'Document search unavailable' },
  retrieval_missing: { icon: FileSearch, title: 'Answer withheld' },
  thread_busy: { icon: TimerOff, title: 'Still waiting for a reply' },
  daily_limit_reached: { icon: CalendarClock, title: 'Daily question limit reached' },
  server_busy: { icon: Hourglass, title: 'The assistant is busy' },
}

/** Renders inline `code` spans in hints without pulling in a markdown pass. */
function Hint({ text }) {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <code key={i} className="rounded bg-black/5 px-1 py-px font-mono text-[0.85em] dark:bg-white/10">
        {part.slice(1, -1)}
      </code>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

export function ErrorCard({ error, onRetry, onNewChat, onDismiss }) {
  const [showDetails, setShowDetails] = useState(false)
  const kind = KIND[error.code] ?? { icon: TriangleAlert, title: error.message }
  const Icon = kind.icon
  const neutral = kind.tone === 'neutral'
  const expired = error.code === 'conversation_expired'
  // Retrying cannot help until the daily limit resets.
  const canRetry = error.code !== 'daily_limit_reached'
  const toolIssues = error.toolIssues ?? []

  return (
    <div
      role="alert"
      className={
        neutral
          ? 'animate-fade-up rounded-2xl border border-slate-200 bg-white p-4 shadow-soft dark:border-white/10 dark:bg-white/[0.03]'
          : 'animate-fade-up rounded-2xl border border-rose-200 bg-rose-50/70 p-4 shadow-soft dark:border-rose-500/25 dark:bg-rose-500/[0.07]'
      }
    >
      <div className="flex items-start gap-3">
        <span
          className={
            neutral
              ? 'grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-300'
              : 'grid size-9 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'
          }
        >
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={neutral ? 'text-sm font-semibold text-slate-800 dark:text-slate-100' : 'text-sm font-semibold text-rose-900 dark:text-rose-100'}>
            {kind.title}
          </p>
          {kind.title !== error.message && !neutral && (
            <p className="mt-0.5 text-sm text-rose-800/90 dark:text-rose-200/90">{error.message}</p>
          )}
          {error.hint && (
            <p className="mt-1 text-[0.8rem] leading-relaxed break-words text-slate-600 dark:text-slate-300">
              <Hint text={error.hint} />
            </p>
          )}
          {toolIssues.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[0.75rem] text-amber-800 dark:text-amber-200">
              {toolIssues.map((t, i) => (
                <li key={i} className="font-mono break-all">
                  {t.tool}: {t.message}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {expired ? (
              <button
                type="button"
                onClick={onNewChat}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900"
              >
                <SquarePen size={14} /> Start a new chat
              </button>
            ) : canRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-soft transition hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              >
                <RotateCcw size={14} /> Retry
              </button>
            )}
            {!neutral && (
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/5"
                aria-expanded={showDetails}
              >
                {showDetails ? 'Hide details' : 'Details'}
              </button>
            )}
          </div>
          {showDetails && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[0.7rem] text-slate-500 dark:text-slate-400">
              <dt>code</dt>
              <dd>{error.code}</dd>
              {error.status && (
                <>
                  <dt>bridge</dt>
                  <dd>HTTP {error.status}</dd>
                </>
              )}
              {error.upstreamStatus && (
                <>
                  <dt>agent</dt>
                  <dd>HTTP {error.upstreamStatus}</dd>
                </>
              )}
            </dl>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="-m-1 rounded-lg p-1 text-slate-400 hover:bg-black/5 hover:text-slate-600 dark:hover:bg-white/5"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
