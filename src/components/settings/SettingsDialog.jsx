import { Laptop, Moon, RefreshCw, Sun } from 'lucide-react'
import { cx, statusLabel } from '../../lib/ui.js'
import { Modal } from '../ui/Modal.jsx'
import { StatusDot } from '../ui/primitives.jsx'

const THEMES = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Laptop },
]

function Section({ title, children }) {
  return (
    <section className="border-t border-slate-100 py-4 first:border-0 first:pt-0 dark:border-white/5">
      <h3 className="mb-3 text-xs font-semibold tracking-wider text-slate-400 uppercase">{title}</h3>
      {children}
    </section>
  )
}

export function SettingsDialog({ open, onClose, theme, health, onRecheck }) {
  const rows = [
    ['Agent', health.agent],
    ['Project', health.project],
    ['Agent type', health.agentKind === 'prompt' ? 'Prompt agent (source-grounded)' : health.agentKind === 'hosted' ? 'Hosted agent (rollback)' : health.agentKind],
    ['Knowledge base', health.knowledgeBase],
    ['Credential', health.authMode === 'cli' ? 'Azure CLI (az login)' : health.authMode],
  ].filter(([, v]) => v)

  return (
    <Modal open={open} onClose={onClose} title="Settings" description="Appearance, connection and privacy.">
      <Section title="Appearance">
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => {
            const Icon = t.icon
            const selected = theme.preference === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => theme.setTheme(t.id)}
                className={cx(
                  'flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-medium transition',
                  selected
                    ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-200'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5',
                )}
              >
                <Icon size={18} />
                {t.label}
              </button>
            )
          })}
        </div>
      </Section>

      <Section title="Connection">
        <div className="flex items-center gap-2.5">
          <StatusDot state={health.state} />
          <span className="text-sm font-medium">{statusLabel(health.state)}</span>
          <button
            type="button"
            onClick={onRecheck}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
          >
            <RefreshCw size={13} className={health.refreshing ? 'animate-spin' : undefined} /> Recheck
          </button>
        </div>
        {health.state === 'offline' && (
          <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            The local API bridge isn’t responding. Start it with{' '}
            <code className="rounded bg-slate-100 px-1 font-mono dark:bg-white/10">npm run dev:api</code>.
          </p>
        )}
        {health.state === 'auth' && health.authError?.hint && (
          <p className="mt-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">{health.authError.hint}</p>
        )}
        {rows.length > 0 && (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl bg-slate-50 p-3 text-xs dark:bg-white/5">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
                <dd className="truncate font-mono text-slate-700 dark:text-slate-200">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-2 text-[0.7rem] leading-relaxed text-slate-400">
          The browser talks only to the local bridge. Azure tokens are obtained and used server-side and never
          reach this page.
        </p>
      </Section>

      <Section title="Privacy">
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Conversations are kept in memory for this tab only and are not saved to browser storage. Refreshing or
          closing the tab clears them. Only your theme preference is stored locally.
        </p>
      </Section>
    </Modal>
  )
}
