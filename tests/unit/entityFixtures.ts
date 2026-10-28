import type {
  QueueDescription,
  SubscriptionDescription,
  TopicDescription
} from '@shared/domain.ts'

export function queue(
  name = 'orders',
  overrides: Partial<QueueDescription> = {}
): QueueDescription {
  return {
    name,
    status: 'Active',
    maxSizeInMegabytes: 1024,
    defaultMessageTimeToLive: 'PT1H',
    lockDuration: 'PT1M',
    requiresDuplicateDetection: false,
    duplicateDetectionHistoryTimeWindow: 'PT10M',
    requiresSession: false,
    deadLetteringOnMessageExpiration: false,
    maxDeliveryCount: 10,
    ...overrides
  }
}

export function subscription(
  overrides: Partial<SubscriptionDescription> = {}
): SubscriptionDescription {
  return {
    topicName: 'events',
    subscriptionName: 'worker',
    status: 'Active',
    lockDuration: 'PT1M',
    defaultMessageTimeToLive: 'PT1H',
    requiresSession: false,
    deadLetteringOnMessageExpiration: false,
    maxDeliveryCount: 10,
    ...overrides
  }
}

export function topic(name = 'events'): TopicDescription {
  return {
    name,
    status: 'Active',
    maxSizeInMegabytes: 1024,
    defaultMessageTimeToLive: 'PT1H',
    requiresDuplicateDetection: false,
    duplicateDetectionHistoryTimeWindow: 'PT10M'
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export const ok = <T>(data: T) => ({ ok: true as const, data })
export const failure = (message = 'offline') => ({
  ok: false as const,
  error: { code: 'NOT_CONNECTED' as const, message }
})
