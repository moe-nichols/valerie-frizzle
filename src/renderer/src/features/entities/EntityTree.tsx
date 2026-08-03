import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { Badge } from '@renderer/components/ui/badge'
import { Button, buttonVariants } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import {
  SidebarGroupLabel,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem
} from '@renderer/components/ui/sidebar'
import { formatMessageCount } from '@renderer/lib/messageCount'
import {
  queueDeleted,
  queueSelected,
  topicDeleted,
  topicSelected
} from '@renderer/store/connectionsSlice'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import type { QueueDescription, TopicDescription } from '@shared/domain'
import { MoreHorizontal, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { CreateQueueDialog, CreateTopicDialog } from './CreateEntityDialog'
import { EditQueueDialog, EditTopicDialog } from './EditEntityDialogs'
import { useEntityTreeData } from './useEntityTreeData'

interface EntityTreeProps {
  profileId: string
}

interface DeletingEntity {
  kind: 'queue' | 'topic'
  name: string
}

export function EntityTree({ profileId }: EntityTreeProps): React.JSX.Element {
  const dispatch = useAppDispatch()
  const activeQueueName = useAppSelector((state) => state.connections.activeQueueName)
  const activeTopicName = useAppSelector((state) => state.connections.activeTopicName)

  const { queues, topics, queueCounts, queueDlqCounts, error, setError, loaded, refresh } =
    useEntityTreeData(profileId)

  const [createQueueOpen, setCreateQueueOpen] = useState(false)
  const [createTopicOpen, setCreateTopicOpen] = useState(false)
  const [editingQueue, setEditingQueue] = useState<QueueDescription | null>(null)
  const [editingTopic, setEditingTopic] = useState<TopicDescription | null>(null)
  const [deleting, setDeleting] = useState<DeletingEntity | null>(null)

  async function handleConfirmDelete(): Promise<void> {
    if (!deleting) return
    const { kind, name } = deleting
    setDeleting(null)

    const response =
      kind === 'queue'
        ? await window.sbAdmin.entities.queues.delete(profileId, name)
        : await window.sbAdmin.entities.topics.delete(profileId, name)

    if (response.ok) {
      dispatch(
        kind === 'queue' ? queueDeleted({ profileId, name }) : topicDeleted({ profileId, name })
      )
      await refresh()
    } else {
      setError(response.error.message)
    }
  }

  return (
    <>
      {error && (
        <Alert variant="destructive" className="mx-2 mb-1 w-auto">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <SidebarMenuSub className="border-l-0 px-0">
        <div className="flex items-center justify-between px-2">
          <SidebarGroupLabel className="p-0">Queues</SidebarGroupLabel>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              title="Refresh now"
              onClick={() => refresh()}
            >
              <RefreshCw />
              <span className="sr-only">Refresh now</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              title="Add queue"
              onClick={() => setCreateQueueOpen(true)}
            >
              <Plus />
              <span className="sr-only">Add queue</span>
            </Button>
          </div>
        </div>
        {queues.length === 0 && (
          <p className="text-muted-foreground px-2 text-xs">
            {loaded ? 'No queues yet.' : 'Loading…'}
          </p>
        )}
        {queues.map((queue) => (
          <SidebarMenuSubItem key={queue.name} className="flex items-center gap-1">
            <SidebarMenuSubButton
              asChild
              isActive={activeQueueName === queue.name}
              className="flex-1"
            >
              <button type="button" onClick={() => dispatch(queueSelected(queue.name))}>
                <span className="truncate">{queue.name}</span>
              </button>
            </SidebarMenuSubButton>
            {queueCounts[queue.name] && (
              <Badge variant="secondary" className="shrink-0">
                {formatMessageCount(queueCounts[queue.name])}
              </Badge>
            )}
            {queueDlqCounts[queue.name] && queueDlqCounts[queue.name].count > 0 && (
              <Badge variant="destructive" className="shrink-0" title="Dead-lettered messages">
                {formatMessageCount(queueDlqCounts[queue.name])} DLQ
              </Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-5 shrink-0">
                  <MoreHorizontal />
                  <span className="sr-only">More</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start">
                <DropdownMenuItem onClick={() => setEditingQueue(queue)}>Edit</DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleting({ kind: 'queue', name: queue.name })}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>

      <SidebarMenuSub className="border-l-0 px-0">
        <div className="flex items-center justify-between px-2">
          <SidebarGroupLabel className="p-0">Topics</SidebarGroupLabel>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              title="Refresh now"
              onClick={() => refresh()}
            >
              <RefreshCw />
              <span className="sr-only">Refresh now</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              title="Add topic"
              onClick={() => setCreateTopicOpen(true)}
            >
              <Plus />
              <span className="sr-only">Add topic</span>
            </Button>
          </div>
        </div>
        {topics.length === 0 && (
          <p className="text-muted-foreground px-2 text-xs">
            {loaded ? 'No topics yet.' : 'Loading…'}
          </p>
        )}
        {topics.map((topic) => (
          <SidebarMenuSubItem key={topic.name} className="flex items-center gap-1">
            <SidebarMenuSubButton
              asChild
              isActive={activeTopicName === topic.name}
              className="flex-1"
            >
              <button type="button" onClick={() => dispatch(topicSelected(topic.name))}>
                <span className="truncate">{topic.name}</span>
              </button>
            </SidebarMenuSubButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-5 shrink-0">
                  <MoreHorizontal />
                  <span className="sr-only">More</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start">
                <DropdownMenuItem onClick={() => setEditingTopic(topic)}>Edit</DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleting({ kind: 'topic', name: topic.name })}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>

      <CreateQueueDialog
        profileId={profileId}
        open={createQueueOpen}
        onOpenChange={setCreateQueueOpen}
        onCreated={refresh}
      />
      <CreateTopicDialog
        profileId={profileId}
        open={createTopicOpen}
        onOpenChange={setCreateTopicOpen}
        onCreated={refresh}
      />

      {editingQueue && (
        <EditQueueDialog
          profileId={profileId}
          queue={editingQueue}
          open={editingQueue !== null}
          onOpenChange={(nextOpen) => !nextOpen && setEditingQueue(null)}
          onUpdated={refresh}
        />
      )}
      {editingTopic && (
        <EditTopicDialog
          profileId={profileId}
          topic={editingTopic}
          open={editingTopic !== null}
          onOpenChange={(nextOpen) => !nextOpen && setEditingTopic(null)}
          onUpdated={refresh}
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(nextOpen) => !nextOpen && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.kind}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove &quot;{deleting?.name}&quot;. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className={buttonVariants({ variant: 'destructive' })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
