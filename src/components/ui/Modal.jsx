import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { cx } from '../../lib/ui.js'

/** Accessible modal built on the native <dialog> element (focus trap + Esc for free). */
export function Modal({ open, onClose, title, description, children, className }) {
  const ref = useRef(null)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby={titleId}
      className={cx(
        'm-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-sm',
        'dark:border-white/10 dark:bg-[#292929] dark:text-zinc-200',
        className,
      )}
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-semibold text-zinc-900 dark:text-white">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-m-1 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10"
            >
              <X size={18} />
            </button>
          </div>
          <div className="mt-5">{children}</div>
        </div>
      )}
    </dialog>
  )
}
