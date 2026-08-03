import type { PurgeProgressEvent } from '@shared/ipc-contract'

/** How long a finished job's buffered events are kept waiting for a subscriber. The
 * renderer subscribes milliseconds after `purge:start` resolves; anything longer means the
 * window went away mid-purge and nobody is coming. */
export const DONE_BUFFER_TTL_MS = 30_000

export interface PurgeProgressHub {
  /** Feed an event in from the IPC channel. */
  deliver(event: PurgeProgressEvent): void
  /** Subscribe to one job's events; buffered events are replayed asynchronously first.
   * Returns an unsubscribe function. */
  subscribe(jobId: string, callback: (event: PurgeProgressEvent) => void): () => void
}

/**
 * Routes purge progress events to per-job subscribers, buffering events that arrive
 * before the subscriber does. `purge:start` returns the jobId only after the drain has
 * already begun, so a fast purge's first events — even its terminal `done` — can reach the
 * renderer before `onPurgeProgress` is called; without buffering they'd be dropped and the
 * progress UI would hang on "purging…" forever.
 */
export function createPurgeProgressHub(
  scheduleExpiry: (expire: () => void) => void = (expire) => setTimeout(expire, DONE_BUFFER_TTL_MS)
): PurgeProgressHub {
  const subscribers = new Map<string, (event: PurgeProgressEvent) => void>()
  const buffers = new Map<string, PurgeProgressEvent[]>()

  return {
    deliver(event) {
      const subscriber = subscribers.get(event.jobId)
      if (subscriber) {
        subscriber(event)
        return
      }
      const buffer = buffers.get(event.jobId) ?? []
      buffer.push(event)
      buffers.set(event.jobId, buffer)
      // A job nobody ever subscribes to (window reloaded mid-purge) must not buffer forever.
      if (event.done) {
        scheduleExpiry(() => buffers.delete(event.jobId))
      }
    },
    subscribe(jobId, callback) {
      subscribers.set(jobId, callback)
      const buffered = buffers.get(jobId)
      buffers.delete(jobId)
      if (buffered) {
        // Replayed asynchronously so the subscriber never fires before subscribe() has
        // returned its unsubscribe function — same contract as a live ipcRenderer event.
        queueMicrotask(() => {
          for (const event of buffered) {
            if (subscribers.get(jobId) === callback) callback(event)
          }
        })
      }
      return () => {
        if (subscribers.get(jobId) === callback) subscribers.delete(jobId)
      }
    }
  }
}
