import { useCallback, useEffect, useState } from 'react'

const KEY = 'rai-theme' // only a UI preference is persisted, never chat content
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function readPreference() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function useTheme() {
  const [preference, setPreference] = useState(readPreference)
  const [systemDark, setSystemDark] = useState(() => media().matches)

  useEffect(() => {
    const mq = media()
    const onChange = (e) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])

  const setTheme = useCallback((value) => {
    setPreference(value)
    try {
      if (value === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, value)
    } catch {
      // Storage unavailable (private mode); the preference still applies for this session.
    }
  }, [])

  const toggle = useCallback(() => setTheme(resolved === 'dark' ? 'light' : 'dark'), [resolved, setTheme])

  return { preference, resolved, setTheme, toggle }
}
