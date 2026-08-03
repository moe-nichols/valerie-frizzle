// The emulator's admin API returns no message-count data at all for queues or
// subscriptions (confirmed: GET-queue response has no CountDetails/SizeInBytes, even with
// real messages present — see the comment in adminService.ts), so every count in this app
// comes from peeking instead. Peek is capped here rather than uncapped, so callers show
// "N+" once the cap is hit instead of an exact count.
export const PEEK_COUNT_CAP = 250

// Without an explicit fromSequenceNumber, Service Bus peek continues from wherever the
// entity's peek cursor last was — a server-side, per-entity cursor shared across every
// caller, not scoped to this component, connection, or even purpose (browsing vs.
// counting). Passing 0 always re-peeks from the very first message regardless of any
// prior peek activity elsewhere in the app — the only way to get a trustworthy count.
export const PEEK_FROM_START = 0

export interface MessageCountResult {
  count: number
  approximate: boolean
}

function toResult(count: number): MessageCountResult {
  return { count, approximate: count === PEEK_COUNT_CAP }
}

/** Returns `null` on failure — callers should show nothing rather than a misleading zero. */
export async function fetchQueueMessageCount(
  profileId: string,
  entityPath: string
): Promise<MessageCountResult | null> {
  const response = await window.sbAdmin.messages.count(
    profileId,
    entityPath,
    PEEK_COUNT_CAP,
    PEEK_FROM_START
  )
  return response.ok ? toResult(response.data) : null
}

/** Returns `null` on failure — callers should show nothing rather than a misleading zero. */
export async function fetchSubscriptionMessageCount(
  profileId: string,
  topicName: string,
  subscriptionName: string
): Promise<MessageCountResult | null> {
  const response = await window.sbAdmin.messages.countSubscription(
    profileId,
    topicName,
    subscriptionName,
    PEEK_COUNT_CAP,
    PEEK_FROM_START
  )
  return response.ok ? toResult(response.data) : null
}

export function formatMessageCount(result: MessageCountResult): string {
  return result.approximate ? `${result.count}+` : `${result.count}`
}
