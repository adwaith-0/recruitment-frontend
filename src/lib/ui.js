export const cx = (...c) => c.filter(Boolean).join(' ')

export const CONNECTION_STATUS = {
  online: { dot: 'bg-emerald-500', ring: 'bg-emerald-500/30', label: 'Connected' },
  auth: { dot: 'bg-amber-500', ring: 'bg-amber-500/30', label: 'Azure sign-in needed' },
  offline: { dot: 'bg-rose-500', ring: 'bg-rose-500/30', label: 'API bridge offline' },
  checking: { dot: 'bg-slate-400', ring: 'bg-slate-400/30', label: 'Checking connection…' },
}

export const statusLabel = (state) => (CONNECTION_STATUS[state] ?? CONNECTION_STATUS.checking).label
