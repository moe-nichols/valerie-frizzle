import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { Button } from '@renderer/components/ui/button'
import { PEEK_COUNT_CAP, PEEK_FROM_START } from '@renderer/lib/messageCount'
import { useEffect, useRef, useState } from 'react'

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
  // The active progress subscription, so it can be torn down on unmount or entity switch —
  // subscribing without this leaked the ipcRenderer listener whenever a purge outlived the
  // component (e.g. the profile was disconnected mid-purge).
  const unsubscribeRef = useRef<(() => void) | null>(null)

  function stopListening(): void {
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
  }

  // A purge and its progress belong to one entity: switching entities mid-purge (the
  // control is not keyed) must not show the old queue's progress against the new one.
  useEffect(() => {
    setConfirming(false)
    setMessageCount(null)
    setMessageCountIsApproximate(false)
    setProgress(null)
    setError(null)
    return stopListening
  }, [profileId, entityPath])

  async function handlePurgeClick(): Promise<void> {
    setError(null)
    const response = await window.sbAdmin.messages.peek(
      profileId,
      entityPath,
      PEEK_COUNT_CAP,
      PEEK_FROM_START
    )
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

    stopListening()
    unsubscribeRef.current = window.sbAdmin.messages.onPurgeProgress(
      startResponse.data.jobId,
      (event) => {
        setProgress({
          deletedCount: event.deletedCount,
          done: event.done,
          stoppedAtCap: event.stoppedAtCap ?? false
        })
        if (event.error) {
          setError(event.error)
        }
        if (event.done) {
          stopListening()
        }
      }
    )
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

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !open && handleCancel()}
        title="Purge messages?"
        description={`Delete all ${countLabel} active message${messageCount === 1 ? '' : 's'} in "${label}"?`}
        confirmLabel={`Yes, purge ${countLabel}`}
        onConfirm={handleConfirmPurge}
      />

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
