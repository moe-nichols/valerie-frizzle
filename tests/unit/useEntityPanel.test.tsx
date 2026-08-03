// @vitest-environment jsdom

import { configureStore } from '@reduxjs/toolkit'
import { act, renderHook } from '@testing-library/react'
import { Provider } from 'react-redux'
import { describe, expect, test, vi } from 'vitest'
import { useEntityPanel } from '../../src/renderer/src/features/entities/useEntityPanel'
import { settingsReducer } from '../../src/renderer/src/store/settingsSlice'

function renderPanel(initialKey: string) {
  const fetch = vi.fn(async () => {})
  const reset = vi.fn()
  const store = configureStore({ reducer: { settings: settingsReducer } })
  const hook = renderHook(({ key }: { key: string }) => useEntityPanel(key, fetch, reset), {
    initialProps: { key: initialKey },
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>
  })
  return { fetch, reset, ...hook }
}

const settle = (): Promise<void> => act(() => Promise.resolve())

describe('useEntityPanel', () => {
  test('mounting resets then refreshes once', async () => {
    const { fetch, reset } = renderPanel('p1::orders')
    await settle()

    expect(reset).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('a rerender with the same selection does not reset or refetch', async () => {
    const { fetch, reset, rerender } = renderPanel('p1::orders')
    await settle()

    rerender({ key: 'p1::orders' })
    await settle()

    expect(reset).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('a selection change resets and refetches', async () => {
    const { fetch, reset, rerender } = renderPanel('p1::orders')
    await settle()

    rerender({ key: 'p1::billing' })
    await settle()

    expect(reset).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('isCurrent captured before a selection change reports stale afterwards', async () => {
    const { result, rerender } = renderPanel('p1::orders')
    await settle()
    const wasCurrent = result.current.isCurrent

    rerender({ key: 'p1::billing' })
    await settle()

    expect(wasCurrent()).toBe(false)
    expect(result.current.isCurrent()).toBe(true)
  })
})
