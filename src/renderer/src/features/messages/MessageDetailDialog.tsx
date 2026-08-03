import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import type { ReceivedMessageDescription } from '@shared/domain'

/** Read-only inspection of one loaded message: broker properties, application
 * properties, copy actions, and the full body. Open whenever `message` is non-null. */
export function MessageDetailDialog({
  message,
  onOpenChange
}: {
  message: ReceivedMessageDescription | null
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open={message !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Message detail</DialogTitle>
        </DialogHeader>
        {message && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Sequence</dt>
              <dd>{message.sequenceNumber}</dd>
              <dt className="text-muted-foreground">Content type</dt>
              <dd>{message.contentType}</dd>
              <dt className="text-muted-foreground">Message ID</dt>
              <dd className="break-all">{message.messageId}</dd>
              <dt className="text-muted-foreground">Correlation ID</dt>
              <dd className="break-all">{message.correlationId}</dd>
              <dt className="text-muted-foreground">Label</dt>
              <dd className="break-all">{message.subject}</dd>
              <dt className="text-muted-foreground">Reply to</dt>
              <dd className="break-all">{message.replyTo}</dd>
              <dt className="text-muted-foreground">Enqueued</dt>
              <dd>{message.enqueuedTimeUtc}</dd>
              <dt className="text-muted-foreground">Delivery count</dt>
              <dd>{message.deliveryCount}</dd>
              {message.deadLetterReason && (
                <>
                  <dt className="text-muted-foreground">Dead-letter reason</dt>
                  <dd className="break-all">{message.deadLetterReason}</dd>
                </>
              )}
              {message.deadLetterErrorDescription && (
                <>
                  <dt className="text-muted-foreground">Dead-letter description</dt>
                  <dd className="break-all">{message.deadLetterErrorDescription}</dd>
                </>
              )}
            </dl>
            <div className="space-y-1">
              <p className="text-muted-foreground text-sm">Application properties</p>
              {message.applicationProperties &&
              Object.keys(message.applicationProperties).length > 0 ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
                  {Object.entries(message.applicationProperties).map(([propKey, value]) => (
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
                onClick={() => navigator.clipboard.writeText(message.body)}
              >
                Copy body
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(JSON.stringify(message, null, 2))}
              >
                Copy as JSON
              </Button>
            </div>
            <pre className="max-h-96 overflow-auto rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
              {message.body}
            </pre>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
