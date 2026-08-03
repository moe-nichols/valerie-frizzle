import { useEffect, useState, type FormEvent } from 'react'
import type { SubscriptionDescription, TopicDescription } from '@shared/domain'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import {
  fetchSubscriptionMessageCount,
  formatMessageCount,
  type MessageCountResult
} from '@renderer/lib/messageCount'
import { useIsCurrent } from '@renderer/lib/useIsCurrent'
import { usePolling } from '@renderer/lib/usePolling'
import { useAppSelector } from '@renderer/store/hooks'
import { MessageComposer } from '../messages/MessageComposer'
import { SubscriptionMessages } from './SubscriptionMessages'
import { SubscriptionRules } from './SubscriptionRules'

interface TopicPanelProps {
  profileId: string
  topicName: string
}

export function TopicPanel({ profileId, topicName }: TopicPanelProps): React.JSX.Element {
  const pollIntervalMs = useAppSelector((state) => state.settings.pollIntervalMs)
  const [topic, setTopic] = useState<TopicDescription | null>(null)
  const [subscriptions, setSubscriptions] = useState<SubscriptionDescription[]>([])
  const [subscriptionCounts, setSubscriptionCounts] = useState<Record<string, MessageCountResult>>(
    {}
  )
  const [subscriptionDlqCounts, setSubscriptionDlqCounts] = useState<
    Record<string, MessageCountResult>
  >({})
  const [error, setError] = useState<string | null>(null)
  const [newSubscriptionName, setNewSubscriptionName] = useState('')
  const isCurrent = useIsCurrent(`${profileId}::${topicName}`)

  // The two refreshers report their error rather than writing shared `error` state
  // directly, so the combined refresh can set it once — otherwise one branch's success
  // could clobber the other branch's failure (they run concurrently). They also bail out
  // once a newer selection has superseded this one, so stale data can't land in the panel.
  async function refreshTopic(): Promise<string | null> {
    const response = await window.sbAdmin.entities.topics.get(profileId, topicName)
    if (!isCurrent()) return null
    if (!response.ok) return response.error.message
    setTopic(response.data)
    return null
  }

  async function refreshSubscriptions(): Promise<string | null> {
    const response = await window.sbAdmin.entities.subscriptions.list(profileId, topicName)
    if (!isCurrent()) return null
    if (!response.ok) return response.error.message
    setSubscriptions(response.data)

    const [counts, dlqCounts] = await Promise.all([
      Promise.all(
        response.data.map((subscription) =>
          fetchSubscriptionMessageCount(profileId, topicName, subscription.subscriptionName)
        )
      ),
      Promise.all(
        response.data.map((subscription) =>
          fetchSubscriptionMessageCount(profileId, topicName, subscription.subscriptionName, true)
        )
      )
    ])
    if (!isCurrent()) return null
    const mergeCounts =
      (results: (MessageCountResult | null)[]) =>
      (prev: Record<string, MessageCountResult>): Record<string, MessageCountResult> => {
        const next: Record<string, MessageCountResult> = {}
        response.data.forEach((subscription, index) => {
          const count = results[index]
          if (count) {
            next[subscription.subscriptionName] = count
          } else if (prev[subscription.subscriptionName]) {
            next[subscription.subscriptionName] = prev[subscription.subscriptionName]
          }
        })
        return next
      }
    setSubscriptionCounts(mergeCounts(counts))
    setSubscriptionDlqCounts(mergeCounts(dlqCounts))
    return null
  }

  async function refresh(): Promise<void> {
    const [topicError, subscriptionError] = await Promise.all([
      refreshTopic(),
      refreshSubscriptions()
    ])
    if (!isCurrent()) return
    setError(topicError ?? subscriptionError)
  }

  useEffect(() => {
    setTopic(null)
    setSubscriptions([])
    setSubscriptionCounts({})
    setSubscriptionDlqCounts({})
    setError(null)
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, topicName])

  usePolling(refresh, pollIntervalMs)

  async function handleCreateSubscription(event: FormEvent): Promise<void> {
    event.preventDefault()
    const response = await window.sbAdmin.entities.subscriptions.create(profileId, {
      topicName,
      subscriptionName: newSubscriptionName
    })
    if (response.ok) {
      setNewSubscriptionName('')
      setError(await refreshSubscriptions())
    } else {
      setError(response.error.message)
    }
  }

  async function handleDeleteSubscription(subscriptionName: string): Promise<void> {
    const response = await window.sbAdmin.entities.subscriptions.delete(
      profileId,
      topicName,
      subscriptionName
    )
    if (response.ok) {
      setError(await refreshSubscriptions())
    } else {
      setError(response.error.message)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{topicName}</CardTitle>
        {topic && (
          <p className="text-muted-foreground text-sm">
            {topic.status}, max {topic.maxSizeInMegabytes}MB
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-3">
          <h3 className="text-lg font-medium">Send</h3>
          <MessageComposer profileId={profileId} entityPath={topicName} />
        </div>
        <div className="space-y-3">
          <h3 className="text-lg font-medium">Subscriptions</h3>
          {subscriptions.length === 0 && (
            <p className="text-muted-foreground text-sm">No subscriptions yet.</p>
          )}
          <ul className="space-y-2">
            {subscriptions.map((subscription) => (
              <li
                key={subscription.subscriptionName}
                className="space-y-1 rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{subscription.subscriptionName}</span>
                  <span className="text-muted-foreground">
                    ({subscription.status}, max delivery {subscription.maxDeliveryCount})
                  </span>
                  {subscriptionCounts[subscription.subscriptionName] && (
                    <Badge variant="secondary">
                      {formatMessageCount(subscriptionCounts[subscription.subscriptionName])} active
                    </Badge>
                  )}
                  {subscriptionDlqCounts[subscription.subscriptionName] &&
                    subscriptionDlqCounts[subscription.subscriptionName].count > 0 && (
                      <Badge variant="destructive" title="Dead-lettered messages">
                        {formatMessageCount(subscriptionDlqCounts[subscription.subscriptionName])} DLQ
                      </Badge>
                    )}
                  <Button
                    variant="destructive"
                    size="sm"
                    className="ml-auto"
                    onClick={() => handleDeleteSubscription(subscription.subscriptionName)}
                  >
                    Delete
                  </Button>
                </div>
                <SubscriptionRules
                  profileId={profileId}
                  topicName={topicName}
                  subscriptionName={subscription.subscriptionName}
                />
                <SubscriptionMessages
                  profileId={profileId}
                  topicName={topicName}
                  subscriptionName={subscription.subscriptionName}
                />
              </li>
            ))}
          </ul>
          <form onSubmit={handleCreateSubscription} className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-subscription-name">New subscription name</Label>
              <Input
                id="new-subscription-name"
                value={newSubscriptionName}
                onChange={(event) => setNewSubscriptionName(event.target.value)}
                required
              />
            </div>
            <Button type="submit">Add subscription</Button>
          </form>
        </div>
      </CardContent>
    </Card>
  )
}
