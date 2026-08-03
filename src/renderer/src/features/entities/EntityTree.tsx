import { useEffect, useState } from 'react'
import { MoreHorizontal, Plus, RefreshCw } from 'lucide-react'
import type { QueueDescription, TopicDescription } from '@shared/domain'
import { buildDeadLetterQueuePath } from '@shared/domain'
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
import {
  fetchQueueDeadLetterCount,
  fetchQueueMessageCount,
  formatMessageCount,
  type MessageCountResult
} from '@renderer/lib/messageCount'
import { usePolling } from '@renderer/lib/usePolling'
import {
  queueDeleted,
  queueSelected,
  topicDeleted,
  topicSelected
} from '@renderer/store/connectionsSlice'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import { CreateQueueDialog } from './CreateQueueDialog'
import { CreateTopicDialog } from './CreateTopicDialog'
import { EditQueueDialog, EditTopicDialog } from './EditEntityDialogs'

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
  const [queueCounts, setQueueCounts] = useState<Record<string, MessageCountResult>>({})
  const [queueDlqCounts, setQueueDlqCounts] = useState<Record<string, MessageCountResult>>({})
  const [error, setError] = useState<string | null>(null)

  const [createQueueOpen, setCreateQueueOpen] = useState(false)
  const [createTopicOpen, setCreateTopicOpen] = useState(false)
  const [editingQueue, setEditingQueue] = useState<QueueDescription | null>(null)
  const [editingTopic, setEditingTopic] = useState<TopicDescription | null>(null)
  const [deleting, setDeleting] = useState<DeletingEntity | null>(null)

  async function refresh(): Promise<void> {
    const [queuesResponse, topicsResponse] = await Promise.all([
      window.sbAdmin.entities.queues.list(profileId),
      window.sbAdmin.entities.topics.list(profileId)
    ])
    // A single error is set at the end so one list's success doesn't wipe the other's
    // failure, and a fully successful poll clears a stale error from an earlier blip.
    let nextError: string | null = null
    if (queuesResponse.ok) {
      // A queue/topic that disappeared server-side (deleted from outside this app, or by
      // another connection to the same emulator) should stop being "active" here too — an
      // open panel for it would otherwise keep showing stale data forever.
      const newNames = new Set(queuesResponse.data.map((queue) => queue.name))
      for (const queue of queues) {
        if (!newNames.has(queue.name)) dispatch(queueDeleted(queue.name))
      }
      setQueues(queuesResponse.data)

      const [counts, dlqCounts] = await Promise.all([
        Promise.all(
          queuesResponse.data.map((queue) => fetchQueueMessageCount(profileId, queue.name))
        ),
        Promise.all(
          queuesResponse.data.map((queue) =>
            fetchQueueDeadLetterCount(profileId, buildDeadLetterQueuePath(queue.name))
          )
        )
      ])
      setQueueDlqCounts((prev) => {
        const next: Record<string, MessageCountResult> = {}
        queuesResponse.data.forEach((queue, index) => {
          const count = dlqCounts[index]
          if (count) {
            next[queue.name] = count
          } else if (prev[queue.name]) {
            next[queue.name] = prev[queue.name]
          }
        })
        return next
      })
      setQueueCounts((prev) => {
        const next: Record<string, MessageCountResult> = {}
        queuesResponse.data.forEach((queue, index) => {
          const count = counts[index]
          if (count) {
            next[queue.name] = count
          } else if (prev[queue.name]) {
            next[queue.name] = prev[queue.name]
          }
        })
        return next
      })
    } else {
      nextError = queuesResponse.error.message
    }
    if (topicsResponse.ok) {
      const newNames = new Set(topicsResponse.data.map((topic) => topic.name))
      for (const topic of topics) {
        if (!newNames.has(topic.name)) dispatch(topicDeleted(topic.name))
      }
      setTopics(topicsResponse.data)
    } else {
      nextError = nextError ?? topicsResponse.error.message
    }
    setError(nextError)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  usePolling(refresh, pollIntervalMs)

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
            {queueCounts[queue.name] && (
              <Badge variant="secondary" className="shrink-0">
                {formatMessageCount(queueCounts[queue.name])}
              </Badge>
            )}
            {queueDlqCounts[queue.name] && queueDlqCounts[queue.name].count > 0 && (
              <Badge
                variant="destructive"
                className="shrink-0"
                title="Dead-lettered messages"
              >
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
