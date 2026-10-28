import { Badge } from '@renderer/components/ui/badge'
import { type AvailableObservation, formatMessageCount } from '@renderer/lib/messageCount'

/**
 * The active-count + dead-letter-count badge pair shown next to an entity. Either badge
 * renders only when its count is known (a failed fetch keeps the previous value or shows
 * nothing), and the DLQ badge only when it's non-zero.
 *
 * An entity with auto-forwarding enabled can't be peeked at all (a permanent Service Bus
 * limitation), so its count is never fetched — instead of a number it shows a "forwarding"
 * badge in place of the active count.
 */
export function EntityCountBadges({
  active,
  deadLetter,
  activeSuffix = ''
}: {
  active: AvailableObservation | undefined
  deadLetter?: AvailableObservation | undefined
  /** e.g. " active" where the badge has room for a label; empty in the tight sidebar. */
  activeSuffix?: string
}): React.JSX.Element {
  return (
    <>
      {active?.status === 'unavailable' ? (
        <Badge
          variant="outline"
          className="shrink-0"
          title="Auto-forwarding is enabled; messages here can't be counted (Service Bus does not allow peeking a forwarding entity)"
        >
          forwarding
        </Badge>
      ) : (
        active?.status === 'observed' && (
          <Badge variant="secondary" className="shrink-0">
            {formatMessageCount(active)}
            {activeSuffix}
          </Badge>
        )
      )}
      {deadLetter?.status === 'observed' && deadLetter.count > 0 && (
        <Badge variant="destructive" className="shrink-0" title="Dead-lettered messages">
          {formatMessageCount(deadLetter)} DLQ
        </Badge>
      )}
    </>
  )
}
