import { useEffect, useState } from 'react'

export function TypingIndicator({ since }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.floor((now - (since ?? now)) / 1000))
  const label = seconds >= 45 ? 'Still working. This is taking longer than usual.' : seconds >= 10 ? 'Still working. Checking the available information.' : 'Thinking'

  return (
    <div className="thinking-indicator" role="status" aria-live="polite">
      <span className="thinking-dot" aria-hidden="true" />
      <span>{label}</span>
      {seconds > 2 && <span className="tabular-nums">{seconds}s</span>}
    </div>
  )
}
