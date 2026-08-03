// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { useIsCurrent } from '../../src/renderer/src/lib/useIsCurrent'

describe('useIsCurrent', () => {
  test('the predicate is true while its key is still the latest', () => {
    const { result } = renderHook(({ key }) => useIsCurrent(key), {
      initialProps: { key: 'p1::queue-a' }
    })
    expect(result.current()).toBe(true)
  })

  test('a predicate captured before the key changed reports stale', () => {
    const { result, rerender } = renderHook(({ key }) => useIsCurrent(key), {
      initialProps: { key: 'p1::queue-a' }
    })
    const capturedBySlowFetch = result.current

    rerender({ key: 'p1::queue-b' })

    // The old fetch's predicate says "discard me"; the new render's says "apply me".
    expect(capturedBySlowFetch()).toBe(false)
    expect(result.current()).toBe(true)
  })

  test('an unchanged rerender keeps the predicate current', () => {
    const { result, rerender } = renderHook(({ key }) => useIsCurrent(key), {
      initialProps: { key: 'p1::queue-a' }
    })
    const captured = result.current
    rerender({ key: 'p1::queue-a' })
    expect(captured()).toBe(true)
  })
})
