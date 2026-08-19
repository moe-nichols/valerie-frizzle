import { randomUUID } from 'node:crypto'
import type {
  ServiceBusClient,
  ServiceBusReceivedMessage,
  ServiceBusReceiver
} from '@azure/service-bus'
import type {
  ApplicationPropertyValue,
  MessageEnvelope,
  ReceivedMessageDescription,
  ReceiveMode
} from '@shared/domain'
import { AppError } from '@shared/errors'
import Long from 'long'

interface PeekLockHandle {
  message: ServiceBusReceivedMessage
  receiver: ServiceBusReceiver
}

/**
 * How a receiver is addressed. A queue (or a queue DLQ, which really is just a path
 * suffix) is a single `entityPath`; a subscription uses the SDK's distinct two-arg
 * `createReceiver(topicName, subscriptionName)` overload (confirmed by reading the SDK's
 * type declarations), and its DLQ is a `subQueueType` option on that overload, not a
 * path suffix.
 */
type ReceiverTarget =
  | { entityPath: string }
  | { topicName: string; subscriptionName: string; deadLetter?: boolean }

/**
 * Recognizes the "can't browse an auto-forwarding entity" failure without importing SDK
 * classes. Peeking/browsing an entity with auto-forwarding enabled is a permanent Service
 * Bus limitation (not an emulator quirk). The SDK surfaces it as a ServiceBusError whose
 * `code` is the generic `GeneralError` (it maps the AMQP `amqp:not-allowed` /
 * `InvalidOperationError` reason down to `GeneralError` and prefixes the real reason onto
 * the message — confirmed by reading @azure/service-bus's serviceBusError.js), so the
 * message text is the reliable discriminator, not `code`.
 */
function isAutoForwardBrowseError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const { message } = err as { message?: unknown }
  return typeof message === 'string' && /auto-forwarding/i.test(message)
}

function describeTarget(target: ReceiverTarget): string {
  if ('entityPath' in target) return target.entityPath
  const suffix = target.deadLetter ? ' (DLQ)' : ''
  return `${target.topicName}/${target.subscriptionName}${suffix}`
}

function stringifyBody(body: unknown): string {
  if (typeof body === 'string') return body
  if (body === null || body === undefined) return ''
  if (Buffer.isBuffer(body)) return body.toString('utf-8')
  try {
    return JSON.stringify(body)
  } catch {
    return String(body)
  }
}

function toApplicationProperties(
  properties: Record<string, unknown> | undefined
): Record<string, ApplicationPropertyValue> | undefined {
  if (!properties) return undefined
  const result: Record<string, ApplicationPropertyValue> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value
    } else {
      result[key] = String(value)
    }
  }
  return result
}

function toReceivedMessageDescription(
  message: ServiceBusReceivedMessage,
  handleId?: string
): ReceivedMessageDescription {
  return {
    handleId,
    sequenceNumber: message.sequenceNumber?.toNumber() ?? 0,
    body: stringifyBody(message.body),
    contentType: message.contentType,
    subject: message.subject,
    correlationId: message.correlationId !== undefined ? String(message.correlationId) : undefined,
    messageId: message.messageId !== undefined ? String(message.messageId) : undefined,
    replyTo: message.replyTo,
    enqueuedTimeUtc: message.enqueuedTimeUtc?.toISOString(),
    deliveryCount: message.deliveryCount,
    applicationProperties: toApplicationProperties(message.applicationProperties),
    deadLetterReason: message.deadLetterReason,
    deadLetterErrorDescription: message.deadLetterErrorDescription
  }
}

/**
 * Wraps ServiceBusClient for send/peek/receive against a queue. Unlike AdminService,
 * this holds real mutable state (open PeekLock receivers keyed by handle id) that must
 * survive across separate IPC calls — a receive call hands back handle ids, and a later,
 * separate complete/abandon/deadLetter call must settle the *same* underlying message on
 * the *same* receiver (lock tokens and receiver objects can't cross IPC). Because of
 * this, one MessagingService instance must live for the lifetime of a connected profile
 * (see connectionManager.ts) rather than being constructed fresh per IPC request.
 */
