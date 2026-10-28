import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { buildDeadLetterQueuePath } from '@shared/domain'
import { MessageBrowser } from '../messages/MessageBrowser'
import { MessageComposer } from '../messages/MessageComposer'
import { EntityCountBadges } from './EntityCountBadges'
import { PanelRefreshControls } from './PanelRefreshControls'
import { QueuePurgeControl } from './QueuePurgeControl'
import { useQueuePanelData } from './useEntityRefresh'

interface QueuePanelProps {
  profileId: string
  queueName: string
}

export function QueuePanel({ profileId, queueName }: QueuePanelProps): React.JSX.Element {
  const { queue, count, error, lastRefreshed, refresh } = useQueuePanelData(profileId, queueName)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          {queueName}
          <EntityCountBadges active={count} activeSuffix=" active" />
          <QueuePurgeControl
            profileId={profileId}
            queueName={queueName}
            queue={queue}
            target="active"
          />
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
        {!queue && !error && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-48" />
          </div>
        )}
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
              queueName={queueName}
              queue={queue}
              target="deadLetter"
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
