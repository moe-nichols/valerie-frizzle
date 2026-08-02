import type {
  ServiceBusAdministrationClient,
  QueueProperties,
  TopicProperties,
  SubscriptionProperties,
  RuleProperties,
  SqlRuleFilter,
  CorrelationRuleFilter
} from '@azure/service-bus'
import type {
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
  RuleFilterInput
} from '@shared/domain'

function toQueueDescription(props: QueueProperties): QueueDescription {
  return {
    name: props.name,
    maxSizeInMegabytes: props.maxSizeInMegabytes,
    defaultMessageTimeToLive: props.defaultMessageTimeToLive,
    lockDuration: props.lockDuration,
    requiresDuplicateDetection: props.requiresDuplicateDetection,
    duplicateDetectionHistoryTimeWindow: props.duplicateDetectionHistoryTimeWindow,
    requiresSession: props.requiresSession,
    deadLetteringOnMessageExpiration: props.deadLetteringOnMessageExpiration,
    maxDeliveryCount: props.maxDeliveryCount,
    status: props.status
  }
}

function toTopicDescription(props: TopicProperties): TopicDescription {
  return {
    name: props.name,
    maxSizeInMegabytes: props.maxSizeInMegabytes,
    defaultMessageTimeToLive: props.defaultMessageTimeToLive,
    requiresDuplicateDetection: props.requiresDuplicateDetection,
    duplicateDetectionHistoryTimeWindow: props.duplicateDetectionHistoryTimeWindow,
    status: props.status
  }
}

function toSubscriptionDescription(props: SubscriptionProperties): SubscriptionDescription {
  return {
    topicName: props.topicName,
    subscriptionName: props.subscriptionName,
    lockDuration: props.lockDuration,
    defaultMessageTimeToLive: props.defaultMessageTimeToLive,
    requiresSession: props.requiresSession,
    deadLetteringOnMessageExpiration: props.deadLetteringOnMessageExpiration,
    maxDeliveryCount: props.maxDeliveryCount,
    status: props.status
  }
}

function toRuleDescription(
  topicName: string,
  subscriptionName: string,
  props: RuleProperties
): RuleDescription {
  // SqlRuleFilter and CorrelationRuleFilter are structurally distinguished by
  // sqlExpression, which only SqlRuleFilter has.
  const filter: RuleFilterInput =
    'sqlExpression' in props.filter
      ? { type: 'Sql', sqlExpression: props.filter.sqlExpression }
      : {
          type: 'Correlation',
          correlationId: props.filter.correlationId,
          messageId: props.filter.messageId,
          subject: props.filter.subject,
          sessionId: props.filter.sessionId,
          contentType: props.filter.contentType
        }
  return { topicName, subscriptionName, name: props.name, filter }
}

function fromRuleFilterInput(filter: RuleFilterInput): SqlRuleFilter | CorrelationRuleFilter {
  if (filter.type === 'Sql') {
    return { sqlExpression: filter.sqlExpression }
  }
  return {
    correlationId: filter.correlationId,
    messageId: filter.messageId,
    subject: filter.subject,
    sessionId: filter.sessionId,
    contentType: filter.contentType
  }
}

/**
 * The emulator's PUT (update) responses for queues/topics are consistently missing
 * several fields the SDK's Atom/XML deserializer requires (confirmed via direct
 * inspection: e.g. no <SizeInBytes>/<CreatedAt>/<AuthorizationRules> etc., present on
 * GET but absent on PUT responses), so ServiceBusAdministrationClient.updateQueue/
 * updateTopic throw a client-side `PARSE_ERROR` even when the update genuinely
 * succeeded server-side (confirmed by re-fetching afterward and seeing the new value).
 * Real validation failures (e.g. an out-of-range TTL) come back as a distinct RestError
 * with a different code, so this narrowly retries only the confirmed-benign case.
 */
async function runUpdateWithEmulatorParseWorkaround<T>(
  update: () => Promise<T>,
  refetch: () => Promise<T>
): Promise<T> {
  try {
    return await update()
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === 'PARSE_ERROR') {
      return refetch()
    }
    throw err
  }
}

/**
 * No `getActiveMessageCount`/runtime-properties method here on purpose. The emulator's
 * GET-queue response has no `CountDetails`/`SizeInBytes`/`AccessedAt` at all (confirmed
 * directly, even with real messages sitting in the queue) — unlike the update-response
 * gap above, there's no data to work around to; `getQueueRuntimeProperties()` throws
 * PARSE_ERROR because the count fields it needs simply aren't in the response. The purge
 * confirmation UI gets its message count from `MessagingService.peekMessages()` instead,
 * which is real, working data.
 */

