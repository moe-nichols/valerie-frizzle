import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { Button, buttonVariants } from '@renderer/components/ui/button'

interface QueuePurgeControlProps {
  profileId: string
  entityPath: string
  /** Defaults to `entityPath` — pass a friendlier label when purging a DLQ
   * (`entityPath` there is the raw `queueName/$DeadLetterQueue` path). */
  displayName?: string
}

interface PurgeProgressState {
  deletedCount: number
  done: boolean
  stoppedAtCap: boolean
}

// The emulator's admin API returns no message-count data at all for queues (confirmed:
// GET-queue response has no CountDetails/SizeInBytes, even with real messages present —
// see the comment in adminService.ts), so the purge confirmation count comes from
// peeking instead. Peek is capped here rather than uncapped, so this shows "N+" once the
// cap is hit instead of an exact count.
const PEEK_COUNT_CAP = 250

// Without an explicit fromSequenceNumber, Service Bus peek continues from wherever the
// entity's peek cursor last was — a server-side, per-entity cursor shared across every
// caller, not scoped to this component or even this connection. If the message browser
// (or anything else) already peeked this queue, an unscoped peek here would silently
// undercount (confirmed via a driven-UI run: browsing first, then purging, showed "0
// active messages" for a queue that still had 3). Passing 0 always re-peeks from the
// very first message regardless of any prior peek activity elsewhere in the app.
const PEEK_FROM_START = 0

export function QueuePurgeControl({
  profileId,
  entityPath,
  displayName
}: QueuePurgeControlProps): React.JSX.Element {
  const label = displayName ?? entityPath
  const [confirming, setConfirming] = useState(false)
  const [messageCount, setMessageCount] = useState<number | null>(null)
  const [messageCountIsApproximate, setMessageCountIsApproximate] = useState(false)
  // Drives the whole "in progress or just finished" UI by itself — no separate
  // `purging` boolean. A prior version cleared `purging` in the same state update as the
  // final `done: true` progress event, so React batched both into one render where
  // `purging && progress` was already false — the "(done)" message never actually
  // appeared on screen (caught via a driven-UI run, not by unit/integration tests, which
  // don't exercise React's render timing). `progress` alone, cleared explicitly by
  // "Dismiss" rather than automatically, avoids that class of bug.
  const [progress, setProgress] = useState<PurgeProgressState | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handlePurgeClick(): Promise<void> {
    setError(null)
    const response = await window.sbAdmin.messages.peek(profileId, entityPath, PEEK_COUNT_CAP, PEEK_FROM_START)
    if (response.ok) {
      setMessageCount(response.data.length)
      setMessageCountIsApproximate(response.data.length === PEEK_COUNT_CAP)
      setConfirming(true)
    } else {
      setError(response.error.message)
    }
  }

  async function handleConfirmPurge(): Promise<void> {
    setConfirming(false)
    setProgress({ deletedCount: 0, done: false, stoppedAtCap: false })

    const startResponse = await window.sbAdmin.messages.purgeStart(profileId, entityPath)
    if (!startResponse.ok) {
      setError(startResponse.error.message)
      setProgress(null)
      return
    }

    const unsubscribe = window.sbAdmin.messages.onPurgeProgress(startResponse.data.jobId, (event) => {
      setProgress({
        deletedCount: event.deletedCount,
        done: event.done,
        stoppedAtCap: event.stoppedAtCap ?? false
      })
      if (event.error) {
        setError(event.error)
      }
      if (event.done) {
        unsubscribe()
      }
    })
  }

  function handleCancel(): void {
    setConfirming(false)
    setMessageCount(null)
    setMessageCountIsApproximate(false)
  }

  function handleDismissProgress(): void {
    setProgress(null)
  }

  const countLabel = messageCountIsApproximate ? `${messageCount}+` : `${messageCount}`

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-destructive text-sm">{error}</span>}
      {!confirming && !progress && (
        <Button variant="outline" size="sm" onClick={handlePurgeClick}>
          Purge
        </Button>
      )}

      <AlertDialog open={confirming} onOpenChange={(open) => !open && handleCancel()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Purge messages?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete all {countLabel} active message{messageCount === 1 ? '' : 's'} in &quot;{label}
              &quot;?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmPurge}
              className={buttonVariants({ variant: 'destructive' })}
            >
              Yes, purge {countLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {progress && (
        <span className="text-sm">
          Purging… {progress.deletedCount} deleted
          {progress.done ? (
            <>
              {' '}
              {progress.stoppedAtCap ? (
                <span className="text-destructive">
                  (stopped at safety cap — more messages may remain; purge again to continue)
                </span>
              ) : (
                '(done)'
              )}{' '}
              <Button variant="ghost" size="sm" onClick={handleDismissProgress}>
                Dismiss
              </Button>
            </>
          ) : null}
        </span>
      )}
    </span>
  )
}
