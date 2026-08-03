import { useEffect, useState } from 'react'
import { MoreHorizontal, Plus, RefreshCw } from 'lucide-react'
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
import { fetchQueueMessageCount, formatMessageCount } from '@renderer/lib/messageCount'
import { useEntityCounts } from '@renderer/lib/useEntityCounts'
import { usePolling } from '@renderer/lib/usePolling'
import {
  entitiesRefreshed,
  queueDeleted,
  queueSelected,
  topicDeleted,
  topicSelected
} from '@renderer/store/connectionsSlice'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import { CreateEntityDialog } from './CreateEntityDialog'

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
  const pollIntervalMs = useAppSelector((state) => state.settings.pollIntervalMs)

  const [queues, setQueues] = useState<QueueDescription[]>([])
  const [topics, setTopics] = useState<TopicDescription[]>([])
  const { counts: queueCounts, updateCounts: updateQueueCounts } = useEntityCounts()
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const [createQueueOpen, setCreateQueueOpen] = useState(false)
  const [createTopicOpen, setCreateTopicOpen] = useState(false)
  const [deleting, setDeleting] = useState<DeletingEntity | null>(null)

  async function fetchEntities(): Promise<void> {
    const [queuesResponse, topicsResponse] = await Promise.all([
      window.sbAdmin.entities.queues.list(profileId),
      window.sbAdmin.entities.topics.list(profileId)
    ])
    // The slice clears any active selection the fresh listings no longer contain (an
    // entity deleted from outside this app must not keep a stale panel open).
    dispatch(
      entitiesRefreshed({
        profileId,
        queueNames: queuesResponse.ok
          ? queuesResponse.data.map((queue) => queue.name)
          : undefined,
        topicNames: topicsResponse.ok
          ? topicsResponse.data.map((topic) => topic.name)
          : undefined
      })
    )
    // A single error is set at the end so one list's success doesn't wipe the other's
    // failure, and a fully successful poll clears a stale error from an earlier blip.
    let nextError: string | null = null
    if (queuesResponse.ok) {
      setQueues(queuesResponse.data)
      await updateQueueCounts(
        queuesResponse.data.map((queue) => queue.name),
        (name) => fetchQueueMessageCount(profileId, name)
      )
    } else {
      nextError = queuesResponse.error.message
    }
    if (topicsResponse.ok) {
      setTopics(topicsResponse.data)
    } else {
      nextError = nextError ?? topicsResponse.error.message
    }
    setError(nextError)
    setLoaded(true)
  }

  // All refreshes — timer ticks, the Refresh buttons, and post-create/delete reloads — go
  // through this one guarded runner so they can't interleave and clobber newer state.
  const refresh = usePolling(fetchEntities, pollIntervalMs)

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
      dispatch(kind === 'queue' ? queueDeleted({ profileId, name }) : topicDeleted({ profileId, name }))
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

      <CreateEntityDialog
        profileId={profileId}
        entityKind="queue"
        open={createQueueOpen}
        onOpenChange={setCreateQueueOpen}
        onCreated={refresh}
      />
      <CreateEntityDialog
        profileId={profileId}
        entityKind="topic"
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
