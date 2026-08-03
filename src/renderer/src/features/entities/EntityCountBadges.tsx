import { Badge } from '@renderer/components/ui/badge'
import { formatMessageCount, type MessageCountResult } from '@renderer/lib/messageCount'

/**
 * The active-count + dead-letter-count badge pair shown next to an entity. Either badge
 * renders only when its count is known (a failed fetch keeps the previous value or shows
 * nothing — see useEntityCounts), and the DLQ badge only when it's non-zero.
 */
export function EntityCountBadges({
  active,
  deadLetter,
  activeSuffix = ''
}: {
  active: MessageCountResult | undefined
  deadLetter: MessageCountResult | undefined
  /** e.g. " active" where the badge has room for a label; empty in the tight sidebar. */
  activeSuffix?: string
}): React.JSX.Element {
  return (
    <>
      {active && (
        <Badge variant="secondary" className="shrink-0">
          {formatMessageCount(active)}
          {activeSuffix}
        </Badge>
      )}
      {deadLetter && deadLetter.count > 0 && (
        <Badge variant="destructive" className="shrink-0" title="Dead-lettered messages">
          {formatMessageCount(deadLetter)} DLQ
        </Badge>
      )}
    </>
  )
}
