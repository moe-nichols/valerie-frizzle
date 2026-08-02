import type { MessagingService } from './messagingService'

export interface PurgeProgress {
  deletedCount: number
  done: boolean
  /** Set only on the terminal (`done: true`) event: `true` when the drain loop stopped
   * because it hit the safety iteration cap rather than because the entity was actually
   * emptied — so the reported count is a floor, not the whole queue. */
  stoppedAtCap?: boolean
}

const BATCH_SIZE = 100
const BATCH_WAIT_TIME_MS = 2000
const MAX_ITERATIONS = 1000
const REQUIRED_CONSECUTIVE_EMPTY_BATCHES = 2

/** Pure — the drain loop's termination condition, extracted so it can be unit tested
 * without a live emulator. */
export function isPurgeComplete(consecutiveEmptyBatches: number): boolean {
  return consecutiveEmptyBatches >= REQUIRED_CONSECUTIVE_EMPTY_BATCHES
}

/**
 * The Service Bus SDK has no native purge API, so this drains an entity via a
 * receive-and-delete loop, stopping once two consecutive batches come back empty (a
 * race guard against messages arriving mid-purge) or a safety iteration cap is hit.
 * `entityPath` is opaque here — this works identically for a regular queue or a DLQ
 * sub-queue path (`queueName/$DeadLetterQueue`), so DLQ purge (Milestone 8) reuses this
 * unchanged rather than needing its own implementation.
 */
export async function purgeEntity(
  messagingService: MessagingService,
  entityPath: string,
  onProgress: (progress: PurgeProgress) => void
): Promise<number> {
  let deletedCount = 0
  let consecutiveEmptyBatches = 0
  let drained = false

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const batch = await messagingService.receiveMessages(
      entityPath,
      BATCH_SIZE,
      'receiveAndDelete',
      BATCH_WAIT_TIME_MS
    )

    if (batch.length === 0) {
      consecutiveEmptyBatches++
      if (isPurgeComplete(consecutiveEmptyBatches)) {
        drained = true
        break
      }
      continue
    }

    consecutiveEmptyBatches = 0
    deletedCount += batch.length
    onProgress({ deletedCount, done: false })
  }

  // If the loop fell out without draining, it exhausted MAX_ITERATIONS — the entity may
  // still hold messages, so `deletedCount` is a floor, not a completed purge.
  onProgress({ deletedCount, done: true, stoppedAtCap: !drained })
  return deletedCount
}
