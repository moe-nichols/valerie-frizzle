// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ConfirmDialog } from '../../src/renderer/src/components/ConfirmDialog'

afterEach(cleanup)

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}): {
  onConfirm: ReturnType<typeof vi.fn>
  onOpenChange: ReturnType<typeof vi.fn>
} {
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Delete queue?"
      description='This will permanently remove "q1". This can&apos;t be undone.'
      onConfirm={onConfirm}
      {...props}
    />
  )
  return { onConfirm, onOpenChange }
}

describe('ConfirmDialog', () => {
  test('confirm fires onConfirm', () => {
    const { onConfirm } = renderDialog()
    screen.getByRole('button', { name: 'Delete' }).click()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  test('cancel does not fire onConfirm', () => {
    const { onConfirm } = renderDialog()
    screen.getByRole('button', { name: 'Cancel' }).click()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  test('pending disables the confirm button', () => {
    const { onConfirm } = renderDialog({ pending: true })
    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(confirm).toHaveProperty('disabled', true)
    confirm.click()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  test('a custom confirm label replaces the default', () => {
    renderDialog({ confirmLabel: 'Purge' })
    expect(screen.getByRole('button', { name: 'Purge' })).toBeTruthy()
  })
})
