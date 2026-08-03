import { useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { MessageBrowser } from '../messages/MessageBrowser'

interface SubscriptionMessagesProps {
  profileId: string
  topicName: string
  subscriptionName: string
}

/**
 * Collapsible browser for the messages fanned out to a single subscription, plus its
 * dead-letter sub-queue. Mirrors {@link SubscriptionRules}' show/hide affordance so a topic
 * with many subscriptions stays scannable. DLQ messages can be resubmitted back to the
 * topic (which re-fans them to every subscription).
 */
export function SubscriptionMessages({
  profileId,
  topicName,
  subscriptionName
}: SubscriptionMessagesProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="ml-6">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm">
          {expanded ? 'Hide messages' : 'Browse messages'}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-6 space-y-6 pt-2">
        <div className="space-y-3">
          <h4 className="font-medium">Messages</h4>
          <MessageBrowser
            profileId={profileId}
            source={{ kind: 'subscription', topicName, subscriptionName }}
          />
        </div>
        <div className="space-y-3">
          <h4 className="font-medium">Dead-letter queue</h4>
          <MessageBrowser
            profileId={profileId}
            source={{ kind: 'subscription', topicName, subscriptionName, deadLetter: true }}
            resubmitDestination={topicName}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
