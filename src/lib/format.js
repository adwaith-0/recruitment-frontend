const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export const formatTime = (ts) => timeFmt.format(ts)
export const formatFull = (ts) => fullFmt.format(ts)

export function formatRelative(ts, now = Date.now()) {
  const diff = Math.round((ts - now) / 1000)
  const abs = Math.abs(diff)
  if (abs < 45) return 'Just now'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86400), 'day')
}

export function makeTitle(text) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 48 ? `${clean.slice(0, 46).trimEnd()}…` : clean
}

let counter = 0
export function uid(prefix = 'id') {
  counter += 1
  const rand = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}${counter}${rand}`
}

/** Section codes such as EMP-01 cited in the reply as 【EMP-01】 or 【EMP-02 / OPS-01】. */
export function parseCitationMarker(inner) {
  return inner
    .split(/[\s/,;|]+/)
    .map((s) => s.replace(/†.*$/, '').trim())
    .filter(Boolean)
}
