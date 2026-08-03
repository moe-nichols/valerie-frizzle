import { describe, expect, test } from 'vitest'
import { createPurgeProgressHub } from '../../src/preload/purgeProgressHub'
import type { PurgeProgressEvent } from '../../src/shared/ipc-contract'

function progressEvent(jobId: string, deletedCount: number, done = false): PurgeProgressEvent {
  return { jobId, deletedCount, done }
}

/** Waits for queued microtasks (the hub replays buffered events via queueMicrotask). */
function flushMicrotasks(): Promise<void> {
  return Promise.resolve()
}

describe('createPurgeProgressHub', () => {
  test('replays events buffered before the subscriber attached, in order', async () => {
    const hub = createPurgeProgressHub()
    hub.deliver(progressEvent('job-1', 10))
    hub.deliver(progressEvent('job-1', 25, true))

    const seen: PurgeProgressEvent[] = []
    hub.subscribe('job-1', (event) => seen.push(event))
    await flushMicrotasks()

    expect(seen.map((event) => event.deletedCount)).toEqual([10, 25])
    expect(seen[1].done).toBe(true)
  })

  test('replay is asynchronous: subscribe returns before the callback fires', () => {
    const hub = createPurgeProgressHub()
    hub.deliver(progressEvent('job-1', 5, true))

    let fired = false
    hub.subscribe('job-1', () => {
      fired = true
    })
    expect(fired).toBe(false)
  })

  test('live events go straight to the subscriber and stop after unsubscribe', () => {
    const hub = createPurgeProgressHub()
    const seen: number[] = []
    const unsubscribe = hub.subscribe('job-1', (event) => seen.push(event.deletedCount))

    hub.deliver(progressEvent('job-1', 1))
    unsubscribe()
    hub.deliver(progressEvent('job-1', 2))

    expect(seen).toEqual([1])
  })

  test('events are routed per job, not broadcast', () => {
    const hub = createPurgeProgressHub()
    const seen: string[] = []
    hub.subscribe('job-1', (event) => seen.push(event.jobId))

    hub.deliver(progressEvent('job-2', 99))
    hub.deliver(progressEvent('job-1', 1))

    expect(seen).toEqual(['job-1'])
  })

  test('a finished job nobody subscribes to is dropped after expiry', async () => {
    const expirations: Array<() => void> = []
    const hub = createPurgeProgressHub((expire) => expirations.push(expire))

    hub.deliver(progressEvent('job-1', 7, true))
    expect(expirations).toHaveLength(1)
    for (const expire of expirations) expire()

    const seen: PurgeProgressEvent[] = []
    hub.subscribe('job-1', (event) => seen.push(event))
    await flushMicrotasks()

    expect(seen).toEqual([])
  })
})
