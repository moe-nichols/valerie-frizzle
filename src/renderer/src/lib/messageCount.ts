import {
  buildDeadLetterQueuePath,
  type QueueDescription,
  type SubscriptionDescription
} from '@shared/domain'
import type { IpcError, Result } from '@shared/errors'

// Explicitly restart the emulator's shared peek cursor; reaching the cap is a lower bound.
const OBSERVATION_CAP = 250
const FROM_START = 0

export interface MessageCountResult {
  count: number
  approximate: boolean
}

export type CountObservation =
  | ({ status: 'observed' } & MessageCountResult)
  | { status: 'unavailable'; reason: 'forwarding' }
  | { status: 'failed'; error: IpcError }

export type AvailableObservation = Exclude<CountObservation, { status: 'failed' }>
export type CountTarget = 'active' | 'deadLetter'

export function countEligibility(
  description: QueueDescription | SubscriptionDescription,
  target: CountTarget
): Extract<CountObservation, { status: 'unavailable' }> | undefined {
  const forwarding =
    target === 'active' ? description.forwardTo : description.forwardDeadLetteredMessagesTo
  return forwarding ? { status: 'unavailable', reason: 'forwarding' } : undefined
}

function interpret(response: Result<number>): CountObservation {
  return response.ok
    ? { status: 'observed', count: response.data, approximate: response.data === OBSERVATION_CAP }
    : { status: 'failed', error: response.error }
}

export async function observeQueueCount(
  profileId: string,
  queue: QueueDescription,
  target: CountTarget
): Promise<CountObservation> {
  const unavailable = countEligibility(queue, target)
  if (unavailable) return unavailable
  return interpret(
    await window.sbAdmin.messages.count(
      profileId,
      target === 'deadLetter' ? buildDeadLetterQueuePath(queue.name) : queue.name,
      OBSERVATION_CAP,
      FROM_START
    )
  )
}

export async function observeSubscriptionCount(
  profileId: string,
  subscription: SubscriptionDescription,
  target: CountTarget
): Promise<CountObservation> {
  const unavailable = countEligibility(subscription, target)
  if (unavailable) return unavailable
  return interpret(
    await window.sbAdmin.messages.countSubscription(
      profileId,
      subscription.topicName,
      subscription.subscriptionName,
      OBSERVATION_CAP,
      FROM_START,
      target === 'deadLetter'
    )
  )
}

export function formatMessageCount(result: MessageCountResult): string {
  return result.approximate ? `${result.count}+` : `${result.count}`
}
