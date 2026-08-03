import { ConfirmDialog, permanentRemovalDescription } from '@renderer/components/ConfirmDialog'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import {
  queueDeleted,
  queueSelected,
  topicDeleted,
  topicSelected
} from '@renderer/store/connectionsSlice'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import type { QueueDescription, TopicDescription } from '@shared/domain'
import { useState } from 'react'
import { CreateQueueDialog, CreateTopicDialog } from './CreateEntityDialog'
import { EditQueueDialog, EditTopicDialog } from './EditEntityDialogs'
import { EntityCountBadges } from './EntityCountBadges'
import { EntityTreeSection } from './EntityTreeSection'
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

      <EntityTreeSection
        label="Queues"
        addLabel="Add queue"
        entities={queues}
        loaded={loaded}
        emptyText="No queues yet."
        activeName={activeQueueName}
        onSelect={(queue) => dispatch(queueSelected(queue.name))}
        onRefresh={() => refresh()}
        onAdd={() => setCreateQueueOpen(true)}
        onEdit={setEditingQueue}
        onDelete={(queue) => setDeleting({ kind: 'queue', name: queue.name })}
        renderBadges={(queue) => (
          <EntityCountBadges
            active={queueCounts[queue.name]}
            deadLetter={queueDlqCounts[queue.name]}
          />
        )}
      />

      <EntityTreeSection
        label="Topics"
        addLabel="Add topic"
        entities={topics}
        loaded={loaded}
        emptyText="No topics yet."
        activeName={activeTopicName}
        onSelect={(topic) => dispatch(topicSelected(topic.name))}
        onRefresh={() => refresh()}
        onAdd={() => setCreateTopicOpen(true)}
        onEdit={setEditingTopic}
        onDelete={(topic) => setDeleting({ kind: 'topic', name: topic.name })}
      />

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

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(nextOpen) => !nextOpen && setDeleting(null)}
        title={`Delete ${deleting?.kind}?`}
        description={permanentRemovalDescription(deleting?.name ?? '')}
        onConfirm={handleConfirmDelete}
      />
    </>
  )
}
