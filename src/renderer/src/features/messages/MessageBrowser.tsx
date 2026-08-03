import { useEffect, useState } from 'react'
import type { ReceivedMessageDescription, ReceiveMode } from '@shared/domain'
import type { IpcError, Result } from '@shared/errors'
import { useIsCurrent } from '@renderer/lib/useIsCurrent'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Label } from '@renderer/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'

const PAGE_SIZE = 20
const RECEIVE_WAIT_MS = 5000

interface MessageBrowserProps {
  profileId: string
  entityPath: string
  /** When set, shows a "Resubmit" action per message that sends a clone of it to this
   * entity path and, only once that send succeeds, completes the original here — used to
   * browse a DLQ and resubmit its messages back to their origin queue. Resubmit needs a
   * handleId (a PeekLock receive result), so it's hidden for peeked-only rows. */
  resubmitDestination?: string
}

export function MessageBrowser({
  profileId,
  entityPath,
  resubmitDestination
}: MessageBrowserProps): React.JSX.Element {
  const [messages, setMessages] = useState<ReceivedMessageDescription[]>([])
  const [mode, setMode] = useState<ReceiveMode>('peekLock')
  const [error, setError] = useState<IpcError | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<ReceivedMessageDescription | null>(null)
  // Defaulted on, per the plan's "regenerate MessageId checkbox defaulted on" — reusing
  // the original id would look like a dupe of whatever's already at the destination if
  // duplicate detection is enabled there.
  const [regenerateMessageId, setRegenerateMessageId] = useState(true)
  const isCurrent = useIsCurrent(`${profileId}::${entityPath}`)

  // Loaded messages (and their PeekLock handles) belong to one entity on one connection —
  // carrying them across a selection switch would let the settle buttons act on the wrong
  // queue's handles under the new queue's header.
  useEffect(() => {
    setMessages([])
    setSelected(null)
    setError(null)
    setLoading(false)
  }, [profileId, entityPath])

  async function loadMessages(
    fetch: () => Promise<Awaited<ReturnType<typeof window.sbAdmin.messages.peek>>>
  ): Promise<void> {
    setLoading(true)
    setError(null)
    const response = await fetch()
    // A slow load from a prior selection must not populate the entity now shown.
    if (!isCurrent()) return
    setLoading(false)
    if (response.ok) {
      setMessages(response.data)
    } else {
      setError(response.error)
    }
  }

  async function handlePeek(): Promise<void> {
    await loadMessages(() => window.sbAdmin.messages.peek(profileId, entityPath, PAGE_SIZE))
  }

  async function handleReceive(): Promise<void> {
    await loadMessages(() =>
      window.sbAdmin.messages.receive(profileId, entityPath, PAGE_SIZE, mode, RECEIVE_WAIT_MS)
    )
  }

  function removeMessage(handleId: string): void {
    setMessages((prev) => prev.filter((message) => message.handleId !== handleId))
    setSelected((prev) => (prev?.handleId === handleId ? null : prev))
  }

  /** Runs a settle operation and, on success, drops the row and clears any prior error. */
  async function settle(handleId: string, operation: () => Promise<Result<unknown>>): Promise<void> {
    const response = await operation()
    if (response.ok) {
      setError(null)
      removeMessage(handleId)
    } else {
      setError(response.error)
      // A partial success means the copy already landed at the destination — drop the row
      // so the tempting "Resubmit" button can't be clicked again and double-deliver it.
      if (response.error.code === 'PARTIAL_SUCCESS') {
        removeMessage(handleId)
      }
    }
  }

  async function handleComplete(handleId: string): Promise<void> {
    await settle(handleId, () => window.sbAdmin.messages.complete(profileId, handleId))
  }

  async function handleAbandon(handleId: string): Promise<void> {
    await settle(handleId, () => window.sbAdmin.messages.abandon(profileId, handleId))
  }

  async function handleDeadLetter(handleId: string): Promise<void> {
    await settle(handleId, () =>
      window.sbAdmin.messages.deadLetter(profileId, handleId, 'manual', 'dead-lettered from the UI')
    )
  }

  async function handleResubmit(message: ReceivedMessageDescription): Promise<void> {
    if (!resubmitDestination || !message.handleId) return
    await settle(message.handleId, () =>
      window.sbAdmin.messages.resubmit(
        profileId,
        message.handleId as string,
        message,
        resubmitDestination,
        regenerateMessageId
      )
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant={error.code === 'PARTIAL_SUCCESS' ? 'default' : 'destructive'}>
          {error.code === 'PARTIAL_SUCCESS' && (
            <AlertTitle>Resubmitted, but the original could not be removed</AlertTitle>
          )}
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button variant="outline" onClick={handlePeek} disabled={loading}>
          Peek (non-destructive)
        </Button>

        <RadioGroup
          value={mode}
          onValueChange={(value) => setMode(value as ReceiveMode)}
          className="flex flex-row gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="peekLock" id={`mode-peek-lock-${entityPath}`} />
            <Label htmlFor={`mode-peek-lock-${entityPath}`}>PeekLock</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="receiveAndDelete" id={`mode-receive-delete-${entityPath}`} />
            <Label htmlFor={`mode-receive-delete-${entityPath}`}>ReceiveAndDelete (destructive!)</Label>
          </div>
        </RadioGroup>

        <Button
          variant={mode === 'receiveAndDelete' ? 'destructive' : 'default'}
          onClick={handleReceive}
          disabled={loading}
        >
          Receive
        </Button>
      </div>

      {resubmitDestination && (
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            id={`regenerate-message-id-${entityPath}`}
            checked={regenerateMessageId}
            onCheckedChange={(checked) => setRegenerateMessageId(checked === true)}
          />
          <Label htmlFor={`regenerate-message-id-${entityPath}`}>Regenerate MessageId on resubmit</Label>
          <small className="text-muted-foreground">
            (at-least-once: if the send succeeds but removing the original fails, don&apos;t
            retry — you&apos;d duplicate the message)
          </small>
        </div>
      )}

      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Seq</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>Correlation ID</TableHead>
            <TableHead>Body preview</TableHead>
            {resubmitDestination && <TableHead>Dead-letter reason</TableHead>}
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {messages.map((message) => (
            <TableRow key={message.handleId ?? message.sequenceNumber}>
              <TableCell>{message.sequenceNumber}</TableCell>
              <TableCell>{message.subject}</TableCell>
              <TableCell>{message.correlationId}</TableCell>
              <TableCell>{message.body.slice(0, 40)}</TableCell>
              {resubmitDestination && <TableCell>{message.deadLetterReason}</TableCell>}
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSelected(message)}>
                    View
                  </Button>
                  {message.handleId && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleComplete(message.handleId as string)}
                      >
                        Complete
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleAbandon(message.handleId as string)}
                      >
                        Abandon
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeadLetter(message.handleId as string)}
                      >
                        Dead-letter
                      </Button>
                      {resubmitDestination && (
                        <Button variant="outline" size="sm" onClick={() => handleResubmit(message)}>
                          Resubmit
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {messages.length === 0 && (
        <p className="text-muted-foreground text-sm">No messages loaded — peek or receive to load some.</p>
      )}

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Message detail</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Sequence</dt>
                <dd>{selected.sequenceNumber}</dd>
                <dt className="text-muted-foreground">Content type</dt>
                <dd>{selected.contentType}</dd>
                <dt className="text-muted-foreground">Message ID</dt>
                <dd>{selected.messageId}</dd>
                <dt className="text-muted-foreground">Correlation ID</dt>
                <dd>{selected.correlationId}</dd>
                <dt className="text-muted-foreground">Enqueued</dt>
                <dd>{selected.enqueuedTimeUtc}</dd>
                <dt className="text-muted-foreground">Delivery count</dt>
                <dd>{selected.deliveryCount}</dd>
              </dl>
              <pre className="max-h-96 overflow-auto rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                {selected.body}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
