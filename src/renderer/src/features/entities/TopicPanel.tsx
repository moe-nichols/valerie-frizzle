import { useState, type FormEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { SubscriptionDescription, TopicDescription } from '@shared/domain'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { fetchSubscriptionMessageCount, formatMessageCount } from '@renderer/lib/messageCount'
import { useEntityCounts } from '@renderer/lib/useEntityCounts'
import { MessageComposer } from '../messages/MessageComposer'
import { EditSubscriptionDialog } from './EditEntityDialogs'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import {
  emptySubscriptionFields,
  SubscriptionFields,
  toCreateSubscriptionInput
} from './entityForms'
import { SubscriptionMessages } from './SubscriptionMessages'
import { SubscriptionRules } from './SubscriptionRules'
import { useEntityPanel } from './useEntityPanel'

interface TopicPanelProps {
  profileId: string
  topicName: string
}

export function TopicPanel({ profileId, topicName }: TopicPanelProps): React.JSX.Element {
  const [topic, setTopic] = useState<TopicDescription | null>(null)
  const [subscriptions, setSubscriptions] = useState<SubscriptionDescription[]>([])
  const {
    counts: subscriptionCounts,
    updateCounts: updateSubscriptionCounts,
    resetCounts: resetSubscriptionCounts
  } = useEntityCounts()
  const {
    counts: subscriptionDlqCounts,
    updateCounts: updateSubscriptionDlqCounts,
    resetCounts: resetSubscriptionDlqCounts
  } = useEntityCounts()
  const [error, setError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [newSubscriptionName, setNewSubscriptionName] = useState('')
  const [newSubscriptionFields, setNewSubscriptionFields] = useState(emptySubscriptionFields)
  const [newSubscriptionAdvancedOpen, setNewSubscriptionAdvancedOpen] = useState(false)
  const [editingSubscription, setEditingSubscription] = useState<SubscriptionDescription | null>(
    null
  )

  const { isCurrent, refresh } = useEntityPanel(
    `${profileId}::${topicName}`,
    (viaPoll) => refreshAll(viaPoll),
    () => {
      setTopic(null)
      setSubscriptions([])
      resetSubscriptionCounts()
      resetSubscriptionDlqCounts()
      setError(null)
      setLastRefreshed(null)
    }
  )

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

    const names = response.data.map((subscription) => subscription.subscriptionName)
    await Promise.all([
      updateSubscriptionCounts(
        names,
        (name) => fetchSubscriptionMessageCount(profileId, topicName, name),
        isCurrent
      ),
      updateSubscriptionDlqCounts(
        names,
        (name) => fetchSubscriptionMessageCount(profileId, topicName, name, true),
        isCurrent
      )
    ])
    return null
  }

  async function refreshAll(viaPoll = false): Promise<void> {
    const [topicError, subscriptionError] = await Promise.all([
      refreshTopic(),
      refreshSubscriptions()
    ])
    if (!isCurrent()) return
    const err = topicError ?? subscriptionError
    if (!err) {
      setError(null)
      setLastRefreshed(new Date())
    } else if (viaPoll) {
      // Background failures toast rather than pin an inline banner the next poll clears.
      toast.error(`Failed to refresh ${topicName}: ${err}`)
    } else {
      setError(err)
    }
  }

  async function handleCreateSubscription(event: FormEvent): Promise<void> {
    event.preventDefault()
    const response = await window.sbAdmin.entities.subscriptions.create(
      profileId,
      toCreateSubscriptionInput(topicName, newSubscriptionName, newSubscriptionFields)
    )
    if (response.ok) {
      setNewSubscriptionName('')
      setNewSubscriptionFields(emptySubscriptionFields)
      setNewSubscriptionAdvancedOpen(false)
      await refresh()
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
      await refresh()
    } else {
      setError(response.error.message)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          {topicName}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Refresh now"
            onClick={() => refresh()}
          >
            <RefreshCw />
            <span className="sr-only">Refresh now</span>
          </Button>
          {lastRefreshed && (
            <span className="text-muted-foreground text-xs font-normal">
              Updated {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
        </CardTitle>
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
        {!topic && !error && <p className="text-muted-foreground text-sm">Loading…</p>}
        <div className="space-y-3">
          <h3 className="text-lg font-medium">Send</h3>
          {/* Keyed so a half-composed draft doesn't silently carry over to another entity. */}
          <MessageComposer
            key={`${profileId}::${topicName}`}
            profileId={profileId}
            entityPath={topicName}
          />
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
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setEditingSubscription(subscription)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
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
          <form onSubmit={handleCreateSubscription} className="space-y-3">
            <div className="flex items-end gap-2">
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
            </div>
            <Collapsible
              open={newSubscriptionAdvancedOpen}
              onOpenChange={setNewSubscriptionAdvancedOpen}
            >
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm">
                  {newSubscriptionAdvancedOpen ? 'Hide advanced' : 'Advanced…'}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="max-w-md pt-2">
                <SubscriptionFields
                  idPrefix="new-subscription"
                  mode="create"
                  state={newSubscriptionFields}
                  onChange={setNewSubscriptionFields}
                />
              </CollapsibleContent>
            </Collapsible>
          </form>
        </div>
      </CardContent>

      {editingSubscription && (
        <EditSubscriptionDialog
          profileId={profileId}
          subscription={editingSubscription}
          open={editingSubscription !== null}
          onOpenChange={(nextOpen) => !nextOpen && setEditingSubscription(null)}
          onUpdated={async () => setError(await refreshSubscriptions())}
        />
      )}
    </Card>
  )
}
