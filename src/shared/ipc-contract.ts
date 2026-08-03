import type { Result } from './errors'
import type {
  ConnectionProfile,
  QueueDescription,
  CreateQueueInput,
  UpdateQueueInput,
  TopicDescription,
  CreateTopicInput,
  UpdateTopicInput,
  SubscriptionDescription,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  RuleDescription,
  CreateRuleInput,
  UpdateRuleInput,
  MessageEnvelope,
  ReceivedMessageDescription,
  ReceiveMode
} from './domain'

export interface IpcChannels {
  'app:ping': {
    request: { message: string }
    response: Result<{ echo: string; timestamp: number }>
  }
  'preferences:pollInterval:get': {
    request: undefined
    response: Result<number>
  }
  'preferences:pollInterval:set': {
    request: { pollIntervalMs: number }
    response: Result<number>
  }
  'connections:list': {
    request: undefined
    response: Result<ConnectionProfile[]>
  }
  'connections:create': {
    request: { name: string; connectionString: string; managementPort: number }
    response: Result<ConnectionProfile>
  }
  'connections:update': {
    request: {
      id: string
      name?: string
      connectionString?: string
      managementPort?: number
    }
    response: Result<ConnectionProfile>
  }
  'connections:delete': {
    request: { id: string }
    response: Result<undefined>
  }
  'connections:connect': {
    request: { id: string }
    response: Result<undefined>
  }
  'connections:disconnect': {
    request: { id: string }
    response: Result<undefined>
  }
  'connections:status': {
    request: { id: string }
    response: Result<{ connected: boolean }>
  }
  'entities:queues:list': {
    request: { profileId: string }
    response: Result<QueueDescription[]>
  }
  'entities:queues:get': {
    request: { profileId: string; name: string }
    response: Result<QueueDescription>
  }
  'entities:queues:create': {
    request: { profileId: string; input: CreateQueueInput }
    response: Result<QueueDescription>
  }
  'entities:queues:update': {
    request: { profileId: string; name: string; input: UpdateQueueInput }
    response: Result<QueueDescription>
  }
  'entities:queues:delete': {
    request: { profileId: string; name: string }
    response: Result<undefined>
  }
  'entities:topics:list': {
    request: { profileId: string }
    response: Result<TopicDescription[]>
  }
  'entities:topics:get': {
    request: { profileId: string; name: string }
    response: Result<TopicDescription>
  }
  'entities:topics:create': {
    request: { profileId: string; input: CreateTopicInput }
    response: Result<TopicDescription>
  }
  'entities:topics:update': {
    request: { profileId: string; name: string; input: UpdateTopicInput }
    response: Result<TopicDescription>
  }
  'entities:topics:delete': {
    request: { profileId: string; name: string }
    response: Result<undefined>
  }
  'entities:subscriptions:list': {
    request: { profileId: string; topicName: string }
    response: Result<SubscriptionDescription[]>
  }
  'entities:subscriptions:get': {
    request: { profileId: string; topicName: string; subscriptionName: string }
    response: Result<SubscriptionDescription>
  }
  'entities:subscriptions:create': {
    request: { profileId: string; input: CreateSubscriptionInput }
    response: Result<SubscriptionDescription>
  }
  'entities:subscriptions:update': {
    request: {
      profileId: string
      topicName: string
      subscriptionName: string
      input: UpdateSubscriptionInput
    }
    response: Result<SubscriptionDescription>
  }
  'entities:subscriptions:delete': {
    request: { profileId: string; topicName: string; subscriptionName: string }
    response: Result<undefined>
  }
  'entities:rules:list': {
    request: { profileId: string; topicName: string; subscriptionName: string }
    response: Result<RuleDescription[]>
  }
  'entities:rules:create': {
    request: { profileId: string; input: CreateRuleInput }
    response: Result<RuleDescription>
  }
  'entities:rules:update': {
    request: { profileId: string; input: UpdateRuleInput }
    response: Result<RuleDescription>
  }
  'entities:rules:delete': {
    request: { profileId: string; topicName: string; subscriptionName: string; name: string }
    response: Result<undefined>
  }
  'messages:send': {
    request: { profileId: string; entityPath: string; envelope: MessageEnvelope }
    response: Result<undefined>
  }
  'messages:peek': {
    request: {
      profileId: string
      entityPath: string
      maxCount: number
      fromSequenceNumber?: number
    }
    response: Result<ReceivedMessageDescription[]>
  }
  'messages:peekSubscription': {
    request: {
      profileId: string
      topicName: string
      subscriptionName: string
      maxCount: number
      fromSequenceNumber?: number
      /** Peek the subscription's dead-letter sub-queue instead of the subscription itself. */
      deadLetter?: boolean
    }
    response: Result<ReceivedMessageDescription[]>
  }
  'messages:count': {
    request: {
      profileId: string
      entityPath: string
      maxCount: number
      fromSequenceNumber?: number
    }
    response: Result<number>
  }
  'messages:countSubscription': {
    request: {
      profileId: string
      topicName: string
      subscriptionName: string
      maxCount: number
      fromSequenceNumber?: number
      /** Count the subscription's dead-letter sub-queue instead of the subscription itself. */
      deadLetter?: boolean
    }
    response: Result<number>
  }
  'messages:receive': {
    request: {
      profileId: string
      entityPath: string
      maxCount: number
      mode: ReceiveMode
      maxWaitTimeMs: number
    }
    response: Result<ReceivedMessageDescription[]>
  }
  'messages:receiveSubscription': {
    request: {
      profileId: string
      topicName: string
      subscriptionName: string
      maxCount: number
      mode: ReceiveMode
      maxWaitTimeMs: number
      /** Receive from the subscription's dead-letter sub-queue instead of the subscription. */
      deadLetter?: boolean
    }
    response: Result<ReceivedMessageDescription[]>
  }
  'messages:complete': {
    request: { profileId: string; handleId: string }
    response: Result<undefined>
  }
  'messages:abandon': {
    request: { profileId: string; handleId: string }
    response: Result<undefined>
  }
  'messages:deadLetter': {
    request: { profileId: string; handleId: string; reason: string; description: string }
    response: Result<undefined>
  }
  'messages:purge:start': {
    request: { profileId: string; entityPath: string }
    response: Result<{ jobId: string }>
  }
  'messages:resubmit': {
    request: {
      profileId: string
      handleId: string
      message: ReceivedMessageDescription
      destinationEntityPath: string
      regenerateMessageId: boolean
    }
    response: Result<undefined>
  }
}

/**
 * Purging can take a while on a large queue, so it doesn't fit the request/response
 * `invoke` shape above — instead `messages:purge:start` returns immediately with a
 * jobId, and progress is pushed from main via `webContents.send` on this channel as the
 * drain loop runs. This is the first (and, for now, only) push-event channel in the app;
 * if more get added later, consider generalizing this pattern rather than one-off
 * channel names like connections/entities/messages above.
 */
export const PURGE_PROGRESS_CHANNEL = 'messages:purge:progress'

export interface PurgeProgressEvent {
  jobId: string
  deletedCount: number
  done: boolean
  /** Set on the terminal event when the drain loop stopped at the safety iteration cap
   * rather than emptying the entity — the count is then a floor, not the full queue. */
  stoppedAtCap?: boolean
  error?: string
}
