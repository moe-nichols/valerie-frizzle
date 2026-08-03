import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import {
  fetchQueueMessageCount,
  formatMessageCount,
  type MessageCountResult
} from '@renderer/lib/messageCount'
import type { QueueDescription } from '@shared/domain'
import { buildDeadLetterQueuePath } from '@shared/domain'
import { useState } from 'react'
import { MessageBrowser } from '../messages/MessageBrowser'
import { MessageComposer } from '../messages/MessageComposer'
import { PanelRefreshControls } from './PanelRefreshControls'
import { QueuePurgeControl } from './QueuePurgeControl'
import { reportRefreshError, useEntityPanel } from './useEntityPanel'

interface QueuePanelProps {
  profileId: string
  queueName: string
}

export function QueuePanel({ profileId, queueName }: QueuePanelProps): React.JSX.Element {
  const [queue, setQueue] = useState<QueueDescription | null>(null)
  const [count, setCount] = useState<MessageCountResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  // `viaPoll` routes background (timer-driven) failures to a toast instead of the inline
  // banner, so a transient blip during polling is noticed without pinning an alert the next
  // successful poll would just clear.
  const { isCurrent, refresh } = useEntityPanel(
    `${profileId}::${queueName}`,
    (viaPoll) => fetchQueue(viaPoll),
    () => {
      setQueue(null)
      setCount(null)
      setError(null)
      setLastRefreshed(null)
    }
  )

  async function fetchQueue(viaPoll: boolean): Promise<void> {
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
    } else {
      reportRefreshError(
        `Failed to refresh ${queueName}: ${queueResponse.error.message}`,
        viaPoll,
        setError
      )
    }
    if (countResult) setCount(countResult)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          {queueName}
          {count && <Badge variant="secondary">{formatMessageCount(count)} active</Badge>}
          <QueuePurgeControl profileId={profileId} entityPath={queueName} />
          <PanelRefreshControls onRefresh={() => refresh()} lastRefreshed={lastRefreshed} />
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
        {!queue && !error && <p className="text-muted-foreground text-sm">Loading…</p>}
        <div className="space-y-3">
          <h3 className="text-lg font-medium">Send</h3>
          {/* Keyed so a half-composed draft doesn't silently carry over to another entity. */}
          <MessageComposer
            key={`${profileId}::${queueName}`}
            profileId={profileId}
            entityPath={queueName}
          />
        </div>
        <div className="space-y-3">
          <h3 className="text-lg font-medium">Browse</h3>
          <MessageBrowser
            profileId={profileId}
            source={{ kind: 'entity', entityPath: queueName }}
          />
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
