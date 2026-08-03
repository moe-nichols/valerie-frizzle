import { EmptyState } from '@renderer/components/EmptyState'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import { parseEnum } from '@renderer/lib/parseEnum'
import { useIsCurrent } from '@renderer/lib/useIsCurrent'
import type { ReceivedMessageDescription, ReceiveMode } from '@shared/domain'
import type { IpcError, Result } from '@shared/errors'
import { useEffect, useState } from 'react'
import { MessageDetailDialog } from './MessageDetailDialog'
import {
  MessageTable,
  type SettleableMessage,
  type SortColumn,
  type SortState
} from './MessageTable'

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
  const [error, setError] = useState<IpcError | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<ReceivedMessageDescription | null>(null)
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE)
  // Whether the last load was a non-destructive peek that filled the whole batch — the only
  // case where paging forward with "Load more" is meaningful.
  const [canLoadMore, setCanLoadMore] = useState(false)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<SortState>({ column: 'seq', dir: 'asc' })
  // Defaulted on, per the plan's "regenerate MessageId checkbox defaulted on" — reusing
  // the original id would look like a dupe of whatever's already at the destination if
  // duplicate detection is enabled there.
  const [regenerateMessageId, setRegenerateMessageId] = useState(true)
  const key = sourceKey(source)
  const isCurrent = useIsCurrent(key)

  // Loaded messages (and their PeekLock handles) belong to one source on one connection —
  // carrying them across a selection switch would let the settle buttons act on the wrong
  // entity's handles under the new entity's header.
  useEffect(() => {
    setMessages([])
    setSelected(null)
    setError(null)
    setLoading(false)
  }, [key])

  function peekFrom(fromSequenceNumber?: number): Promise<Result<ReceivedMessageDescription[]>> {
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
      ? window.sbAdmin.messages.receive(
          profileId,
          source.entityPath,
          batchSize,
          mode,
          RECEIVE_WAIT_MS
        )
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
    // A slow load from a prior selection must not populate the entity now shown.
    if (!isCurrent()) return
    setLoading(false)
    if (response.ok) {
      setMessages(response.data)
      setCanLoadMore(response.data.length === batchSize)
    } else {
      setError(response.error)
    }
  }

  async function handleLoadMore(): Promise<void> {
    // Continue paging from just past the highest sequence number already loaded, so peek
    // resumes where this page left off rather than restarting from the entity's cursor.
    const lastSeq = messages.reduce((max, m) => Math.max(max, m.sequenceNumber), -1)
    setLoading(true)
    setError(null)
    const response = await peekFrom(lastSeq + 1)
    if (!isCurrent()) return
    setLoading(false)
    if (!response.ok) {
      setError(response.error)
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
    if (!isCurrent()) return
    setLoading(false)
    if (response.ok) {
      setMessages(response.data)
      setCanLoadMore(false)
    } else {
      setError(response.error)
    }
  }

  function removeMessage(handleId: string): void {
    setMessages((prev) => prev.filter((message) => message.handleId !== handleId))
    setSelected((prev) => (prev?.handleId === handleId ? null : prev))
  }

  /** Runs a settle operation and, on success, drops the row and clears any prior error. */
  async function settle(
    handleId: string,
    operation: () => Promise<Result<unknown>>
  ): Promise<void> {
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

  async function handleResubmit(message: SettleableMessage): Promise<void> {
    if (!resubmitDestination) return
    await settle(message.handleId, () =>
      window.sbAdmin.messages.resubmit(
        profileId,
        message.handleId,
        message,
        resubmitDestination,
        regenerateMessageId
      )
    )
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

  function toggleSort(column: SortColumn): void {
    setSort((prev) =>
      prev.column === column
        ? { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { column, dir: 'asc' }
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
          onValueChange={(value) =>
            setMode(parseEnum(['peekLock', 'receiveAndDelete'], value, 'peekLock'))
          }
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
            (at-least-once: if the send succeeds but removing the original fails, don&apos;t retry —
            you&apos;d duplicate the message)
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

      <MessageTable
        messages={visibleMessages}
        resubmitDestination={resubmitDestination}
        sort={sort}
        onToggleSort={toggleSort}
        onView={setSelected}
        onComplete={handleComplete}
        onAbandon={handleAbandon}
        onDeadLetter={handleDeadLetter}
        onResubmit={handleResubmit}
      />
      {messages.length === 0 && (
        <EmptyState message="No messages loaded — peek or receive to load some." />
      )}
      {messages.length > 0 && visibleMessages.length === 0 && (
        <EmptyState message="No loaded messages match the filter." />
      )}
      {canLoadMore && (
        <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={loading}>
          Load more
        </Button>
      )}

      <MessageDetailDialog message={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  )
}
