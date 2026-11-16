import { CONNECTION_STATUS, cx } from '../../lib/ui.js'

export function IconButton({ label, children, className, tone = 'ghost', ...props }) {
  const tones = {
    ghost: 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white',
    danger: 'text-zinc-500 hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-300',
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-grid size-9 shrink-0 place-items-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-40',
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function StatusDot({ state }) {
  const s = CONNECTION_STATUS[state] ?? CONNECTION_STATUS.checking
  return (
    <span className="relative inline-flex size-2" aria-hidden="true">
      <span className={cx('relative inline-flex size-2 rounded-full', s.dot)} />
    </span>
  )
}
