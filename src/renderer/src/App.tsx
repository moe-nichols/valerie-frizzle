import { Radio } from 'lucide-react'
import { buildDeadLetterQueuePath } from '@shared/domain'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger
} from '@renderer/components/ui/sidebar'
import { Toaster } from '@renderer/components/ui/sonner'
import { ConnectionSidebar } from './features/connections/ConnectionSidebar'
import { EntityExplorer } from './features/entities/EntityExplorer'
import { QueuePurgeControl } from './features/entities/QueuePurgeControl'
import { MessageComposer } from './features/messages/MessageComposer'
import { MessageBrowser } from './features/messages/MessageBrowser'
import { useAppSelector } from './store/hooks'

function App(): React.JSX.Element {
  const selectedProfileId = useAppSelector((state) => state.connections.selectedProfileId)
  const activeQueueName = useAppSelector((state) => state.connections.activeQueueName)
  const activeTopicName = useAppSelector((state) => state.connections.activeTopicName)

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2">
            <Radio className="size-5 shrink-0" />
            <h1 className="truncate text-lg font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
              SB Emulator Manager
            </h1>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <ConnectionSidebar />
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        <header className="flex items-center gap-2 border-b p-4">
          <SidebarTrigger />
        </header>

        <div className="mx-auto w-full max-w-5xl space-y-6 p-8">
          {selectedProfileId ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-xl">Entities</CardTitle>
                </CardHeader>
                <CardContent>
                  <EntityExplorer profileId={selectedProfileId} />
                </CardContent>
              </Card>

              {activeQueueName && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-xl">Messages — {activeQueueName}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-3">
                      <h3 className="text-lg font-medium">Send</h3>
                      <MessageComposer profileId={selectedProfileId} entityPath={activeQueueName} />
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-lg font-medium">Browse</h3>
                      <MessageBrowser profileId={selectedProfileId} entityPath={activeQueueName} />
                    </div>
                    <div className="space-y-3">
                      <h3 className="flex items-center gap-2 text-lg font-medium">
                        Dead-letter queue
                        <QueuePurgeControl
                          profileId={selectedProfileId}
                          entityPath={buildDeadLetterQueuePath(activeQueueName)}
                          displayName={`${activeQueueName} DLQ`}
                        />
                      </h3>
                      <MessageBrowser
                        profileId={selectedProfileId}
                        entityPath={buildDeadLetterQueuePath(activeQueueName)}
                        resubmitDestination={activeQueueName}
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeTopicName && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-xl">Messages — {activeTopicName}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-3">
                      <h3 className="text-lg font-medium">Send</h3>
                      <MessageComposer profileId={selectedProfileId} entityPath={activeTopicName} />
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Select or connect to a profile in the sidebar to get started.
            </p>
          )}
        </div>
      </SidebarInset>

      <Toaster />
    </SidebarProvider>
  )
}

export default App
