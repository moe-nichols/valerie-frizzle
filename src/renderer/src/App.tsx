import { useEffect } from 'react'
import { Radio } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger
} from '@renderer/components/ui/sidebar'
import { Toaster } from '@renderer/components/ui/sonner'
import { ConnectionSidebar } from './features/connections/ConnectionSidebar'
import { QueuePanel } from './features/entities/QueuePanel'
import { TopicPanel } from './features/entities/TopicPanel'
import { SettingsButton } from './features/settings/SettingsButton'
import { fetchPollInterval } from './store/settingsSlice'
import { useAppDispatch, useAppSelector } from './store/hooks'

function App(): React.JSX.Element {
  const dispatch = useAppDispatch()
  const selectedProfileId = useAppSelector((state) => state.connections.selectedProfileId)
  const activeQueueName = useAppSelector((state) => state.connections.activeQueueName)
  const activeTopicName = useAppSelector((state) => state.connections.activeTopicName)

  useEffect(() => {
    dispatch(fetchPollInterval())
  }, [dispatch])

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
        <SidebarFooter>
          <SettingsButton />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex items-center gap-2 border-b p-4">
          <SidebarTrigger />
        </header>

        <div className="mx-auto w-full max-w-5xl space-y-6 p-8">
          {selectedProfileId ? (
            <>
              {activeQueueName && (
                <QueuePanel profileId={selectedProfileId} queueName={activeQueueName} />
              )}
              {activeTopicName && (
                <TopicPanel profileId={selectedProfileId} topicName={activeTopicName} />
              )}
              {!activeQueueName && !activeTopicName && (
                <p className="text-muted-foreground text-sm">
                  Select a queue or topic in the sidebar to get started.
                </p>
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