export class MessagingService {
  private peekLockHandles = new Map<string, PeekLockHandle>()
  // Number of outstanding (not-yet-settled) handles per open PeekLock receiver. A single
  // `receiveMessages` batch shares one receiver across all its messages, so the receiver
  // must stay open until the *last* of them is settled — tracking a count (rather than
  // rescanning peekLockHandles) makes closing safe even when settlements for the same
  // batch overlap: each settle decrements exactly once, and only the one that brings the
  // count to zero closes the receiver, after its own action has already resolved.
  private receiverRefCounts = new Map<ServiceBusReceiver, number>()

  constructor(private client: ServiceBusClient) {}

  async sendMessage(entityPath: string, envelope: MessageEnvelope): Promise<void> {
    const sender = this.client.createSender(entityPath)
    try {
      await sender.sendMessages({
        // The SDK's default data transformer JSON.stringify()s any non-Buffer body
        // (including strings) before writing the AMQP data section, which would
        // double-encode text/json/xml bodies alike. Passing a Buffer bypasses that.
        body: Buffer.from(envelope.body, 'utf8'),
        contentType: envelope.contentType,
        subject: envelope.subject,
        correlationId: envelope.correlationId,
        messageId: envelope.messageId || randomUUID(),
        replyTo: envelope.replyTo,
        timeToLive: envelope.timeToLive,
        sessionId: envelope.sessionId,
        scheduledEnqueueTimeUtc:
          envelope.scheduledEnqueueTime !== undefined
            ? new Date(envelope.scheduledEnqueueTime)
            : undefined,
        applicationProperties: envelope.applicationProperties
      })
    } finally {
      await sender.close()
    }
  }

  /** The one place a receiver is constructed — every peek/count/receive pair differs
   * only in this addressing (see {@link ReceiverTarget}). */
  private openReceiver(target: ReceiverTarget, mode?: ReceiveMode): ServiceBusReceiver {
    // Bodies are always sent as raw Buffers (see sendMessage), so skip the SDK's
    // JSON.parse() attempt on receive too — otherwise a JSON-shaped body would come
    // back as a parsed object instead of the original raw string.
    const options = { ...(mode ? { receiveMode: mode } : {}), skipParsingBodyAsJson: true }
    if ('entityPath' in target) {
      return this.client.createReceiver(target.entityPath, options)
    }
    return this.client.createReceiver(target.topicName, target.subscriptionName, {
      ...options,
      ...(target.deadLetter ? { subQueueType: 'deadLetter' as const } : {})
    })
  }

  /** Opens a transient receiver, peeks up to `maxCount` (optionally from a cursor), maps
   * the batch through `project`, and always closes the receiver. The four public
   * peek/count methods differ only in how the receiver is addressed and what they
   * project out of the batch. */
  private async withPeekedBatch<T>(
    target: ReceiverTarget,
    maxCount: number,
    fromSequenceNumber: number | undefined,
    project: (messages: ServiceBusReceivedMessage[]) => T
  ): Promise<T> {
    const receiver = this.openReceiver(target)
    try {
      const messages = await receiver.peekMessages(maxCount, {
        fromSequenceNumber:
          fromSequenceNumber !== undefined ? Long.fromNumber(fromSequenceNumber) : undefined
      })
      return project(messages)
    } catch (err) {
      // Defense in depth: the renderer already skips the count for auto-forwarding entities
      // (it reads forwardTo — see EntityCountBadges/useEntityTreeData), but if any path still
      // peeks one, turn the SDK's opaque error into a clear, actionable one. Mirrors
      // drainReceiver's explicit catch/close/rethrow rather than relying on `finally` alone.
      if (isAutoForwardBrowseError(err)) {
        throw new Error(
          `Cannot browse messages on "${describeTarget(target)}": it has auto-forwarding enabled, which Service Bus does not allow peeking.`
        )
      }
      throw err
    } finally {
      await receiver.close()
    }
  }

