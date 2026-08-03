import { useCallback, useState } from 'react'
import type { MessageCountResult } from './messageCount'

/**
 * Owns the per-entity message-count map behind the sidebar/panel badges. Counts are
 * fetched in one concurrent burst and merged so that an entity whose fetch failed (null)
 * keeps its previous count instead of its badge flickering away, while entities no longer
 * in the list are dropped.
 */
export function useEntityCounts(): {
  counts: Record<string, MessageCountResult>
  updateCounts: (
    names: string[],
    fetchCount: (name: string) => Promise<MessageCountResult | null>,
    shouldApply?: () => boolean
  ) => Promise<void>
  resetCounts: () => void
} {
  const [counts, setCounts] = useState<Record<string, MessageCountResult>>({})

  const updateCounts = useCallback(
    async (
      names: string[],
      fetchCount: (name: string) => Promise<MessageCountResult | null>,
      shouldApply?: () => boolean
    ): Promise<void> => {
      const fetched = await Promise.all(names.map((name) => fetchCount(name)))
      // Callers pass their useIsCurrent predicate here so a slow burst from a superseded
      // selection can't land in the map now showing a different entity's counts.
      if (shouldApply && !shouldApply()) return
      setCounts((prev) => {
        const next: Record<string, MessageCountResult> = {}
        names.forEach((name, index) => {
          const count = fetched[index]
          if (count) {
            next[name] = count
          } else if (prev[name]) {
            next[name] = prev[name]
          }
        })
        return next
      })
    },
    []
  )

  const resetCounts = useCallback(() => setCounts({}), [])

  return { counts, updateCounts, resetCounts }
}
