import { describe, expect, test } from 'vitest'
import { buildResubmitEnvelope } from '../../src/main/services/replayService'
import type { ReceivedMessageDescription } from '../../src/shared/domain'

const deadLetteredMessage: ReceivedMessageDescription = {
  handleId: 'handle-1',
  sequenceNumber: 42,
  body: 'hello world',
  contentType: 'text/plain',
  subject: 'greeting',
  correlationId: 'corr-1',
  messageId: 'original-message-id',
  replyTo: 'replies-queue',
  enqueuedTimeUtc: '2026-01-01T00:00:00.000Z',
  deliveryCount: 3,
  applicationProperties: { priority: 'high' },
  deadLetterReason: 'MaxDeliveryCountExceeded',
  deadLetterErrorDescription: 'exceeded max delivery count of 1'
}

describe('buildResubmitEnvelope', () => {
  test('carries over resend-worthy properties', () => {
    const envelope = buildResubmitEnvelope(deadLetteredMessage, false)
    expect(envelope.body).toBe('hello world')
    expect(envelope.contentType).toBe('text/plain')
    expect(envelope.subject).toBe('greeting')
    expect(envelope.correlationId).toBe('corr-1')
    expect(envelope.replyTo).toBe('replies-queue')
    expect(envelope.applicationProperties).toEqual({ priority: 'high' })
  })

  test('keeps the original MessageId when regeneration is off', () => {
    const envelope = buildResubmitEnvelope(deadLetteredMessage, false)
    expect(envelope.messageId).toBe('original-message-id')
  })

  test('clears the MessageId when regeneration is on, leaving auto-generation to the sender', () => {
    const envelope = buildResubmitEnvelope(deadLetteredMessage, true)
    expect(envelope.messageId).toBeUndefined()
  })

  test("has no slot for DLQ-only metadata — it's dropped by construction", () => {
    const envelope = buildResubmitEnvelope(deadLetteredMessage, false)
    expect(envelope).not.toHaveProperty('deadLetterReason')
    expect(envelope).not.toHaveProperty('deadLetterErrorDescription')
    expect(envelope).not.toHaveProperty('deliveryCount')
  })
})
