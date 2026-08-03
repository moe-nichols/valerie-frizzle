import { useEffect, useRef } from 'react'

/**
 * Calls `callback` on an interval. `intervalMs === null` means "not ready to poll yet"
 * (e.g. the poll-rate preference hasn't loaded from the main process) — no timer is set up
 * in that case, rather than polling at a guessed default.
 */
export function usePolling(callback: () => void, intervalMs: number | null): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (intervalMs === null) return
    const id = setInterval(() => callbackRef.current(), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
}
