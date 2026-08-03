import { useEffect, useState, type FormEvent } from 'react'
import type { SubscriptionDescription, TopicDescription } from '@shared/domain'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { MessageComposer } from '../messages/MessageComposer'
import { SubscriptionRules } from './SubscriptionRules'

interface TopicPanelProps {
  profileId: string
  topicName: string
}

export function TopicPanel({ profileId, topicName }: TopicPanelProps): React.JSX.Element {
  const [topic, setTopic] = useState<TopicDescription | null>(null)
  const [subscriptions, setSubscriptions] = useState<SubscriptionDescription[]>([])
  const [error, setError] = useState<string | null>(null)
  const [newSubscriptionName, setNewSubscriptionName] = useState('')

  async function refreshSubscriptions(): Promise<void> {
    const response = await window.sbAdmin.entities.subscriptions.list(profileId, topicName)
    if (response.ok) {
      setSubscriptions(response.data)
    } else {
      setError(response.error.message)
    }
  }

  useEffect(() => {
    setTopic(null)
    setSubscriptions([])
    setError(null)
    async function load(): Promise<void> {
      const [topicResponse, subscriptionsResponse] = await Promise.all([
        window.sbAdmin.entities.topics.get(profileId, topicName),
        window.sbAdmin.entities.subscriptions.list(profileId, topicName)
      ])
      if (topicResponse.ok) {
        setTopic(topicResponse.data)
      } else {
        setError(topicResponse.error.message)
      }
      if (subscriptionsResponse.ok) {
        setSubscriptions(subscriptionsResponse.data)
      } else {
        setError(subscriptionsResponse.error.message)
      }
    }
    load()
  }, [profileId, topicName])

  async function handleCreateSubscription(event: FormEvent): Promise<void> {
    event.preventDefault()
    const response = await window.sbAdmin.entities.subscriptions.create(profileId, {
      topicName,
      subscriptionName: newSubscriptionName
    })
    if (response.ok) {
      setNewSubscriptionName('')
      await refreshSubscriptions()
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
      await refreshSubscriptions()
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
