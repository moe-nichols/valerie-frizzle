// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CreateQueueDialog } from '../../src/renderer/src/features/entities/CreateEntityDialog'
import type { Result } from '../../src/shared/errors'
import { defer } from './helpers/deferred'

const create = vi.fn<() => Promise<Result<unknown>>>()

beforeEach(() => {
  create.mockReset()
  vi.stubGlobal('sbAdmin', { entities: { queues: { create } } })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderDialog(): {
  onCreated: ReturnType<typeof vi.fn>
  onOpenChange: ReturnType<typeof vi.fn>
} {
  const onCreated = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <CreateQueueDialog profileId="p1" open onOpenChange={onOpenChange} onCreated={onCreated} />
  )
  return { onCreated, onOpenChange }
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.submit(screen.getByRole('button', { name: 'Add queue' }).closest('form')!)
  })
}

describe('CreateEntityDialog', () => {
  test('submits the name mapped through toCreateQueueInput and closes on success', async () => {
    create.mockResolvedValue({ ok: true, data: undefined })
    const { onCreated, onOpenChange } = renderDialog()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'orders' } })
    await submit()

    expect(create).toHaveBeenCalledTimes(1)
    const [profileId, input] = create.mock.calls[0] as unknown as [string, { name: string }]
    expect(profileId).toBe('p1')
    // Blank advanced fields must be omitted, not sent as empty strings.
    expect(input).toEqual({ name: 'orders' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  test('a failed Result renders the error alert and keeps the dialog open', async () => {
    create.mockResolvedValue({
      ok: false,
      error: { code: 'UNEXPECTED_ERROR', message: 'queue already exists' }
    })
    const { onOpenChange } = renderDialog()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'orders' } })
    await submit()

    expect(screen.getByText('queue already exists')).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  test('a double submit while the create is in flight calls the IPC once', async () => {
    const deferred = defer<Result<unknown>>()
    create.mockReturnValue(deferred.promise)
    renderDialog()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'orders' } })
    await submit()
    await submit()
    expect(create).toHaveBeenCalledTimes(1)

    await act(async () => {
      deferred.resolve({ ok: true, data: undefined })
    })
  })
})
