// @vitest-environment jsdom

import { configureStore } from '@reduxjs/toolkit'
import { act, cleanup, renderHook } from '@testing-library/react'
import { Provider } from 'react-redux'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  useQueuePanelData,
  useTopicPanelData
} from '@renderer/features/entities/useEntityRefresh.ts'
import { fetchPollInterval, settingsReducer } from '@renderer/store/settingsSlice.ts'
import type { QueueDescription } from '@shared/domain.ts'
import type { Result } from '@shared/errors.ts'
import { deferred, failure, ok, queue, subscription, topic } from './entityFixtures'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
const api = {
  entities: {
    queues: { get: vi.fn() },
    topics: { get: vi.fn() },
    subscriptions: { list: vi.fn() }
  },
  messages: { count: vi.fn(), countSubscription: vi.fn() }
}
const settle = async () => {
  await act(async () => {})
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('sbAdmin', api)
  api.entities.queues.get.mockResolvedValue(ok(queue()))
  api.entities.topics.get.mockResolvedValue(ok(topic()))
  api.entities.subscriptions.list.mockResolvedValue(ok([subscription()]))
  api.messages.count.mockResolvedValue(ok(3))
  api.messages.countSubscription.mockResolvedValue(ok(4))
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function wrapper() {
  const store = configureStore({ reducer: { settings: settingsReducer } })
  return {
    store,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    )
  }
}
function renderQueue(name = 'orders') {
  const setup = wrapper()
  return {
    store: setup.store,
    ...renderHook(({ profileId, name }) => useQueuePanelData(profileId, name), {
      initialProps: { profileId: 'p1', name },
      wrapper: setup.wrapper
    })
  }
}
function renderTopic(name = 'events') {
  const setup = wrapper()
  return {
    store: setup.store,
    ...renderHook(({ name }) => useTopicPanelData('p1', name), {
      initialProps: { name },
      wrapper: setup.wrapper
    })
  }
}