/**
 * Wraps ServiceBusAdministrationClient for entity CRUD, mapping SDK types to
 * shared/domain.ts DTOs so no @azure/service-bus type ever crosses the IPC boundary.
 * Takes an already-connected client — connection lifecycle belongs to connectionManager.
 */
export class AdminService {
  constructor(private client: ServiceBusAdministrationClient) {}

  async listQueues(): Promise<QueueDescription[]> {
    const queues: QueueDescription[] = []
    for await (const queue of this.client.listQueues()) {
      queues.push(toQueueDescription(queue))
    }
    return queues
  }

  async getQueue(name: string): Promise<QueueDescription> {
    return toQueueDescription(await this.client.getQueue(name))
  }

  async createQueue(input: CreateQueueInput): Promise<QueueDescription> {
    const { name, ...options } = input
    return toQueueDescription(await this.client.createQueue(name, options))
  }

  async updateQueue(name: string, input: UpdateQueueInput): Promise<QueueDescription> {
    // The SDK requires the full properties object (fetch, mutate, put back) rather
    // than a partial patch — see ServiceBusAdministrationClient.updateQueue's docs.
    const existing = await this.client.getQueue(name)
    const merged = { ...existing, ...input }
    const updated = await runUpdateWithEmulatorParseWorkaround(
      () => this.client.updateQueue(merged),
      () => this.client.getQueue(name)
    )
    return toQueueDescription(updated)
  }

  async deleteQueue(name: string): Promise<void> {
    await this.client.deleteQueue(name)
  }

  async listTopics(): Promise<TopicDescription[]> {
    const topics: TopicDescription[] = []
    for await (const topic of this.client.listTopics()) {
      topics.push(toTopicDescription(topic))
    }
    return topics
  }

  async getTopic(name: string): Promise<TopicDescription> {
    return toTopicDescription(await this.client.getTopic(name))
  }

  async createTopic(input: CreateTopicInput): Promise<TopicDescription> {
    const { name, ...options } = input
    return toTopicDescription(await this.client.createTopic(name, options))
  }

  async updateTopic(name: string, input: UpdateTopicInput): Promise<TopicDescription> {
    const existing = await this.client.getTopic(name)
    const merged = { ...existing, ...input }
    const updated = await runUpdateWithEmulatorParseWorkaround(
      () => this.client.updateTopic(merged),
      () => this.client.getTopic(name)
    )
    return toTopicDescription(updated)
  }

  async deleteTopic(name: string): Promise<void> {
    await this.client.deleteTopic(name)
  }

  async listSubscriptions(topicName: string): Promise<SubscriptionDescription[]> {
    const subscriptions: SubscriptionDescription[] = []
    for await (const subscription of this.client.listSubscriptions(topicName)) {
      subscriptions.push(toSubscriptionDescription(subscription))
    }
    return subscriptions
  }

  async getSubscription(topicName: string, subscriptionName: string): Promise<SubscriptionDescription> {
    return toSubscriptionDescription(await this.client.getSubscription(topicName, subscriptionName))
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionDescription> {
    const { topicName, subscriptionName, ...options } = input
    return toSubscriptionDescription(
      await this.client.createSubscription(topicName, subscriptionName, options)
    )
  }

  async updateSubscription(
    topicName: string,
    subscriptionName: string,
    input: UpdateSubscriptionInput
  ): Promise<SubscriptionDescription> {
    const existing = await this.client.getSubscription(topicName, subscriptionName)
    const merged = { ...existing, ...input }
    const updated = await runUpdateWithEmulatorParseWorkaround(
      () => this.client.updateSubscription(merged),
      () => this.client.getSubscription(topicName, subscriptionName)
    )
    return toSubscriptionDescription(updated)
  }

  async deleteSubscription(topicName: string, subscriptionName: string): Promise<void> {
    await this.client.deleteSubscription(topicName, subscriptionName)
  }

  async listRules(topicName: string, subscriptionName: string): Promise<RuleDescription[]> {
    const rules: RuleDescription[] = []
    for await (const rule of this.client.listRules(topicName, subscriptionName)) {
      rules.push(toRuleDescription(topicName, subscriptionName, rule))
    }
    return rules
  }

  async createRule(input: CreateRuleInput): Promise<RuleDescription> {
    const { topicName, subscriptionName, name, filter } = input
    const created = await this.client.createRule(
      topicName,
      subscriptionName,
      name,
      fromRuleFilterInput(filter)
    )
    return toRuleDescription(topicName, subscriptionName, created)
  }

  async deleteRule(topicName: string, subscriptionName: string, name: string): Promise<void> {
    await this.client.deleteRule(topicName, subscriptionName, name)
  }
}
