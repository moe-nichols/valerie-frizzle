import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { QueueDescription } from '@shared/domain'
import { buildDeadLetterQueuePath } from '@shared/domain'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import {
  fetchQueueMessageCount,
  formatMessageCount,
  type MessageCountResult
} from '@renderer/lib/messageCount'
import { useIsCurrent } from '@renderer/lib/useIsCurrent'
import { usePolling } from '@renderer/lib/usePolling'
import { useAppSelector } from '@renderer/store/hooks'
import { MessageBrowser } from '../messages/MessageBrowser'
import { MessageComposer } from '../messages/MessageComposer'
import { QueuePurgeControl } from './QueuePurgeControl'

interface QueuePanelProps {
  profileId: string
  queueName: string
}

export function QueuePanel({ profileId, queueName }: QueuePanelProps): React.JSX.Element {
  const pollIntervalMs = useAppSelector((state) => state.settings.pollIntervalMs)
  const [queue, setQueue] = useState<QueueDescription | null>(null)
  const [count, setCount] = useState<MessageCountResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const isCurrent = useIsCurrent(`${profileId}::${queueName}`)

  // `viaPoll` routes background (timer-driven) failures to a toast instead of the inline
  // banner, so a transient blip during polling is noticed without pinning an alert the next
  // successful poll would just clear.
  async function refresh(viaPoll = false): Promise<void> {
    const [queueResponse, countResult] = await Promise.all([
      window.sbAdmin.entities.queues.get(profileId, queueName),
      fetchQueueMessageCount(profileId, queueName)
    ])
    // A slower in-flight refresh from a prior selection must not overwrite the panel that
    // now shows a different queue.
    if (!isCurrent()) return
    if (queueResponse.ok) {
      setQueue(queueResponse.data)
      setError(null)
      setLastRefreshed(new Date())
    } else if (viaPoll) {
      toast.error(`Failed to refresh ${queueName}: ${queueResponse.error.message}`)
    } else {
      setError(queueResponse.error.message)
    }
    if (countResult) setCount(countResult)
  }

  useEffect(() => {
    setQueue(null)
    setCount(null)
    setError(null)
    setLastRefreshed(null)
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, queueName])

  usePolling(() => refresh(true), pollIntervalMs)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          {queueName}
          {count && <Badge variant="secondary">{formatMessageCount(count)} active</Badge>}
          <QueuePurgeControl profileId={profileId} entityPath={queueName} />
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Refresh now"
            onClick={() => refresh()}
          >
            <RefreshCw />
            <span className="sr-only">Refresh now</span>
          </Button>
          {lastRefreshed && (
            <span className="text-muted-foreground text-xs font-normal">
              Updated {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
        </CardTitle>
        {queue && (
          <p className="text-muted-foreground text-sm">
            {queue.status}, max {queue.maxSizeInMegabytes}MB, TTL {queue.defaultMessageTimeToLive}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-3">
          <h3 className="text-lg font-medium">Send</h3>
          <MessageComposer profileId={profileId} entityPath={queueName} />
        </div>
        <div className="space-y-3">
          <h3 className="text-lg font-medium">Browse</h3>
          <MessageBrowser profileId={profileId} source={{ kind: 'entity', entityPath: queueName }} />
        </div>
        <div className="space-y-3">
          <h3 className="flex flex-wrap items-center gap-2 text-lg font-medium">
            Dead-letter queue
            <QueuePurgeControl
              profileId={profileId}
              entityPath={buildDeadLetterQueuePath(queueName)}
              displayName={`${queueName} DLQ`}
            />
          </h3>
          <MessageBrowser
            profileId={profileId}
            source={{ kind: 'entity', entityPath: buildDeadLetterQueuePath(queueName) }}
            resubmitDestination={queueName}
          />
        </div>
      </CardContent>
    </Card>
  )
}
