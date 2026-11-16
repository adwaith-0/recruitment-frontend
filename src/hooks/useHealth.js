import { useCallback, useEffect, useState } from 'react'
import { fetchHealth } from '../api/chatApi.js'

const ignoreAbort = () => {}

/** Polls the bridge's /api/health so the UI can show connection + Azure sign-in status. */
export function useHealth(intervalMs = 60_000) {
  const [health, setHealth] = useState({ state: 'checking' })

  useEffect(() => {
    const controller = new AbortController()
    const load = () => fetchHealth(controller.signal).then(setHealth, ignoreAbort)
    load()
    const t = setInterval(load, intervalMs)
    return () => {
      controller.abort()
      clearInterval(t)
    }
  }, [intervalMs])

  const recheck = useCallback(() => {
    setHealth((h) => ({ ...h, refreshing: true }))
    fetchHealth().then(setHealth, ignoreAbort)
  }, [])

  return { health, recheck }
}
