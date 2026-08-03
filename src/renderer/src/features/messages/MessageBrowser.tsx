import { useState } from 'react'
import type { ReceivedMessageDescription, ReceiveMode } from '@shared/domain'
import type { Result } from '@shared/errors'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
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

/**
 * Where a browser reads messages from. A queue (or a queue DLQ, addressed by its path
 * suffix) is an `entity`; a topic subscription — and its DLQ, which is *not* a path suffix
 * but a `subQueueType` on the two-arg receiver — is a `subscription`.
 */
export type MessageSource =
  | { kind: 'entity'; entityPath: string }
  | { kind: 'subscription'; topicName: string; subscriptionName: string; deadLetter?: boolean }

interface MessageBrowserProps {
  profileId: string
  source: MessageSource
  /** When set, shows a "Resubmit" action per message that sends a clone of it to this
   * entity path and, only once that send succeeds, completes the original here — used to
   * browse a DLQ and resubmit its messages back to their origin queue. Resubmit needs a
   * handleId (a PeekLock receive result), so it's hidden for peeked-only rows. */
  resubmitDestination?: string
}

const DEFAULT_BATCH_SIZE = 20
const MIN_BATCH_SIZE = 1
const MAX_BATCH_SIZE = 2048
const RECEIVE_WAIT_MS = 5000

/** A stable identity string for a source, used to reset the browser when it changes. */
function sourceKey(source: MessageSource): string {
  return source.kind === 'entity'
    ? `entity:${source.entityPath}`
    : `sub:${source.topicName}/${source.subscriptionName}${source.deadLetter ? ':dlq' : ''}`
}

