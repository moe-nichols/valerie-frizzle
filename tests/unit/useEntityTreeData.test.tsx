// @vitest-environment jsdom

import { configureStore } from '@reduxjs/toolkit'
import { act, cleanup, renderHook } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useEntityTreeData } from '@renderer/features/entities/useEntityRefresh.ts'
import {
  connectionsReducer,
  profileSelected,
  queueSelected
} from '@renderer/store/connectionsSlice.ts'
import { settingsReducer } from '@renderer/store/settingsSlice.ts'
import type { Result } from '@shared/errors.ts'
import { deferred, failure, ok, queue } from './entityFixtures'

type ListResult = Result<Array<{ name: string }>>

/** Per-profile deferred list responses so the test controls which burst lands when. */
const pending = new Map<
  string,
  { resolveQueues: (r: ListResult) => void; resolveTopics: (r: ListResult) => void }
>()

function listStub(kind: 'resolveQueues' | 'resolveTopics') {
  return vi.fn(
    (profileId: string) =>
      new Promise<ListResult>((resolve) => {
        const entry = pending.get(profileId) ?? {
          resolveQueues: () => {},
          resolveTopics: () => {}
        }
        entry[kind] = resolve
        pending.set(profileId, entry)
      })
  )
}

const sbAdmin = {
  entities: {
    queues: { list: listStub('resolveQueues') },
    topics: { list: listStub('resolveTopics') }
  },
  messages: {
    count: vi.fn<() => Promise<Result<number>>>()
  }
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function resolveListsFor(profileId: string, names: string[]): Promise<void> {
  const entry = pending.get(profileId)
  entry?.resolveQueues({ ok: true, data: names.map((name) => ({ name })) })
  entry?.resolveTopics({ ok: true, data: [] })
  await settle()
}

beforeEach(() => {
  pending.clear()
  vi.stubGlobal('sbAdmin', sbAdmin)
  sbAdmin.messages.count.mockReset().mockResolvedValue(ok(3))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderTreeData(initialProfileId: string) {
  const store = configureStore({
    reducer: { connections: connectionsReducer, settings: settingsReducer }
  })
  const hook = renderHook(({ profileId }: { profileId: string }) => useEntityTreeData(profileId), {
    initialProps: { profileId: initialProfileId },
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>
  })
  return { ...hook, store }
}

describe('useEntityTreeData', () => {
  test('listing success renders independently and loaded does not wait for count completion', async () => {
    const pendingCount = deferred<Result<number>>()
    sbAdmin.messages.count.mockReturnValue(pendingCount.promise)
    const { result } = renderTreeData('p1')
    pending.get('p1')?.resolveTopics(ok([{ name: 'events' }]))
    await settle()
    expect(result.current.topics.map((topic) => topic.name)).toEqual(['events'])
    expect(result.current.loaded).toBe(false)
    pending.get('p1')?.resolveQueues(ok([queue()]))
    await settle()
    expect(result.current.loaded).toBe(true)
    expect(result.current.queues).toHaveLength(1)
    expect(result.current.queueCounts).toEqual({})
    await act(async () => pendingCount.resolve(ok(2)))
    expect(result.current.queueCounts.orders).toMatchObject({ count: 2 })
  })

  test('partial and failed listings retain valid lists/counts and do not reconcile unknown membership', async () => {
    const { result, store } = renderTreeData('p1')
    await resolveListsFor('p1', ['orders'])
    act(() => {
      store.dispatch(profileSelected('p1'))
      store.dispatch(queueSelected('orders'))
      void result.current.refresh()
    })
    pending.get('p1')?.resolveQueues(failure('queues failed'))
    pending.get('p1')?.resolveTopics(ok([{ name: 'events' }]))
    await settle()
    expect(result.current.queues.map((queue) => queue.name)).toEqual(['orders'])
    expect(result.current.queueCounts.orders).toMatchObject({ count: 3 })
    expect(result.current.topics.map((topic) => topic.name)).toEqual(['events'])
    expect(result.current.error).toBe('queues failed')
    expect(store.getState().connections.activeQueueName).toBe('orders')
    act(() => {
      void result.current.refresh()
    })
    await resolveListsFor('p1', [])
    expect(result.current.queueCounts).toEqual({})
    expect(store.getState().connections.activeQueueName).toBeNull()
    expect(result.current.error).toBeNull()
  })

  test('failure precedence is queues before topics and initial failure still marks loaded', async () => {
    const { result } = renderTreeData('p1')
    pending.get('p1')?.resolveTopics(failure('topics failed'))
    pending.get('p1')?.resolveQueues(failure('queues failed'))
    await settle()
    expect(result.current.loaded).toBe(true)
    expect(result.current.error).toBe('queues failed')
  })

  test('A -> B -> A cannot reconcile or publish the superseded A lifetime', async () => {
    const { result, store, rerender } = renderTreeData('p1')
    act(() => {
      store.dispatch(profileSelected('p1'))
      store.dispatch(queueSelected('orders'))
    })
    const dispatch = vi.spyOn(store, 'dispatch')
    rerender({ profileId: 'p2' })
    rerender({ profileId: 'p1' })
    await resolveListsFor('p1', [])
    expect(result.current.loaded).toBe(false)
    expect(store.getState().connections.activeQueueName).toBe('orders')
    expect(dispatch).not.toHaveBeenCalled()
    await resolveListsFor('p1', ['orders'])
    expect(result.current.loaded).toBe(true)
  })

  test('unmount discards pending listing reconciliation and queued follow-ups', async () => {
    const { result, store, unmount } = renderTreeData('p1')
    act(() => {
      store.dispatch(profileSelected('p1'))
      store.dispatch(queueSelected('orders'))
    })
    const dispatch = vi.spyOn(store, 'dispatch')
    await act(() => result.current.refresh())
    const listCalls = sbAdmin.entities.queues.list.mock.calls.length
    unmount()
    await resolveListsFor('p1', [])
    expect(dispatch).not.toHaveBeenCalled()
    expect(sbAdmin.entities.queues.list.mock.calls.length).toBe(listCalls)
    expect(sbAdmin.messages.count).not.toHaveBeenCalled()
    expect(store.getState().connections.activeQueueName).toBe('orders')
  })

  test('applies listings and counts for the current profile', async () => {
    const { result } = renderTreeData('p1')
    await resolveListsFor('p1', ['orders'])

    expect(result.current.queues.map((queue) => queue.name)).toEqual(['orders'])
    expect(result.current.loaded).toBe(true)
    expect(result.current.queueCounts.orders).toEqual({
      status: 'observed',
      count: 3,
      approximate: false
    })
  })

  test("a burst superseded by a profile switch never lands in the new profile's tree", async () => {
    const { result, rerender } = renderTreeData('p1')

    // Switch profiles while p1's listing is still in flight, then let it resolve late.
    rerender({ profileId: 'p2' })
    await resolveListsFor('p1', ['stale-queue'])

    expect(result.current.queues).toEqual([])
    // The dropped burst must not even fetch counts for the stale names.
    expect(sbAdmin.messages.count).not.toHaveBeenCalled()

    // The coalesced follow-up fetch for p2 lands normally.
    await resolveListsFor('p2', ['fresh-queue'])
    expect(result.current.queues.map((queue) => queue.name)).toEqual(['fresh-queue'])
  })
})