  async peekMessages(
    entityPath: string,
    maxCount: number,
    fromSequenceNumber?: number
  ): Promise<ReceivedMessageDescription[]> {
    return this.withPeekedBatch({ entityPath }, maxCount, fromSequenceNumber, (messages) =>
      messages.map((message) => toReceivedMessageDescription(message))
    )
  }

  /** Subscription counterpart of {@link peekMessages} — see {@link ReceiverTarget} for why
   * a subscription (and its DLQ) is addressed differently from a queue. */
  async peekSubscriptionMessages(
    topicName: string,
    subscriptionName: string,
    maxCount: number,
    fromSequenceNumber?: number,
    deadLetter = false
  ): Promise<ReceivedMessageDescription[]> {
    return this.withPeekedBatch(
      { topicName, subscriptionName, deadLetter },
      maxCount,
      fromSequenceNumber,
      (messages) => messages.map((message) => toReceivedMessageDescription(message))
    )
  }

  /**
   * Counts messages by peeking up to `maxCount` and returning only the tally — the full
   * envelopes never leave the main process. Used by the sidebar/panel pollers, which would
   * otherwise serialize every message body over IPC just to read `.length`. Callers treat
   * a result equal to `maxCount` as a lower bound ("N+"). Mirrors `peekMessages` for
   * cursor semantics: pass `fromSequenceNumber: 0` to count from the very first message.
   */
  async countMessages(
    entityPath: string,
    maxCount: number,
    fromSequenceNumber?: number
  ): Promise<number> {
    return this.withPeekedBatch(
      { entityPath },
      maxCount,
      fromSequenceNumber,
      (messages) => messages.length
    )
  }

  /** Subscription counterpart of {@link countMessages}. */
  async countSubscriptionMessages(
    topicName: string,
    subscriptionName: string,
    maxCount: number,
    fromSequenceNumber?: number,
    deadLetter = false
  ): Promise<number> {
    return this.withPeekedBatch(
      { topicName, subscriptionName, deadLetter },
      maxCount,
      fromSequenceNumber,
      (messages) => messages.length
    )
  }

  async receiveMessages(
    entityPath: string,
    maxCount: number,
    mode: ReceiveMode,
    maxWaitTimeMs: number
  ): Promise<ReceivedMessageDescription[]> {
    return this.drainReceiver(
      this.openReceiver({ entityPath }, mode),
      maxCount,
      mode,
      maxWaitTimeMs
    )
  }

  /**
   * Subscription counterpart of {@link receiveMessages}; the returned PeekLock handles
   * settle through the same handle-based complete/abandon/deadLetter path, since settling
   * is keyed on the receiver, not on how it was created.
   */
  async receiveSubscriptionMessages(
    topicName: string,
    subscriptionName: string,
    maxCount: number,
    mode: ReceiveMode,
    maxWaitTimeMs: number,
    deadLetter = false
  ): Promise<ReceivedMessageDescription[]> {
    return this.drainReceiver(
      this.openReceiver({ topicName, subscriptionName, deadLetter }, mode),
      maxCount,
      mode,
      maxWaitTimeMs
    )
  }