describe('selection-scoped panel refresh', () => {
  test('publishes metadata and timestamp before count completion; failed counts retain previous values', async () => {
    const pending = deferred<Result<number>>()
    api.messages.count.mockReturnValueOnce(pending.promise)
    const { result } = renderQueue()
    await settle()
    expect(result.current.queue?.name).toBe('orders')
    expect(result.current.lastRefreshed).toBeInstanceOf(Date)
    expect(result.current.count).toBeUndefined()
    await act(async () => pending.resolve(ok(7)))
    expect(result.current.count).toMatchObject({ status: 'observed', count: 7 })
    const previous = result.current.lastRefreshed
    vi.setSystemTime(Date.now() + 1000)
    api.messages.count.mockResolvedValue(failure())
    await act(() => result.current.refresh())
    expect(result.current.count).toMatchObject({ count: 7 })
    expect(result.current.lastRefreshed?.getTime()).toBeGreaterThan(previous?.getTime() ?? 0)
    expect(result.current.error).toBeNull()
  })

  test('forwarding immediately removes an old numeric observation and skips counts', async () => {
    const { result } = renderQueue()
    await settle()
    api.entities.queues.get.mockResolvedValue(ok(queue('orders', { forwardTo: 'next' })))
    api.messages.count.mockClear()
    await act(() => result.current.refresh())
    expect(result.current.count).toEqual({ status: 'unavailable', reason: 'forwarding' })
    expect(api.messages.count).not.toHaveBeenCalled()
    api.entities.queues.get.mockResolvedValue(ok(queue()))
    api.messages.count.mockResolvedValue(failure())
    await act(() => result.current.refresh())
    expect(result.current.count).toBeUndefined()
  })

  test('A -> B -> A never revives original metadata, errors, or timestamp; only latest is fetched next', async () => {
    const original = deferred<Result<QueueDescription>>()
    const latest = deferred<Result<QueueDescription>>()
    api.entities.queues.get
      .mockReturnValueOnce(original.promise)
      .mockReturnValueOnce(latest.promise)
    const { result, rerender } = renderQueue()
    rerender({ profileId: 'p1', name: 'billing' })
    rerender({ profileId: 'p1', name: 'orders' })
    await act(async () => original.resolve(failure('stale')))
    expect(result.current.queue).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.lastRefreshed).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
    expect(api.entities.queues.get.mock.calls).toEqual([
      ['p1', 'orders'],
      ['p1', 'orders']
    ])
    await act(async () => latest.resolve(ok(queue())))
    expect(result.current.queue?.name).toBe('orders')
  })

  test('selection changes during count work discard counts and reset metadata immediately', async () => {
    const pending = deferred<Result<number>>()
    const nextMetadata = deferred<Result<QueueDescription>>()
    api.messages.count.mockReturnValueOnce(pending.promise)
    const { result, rerender } = renderQueue()
    await settle()
    api.entities.queues.get.mockReturnValueOnce(nextMetadata.promise)
    rerender({ profileId: 'p2', name: 'orders' })
    expect(result.current.queue).toBeNull()
    expect(result.current.lastRefreshed).toBeNull()
    await act(async () => pending.reject(new Error('stale count')))
    expect(result.current.count).toBeUndefined()
    expect(result.current.error).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
    await act(async () => nextMetadata.resolve(ok(queue())))
    expect(result.current.queue).not.toBeNull()
  })

  test('manual requests during polling coalesce once with manual error precedence', async () => {
    const { result, store } = renderQueue()
    await settle()
    act(() => store.dispatch(fetchPollInterval.fulfilled(1000, 'test')))
    const poll = deferred<Result<QueueDescription>>()
    api.entities.queues.get
      .mockReturnValueOnce(poll.promise)
      .mockResolvedValue(failure('manual failed'))
    await act(() => vi.advanceTimersByTimeAsync(1000))
    await act(async () => {
      await result.current.refresh()
      await result.current.refresh()
    })
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(api.entities.queues.get).toHaveBeenCalledTimes(2)
    await act(async () => poll.resolve(ok(queue())))
    expect(api.entities.queues.get).toHaveBeenCalledTimes(3)
    expect(result.current.error).toContain('manual failed')
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('poll failure toasts without replacing inline error; successful metadata clears it', async () => {
    api.entities.queues.get.mockResolvedValue(failure('initial'))
    const { result, store } = renderQueue()
    await settle()
    act(() => store.dispatch(fetchPollInterval.fulfilled(1000, 'test')))
    api.entities.queues.get.mockResolvedValue(failure('poll'))
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(result.current.error).toContain('initial')
    expect(toast.error).toHaveBeenCalledWith('Failed to refresh orders: poll')
    api.entities.queues.get.mockResolvedValue(ok(queue()))
    await act(() => result.current.refresh())
    expect(result.current.error).toBeNull()
  })

  test('unexpected count rejection is surfaced and releases the execution guard', async () => {
    api.messages.count.mockRejectedValueOnce(new Error('bridge rejected'))
    const { result } = renderQueue()
    await settle()
    expect(result.current.error).toContain('bridge rejected')
    expect(result.current.queue).not.toBeNull()
    expect(result.current.lastRefreshed).not.toBeNull()
    await act(() => result.current.refresh())
    expect(result.current.error).toBeNull()
    expect(result.current.count).toMatchObject({ count: 3 })
  })

  test('unmount discards pending errors and queued follow-ups, and stops the timer', async () => {
    const pending = deferred<Result<QueueDescription>>()
    api.entities.queues.get.mockReturnValueOnce(pending.promise)
    const { result, unmount, store } = renderQueue()
    act(() => store.dispatch(fetchPollInterval.fulfilled(1000, 'test')))
    await act(() => result.current.refresh())
    unmount()
    pending.resolve(failure('unmounted'))
    await settle()
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.entities.queues.get).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('topic partial results', () => {
  test('a rejected count cannot suppress its sibling or release the scheduler before it settles', async () => {
    const dlq = deferred<Result<number>>()
    api.messages.countSubscription
      .mockRejectedValueOnce(new Error('active rejected'))
      .mockReturnValueOnce(dlq.promise)
    const { result } = renderTopic()
    await settle()
    expect(result.current.lastRefreshed).not.toBeNull()
    await act(() => result.current.refresh())
    expect(api.entities.topics.get).toHaveBeenCalledTimes(1)
    // Keep the queued refresh pending so the failed run remains observable.
    const next = deferred<Result<ReturnType<typeof topic>>>()
    api.entities.topics.get.mockReturnValueOnce(next.promise)
    await act(async () => dlq.resolve(ok(6)))
    expect(result.current.subscriptionDlqCounts.worker).toMatchObject({ count: 6 })
    expect(result.current.error).toContain('active rejected')
    expect(api.entities.topics.get).toHaveBeenCalledTimes(2)
    await act(async () => next.resolve(ok(topic())))
    expect(result.current.error).toBeNull()
  })

  test('retains failed targets independently, prunes deletions, and clears forwarding counts', async () => {
    api.entities.subscriptions.list.mockResolvedValue(
      ok([subscription(), subscription({ subscriptionName: 'deleted' })])
    )
    const { result } = renderTopic()
    await settle()
    api.entities.subscriptions.list.mockResolvedValue(ok([subscription()]))
    api.messages.countSubscription.mockImplementation(
      async (_profile, _topic, _sub, _cap, _cursor, deadLetter) => (deadLetter ? ok(8) : failure())
    )
    await act(() => result.current.refresh())
    expect(Object.keys(result.current.subscriptionCounts)).toEqual(['worker'])
    expect(result.current.subscriptionCounts.worker).toMatchObject({ count: 4 })
    expect(result.current.subscriptionDlqCounts.worker).toMatchObject({ count: 8 })
    api.entities.subscriptions.list.mockResolvedValue(
      ok([subscription({ forwardTo: 'next', forwardDeadLetteredMessagesTo: 'next' })])
    )
    await act(() => result.current.refresh())
    expect(result.current.subscriptionCounts.worker?.status).toBe('unavailable')
    expect(result.current.subscriptionDlqCounts.worker?.status).toBe('unavailable')
  })

  test('metadata failure cannot erase successful subscriptions or delay them behind counts', async () => {
    const pending = deferred<Result<number>>()
    api.entities.topics.get.mockResolvedValue(failure('topic failed'))
    api.messages.countSubscription.mockReturnValue(pending.promise)
    const { result } = renderTopic()
    await settle()
    expect(result.current.subscriptions).toHaveLength(1)
    expect(result.current.error).toContain('topic failed')
    expect(result.current.lastRefreshed).toBeNull()
    await act(async () => pending.resolve(ok(2)))
    expect(result.current.subscriptionCounts.worker).toMatchObject({ count: 2 })
    expect(result.current.error).toContain('topic failed')
  })

  test('subscription listing failure retains prior data without advancing the timestamp', async () => {
    const { result } = renderTopic()
    await settle()
    const timestamp = result.current.lastRefreshed
    api.entities.subscriptions.list.mockResolvedValue(failure('subscriptions failed'))
    await act(() => result.current.refresh())
    expect(result.current.topic).not.toBeNull()
    expect(result.current.subscriptions).toHaveLength(1)
    expect(result.current.subscriptionCounts.worker).toMatchObject({ count: 4 })
    expect(result.current.error).toContain('subscriptions failed')
    expect(result.current.lastRefreshed).toBe(timestamp)
  })

  test('metadata errors have deterministic precedence', async () => {
    api.entities.topics.get.mockResolvedValue(failure('topic first'))
    api.entities.subscriptions.list.mockResolvedValue(failure('subscriptions second'))
    const { result } = renderTopic()
    await settle()
    expect(result.current.error).toContain('topic first')
  })
})
