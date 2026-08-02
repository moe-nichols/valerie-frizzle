import { useState } from 'react'
import { buildDeadLetterQueuePath } from '@shared/domain'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Toaster } from '@renderer/components/ui/sonner'
import { ConnectionManagerPanel } from './features/connections/ConnectionManagerPanel'
import { EntityExplorer } from './features/entities/EntityExplorer'
import { QueuePurgeControl } from './features/entities/QueuePurgeControl'
import { MessageComposer } from './features/messages/MessageComposer'
import { MessageBrowser } from './features/messages/MessageBrowser'

function App(): React.JSX.Element {
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [activeQueueName, setActiveQueueName] = useState<string | null>(null)

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">SB Emulator Manager</h1>

      <Card>
        <CardContent>
          <ConnectionManagerPanel onActiveProfileChange={setActiveProfileId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Entities</CardTitle>
        </CardHeader>
        <CardContent>
          <EntityExplorer
            profileId={activeProfileId}
            onSelectQueue={setActiveQueueName}
            onQueueDeleted={(name) =>
              setActiveQueueName((current) => (current === name ? null : current))
            }
          />
        </CardContent>
      </Card>

      {activeProfileId && activeQueueName && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Messages — {activeQueueName}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <h3 className="text-lg font-medium">Send</h3>
              <MessageComposer profileId={activeProfileId} entityPath={activeQueueName} />
            </div>
            <div className="space-y-3">
              <h3 className="text-lg font-medium">Browse</h3>
              <MessageBrowser profileId={activeProfileId} entityPath={activeQueueName} />
            </div>
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 text-lg font-medium">
                Dead-letter queue
                <QueuePurgeControl
                  profileId={activeProfileId}
                  entityPath={buildDeadLetterQueuePath(activeQueueName)}
                  displayName={`${activeQueueName} DLQ`}
                />
              </h3>
              <MessageBrowser
                profileId={activeProfileId}
                entityPath={buildDeadLetterQueuePath(activeQueueName)}
                resubmitDestination={activeQueueName}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Toaster />
    </div>
  )
}

export default App