export function MessageBrowser({
  profileId,
  source,
  resubmitDestination
}: MessageBrowserProps): React.JSX.Element {
  const [messages, setMessages] = useState<ReceivedMessageDescription[]>([])
  const [mode, setMode] = useState<ReceiveMode>('peekLock')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<ReceivedMessageDescription | null>(null)
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE)
  // Whether the last load was a non-destructive peek that filled the whole batch — the only
  // case where paging forward with "Load more" is meaningful.
  const [canLoadMore, setCanLoadMore] = useState(false)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ column: 'seq' | 'enqueued'; dir: 'asc' | 'desc' }>({
    column: 'seq',
    dir: 'asc'
  })
  // Defaulted on, per the plan's "regenerate MessageId checkbox defaulted on" — reusing
  // the original id would look like a dupe of whatever's already at the destination if
  // duplicate detection is enabled there.
  const [regenerateMessageId, setRegenerateMessageId] = useState(true)

  const key = sourceKey(source)

  function peekFrom(
    fromSequenceNumber?: number
  ): Promise<Result<ReceivedMessageDescription[]>> {
    return source.kind === 'entity'
      ? window.sbAdmin.messages.peek(profileId, source.entityPath, batchSize, fromSequenceNumber)
      : window.sbAdmin.messages.peekSubscription(
          profileId,
          source.topicName,
          source.subscriptionName,
          batchSize,
          fromSequenceNumber,
          source.deadLetter
        )
  }

  function receiveBatch(): Promise<Result<ReceivedMessageDescription[]>> {
    return source.kind === 'entity'
      ? window.sbAdmin.messages.receive(profileId, source.entityPath, batchSize, mode, RECEIVE_WAIT_MS)
      : window.sbAdmin.messages.receiveSubscription(
          profileId,
          source.topicName,
          source.subscriptionName,
          batchSize,
          mode,
          RECEIVE_WAIT_MS,
          source.deadLetter
        )
  }

  async function handlePeek(): Promise<void> {
    setLoading(true)
    setError(null)
    const response = await peekFrom()
    setLoading(false)
    if (response.ok) {
      setMessages(response.data)
      setCanLoadMore(response.data.length === batchSize)
    } else {
      setError(response.error.message)
    }
  }

  async function handleLoadMore(): Promise<void> {
    // Continue paging from just past the highest sequence number already loaded, so peek
    // resumes where this page left off rather than restarting from the entity's cursor.
    const lastSeq = messages.reduce((max, m) => Math.max(max, m.sequenceNumber), -1)
    setLoading(true)
    setError(null)
    const response = await peekFrom(lastSeq + 1)
    setLoading(false)
    if (!response.ok) {
      setError(response.error.message)
      return
    }
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.sequenceNumber))
      return [...prev, ...response.data.filter((m) => !seen.has(m.sequenceNumber))]
    })
    setCanLoadMore(response.data.length === batchSize)
  }

  async function handleReceive(): Promise<void> {
    setLoading(true)
    setError(null)
    const response = await receiveBatch()
    setLoading(false)
    if (response.ok) {
      setMessages(response.data)
      setCanLoadMore(false)
    } else {
      setError(response.error.message)
    }
  }

  function removeMessage(handleId: string): void {
    setMessages((prev) => prev.filter((message) => message.handleId !== handleId))
    setSelected((prev) => (prev?.handleId === handleId ? null : prev))
  }

  async function handleComplete(handleId: string): Promise<void> {
    const response = await window.sbAdmin.messages.complete(profileId, handleId)
    if (response.ok) {
      removeMessage(handleId)
    } else {
      setError(response.error.message)
    }
  }

  async function handleAbandon(handleId: string): Promise<void> {
    const response = await window.sbAdmin.messages.abandon(profileId, handleId)
    if (response.ok) {
      removeMessage(handleId)
    } else {
      setError(response.error.message)
    }
  }

  async function handleDeadLetter(handleId: string): Promise<void> {
    const response = await window.sbAdmin.messages.deadLetter(
      profileId,
      handleId,
      'manual',
      'dead-lettered from the UI'
    )
    if (response.ok) {
      removeMessage(handleId)
    } else {
      setError(response.error.message)
    }
  }

  async function handleResubmit(message: ReceivedMessageDescription): Promise<void> {
    if (!resubmitDestination || !message.handleId) return
    const response = await window.sbAdmin.messages.resubmit(
      profileId,
      message.handleId,
      message,
      resubmitDestination,
      regenerateMessageId
    )
    if (response.ok) {
      removeMessage(message.handleId)
    } else {
      setError(response.error.message)
    }
  }

  const normalizedFilter = filter.trim().toLowerCase()
  const filteredMessages = normalizedFilter
    ? messages.filter((message) =>
        [message.messageId, message.subject, message.correlationId, message.body]
          .filter((value): value is string => typeof value === 'string')
          .some((value) => value.toLowerCase().includes(normalizedFilter))
      )
    : messages

  function sortValue(message: ReceivedMessageDescription): number {
    return sort.column === 'seq'
      ? message.sequenceNumber
      : message.enqueuedTimeUtc
        ? Date.parse(message.enqueuedTimeUtc)
        : 0
  }
  const visibleMessages = [...filteredMessages].sort((a, b) => {
    const diff = sortValue(a) - sortValue(b)
    return sort.dir === 'asc' ? diff : -diff
  })

  function toggleSort(column: 'seq' | 'enqueued'): void {
    setSort((prev) =>
      prev.column === column
        ? { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { column, dir: 'asc' }
    )
  }
  const sortIndicator = (column: 'seq' | 'enqueued'): string =>
    sort.column === column ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
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
            <RadioGroupItem value="peekLock" id={`mode-peek-lock-${key}`} />
            <Label htmlFor={`mode-peek-lock-${key}`}>PeekLock</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="receiveAndDelete" id={`mode-receive-delete-${key}`} />
            <Label htmlFor={`mode-receive-delete-${key}`}>ReceiveAndDelete (destructive!)</Label>
          </div>
        </RadioGroup>

        <Button
          variant={mode === 'receiveAndDelete' ? 'destructive' : 'default'}
          onClick={handleReceive}
          disabled={loading}
        >
          Receive
        </Button>

        <div className="flex items-center gap-2">
          <Label htmlFor={`batch-size-${key}`}>Batch size</Label>
          <Input
            id={`batch-size-${key}`}
            type="number"
            min={MIN_BATCH_SIZE}
            max={MAX_BATCH_SIZE}
            value={batchSize}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) {
                setBatchSize(Math.min(Math.max(Math.round(next), MIN_BATCH_SIZE), MAX_BATCH_SIZE))
              }
            }}
            className="w-20"
          />
        </div>
      </div>

      {resubmitDestination && (
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            id={`regenerate-message-id-${key}`}
            checked={regenerateMessageId}
            onCheckedChange={(checked) => setRegenerateMessageId(checked === true)}
          />
          <Label htmlFor={`regenerate-message-id-${key}`}>Regenerate MessageId on resubmit</Label>
          <small className="text-muted-foreground">
            (at-least-once: if the send succeeds but removing the original fails, don&apos;t
            retry — you&apos;d duplicate the message)
          </small>
        </div>
      )}

      {messages.length > 0 && (
        <Input
          placeholder="Filter loaded messages (id, label, correlation, body)…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="max-w-md"
        />
      )}

      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <button type="button" className="font-medium" onClick={() => toggleSort('seq')}>
                Seq{sortIndicator('seq')}
              </button>
            </TableHead>
            <TableHead>Label</TableHead>
            <TableHead>Correlation ID</TableHead>
            <TableHead>
              <button type="button" className="font-medium" onClick={() => toggleSort('enqueued')}>
                Enqueued{sortIndicator('enqueued')}
              </button>
            </TableHead>
            <TableHead>Body preview</TableHead>
            {resubmitDestination && <TableHead>Dead-letter reason</TableHead>}
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleMessages.map((message) => (
            <TableRow key={message.handleId ?? message.sequenceNumber}>
              <TableCell>{message.sequenceNumber}</TableCell>
              <TableCell>{message.subject}</TableCell>
              <TableCell>{message.correlationId}</TableCell>
              <TableCell className="whitespace-nowrap">{message.enqueuedTimeUtc}</TableCell>
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
      {messages.length > 0 && visibleMessages.length === 0 && (
        <p className="text-muted-foreground text-sm">No loaded messages match the filter.</p>
      )}
      {canLoadMore && (
        <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={loading}>
          Load more
        </Button>
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
                <dd className="break-all">{selected.messageId}</dd>
                <dt className="text-muted-foreground">Correlation ID</dt>
                <dd className="break-all">{selected.correlationId}</dd>
                <dt className="text-muted-foreground">Label</dt>
                <dd className="break-all">{selected.subject}</dd>
                <dt className="text-muted-foreground">Reply to</dt>
                <dd className="break-all">{selected.replyTo}</dd>
                <dt className="text-muted-foreground">Enqueued</dt>
                <dd>{selected.enqueuedTimeUtc}</dd>
                <dt className="text-muted-foreground">Delivery count</dt>
                <dd>{selected.deliveryCount}</dd>
                {selected.deadLetterReason && (
                  <>
                    <dt className="text-muted-foreground">Dead-letter reason</dt>
                    <dd className="break-all">{selected.deadLetterReason}</dd>
                  </>
                )}
                {selected.deadLetterErrorDescription && (
                  <>
                    <dt className="text-muted-foreground">Dead-letter description</dt>
                    <dd className="break-all">{selected.deadLetterErrorDescription}</dd>
                  </>
                )}
              </dl>
              <div className="space-y-1">
                <p className="text-muted-foreground text-sm">Application properties</p>
                {selected.applicationProperties &&
                Object.keys(selected.applicationProperties).length > 0 ? (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
                    {Object.entries(selected.applicationProperties).map(([propKey, value]) => (
                      <div key={propKey} className="contents">
                        <dt className="text-muted-foreground break-all">{propKey}</dt>
                        <dd className="break-all">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-muted-foreground text-sm">(none)</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigator.clipboard.writeText(selected.body)}
                >
                  Copy body
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigator.clipboard.writeText(JSON.stringify(selected, null, 2))}
                >
                  Copy as JSON
                </Button>
              </div>
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
