// @vitest-environment jsdom

import { configureStore } from '@reduxjs/toolkit'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TooltipProvider } from '@renderer/components/ui/tooltip.tsx'
import { EntityCountBadges } from '@renderer/features/entities/EntityCountBadges.tsx'
import { QueuePanel } from '@renderer/features/entities/QueuePanel.tsx'
import { settingsReducer } from '@renderer/store/settingsSlice.ts'
import type { QueueDescription } from '@shared/domain.ts'
import type { Result } from '@shared/errors.ts'
import { deferred, failure, ok, queue } from './entityFixtures'

vi.mock('../../src/renderer/src/features/messages/MessageBrowser', () => ({
  MessageBrowser: () => null
}))
vi.mock('../../src/renderer/src/features/messages/MessageComposer', () => ({
  MessageComposer: () => null
}))
const api = {
  entities: { queues: { get: vi.fn() } },
  messages: { count: vi.fn() }
}
beforeEach(() => {
  vi.stubGlobal('sbAdmin', api)
  api.messages.count.mockResolvedValue(ok(3))
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
function renderPanel() {
  const store = configureStore({ reducer: { settings: settingsReducer } })
  return render(
    <Provider store={store}>
      <TooltipProvider>
        <QueuePanel profileId="p1" queueName="orders" />
      </TooltipProvider>
    </Provider>
  )
}
const settle = async () => {
  await act(async () => {})
}

test('panel shows metadata and enables purge before a slow count settles', async () => {
  const description = deferred<Result<QueueDescription>>()
  const count = deferred<Result<number>>()
  api.entities.queues.get.mockReturnValue(description.promise)
  api.messages.count.mockReturnValue(count.promise)
  renderPanel()
  expect(
    screen
      .getAllByRole('button', { name: 'Purge' })
      .every((button) => button.hasAttribute('disabled'))
  ).toBe(true)
  expect(api.messages.count).not.toHaveBeenCalled()
  await act(async () => description.resolve(ok(queue())))
  expect(screen.getByText(/Active, max/)).toBeTruthy()
  expect(screen.getByText(/Updated/)).toBeTruthy()
  expect(
    screen
      .getAllByRole('button', { name: 'Purge' })
      .every((button) => !button.hasAttribute('disabled'))
  ).toBe(true)
  await act(async () => count.resolve(ok(250)))
  expect(screen.getByText('250+ active')).toBeTruthy()
})

test('panel displays forwarding, skips the active badge count, and explains unavailable purge estimates', async () => {
  api.entities.queues.get.mockResolvedValue(ok(queue('orders', { forwardTo: 'next' })))
  renderPanel()
  await settle()
  expect(screen.getByText('forwarding')).toBeTruthy()
  expect(api.messages.count).not.toHaveBeenCalled()
  fireEvent.click(screen.getAllByRole('button', { name: 'Purge' })[0])
  await settle()
  expect(screen.getByText(/Disable forwarding and retry Purge/)).toBeTruthy()
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('metadata failures stay visible rather than leaving only disabled purge controls', async () => {
  api.entities.queues.get.mockResolvedValue(failure('metadata unavailable'))
  renderPanel()
  await settle()
  expect(screen.getByText(/Failed to refresh orders: metadata unavailable/)).toBeTruthy()
  expect(api.messages.count).not.toHaveBeenCalled()
})

test('badges show active zero, hide DLQ zero, and suppress numeric forwarding observations', () => {
  const { rerender } = render(
    <EntityCountBadges
      active={{ status: 'observed', count: 0, approximate: false }}
      deadLetter={{ status: 'observed', count: 0, approximate: false }}
      activeSuffix=" active"
    />
  )
  expect(screen.getByText('0 active')).toBeTruthy()
  expect(screen.queryByText(/DLQ/)).toBeNull()
  rerender(
    <EntityCountBadges
      active={{ status: 'unavailable', reason: 'forwarding' }}
      deadLetter={{ status: 'observed', count: 250, approximate: true }}
    />
  )
  expect(screen.getByText('forwarding')).toBeTruthy()
  expect(screen.getByText('250+ DLQ')).toBeTruthy()
  expect(screen.queryByText('0 active')).toBeNull()
})
