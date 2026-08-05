import {
  fetchQueueDeadLetterCount,
  fetchQueueMessageCount,
  type MessageCountResult
} from '@renderer/lib/messageCount'
import { useEntityCounts } from '@renderer/lib/useEntityCounts'
import { useIsCurrent } from '@renderer/lib/useIsCurrent'
import { usePolling } from '@renderer/lib/usePolling'
import { entitiesRefreshed } from '@renderer/store/connectionsSlice'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import type { QueueDescription, TopicDescription } from '@shared/domain'
import { buildDeadLetterQueuePath } from '@shared/domain'
import { useEffect, useState } from 'react'
import { reportRefreshError } from './useEntityPanel'

/**
 * Data layer for the sidebar entity tree: the queue/topic listings, their count maps, and
 * the polling wiring. Every apply is guarded by the profile's currency predicate (the same
 * shouldApply guard the detail panels use) so a slow fetch from a superseded profile can't
 * land in a tree now showing another profile's entities.
 */
export function useEntityTreeData(profileId: string): {
  queues: QueueDescription[]
  topics: TopicDescription[]
  queueCounts: Record<string, MessageCountResult>
  queueDlqCounts: Record<string, MessageCountResult>
  error: string | null
  setError: (error: string | null) => void
  loaded: boolean
  refresh: (viaPoll?: boolean) => Promise<void>
} {
  const dispatch = useAppDispatch()
  const pollIntervalMs = useAppSelector((state) => state.settings.pollIntervalMs)
  const isCurrent = useIsCurrent(profileId)

  const [queues, setQueues] = useState<QueueDescription[]>([])
  const [topics, setTopics] = useState<TopicDescription[]>([])
  const {
    counts: queueCounts,
    updateCounts: updateQueueCounts,
    resetCounts: resetQueueCounts
  } = useEntityCounts()
  const {
    counts: queueDlqCounts,
    updateCounts: updateQueueDlqCounts,
    resetCounts: resetQueueDlqCounts
  } = useEntityCounts()
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  async function fetchEntities(viaPoll: boolean): Promise<void> {
    const [queuesResponse, topicsResponse] = await Promise.all([
      window.sbAdmin.entities.queues.list(profileId),
      window.sbAdmin.entities.topics.list(profileId)
    ])
    // A profile switch superseded this burst — drop it entirely.
    if (!isCurrent()) return
    // The slice clears any active selection the fresh listings no longer contain (an
    // entity deleted from outside this app must not keep a stale panel open).
    dispatch(
      entitiesRefreshed({
        profileId,
        queueNames: queuesResponse.ok ? queuesResponse.data.map((queue) => queue.name) : undefined,
        topicNames: topicsResponse.ok ? topicsResponse.data.map((topic) => topic.name) : undefined
      })
    )
    // A single error is set at the end so one list's success doesn't wipe the other's
    // failure, and a fully successful poll clears a stale error from an earlier blip.
    let nextError: string | null = null
    if (queuesResponse.ok) {
      setQueues(queuesResponse.data)
      // An auto-forwarding entity can't be peeked (a permanent Service Bus limitation), so
      // skip its count fetch entirely rather than letting every poll throw on it — the badge
      // shows "forwarding" instead (see EntityCountBadges). The DLQ is gated on its own
      // forwardDeadLetteredMessagesTo, since a queue can forward one and not the other.
      const activeCountNames = queuesResponse.data
        .filter((queue) => !queue.forwardTo)
        .map((queue) => queue.name)
      const dlqCountNames = queuesResponse.data
        .filter((queue) => !queue.forwardDeadLetteredMessagesTo)
        .map((queue) => queue.name)
      await Promise.all([
        updateQueueCounts(
          activeCountNames,
          (name) => fetchQueueMessageCount(profileId, name),
          isCurrent
        ),
        updateQueueDlqCounts(
          dlqCountNames,
          (name) => fetchQueueDeadLetterCount(profileId, buildDeadLetterQueuePath(name)),
          isCurrent
        )
      ])
    } else {
      nextError = queuesResponse.error.message
    }
    if (topicsResponse.ok) {
      setTopics(topicsResponse.data)
    } else {
      nextError = nextError ?? topicsResponse.error.message
    }
    if (!isCurrent()) return
    if (nextError) {
      reportRefreshError(nextError, viaPoll, setError)
    } else {
      setError(null)
    }
    setLoaded(true)
  }

  // All refreshes — timer ticks, the Refresh buttons, and post-create/delete reloads — go
  // through this one guarded runner so they can't interleave and clobber newer state.
  const refresh = usePolling(fetchEntities, pollIntervalMs)

  useEffect(() => {
    setQueues([])
    setTopics([])
    resetQueueCounts()
    resetQueueDlqCounts()
    setError(null)
    setLoaded(false)
    refresh()
    // Only a profile change should reset the tree — `refresh`/reset identities are
    // deliberately not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  return { queues, topics, queueCounts, queueDlqCounts, error, setError, loaded, refresh }
}
