import {
  type AvailableObservation,
  type CountObservation,
  type CountTarget,
  countEligibility,
  observeQueueCount,
  observeSubscriptionCount
} from '@renderer/lib/messageCount'
import { usePolling } from '@renderer/lib/usePolling'
import { entitiesRefreshed } from '@renderer/store/connectionsSlice'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import type { QueueDescription, SubscriptionDescription, TopicDescription } from '@shared/domain'
import type { Result } from '@shared/errors'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

type Counts = Record<string, AvailableObservation>
interface Publication<T> {
  data: (update: (previous: T) => T) => void
  effect: (apply: () => void) => void
  metadata: (errors: Array<string | null>) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Keep branch failures as outcomes so a rejection cannot suppress another branch's data.
async function metadata<T>(request: Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await request
  } catch (error) {
    return { ok: false, error: { code: 'UNEXPECTED_ERROR', message: errorMessage(error) } }
  }
}

// Private refresh machinery: callers receive data/status, never publication permissions.
function useSelectionRefresh<T>(
  key: string,
  empty: () => T,
  fetch: (publication: Publication<T>) => Promise<void>,
  errorPrefix = ''
) {
  const interval = useAppSelector((state) => state.settings.pollIntervalMs)
  const [snapshot, setSnapshot] = useState(() => ({
    key,
    token: {},
    data: empty(),
    error: null as string | null,
    loaded: false,
    lastRefreshed: null as Date | null
  }))
  let current = snapshot
  if (current.key !== key) {
    current = { key, token: {}, data: empty(), error: null, loaded: false, lastRefreshed: null }
    setSnapshot(current)
  }
  const latest = useRef(current.token)
  latest.current = current.token
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = usePolling(async (viaPoll) => {
    const token = current.token
    const isCurrent = (): boolean => mounted.current && latest.current === token
    const apply = (update: (previous: typeof snapshot) => typeof snapshot): void => {
      if (!isCurrent()) return
      setSnapshot((previous) =>
        isCurrent() && previous.token === token ? update(previous) : previous
      )
    }
    const fail = (message: string): void => {
      if (!isCurrent()) return
      if (viaPoll) toast.error(errorPrefix + message)
      else apply((previous) => ({ ...previous, error: errorPrefix + message }))
    }
    try {
      await fetch({
        data: (update) => apply((previous) => ({ ...previous, data: update(previous.data) })),
        effect: (effect) => {
          if (isCurrent()) effect()
        },
        metadata: (errors) => {
          const error = errors.find((message) => message !== null)
          apply((previous) => ({
            ...previous,
            loaded: true,
            ...(error ? {} : { error: null, lastRefreshed: new Date() })
          }))
          if (error) fail(error)
        }
      })
    } catch (error) {
      apply((previous) => ({ ...previous, loaded: true }))
      fail(errorMessage(error))
    }
  }, interval)

  useEffect(() => {
    void refresh()
  }, [current.token, refresh])

  return {
    ...current.data,
    error: current.error,
    loaded: current.loaded,
    lastRefreshed: current.lastRefreshed,
    refresh
  }
}

function retainObservation(
  previous: AvailableObservation | undefined,
  observation: CountObservation
): AvailableObservation | undefined {
  return observation.status === 'failed' ? previous : observation
}

function reconcileCounts<T extends QueueDescription | SubscriptionDescription>(
  previous: Counts,
  descriptions: T[],
  name: (description: T) => string,
  target: CountTarget
): Counts {
  const next: Counts = {}
  for (const description of descriptions) {
    const key = name(description)
    const observation = eligiblePrevious(description, target, previous[key])
    if (observation) next[key] = observation
  }
  return next
}

function eligiblePrevious(
  description: QueueDescription | SubscriptionDescription,
  target: CountTarget,
  previous: AvailableObservation | undefined
): AvailableObservation | undefined {
  return (
    countEligibility(description, target) ??
    (previous?.status === 'observed' ? previous : undefined)
  )
}

// All tasks settle before releasing the scheduler; successful targets publish independently.
async function observations(tasks: Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(tasks)
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}

export function useQueuePanelData(profileId: string, queueName: string) {
  return useSelectionRefresh(
    JSON.stringify([profileId, queueName]),
    () => ({
      queue: null as QueueDescription | null,
      count: undefined as AvailableObservation | undefined
    }),
    async (publication) => {
      const response = await metadata(window.sbAdmin.entities.queues.get(profileId, queueName))
      if (response.ok) {
        publication.data((previous) => ({
          queue: response.data,
          count: eligiblePrevious(response.data, 'active', previous.count)
        }))
      }
      publication.metadata([response.ok ? null : response.error.message])
      if (!response.ok) return
      let task: Promise<void> | undefined
      publication.effect(() => {
        task = observeQueueCount(profileId, response.data, 'active').then((observation) =>
          publication.data((previous) => ({
            ...previous,
            count: retainObservation(previous.count, observation)
          }))
        )
      })
      await task
    },
    `Failed to refresh ${queueName}: `
  )
}

