import { z } from 'zod'
import type { IpcChannels } from './ipc-contract'
import { MAX_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS } from './pollInterval'

/**
 * Runtime validation for every IPC request payload. The `IpcChannels` request types are
 * compile-time only — erased before the code runs — so nothing stops a compromised or
 * buggy renderer from sending `maxCount: -1`, a non-string entity path, or an out-of-range
 * port straight into the Azure SDK. These schemas re-check the payload at the main-process
 * boundary before any service touches it. Unknown keys are stripped (zod's default), so
 * only the declared shape reaches the SDK.
 *
 * The exported map is typed `{ [K in keyof IpcChannels]: ZodType<request> }`, so the
 * compiler enforces both that every channel has a schema and that each schema produces its
 * channel's request type — the schemas can't silently drift from the contract.
 */

const nonEmptyString = z.string().min(1)
const port = z.number().int().min(1).max(65535)
// Service Bus caps a single receive/peek batch at 2048; anything outside [1, 2048] is a
// bug or an abuse, never a real request.
const batchCount = z.number().int().min(1).max(2048)
const waitTimeMs = z.number().int().min(0).max(300_000)
const sequenceNumber = z.number().int().nonnegative()
const receiveMode = z.enum(['peekLock', 'receiveAndDelete'])
const durationString = z.string()

const applicationProperties = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))

const messageEnvelope = z.object({
  body: z.string(),
  bodyMode: z.enum(['text', 'json', 'xml']),
  contentType: z.string().optional(),
  subject: z.string().optional(),
  correlationId: z.string().optional(),
  messageId: z.string().optional(),
  replyTo: z.string().optional(),
  timeToLive: z.number().nonnegative().optional(),
  sessionId: z.string().optional(),
  scheduledEnqueueTime: z.number().int().nonnegative().optional(),
  applicationProperties: applicationProperties.optional()
})

const receivedMessage = z.object({
  handleId: z.string().optional(),
  sequenceNumber: z.number(),
  body: z.string(),
  contentType: z.string().optional(),
  subject: z.string().optional(),
  correlationId: z.string().optional(),
  messageId: z.string().optional(),
  replyTo: z.string().optional(),
  enqueuedTimeUtc: z.string().optional(),
  deliveryCount: z.number().optional(),
  applicationProperties: applicationProperties.optional(),
  deadLetterReason: z.string().optional(),
  deadLetterErrorDescription: z.string().optional()
})

const createQueueInput = z.object({
  name: nonEmptyString,
  maxSizeInMegabytes: z.number().int().nonnegative().optional(),
  defaultMessageTimeToLive: durationString.optional(),
  lockDuration: durationString.optional(),
  requiresDuplicateDetection: z.boolean().optional(),
  duplicateDetectionHistoryTimeWindow: durationString.optional(),
  requiresSession: z.boolean().optional(),
  deadLetteringOnMessageExpiration: z.boolean().optional(),
  maxDeliveryCount: z.number().int().optional()
})

const updateQueueInput = z.object({
  maxSizeInMegabytes: z.number().int().nonnegative().optional(),
  defaultMessageTimeToLive: durationString.optional(),
  lockDuration: durationString.optional(),
  duplicateDetectionHistoryTimeWindow: durationString.optional(),
  deadLetteringOnMessageExpiration: z.boolean().optional(),
  maxDeliveryCount: z.number().int().optional()
})

const createTopicInput = z.object({
  name: nonEmptyString,
  maxSizeInMegabytes: z.number().int().nonnegative().optional(),
  defaultMessageTimeToLive: durationString.optional(),
  requiresDuplicateDetection: z.boolean().optional(),
  duplicateDetectionHistoryTimeWindow: durationString.optional()
})

const updateTopicInput = z.object({
  maxSizeInMegabytes: z.number().int().nonnegative().optional(),
  defaultMessageTimeToLive: durationString.optional(),
  duplicateDetectionHistoryTimeWindow: durationString.optional()
})

const createSubscriptionInput = z.object({
  topicName: nonEmptyString,
  subscriptionName: nonEmptyString,
  lockDuration: durationString.optional(),
  defaultMessageTimeToLive: durationString.optional(),
  requiresSession: z.boolean().optional(),
  deadLetteringOnMessageExpiration: z.boolean().optional(),
  maxDeliveryCount: z.number().int().optional()
})

const updateSubscriptionInput = z.object({
  lockDuration: durationString.optional(),
  defaultMessageTimeToLive: durationString.optional(),
  deadLetteringOnMessageExpiration: z.boolean().optional(),
  maxDeliveryCount: z.number().int().optional()
})

const ruleFilter = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Sql'), sqlExpression: z.string() }),
  z.object({
    type: z.literal('Correlation'),
    correlationId: z.string().optional(),
    messageId: z.string().optional(),
    subject: z.string().optional(),
    sessionId: z.string().optional(),
    contentType: z.string().optional()
  })
])

const ruleAction = z.object({ sqlExpression: nonEmptyString })

const createRuleInput = z.object({
  topicName: nonEmptyString,
  subscriptionName: nonEmptyString,
  name: nonEmptyString,
  filter: ruleFilter,
  action: ruleAction.optional()
})

