export interface ConnectionProfile {
  id: string
  name: string
  connectionString: string
  /**
   * The emulator's HTTP management API port (distinct from the AMQP port embedded in
   * connectionString) — not derivable from the connection string itself, since the
   * emulator's admin/management API and messaging API listen on separate ports.
   */
  managementPort: number
  createdAt: number
  updatedAt: number
}

export type EntityStatus =
  | 'Active'
  | 'Creating'
  | 'Deleting'
  | 'ReceiveDisabled'
  | 'SendDisabled'
  | 'Disabled'
  | 'Renaming'
  | 'Restoring'
  | 'Unknown'

export interface QueueDescription {
  name: string
  maxSizeInMegabytes: number
  defaultMessageTimeToLive: string
  lockDuration: string
  requiresDuplicateDetection: boolean
  duplicateDetectionHistoryTimeWindow: string
  requiresSession: boolean
  deadLetteringOnMessageExpiration: boolean
  maxDeliveryCount: number
  status: EntityStatus
}

export interface CreateQueueInput {
  name: string
  maxSizeInMegabytes?: number
  defaultMessageTimeToLive?: string
  lockDuration?: string
  requiresDuplicateDetection?: boolean
  duplicateDetectionHistoryTimeWindow?: string
  requiresSession?: boolean
  deadLetteringOnMessageExpiration?: boolean
  maxDeliveryCount?: number
}

export interface UpdateQueueInput {
  maxSizeInMegabytes?: number
  defaultMessageTimeToLive?: string
  lockDuration?: string
  duplicateDetectionHistoryTimeWindow?: string
  deadLetteringOnMessageExpiration?: boolean
  maxDeliveryCount?: number
}

export interface TopicDescription {
  name: string
  maxSizeInMegabytes: number
  defaultMessageTimeToLive: string
  requiresDuplicateDetection: boolean
  duplicateDetectionHistoryTimeWindow: string
  status: EntityStatus
}

export interface CreateTopicInput {
  name: string
  maxSizeInMegabytes?: number
  defaultMessageTimeToLive?: string
  requiresDuplicateDetection?: boolean
  duplicateDetectionHistoryTimeWindow?: string
}

export interface UpdateTopicInput {
  maxSizeInMegabytes?: number
  defaultMessageTimeToLive?: string
  duplicateDetectionHistoryTimeWindow?: string
}

export interface SubscriptionDescription {
  topicName: string
  subscriptionName: string
  lockDuration: string
  defaultMessageTimeToLive: string
  requiresSession: boolean
  deadLetteringOnMessageExpiration: boolean
  maxDeliveryCount: number
  status: EntityStatus
}

export interface CreateSubscriptionInput {
  topicName: string
  subscriptionName: string
  lockDuration?: string
  defaultMessageTimeToLive?: string
  requiresSession?: boolean
  deadLetteringOnMessageExpiration?: boolean
  maxDeliveryCount?: number
}

export interface UpdateSubscriptionInput {
  lockDuration?: string
  defaultMessageTimeToLive?: string
  deadLetteringOnMessageExpiration?: boolean
  maxDeliveryCount?: number
}

export interface SqlRuleFilterInput {
  type: 'Sql'
  sqlExpression: string
}

export interface CorrelationRuleFilterInput {
  type: 'Correlation'
  correlationId?: string
  messageId?: string
  subject?: string
  sessionId?: string
  contentType?: string
}

export type RuleFilterInput = SqlRuleFilterInput | CorrelationRuleFilterInput

export interface RuleDescription {
  topicName: string
  subscriptionName: string
  name: string
  filter: RuleFilterInput
}

export interface CreateRuleInput {
  topicName: string
  subscriptionName: string
  name: string
  filter: RuleFilterInput
}

export type ApplicationPropertyValue = string | number | boolean

/** What the composer sends. `bodyMode` only drives Monaco's syntax highlighting —
 * the wire body is always the raw string in `body`; `contentType` is the actual hint
 * consumers should use to interpret it (matches how Service Bus itself works: it never
 * parses the body, `contentType` is just an application-level convention). */
export interface MessageEnvelope {
  body: string
  bodyMode: 'text' | 'json' | 'xml'
  contentType?: string
  subject?: string
  correlationId?: string
  /** Left blank to auto-generate. */
  messageId?: string
  replyTo?: string
  /** Milliseconds. */
  timeToLive?: number
  /** Session id — required for session-enabled entities; ignored otherwise. */
  sessionId?: string
  /** Epoch milliseconds. When set, the broker holds the message until this time before it
   * becomes available (scheduled/delayed enqueue). */
  scheduledEnqueueTime?: number
  applicationProperties?: Record<string, ApplicationPropertyValue>
}

export type ReceiveMode = 'peekLock' | 'receiveAndDelete'

/**
 * The JS SDK's `createReceiver(name, { subQueueType: 'deadLetter' })` option internally
 * does nothing more than append this suffix to the entity path before handing it to the
 * AMQP link (confirmed by reading the SDK source) — so passing the suffixed path string
 * directly works identically, and every entityPath-taking method (peek/receive/purge)
 * already accepts a DLQ path unchanged, no separate DLQ-specific plumbing needed.
 */
const DEAD_LETTER_QUEUE_SUFFIX = '/$DeadLetterQueue'

export function buildDeadLetterQueuePath(queueName: string): string {
  return `${queueName}${DEAD_LETTER_QUEUE_SUFFIX}`
}

export interface ReceivedMessageDescription {
  /** Present only for peekLock-mode receive results — the only case where the message
   * can later be settled (complete/abandon/deadLetter). Absent for peek results and for
   * receiveAndDelete-mode receives, both of which have nothing left to settle. */
  handleId?: string
  sequenceNumber: number
  body: string
  contentType?: string
  subject?: string
  correlationId?: string
  messageId?: string
  replyTo?: string
  enqueuedTimeUtc?: string
  deliveryCount?: number
  applicationProperties?: Record<string, ApplicationPropertyValue>
  deadLetterReason?: string
  deadLetterErrorDescription?: string
}
