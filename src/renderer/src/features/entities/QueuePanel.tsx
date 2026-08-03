import { useEffect, useState } from 'react'
import type { QueueDescription } from '@shared/domain'
import { buildDeadLetterQueuePath } from '@shared/domain'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
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
  const isCurrent = useIsCurrent(`${profileId}::${queueName}`)

  async function refresh(): Promise<void> {
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
    } else {
      setError(queueResponse.error.message)
    }
    if (countResult) setCount(countResult)
  }

  useEffect(() => {
    setQueue(null)
    setCount(null)
    setError(null)
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, queueName])

  usePolling(refresh, pollIntervalMs)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          {queueName}
          {count && <Badge variant="secondary">{formatMessageCount(count)} active</Badge>}
          <QueuePurgeControl profileId={profileId} entityPath={queueName} />
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
