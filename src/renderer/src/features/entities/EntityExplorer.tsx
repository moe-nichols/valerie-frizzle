import { useEffect, useState, type FormEvent } from 'react'
import type { QueueDescription, TopicDescription, SubscriptionDescription } from '@shared/domain'
import { SubscriptionRules } from './SubscriptionRules'
import { QueuePurgeControl } from './QueuePurgeControl'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'

interface EntityExplorerProps {
  profileId: string | null
  onSelectQueue: (queueName: string) => void
  onQueueDeleted: (queueName: string) => void
}

export function EntityExplorer({
  profileId,
  onSelectQueue,
  onQueueDeleted
}: EntityExplorerProps): React.JSX.Element {
  const [queues, setQueues] = useState<QueueDescription[]>([])
  const [topics, setTopics] = useState<TopicDescription[]>([])
  const [subscriptionsByTopic, setSubscriptionsByTopic] = useState<
    Record<string, SubscriptionDescription[]>
  >({})
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [newQueueName, setNewQueueName] = useState('')
  const [newTopicName, setNewTopicName] = useState('')
  const [newSubscriptionNameByTopic, setNewSubscriptionNameByTopic] = useState<Record<string, string>>({})

  async function refresh(currentProfileId: string): Promise<void> {
    setLoading(true)
    const [queuesResponse, topicsResponse] = await Promise.all([
      window.sbAdmin.entities.queues.list(currentProfileId),
      window.sbAdmin.entities.topics.list(currentProfileId)
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
    setLoading(false)
  }

  useEffect(() => {
    setQueues([])
    setTopics([])
    setSubscriptionsByTopic({})
    setExpandedTopics(new Set())
    setError(null)
    if (profileId) {
      refresh(profileId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  async function refreshSubscriptions(topicName: string): Promise<void> {
    if (!profileId) return
    const response = await window.sbAdmin.entities.subscriptions.list(profileId, topicName)
    if (response.ok) {
      setSubscriptionsByTopic((prev) => ({ ...prev, [topicName]: response.data }))
    } else {
      setError(response.error.message)
    }
  }

  async function handleToggleTopic(topicName: string): Promise<void> {
    const alreadyExpanded = expandedTopics.has(topicName)
    setExpandedTopics((prev) => {
      const next = new Set(prev)
      if (alreadyExpanded) {
        next.delete(topicName)
      } else {
        next.add(topicName)
      }
      return next
    })
    if (!alreadyExpanded) {
      await refreshSubscriptions(topicName)
    }
  }

  async function handleCreateQueue(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!profileId) return
    const response = await window.sbAdmin.entities.queues.create(profileId, { name: newQueueName })
    if (response.ok) {
      setNewQueueName('')
      await refresh(profileId)
    } else {
      setError(response.error.message)
    }
  }

  async function handleDeleteQueue(name: string): Promise<void> {
    if (!profileId) return
    const response = await window.sbAdmin.entities.queues.delete(profileId, name)
    if (response.ok) {
      onQueueDeleted(name)
      await refresh(profileId)
    } else {
      setError(response.error.message)
    }
  }

  async function handleCreateTopic(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!profileId) return
    const response = await window.sbAdmin.entities.topics.create(profileId, { name: newTopicName })
    if (response.ok) {
      setNewTopicName('')
      await refresh(profileId)
    } else {
      setError(response.error.message)
    }
  }

  async function handleDeleteTopic(name: string): Promise<void> {
    if (!profileId) return
    const response = await window.sbAdmin.entities.topics.delete(profileId, name)
    if (response.ok) {
      await refresh(profileId)
    } else {
      setError(response.error.message)
    }
  }

  async function handleCreateSubscription(event: FormEvent, topicName: string): Promise<void> {
    event.preventDefault()
    if (!profileId) return
    const subscriptionName = newSubscriptionNameByTopic[topicName] ?? ''
    const response = await window.sbAdmin.entities.subscriptions.create(profileId, {
      topicName,
      subscriptionName
    })
    if (response.ok) {
      setNewSubscriptionNameByTopic((prev) => ({ ...prev, [topicName]: '' }))
      await refreshSubscriptions(topicName)
    } else {
      setError(response.error.message)
    }
  }

  async function handleDeleteSubscription(topicName: string, subscriptionName: string): Promise<void> {
    if (!profileId) return
    const response = await window.sbAdmin.entities.subscriptions.delete(
      profileId,
      topicName,
      subscriptionName
    )
    if (response.ok) {
      await refreshSubscriptions(topicName)
    } else {
      setError(response.error.message)
    }
  }

  if (!profileId) {
    return (
      <p className="text-muted-foreground text-sm">
        Connect to a profile above to manage its queues and topics.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {loading && <p className="text-muted-foreground text-sm">Loading entities…</p>}

      <div className="space-y-3">
        <h3 className="text-lg font-medium">Queues</h3>
        {queues.length === 0 && <p className="text-muted-foreground text-sm">No queues yet.</p>}
        <ul className="space-y-2">
          {queues.map((queue) => (
            <li
              key={queue.name}
              className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
            >
              <span className="font-medium">{queue.name}</span>
              <span className="text-muted-foreground text-sm">
                ({queue.status}, max {queue.maxSizeInMegabytes}MB, TTL {queue.defaultMessageTimeToLive})
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => onSelectQueue(queue.name)}>
                  Messages
                </Button>
                <Button variant="destructive" size="sm" onClick={() => handleDeleteQueue(queue.name)}>
                  Delete
                </Button>
                <QueuePurgeControl profileId={profileId} entityPath={queue.name} />
              </div>
            </li>
          ))}
        </ul>
        <form onSubmit={handleCreateQueue} className="flex items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-queue-name">New queue name</Label>
            <Input
              id="new-queue-name"
              value={newQueueName}
              onChange={(event) => setNewQueueName(event.target.value)}
              required
            />
          </div>
          <Button type="submit">Add queue</Button>
        </form>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-medium">Topics</h3>
        {topics.length === 0 && <p className="text-muted-foreground text-sm">No topics yet.</p>}
        <ul className="space-y-2">
          {topics.map((topic) => (
            <li key={topic.name} className="space-y-2 rounded-md border px-3 py-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{topic.name}</span>
                <span className="text-muted-foreground text-sm">
                  ({topic.status}, max {topic.maxSizeInMegabytes}MB)
                </span>
              </div>
              {/* A direct child <button> of this <li>, not nested in a wrapper div — a driver
                  script locator pattern (see plan/PROGRESS.md finding #5) scopes to this exact
                  shape (`topicRow.locator(':scope > button:has-text("Delete")')`) to disambiguate
                  this topic's own Delete button from nested subscription/rule Delete buttons. */}
              <Button variant="destructive" size="sm" onClick={() => handleDeleteTopic(topic.name)}>
                Delete
              </Button>
              <Collapsible
                open={expandedTopics.has(topic.name)}
                onOpenChange={() => handleToggleTopic(topic.name)}
              >
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm">
                    {expandedTopics.has(topic.name) ? 'Hide subscriptions' : 'Show subscriptions'}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="ml-6 space-y-3 pt-2">
                  <ul className="space-y-1">
                    {(subscriptionsByTopic[topic.name] ?? []).map((subscription) => (
                      <li key={subscription.subscriptionName} className="space-y-1 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>
                            {subscription.subscriptionName} ({subscription.status}, max delivery{' '}
                            {subscription.maxDeliveryCount})
                          </span>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDeleteSubscription(topic.name, subscription.subscriptionName)}
                          >
                            Delete
                          </Button>
                        </div>
                        <SubscriptionRules
                          profileId={profileId}
                          topicName={topic.name}
                          subscriptionName={subscription.subscriptionName}
                        />
                      </li>
                    ))}
                    {(subscriptionsByTopic[topic.name] ?? []).length === 0 && (
                      <li className="text-muted-foreground">No subscriptions yet.</li>
                    )}
                  </ul>
                  <form
                    onSubmit={(event) => handleCreateSubscription(event, topic.name)}
                    className="flex items-end gap-2"
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor={`new-subscription-${topic.name}`}>New subscription name</Label>
                      <Input
                        id={`new-subscription-${topic.name}`}
                        value={newSubscriptionNameByTopic[topic.name] ?? ''}
                        onChange={(event) =>
                          setNewSubscriptionNameByTopic((prev) => ({
                            ...prev,
                            [topic.name]: event.target.value
                          }))
                        }
                        required
                      />
                    </div>
                    <Button type="submit">Add subscription</Button>
                  </form>
                </CollapsibleContent>
              </Collapsible>
            </li>
          ))}
        </ul>
        <form onSubmit={handleCreateTopic} className="flex items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-topic-name">New topic name</Label>
            <Input
              id="new-topic-name"
              value={newTopicName}
              onChange={(event) => setNewTopicName(event.target.value)}
              required
            />
          </div>
          <Button type="submit">Add topic</Button>
        </form>
      </div>
    </div>
  )
}
