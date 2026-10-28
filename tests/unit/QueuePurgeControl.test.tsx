// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { QueuePurgeControl } from '@renderer/features/entities/QueuePurgeControl.tsx'
import type { Result } from '@shared/errors.ts'
import { deferred, failure, ok, queue } from './entityFixtures'

const api = {
  messages: {
    count: vi.fn(),
    peek: vi.fn(),
    purgeStart: vi.fn(),
    onPurgeProgress: vi.fn(() => vi.fn())
  }
}
beforeEach(() => {
  vi.stubGlobal('sbAdmin', api)
  api.messages.count.mockResolvedValue(ok(3))
  api.messages.purgeStart.mockResolvedValue(ok({ jobId: 'job' }))
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
const settle = async () => {
  await act(async () => {})
}
const props = { profileId: 'p1', queueName: 'orders', queue: queue(), target: 'active' as const }

describe('purge estimates', () => {
  test('an existing confirmation cannot be shown against a new target', async () => {
    const { rerender } = render(<QueuePurgeControl {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Purge' }))
    await settle()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    rerender(<QueuePurgeControl {...props} target="deadLetter" />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.messages.purgeStart).not.toHaveBeenCalled()
  })

  test('a rejected estimate from an old target cannot show an error on the new target', async () => {
    const pending = deferred<Result<number>>()
    api.messages.count.mockReturnValue(pending.promise)
    const { rerender } = render(<QueuePurgeControl {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Purge' }))
    rerender(<QueuePurgeControl {...props} profileId="p2" />)
    await act(async () => pending.reject(new Error('old bridge rejected')))
    expect(screen.queryByText(/Unable to estimate/)).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  test.each([0, 3, 250])(
    'confirms a fresh scalar estimate of %s before starting a purge',
    async (count) => {
      api.messages.count.mockResolvedValue(ok(count))
      render(<QueuePurgeControl {...props} />)
      fireEvent.click(screen.getByRole('button', { name: 'Purge' }))
      await settle()
      const label = count === 250 ? '250+' : String(count)
      expect(api.messages.count).toHaveBeenCalledWith('p1', 'orders', 250, 0)
      expect(api.messages.peek).not.toHaveBeenCalled()
      expect(api.messages.purgeStart).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: `Yes, purge ${label}` }))
      await settle()
      expect(api.messages.purgeStart).toHaveBeenCalledWith('p1', 'orders')
    }
  )

  test('waits for metadata and explicitly addresses the DLQ with its own eligibility', async () => {
    const { rerender } = render(<QueuePurgeControl {...props} queue={null} target="deadLetter" />)
    expect(screen.getByRole('button', { name: 'Purge' }).hasAttribute('disabled')).toBe(true)
    expect(api.messages.count).not.toHaveBeenCalled()
    rerender(
      <QueuePurgeControl
        {...props}
        queue={queue('orders', { forwardTo: 'next' })}
        target="deadLetter"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Purge' }))
    await settle()
    expect(api.messages.count).toHaveBeenCalledWith('p1', 'orders/$DeadLetterQueue', 250, 0)
  })

  test.each(['failure', 'forwarding', 'rejection'])(
    '%s leaves actionable inline feedback without confirmation',
    async (mode) => {
      api.messages.count.mockResolvedValue(failure('offline'))
      if (mode === 'rejection') api.messages.count.mockRejectedValue(new Error('bridge rejected'))
      render(
        <QueuePurgeControl
          {...props}
          queue={queue('orders', mode === 'forwarding' ? { forwardTo: 'next' } : {})}
        />
      )
      fireEvent.click(screen.getByRole('button', { name: 'Purge' }))
      await settle()
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(
        screen.getByText(mode === 'forwarding' ? /Disable forwarding/ : /Unable to estimate/)
      ).toBeTruthy()
      expect(api.messages.purgeStart).not.toHaveBeenCalled()
      if (mode === 'forwarding') expect(api.messages.count).not.toHaveBeenCalled()
    }
  )

  test.each(['profile', 'queue', 'target', 'aba', 'unmount'])(
    'discards an estimate after %s changes',
    async (change) => {
      const pending = deferred<Result<number>>()
      api.messages.count.mockReturnValue(pending.promise)
      const { rerender, unmount } = render(<QueuePurgeControl {...props} />)
      fireEvent.click(screen.getByRole('button', { name: 'Purge' }))
      if (change === 'profile') rerender(<QueuePurgeControl {...props} profileId="p2" />)
      if (change === 'queue' || change === 'aba') {
        rerender(<QueuePurgeControl {...props} queueName="billing" queue={queue('billing')} />)
        if (change === 'aba') rerender(<QueuePurgeControl {...props} />)
      }
      if (change === 'target') rerender(<QueuePurgeControl {...props} target="deadLetter" />)
      if (change === 'unmount') unmount()
      await act(async () => pending.resolve(ok(99)))
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(screen.queryByText(/99/)).toBeNull()
      expect(api.messages.purgeStart).not.toHaveBeenCalled()
    }
  )
})
