// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { FormDialog } from '../../src/renderer/src/components/FormDialog'
import type { Result } from '../../src/shared/errors'

afterEach(cleanup)

const failure: Result<unknown> = {
  ok: false,
  error: { code: 'UNEXPECTED_ERROR', message: 'creation failed' }
}

describe('FormDialog', () => {
  test('a failed action renders its message; a successful one runs onSuccess', async () => {
    let response: Result<unknown> = failure
    const onSuccess = vi.fn()
    render(
      <FormDialog
        title="Add queue"
        open
        onOpenChange={() => {}}
        submitLabel="Add queue"
        action={async () => response}
        onSuccess={onSuccess}
      >
        <input aria-label="Name" />
      </FormDialog>
    )

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Add queue' }).closest('form')!)
    })
    expect(screen.getByText('creation failed')).toBeTruthy()
    expect(onSuccess).not.toHaveBeenCalled()

    response = { ok: true, data: undefined }
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Add queue' }).closest('form')!)
    })
    expect(screen.queryByText('creation failed')).toBeNull()
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  test('the submit button disables while the action is in flight', async () => {
    let release: (result: Result<unknown>) => void = () => {}
    const action = (): Promise<Result<unknown>> =>
      new Promise((resolve) => {
        release = resolve
      })
    render(
      <FormDialog
        title="Add queue"
        open
        onOpenChange={() => {}}
        submitLabel="Add queue"
        action={action}
      >
        <input aria-label="Name" />
      </FormDialog>
    )

    const button = screen.getByRole('button', { name: 'Add queue' })
    await act(async () => {
      fireEvent.submit(button.closest('form')!)
    })
    expect(button).toHaveProperty('disabled', true)

    await act(async () => {
      release({ ok: true, data: undefined })
    })
    expect(button).toHaveProperty('disabled', false)
  })
})
