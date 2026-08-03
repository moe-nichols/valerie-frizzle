import { useIsCurrent } from '@renderer/lib/useIsCurrent'
import { usePolling } from '@renderer/lib/usePolling'
import { useAppSelector } from '@renderer/store/hooks'
import { useEffect } from 'react'
import { toast } from 'sonner'

/**
 * Routes a refresh failure to where the user is looking: background (timer-driven)
 * failures toast, so a transient blip is noticed without pinning an inline banner the
 * next successful poll would just clear; manual/initial refreshes surface inline.
 */
export function reportRefreshError(
  message: string,
  viaPoll: boolean,
  setError: (error: string | null) => void
): void {
  if (viaPoll) {
    toast.error(message)
  } else {
    setError(message)
  }
}

/**
 * Shared scaffolding for the entity detail panels (QueuePanel/TopicPanel), which render
 * un-keyed and so must reset and refetch themselves whenever the selection changes.
 * Wires together the poll-interval preference, a stale-result predicate for the panel's
 * fetches, a guarded refresh (timer ticks and manual calls share one in-flight guard),
 * and the reset-then-refresh effect keyed on the selection.
 */
export function useEntityPanel(
  selectionKey: string,
  fetch: (viaPoll: boolean) => void | Promise<void>,
  reset: () => void
): { isCurrent: () => boolean; refresh: (viaPoll?: boolean) => Promise<void> } {
  const pollIntervalMs = useAppSelector((state) => state.settings.pollIntervalMs)
  const isCurrent = useIsCurrent(selectionKey)
  const refresh = usePolling(fetch, pollIntervalMs)

  useEffect(() => {
    reset()
    refresh()
    // Only a selection change should reset the panel — `reset`/`refresh` identities are
    // deliberately not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey])

  return { isCurrent, refresh }
}
