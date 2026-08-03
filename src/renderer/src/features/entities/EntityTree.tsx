import { useEffect, useState } from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'
import type { QueueDescription, TopicDescription } from '@shared/domain'
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
import {
  queueDeleted,
  queueSelected,
  topicDeleted,
  topicSelected
} from '@renderer/store/connectionsSlice'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import { CreateQueueDialog } from './CreateQueueDialog'
import { CreateTopicDialog } from './CreateTopicDialog'

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

  const [queues, setQueues] = useState<QueueDescription[]>([])
  const [topics, setTopics] = useState<TopicDescription[]>([])
  const [error, setError] = useState<string | null>(null)

  const [createQueueOpen, setCreateQueueOpen] = useState(false)
  const [createTopicOpen, setCreateTopicOpen] = useState(false)
  const [deleting, setDeleting] = useState<DeletingEntity | null>(null)

  async function refresh(): Promise<void> {
    const [queuesResponse, topicsResponse] = await Promise.all([
      window.sbAdmin.entities.queues.list(profileId),
      window.sbAdmin.entities.topics.list(profileId)
    ])
    if (queuesResponse.ok) {
      setQueues(queuesResponse.data)
    } else {
      setError(queuesResponse.error.message)
    }
    if (topicsResponse.ok) {
      setTopics(topicsResponse.data)
    } else {
      setError(topicsResponse.error.message)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  async function handleConfirmDelete(): Promise<void> {
    if (!deleting) return
    const { kind, name } = deleting
    setDeleting(null)

    const response =
      kind === 'queue'
        ? await window.sbAdmin.entities.queues.delete(profileId, name)
        : await window.sbAdmin.entities.topics.delete(profileId, name)

    if (response.ok) {
      dispatch(kind === 'queue' ? queueDeleted(name) : topicDeleted(name))
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
        {queues.length === 0 && (
          <p className="text-muted-foreground px-2 text-xs">No queues yet.</p>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-5 shrink-0">
                  <MoreHorizontal />
                  <span className="sr-only">More</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start">
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
        {topics.length === 0 && (
          <p className="text-muted-foreground px-2 text-xs">No topics yet.</p>
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
