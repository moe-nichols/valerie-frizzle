// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { MessageDetailDialog } from '../../src/renderer/src/features/messages/MessageDetailDialog'

afterEach(cleanup)

describe('MessageDetailDialog', () => {
  test('renders broker properties, application properties, and the body', () => {
    render(
      <MessageDetailDialog
        message={{
          sequenceNumber: 42,
          body: '{"hello":"world"}',
          messageId: 'msg-1',
          subject: 'greeting',
          deadLetterReason: 'TTLExpired',
          applicationProperties: { tenant: 'acme' }
        }}
        onOpenChange={() => {}}
      />
    )

    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText('msg-1')).toBeTruthy()
    expect(screen.getByText('TTLExpired')).toBeTruthy()
    expect(screen.getByText('tenant')).toBeTruthy()
    expect(screen.getByText('acme')).toBeTruthy()
    expect(screen.getByText('{"hello":"world"}')).toBeTruthy()
  })

  test('renders nothing when no message is selected', () => {
    render(<MessageDetailDialog message={null} onOpenChange={() => {}} />)
    expect(screen.queryByText('Message detail')).toBeNull()
  })
})
