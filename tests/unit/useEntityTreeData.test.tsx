// @vitest-environment jsdom

import { configureStore } from '@reduxjs/toolkit'
import { act, cleanup, renderHook } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useEntityTreeData } from '../../src/renderer/src/features/entities/useEntityTreeData'
import { connectionsReducer } from '../../src/renderer/src/store/connectionsSlice'
import { settingsReducer } from '../../src/renderer/src/store/settingsSlice'
import type { Result } from '../../src/shared/errors'

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
    count: vi.fn(async () => ({ ok: true as const, data: 3 }))
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
  sbAdmin.messages.count.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderTreeData(initialProfileId: string) {
  const store = configureStore({
    reducer: { connections: connectionsReducer, settings: settingsReducer }
  })
  return renderHook(({ profileId }: { profileId: string }) => useEntityTreeData(profileId), {
    initialProps: { profileId: initialProfileId },
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>
  })
}

describe('useEntityTreeData', () => {
  test('applies listings and counts for the current profile', async () => {
    const { result } = renderTreeData('p1')
    await resolveListsFor('p1', ['orders'])

    expect(result.current.queues.map((queue) => queue.name)).toEqual(['orders'])
    expect(result.current.loaded).toBe(true)
    expect(result.current.queueCounts.orders).toEqual({ count: 3, approximate: false })
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
