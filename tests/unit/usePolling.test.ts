// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePolling } from '../../src/renderer/src/lib/usePolling'

/** A callback whose completion the test controls. */
function deferredCallback(): { callback: () => Promise<void>; resolveNext: () => Promise<void> } {
  const resolvers: Array<() => void> = []
  const callback = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolvers.push(resolve)
      })
  )
  return {
    callback,
    async resolveNext() {
      resolvers.shift()?.()
      // Let the awaiting run continue before the test asserts.
      await Promise.resolve()
      await Promise.resolve()
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePolling', () => {
  test('a null interval ("not ready") never polls', async () => {
    const callback = vi.fn()
    renderHook(() => usePolling(callback, null))

    await vi.advanceTimersByTimeAsync(60_000)

    expect(callback).not.toHaveBeenCalled()
  })

  test('runs the callback once per interval', async () => {
    const callback = vi.fn()
    renderHook(() => usePolling(callback, 1000))

    await vi.advanceTimersByTimeAsync(3000)

    expect(callback).toHaveBeenCalledTimes(3)
  })

  test('skips timer ticks that land while a run is still in flight', async () => {
    const { callback, resolveNext } = deferredCallback()
    renderHook(() => usePolling(callback, 1000))

    await vi.advanceTimersByTimeAsync(3500)
    expect(callback).toHaveBeenCalledTimes(1)

    await resolveNext()
    await vi.advanceTimersByTimeAsync(1000)
    expect(callback).toHaveBeenCalledTimes(2)
  })

  test('a manual refresh mid-run coalesces into one follow-up run instead of overlapping', async () => {
    const { callback, resolveNext } = deferredCallback()
    const { result } = renderHook(() => usePolling(callback, null))
    const refresh = result.current

    const first = refresh()
    expect(callback).toHaveBeenCalledTimes(1)

    // Two more requests while the first run is still going — they must not start
    // concurrent runs, and must collapse into a single follow-up.
    void refresh()
    void refresh()
    expect(callback).toHaveBeenCalledTimes(1)

    await resolveNext()
    expect(callback).toHaveBeenCalledTimes(2)

    await resolveNext()
    await first
    expect(callback).toHaveBeenCalledTimes(2)
  })

  test('the interval stops when the component unmounts', async () => {
    const callback = vi.fn()
    const { unmount } = renderHook(() => usePolling(callback, 1000))

    await vi.advanceTimersByTimeAsync(1000)
    expect(callback).toHaveBeenCalledTimes(1)

    unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