export const ipcRequestSchemas: {
  [K in keyof IpcChannels]: z.ZodType<IpcChannels[K]['request']>
} = {
  'app:ping': z.object({ message: z.string() }),

  'preferences:pollInterval:get': z.undefined(),
  'preferences:pollInterval:set': z.object({
    // Enforced here so an out-of-range value is an honest VALIDATION_ERROR at the boundary
    // instead of being silently clamped after passing validation.
    pollIntervalMs: z.number().int().min(MIN_POLL_INTERVAL_MS).max(MAX_POLL_INTERVAL_MS)
  }),

  'preferences:theme:get': z.undefined(),
  'preferences:theme:set': z.object({ theme: z.enum(['light', 'dark']) }),

  'connections:list': z.undefined(),
  'connections:create': z.object({
    name: nonEmptyString,
    connectionString: nonEmptyString,
    managementPort: port
  }),
  'connections:test': z.object({
    connectionString: nonEmptyString,
    managementPort: port
  }),
  'connections:update': z.object({
    id: nonEmptyString,
    name: nonEmptyString.optional(),
    connectionString: nonEmptyString.optional(),
    managementPort: port.optional()
  }),
  'connections:delete': z.object({ id: nonEmptyString }),
  'connections:connect': z.object({ id: nonEmptyString }),
  'connections:disconnect': z.object({ id: nonEmptyString }),
  'connections:status': z.object({ id: nonEmptyString }),

  'entities:queues:list': z.object({ profileId: nonEmptyString }),
  'entities:queues:get': z.object({ profileId: nonEmptyString, name: nonEmptyString }),
  'entities:queues:create': z.object({ profileId: nonEmptyString, input: createQueueInput }),
  'entities:queues:update': z.object({
    profileId: nonEmptyString,
    name: nonEmptyString,
    input: updateQueueInput
  }),
  'entities:queues:delete': z.object({ profileId: nonEmptyString, name: nonEmptyString }),

  'entities:topics:list': z.object({ profileId: nonEmptyString }),
  'entities:topics:get': z.object({ profileId: nonEmptyString, name: nonEmptyString }),
  'entities:topics:create': z.object({ profileId: nonEmptyString, input: createTopicInput }),
  'entities:topics:update': z.object({
    profileId: nonEmptyString,
    name: nonEmptyString,
    input: updateTopicInput
  }),
  'entities:topics:delete': z.object({ profileId: nonEmptyString, name: nonEmptyString }),

  'entities:subscriptions:list': z.object({
    profileId: nonEmptyString,
    topicName: nonEmptyString
  }),
  'entities:subscriptions:get': z.object({
    profileId: nonEmptyString,
    topicName: nonEmptyString,
    subscriptionName: nonEmptyString
  }),
  'entities:subscriptions:create': z.object({
    profileId: nonEmptyString,
    input: createSubscriptionInput
  }),
  'entities:subscriptions:update': z.object({
    profileId: nonEmptyString,
    topicName: nonEmptyString,
    subscriptionName: nonEmptyString,
    input: updateSubscriptionInput
  }),
  'entities:subscriptions:delete': z.object({
    profileId: nonEmptyString,
    topicName: nonEmptyString,
    subscriptionName: nonEmptyString
  }),

  'entities:rules:list': z.object({
    profileId: nonEmptyString,
    topicName: nonEmptyString,
    subscriptionName: nonEmptyString
  }),
  'entities:rules:create': z.object({ profileId: nonEmptyString, input: createRuleInput }),
  'entities:rules:update': z.object({ profileId: nonEmptyString, input: createRuleInput }),
  'entities:rules:delete': z.object({
    profileId: nonEmptyString,
    topicName: nonEmptyString,
    subscriptionName: nonEmptyString,
    name: nonEmptyString
  }),

  'messages:send': z.object({
    profileId: nonEmptyString,
    entityPath: nonEmptyString,
    envelope: messageEnvelope
  }),
  'messages:peek': z.object({
    profileId: nonEmptyString,
    entityPath: nonEmptyString,
    maxCount: batchCount,
    fromSequenceNumber: sequenceNumber.optional()
  }),
  'messages:peekSubscription': z.object({
    profileId: nonEmptyString,
    topicName: nonEmptyString,
    subscriptionName: nonEmptyString,
    maxCount: batchCount,
    fromSequenceNumber: sequenceNumber.optional(),
    deadLetter: z.boolean().optional()
  }),
  'messages:count': z.object({
    profileId: nonEmptyString,
    entityPath: nonEmptyString,
    maxCount: batchCount,
    fromSequenceNumber: sequenceNumber.optional()
  }),
  'messages:countSubscription': z.object({
    profileId: nonEmptyString,
    topicName: nonEmptyString,
    subscriptionName: nonEmptyString,
    maxCount: batchCount,
    fromSequenceNumber: sequenceNumber.optional(),
    deadLetter: z.boolean().optional()
  }),
  'messages:receive': z.object({
    profileId: nonEmptyString,
    entityPath: nonEmptyString,
    maxCount: batchCount,
    mode: receiveMode,
    maxWaitTimeMs: waitTimeMs
  }),
  'messages:receiveSubscription': z.object({
    profileId: nonEmptyString,
    topicName: nonEmptyString,
    subscriptionName: nonEmptyString,
    maxCount: batchCount,
    mode: receiveMode,
    maxWaitTimeMs: waitTimeMs,
    deadLetter: z.boolean().optional()
  }),
  'messages:complete': z.object({ profileId: nonEmptyString, handleId: nonEmptyString }),
  'messages:abandon': z.object({ profileId: nonEmptyString, handleId: nonEmptyString }),
  'messages:deadLetter': z.object({
    profileId: nonEmptyString,
    handleId: nonEmptyString,
    reason: z.string(),
    description: z.string()
  }),
  'messages:purge:start': z.object({
    profileId: nonEmptyString,
    entityPath: nonEmptyString
  }),
  'messages:resubmit': z.object({
    profileId: nonEmptyString,
    handleId: nonEmptyString,
    message: receivedMessage,
    destinationEntityPath: nonEmptyString,
    regenerateMessageId: z.boolean()
  })
}