interface TopicData {
  topic: TopicDescription | null
  subscriptions: SubscriptionDescription[]
  subscriptionCounts: Counts
  subscriptionDlqCounts: Counts
}

export function useTopicPanelData(profileId: string, topicName: string) {
  return useSelectionRefresh<TopicData>(
    JSON.stringify([profileId, topicName]),
    () => ({ topic: null, subscriptions: [], subscriptionCounts: {}, subscriptionDlqCounts: {} }),
    async (publication) => {
      const [topic, subscriptions] = await Promise.all([
        metadata(window.sbAdmin.entities.topics.get(profileId, topicName)).then((response) => {
          if (response.ok) publication.data((previous) => ({ ...previous, topic: response.data }))
          return response
        }),
        metadata(window.sbAdmin.entities.subscriptions.list(profileId, topicName)).then(
          (response) => {
            if (response.ok)
              publication.data((previous) => ({
                ...previous,
                subscriptions: response.data,
                subscriptionCounts: reconcileCounts(
                  previous.subscriptionCounts,
                  response.data,
                  (s) => s.subscriptionName,
                  'active'
                ),
                subscriptionDlqCounts: reconcileCounts(
                  previous.subscriptionDlqCounts,
                  response.data,
                  (s) => s.subscriptionName,
                  'deadLetter'
                )
              }))
            return response
          }
        )
      ])
      publication.metadata([
        topic.ok ? null : topic.error.message,
        subscriptions.ok ? null : subscriptions.error.message
      ])
      if (!subscriptions.ok) return
      const tasks: Promise<void>[] = []
      publication.effect(() => {
        for (const subscription of subscriptions.data) {
          for (const target of ['active', 'deadLetter'] as const) {
            const field = target === 'active' ? 'subscriptionCounts' : 'subscriptionDlqCounts'
            tasks.push(
              observeSubscriptionCount(profileId, subscription, target).then((observation) => {
                publication.data((previous) => {
                  const next = { ...previous[field] }
                  const retained = retainObservation(
                    next[subscription.subscriptionName],
                    observation
                  )
                  if (retained) next[subscription.subscriptionName] = retained
                  return { ...previous, [field]: next }
                })
              })
            )
          }
        }
      })
      await observations(tasks)
    },
    `Failed to refresh ${topicName}: `
  )
}

interface TreeData {
  queues: QueueDescription[]
  topics: TopicDescription[]
  queueCounts: Counts
  queueDlqCounts: Counts
}

export function useEntityTreeData(profileId: string) {
  const dispatch = useAppDispatch()
  return useSelectionRefresh<TreeData>(
    profileId,
    () => ({ queues: [], topics: [], queueCounts: {}, queueDlqCounts: {} }),
    async (publication) => {
      const [queues, topics] = await Promise.all([
        metadata(window.sbAdmin.entities.queues.list(profileId)).then((response) => {
          if (response.ok) {
            publication.data((previous) => ({
              ...previous,
              queues: response.data,
              queueCounts: reconcileCounts(
                previous.queueCounts,
                response.data,
                (q) => q.name,
                'active'
              ),
              queueDlqCounts: reconcileCounts(
                previous.queueDlqCounts,
                response.data,
                (q) => q.name,
                'deadLetter'
              )
            }))
            publication.effect(() =>
              dispatch(
                entitiesRefreshed({
                  profileId,
                  queueNames: response.data.map((queue) => queue.name)
                })
              )
            )
          }
          return response
        }),
        metadata(window.sbAdmin.entities.topics.list(profileId)).then((response) => {
          if (response.ok) {
            publication.data((previous) => ({ ...previous, topics: response.data }))
            publication.effect(() =>
              dispatch(
                entitiesRefreshed({
                  profileId,
                  topicNames: response.data.map((topic) => topic.name)
                })
              )
            )
          }
          return response
        })
      ])
      publication.metadata([
        queues.ok ? null : queues.error.message,
        topics.ok ? null : topics.error.message
      ])
      if (!queues.ok) return
      const tasks: Promise<void>[] = []
      publication.effect(() => {
        for (const queue of queues.data) {
          for (const target of ['active', 'deadLetter'] as const) {
            const field = target === 'active' ? 'queueCounts' : 'queueDlqCounts'
            tasks.push(
              observeQueueCount(profileId, queue, target).then((observation) => {
                publication.data((previous) => {
                  const next = { ...previous[field] }
                  const retained = retainObservation(next[queue.name], observation)
                  if (retained) next[queue.name] = retained
                  return { ...previous, [field]: next }
                })
              })
            )
          }
        }
      })
      await observations(tasks)
    }
  )
}
