import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { Button } from '@renderer/components/ui/button'
import {
  type CountTarget,
  formatMessageCount,
  type MessageCountResult,
  observeQueueCount
} from '@renderer/lib/messageCount'
import { buildDeadLetterQueuePath, type QueueDescription } from '@shared/domain'
import { useEffect, useRef, useState } from 'react'

interface QueuePurgeControlProps {
  profileId: string
  queue: QueueDescription | null
  queueName: string
  target: CountTarget
}

interface PurgeProgressState {
  deletedCount: number
  done: boolean
  stoppedAtCap: boolean
}

export function QueuePurgeControl(props: QueuePurgeControlProps): React.JSX.Element {
  return (
    <QueuePurgeSession
      key={JSON.stringify([props.profileId, props.queueName, props.target])}
      {...props}
    />
  )
}

function QueuePurgeSession({
  profileId,
  queue,
  queueName,
  target
}: QueuePurgeControlProps): React.JSX.Element {
  const entityPath = target === 'deadLetter' ? buildDeadLetterQueuePath(queueName) : queueName
  const label = target === 'deadLetter' ? `${queueName} DLQ` : queueName
  const [confirming, setConfirming] = useState(false)
  const [messageCount, setMessageCount] = useState<MessageCountResult | null>(null)
  const [estimating, setEstimating] = useState(false)
  const lifetime = useRef<object>({})
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

  // The keyed session isolates visible state; pending estimates also lose permission on teardown.
  useEffect(() => {
    return () => {
      lifetime.current = {}
      stopListening()
    }
  }, [])

  async function handlePurgeClick(): Promise<void> {
    if (!queue || estimating) return
    const token = lifetime.current
    setEstimating(true)
    setError(null)
    try {
      const observation = await observeQueueCount(profileId, queue, target)
      if (lifetime.current !== token) return
      if (observation.status === 'observed') {
        setMessageCount(observation)
        setConfirming(true)
      } else {
        setError(
          observation.status === 'failed'
            ? `Unable to estimate messages: ${observation.error.message}. Retry Purge after resolving the error.`
            : 'Forwarding prevents estimating these messages. Disable forwarding and retry Purge.'
        )
      }
    } catch (error) {
      if (lifetime.current === token) {
        setError(
          `Unable to estimate messages: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    } finally {
      if (lifetime.current === token) setEstimating(false)
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
  }

  function handleDismissProgress(): void {
    setProgress(null)
  }

  const countLabel = messageCount ? formatMessageCount(messageCount) : ''

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-destructive text-sm">{error}</span>}
      {!confirming && !progress && (
        <Button
          variant="outline"
          size="sm"
          onClick={handlePurgeClick}
          disabled={!queue || estimating}
        >
          {estimating ? 'Estimating…' : 'Purge'}
        </Button>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !open && handleCancel()}
        title="Purge messages?"
        description={`Delete all ${countLabel} active message${messageCount?.count === 1 ? '' : 's'} in "${label}"?`}
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