  /** Shared receive body for queues and subscriptions — the only thing that differs between
   * them is how the receiver is created (single-path vs. two-arg overload). */
  private async drainReceiver(
    receiver: ServiceBusReceiver,
    maxCount: number,
    mode: ReceiveMode,
    maxWaitTimeMs: number
  ): Promise<ReceivedMessageDescription[]> {
    if (mode === 'receiveAndDelete') {
      try {
        const messages = await receiver.receiveMessages(maxCount, {
          maxWaitTimeInMs: maxWaitTimeMs
        })
        return messages.map((message) => toReceivedMessageDescription(message))
      } finally {
        await receiver.close()
      }
    }

    // PeekLock: keep the receiver open and stash a handle per message so the renderer can
    // settle it later via a separate IPC call. But if the receive throws, or returns no
    // messages, there's nothing to settle — so the receiver would otherwise leak (an open
    // AMQP link that close() below can't reclaim, since it only walks live handles). Close
    // it in those cases; only keep it open once at least one handle actually references it.
    let messages: ServiceBusReceivedMessage[]
    try {
      messages = await receiver.receiveMessages(maxCount, { maxWaitTimeInMs: maxWaitTimeMs })
    } catch (err) {
      await receiver.close()
      throw err
    }

    if (messages.length === 0) {
      await receiver.close()
      return []
    }

    // Project before registering any handle/ref-count state: if the projection throws,
    // the receiver is closed and rethrown from here with nothing half-registered —
    // otherwise it would be stranded open with no handle ever able to release it.
    let described: Array<{
      message: ServiceBusReceivedMessage
      handleId: string
      result: ReceivedMessageDescription
    }>
    try {
      described = messages.map((message) => {
        const handleId = randomUUID()
        return { message, handleId, result: toReceivedMessageDescription(message, handleId) }
      })
    } catch (err) {
      await receiver.close()
      throw err
    }

    this.receiverRefCounts.set(receiver, described.length)
    for (const { message, handleId } of described) {
      this.peekLockHandles.set(handleId, { message, receiver })
    }
    return described.map(({ result }) => result)
  }

  private async settle(
    handleId: string,
    action: (message: ServiceBusReceivedMessage, receiver: ServiceBusReceiver) => Promise<void>
  ): Promise<void> {
    const handle = this.peekLockHandles.get(handleId)
    if (!handle) {
      throw new AppError(
        'NOT_FOUND',
        `no such message handle (it may have already been settled, or its lock expired): ${handleId}`
      )
    }
    // Remove the handle up front so it can't be settled twice, but decrement the receiver's
    // ref count only after the action resolves — otherwise a concurrent settle of a sibling
    // message could bring the count to zero and close the receiver while this action is
    // still in flight. The decrement runs even if `action` throws (e.g. an expired lock):
    // the handle is already gone, so the receiver must still be released once drained.
    this.peekLockHandles.delete(handleId)
    try {
      await action(handle.message, handle.receiver)
    } finally {
      await this.releaseReceiver(handle.receiver)
    }
  }

  /** Decrements the receiver's outstanding-handle count and closes it once it reaches zero.
   * Called exactly once per settled handle. */
  private async releaseReceiver(receiver: ServiceBusReceiver): Promise<void> {
    const remaining = (this.receiverRefCounts.get(receiver) ?? 1) - 1
    if (remaining <= 0) {
      this.receiverRefCounts.delete(receiver)
      await receiver.close()
    } else {
      this.receiverRefCounts.set(receiver, remaining)
    }
  }

  async completeMessage(handleId: string): Promise<void> {
    await this.settle(handleId, (message, receiver) => receiver.completeMessage(message))
  }

  async abandonMessage(handleId: string): Promise<void> {
    await this.settle(handleId, (message, receiver) => receiver.abandonMessage(message))
  }

  async deadLetterMessage(handleId: string, reason: string, description: string): Promise<void> {
    await this.settle(handleId, (message, receiver) =>
      receiver.deadLetterMessage(message, {
        deadLetterReason: reason,
        deadLetterErrorDescription: description
      })
    )
  }

  /** Closes every receiver still open due to unsettled PeekLock handles — called when the
   * owning profile disconnects. Drives off the ref-count map (the authoritative set of open
   * receivers) rather than the handle map, so a receiver whose handles have all expired but
   * were never settled is still reclaimed. */
  async close(): Promise<void> {
    const receivers = [...this.receiverRefCounts.keys()]
    this.peekLockHandles.clear()
    this.receiverRefCounts.clear()
    await Promise.all(receivers.map((receiver) => receiver.close()))
  }
}
