import { useEffect, useRef } from 'react'

/**
 * Calls `callback` on an interval. `intervalMs === null` means "not ready to poll yet"
 * (e.g. the poll-rate preference hasn't loaded from the main process) — no timer is set up
 * in that case, rather than polling at a guessed default.
 *
 * A tick is skipped while the previous invocation is still in flight, so a `callback` that
 * takes longer than `intervalMs` (a refresh that peeks many entities, say) can't pile up
 * overlapping runs that resolve out of order — the app would otherwise apply whichever
 * happened to finish last rather than the most recently started.
 */
export function usePolling(callback: () => void | Promise<void>, intervalMs: number | null): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const runningRef = useRef(false)

  useEffect(() => {
    if (intervalMs === null) return
    const id = setInterval(async () => {
      if (runningRef.current) return
      runningRef.current = true
      try {
        await callbackRef.current()
      } finally {
        runningRef.current = false
      }
    }, intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
}
