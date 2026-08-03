import { Button } from '@renderer/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'
import type { ReceivedMessageDescription } from '@shared/domain'

/** A message that arrived via PeekLock and can therefore be settled (completed,
 * abandoned, dead-lettered, resubmitted). Peeked rows have no handle. */
export type SettleableMessage = ReceivedMessageDescription & { handleId: string }

export function isSettleable(message: ReceivedMessageDescription): message is SettleableMessage {
  return typeof message.handleId === 'string'
}

export type SortColumn = 'seq' | 'enqueued'
export interface SortState {
  column: SortColumn
  dir: 'asc' | 'desc'
}

/** The loaded-messages table: sortable headers, per-row view/settle actions, and the
 * resubmit action when a destination is configured. Purely presentational — filtering,
 * sorting, and the IPC calls live with the caller. */
export function MessageTable({
  messages,
  resubmitDestination,
  sort,
  onToggleSort,
  onView,
  onComplete,
  onAbandon,
  onDeadLetter,
  onResubmit
}: {
  messages: ReceivedMessageDescription[]
  resubmitDestination?: string
  sort: SortState
  onToggleSort: (column: SortColumn) => void
  onView: (message: ReceivedMessageDescription) => void
  onComplete: (handleId: string) => void
  onAbandon: (handleId: string) => void
  onDeadLetter: (handleId: string) => void
  onResubmit: (message: SettleableMessage) => void
}): React.JSX.Element {
  const sortIndicator = (column: SortColumn): string =>
    sort.column === column ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <button type="button" className="font-medium" onClick={() => onToggleSort('seq')}>
              Seq{sortIndicator('seq')}
            </button>
          </TableHead>
          <TableHead>Label</TableHead>
          <TableHead>Correlation ID</TableHead>
          <TableHead>
            <button type="button" className="font-medium" onClick={() => onToggleSort('enqueued')}>
              Enqueued{sortIndicator('enqueued')}
            </button>
          </TableHead>
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
            <TableCell className="whitespace-nowrap">{message.enqueuedTimeUtc}</TableCell>
            <TableCell>{message.body.slice(0, 40)}</TableCell>
            {resubmitDestination && <TableCell>{message.deadLetterReason}</TableCell>}
            <TableCell>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => onView(message)}>
                  View
                </Button>
                {isSettleable(message) && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onComplete(message.handleId)}
                    >
                      Complete
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onAbandon(message.handleId)}>
                      Abandon
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onDeadLetter(message.handleId)}
                    >
                      Dead-letter
                    </Button>
                    {resubmitDestination && (
                      <Button variant="outline" size="sm" onClick={() => onResubmit(message)}>
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
  )
}
