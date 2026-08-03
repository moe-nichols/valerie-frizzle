import { useEffect, useState } from 'react'
import type { QueueDescription } from '@shared/domain'
import { buildDeadLetterQueuePath } from '@shared/domain'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { MessageBrowser } from '../messages/MessageBrowser'
import { MessageComposer } from '../messages/MessageComposer'
import { QueuePurgeControl } from './QueuePurgeControl'

interface QueuePanelProps {
  profileId: string
  queueName: string
}

export function QueuePanel({ profileId, queueName }: QueuePanelProps): React.JSX.Element {
  const [queue, setQueue] = useState<QueueDescription | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setQueue(null)
    setError(null)
    async function load(): Promise<void> {
      const response = await window.sbAdmin.entities.queues.get(profileId, queueName)
      if (response.ok) {
        setQueue(response.data)
      } else {
        setError(response.error.message)
      }
    }
    load()
  }, [profileId, queueName])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          {queueName}
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
          <MessageBrowser profileId={profileId} entityPath={queueName} />
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
            entityPath={buildDeadLetterQueuePath(queueName)}
            resubmitDestination={queueName}
          />
        </div>
      </CardContent>
    </Card>
  )
}
