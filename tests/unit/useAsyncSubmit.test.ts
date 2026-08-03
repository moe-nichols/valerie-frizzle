// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useAsyncSubmit } from '../../src/renderer/src/lib/useAsyncSubmit'
import type { Result } from '../../src/shared/errors'

/** An action whose completion the test controls. */
function deferredAction(): {
  action: () => Promise<Result<unknown>>
  resolveNext: (result: Result<unknown>) => Promise<void>
} {
  const resolvers: Array<(result: Result<unknown>) => void> = []
  const action = vi.fn(
    () =>
      new Promise<Result<unknown>>((resolve) => {
        resolvers.push(resolve)
      })
  )
  return {
    action,
    async resolveNext(result) {
      resolvers.shift()?.(result)
      await Promise.resolve()
      await Promise.resolve()
    }
  }
}

describe('useAsyncSubmit', () => {
  test('ignores re-entrant submits while a request is in flight', async () => {
    const { action, resolveNext } = deferredAction()
    const { result } = renderHook(() => useAsyncSubmit(action))

    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.submit()
      void result.current.submit()
      void result.current.submit()
    })
    expect(action).toHaveBeenCalledTimes(1)
    expect(result.current.submitting).toBe(true)

    await act(async () => {
      await resolveNext({ ok: true, data: undefined })
      await first
    })
    expect(result.current.submitting).toBe(false)
  })

  test('a failed Result lands in error; a later success clears it and runs onSuccess', async () => {
    const onSuccess = vi.fn()
    let response: Result<unknown> = {
      ok: false,
      error: { code: 'UNEXPECTED_ERROR', message: 'boom' }
    }
    const { result } = renderHook(() => useAsyncSubmit(async () => response, onSuccess))

    await act(() => result.current.submit())
    expect(result.current.error).toBe('boom')
    expect(onSuccess).not.toHaveBeenCalled()

    response = { ok: true, data: undefined }
    await act(() => result.current.submit())
    expect(result.current.error).toBeNull()
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  test('prevents the default form submission and reset clears the error', async () => {
    const { result } = renderHook(() =>
      useAsyncSubmit(async () => ({
        ok: false as const,
        error: { code: 'UNEXPECTED_ERROR' as const, message: 'nope' }
      }))
    )
    const preventDefault = vi.fn()

    await act(() => result.current.submit({ preventDefault } as unknown as React.FormEvent))
    expect(preventDefault).toHaveBeenCalled()
    expect(result.current.error).toBe('nope')

    act(() => result.current.reset())
    expect(result.current.error).toBeNull()
  })
})
