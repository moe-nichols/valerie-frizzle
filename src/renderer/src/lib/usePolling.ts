import { useCallback, useEffect, useRef } from 'react'

/**
 * Calls `callback` on an interval and returns a guarded manual-refresh function.
 * `intervalMs === null` means "not ready to poll yet" (e.g. the poll-rate preference hasn't
 * loaded from the main process) — no timer is set up in that case, rather than polling at a
 * guessed default.
 *
 * All runs go through one in-flight guard, so a `callback` that takes longer than
 * `intervalMs` (a refresh that peeks many entities, say) can't pile up overlapping runs
 * that resolve out of order — the app would otherwise apply whichever happened to finish
 * last rather than the most recently started. Manual refreshes use the same guard: calling
 * the returned function mid-run coalesces into one follow-up run instead of overlapping,
 * so a caller who just created or deleted something still gets a fetch that started after
 * their change. Timer ticks that land mid-run are simply skipped.
 *
 * `callback` receives `viaPoll`, so it can route background (timer-driven) failures to a
 * toast instead of an inline banner. Timer ticks always pass `true`; the returned function
 * defaults to `false` for manual callers (button clicks, initial-load effects). If calls
 * coalesce mid-run, a manual call in the mix always wins — a user waiting on a manual
 * refresh should see its result inline, not have it silently downgraded to a toast because a
 * poll tick landed at the same time.
 */
export function usePolling(
  callback: (viaPoll: boolean) => void | Promise<void>,
  intervalMs: number | null
): (viaPoll?: boolean) => Promise<void> {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const runningRef = useRef(false)
  const rerunRef = useRef(false)
  const rerunViaPollRef = useRef(true)

  const refresh = useCallback(async (viaPoll = false): Promise<void> => {
    if (runningRef.current) {
      rerunRef.current = true
      rerunViaPollRef.current = rerunViaPollRef.current && viaPoll
      return
    }
    runningRef.current = true
    try {
      let currentViaPoll = viaPoll
      do {
        rerunRef.current = false
        rerunViaPollRef.current = true
        await callbackRef.current(currentViaPoll)
        currentViaPoll = rerunViaPollRef.current
      } while (rerunRef.current)
    } finally {
      runningRef.current = false
    }
  }, [])

  useEffect(() => {
    if (intervalMs === null) return
    const id = setInterval(() => {
      // Skip (don't coalesce) ticks that land mid-run — the next tick will catch up.
      if (!runningRef.current) void refresh(true)
    }, intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, refresh])

  return refresh
}
