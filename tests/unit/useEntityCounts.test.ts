// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { useEntityCounts } from '../../src/renderer/src/lib/useEntityCounts'

const count = (n: number): { count: number; approximate: boolean } => ({
  count: n,
  approximate: false
})

describe('useEntityCounts', () => {
  test('an entity whose fetch failed keeps its previous count instead of flickering away', async () => {
    const { result } = renderHook(() => useEntityCounts())

    await act(() => result.current.updateCounts(['a'], async () => count(2)))
    expect(result.current.counts.a).toEqual(count(2))

    await act(() => result.current.updateCounts(['a'], async () => null))
    expect(result.current.counts.a).toEqual(count(2))
  })

  test('entities no longer in the listing are dropped from the map', async () => {
    const { result } = renderHook(() => useEntityCounts())

    await act(() => result.current.updateCounts(['a', 'b'], async () => count(1)))
    expect(Object.keys(result.current.counts).sort()).toEqual(['a', 'b'])

    await act(() => result.current.updateCounts(['b'], async () => count(1)))
    expect(Object.keys(result.current.counts)).toEqual(['b'])
  })

  test('a vetoed burst (shouldApply false) is discarded entirely', async () => {
    const { result } = renderHook(() => useEntityCounts())

    await act(() =>
      result.current.updateCounts(
        ['a'],
        async () => count(9),
        () => false
      )
    )
    expect(result.current.counts).toEqual({})
  })

  test('resetCounts empties the map', async () => {
    const { result } = renderHook(() => useEntityCounts())
    await act(() => result.current.updateCounts(['a'], async () => count(1)))

    act(() => result.current.resetCounts())
    expect(result.current.counts).toEqual({})
  })
})
