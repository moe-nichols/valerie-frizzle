import { FormDialog } from '@renderer/components/FormDialog'
import type { QueueDescription, SubscriptionDescription, TopicDescription } from '@shared/domain'
import type { Result } from '@shared/errors'
import { useEffect, useState } from 'react'
import {
  QueueFields,
  queueFieldsFromDescription,
  SubscriptionFields,
  subscriptionFieldsFromDescription,
  TopicFields,
  topicFieldsFromDescription,
  toUpdateQueueInput,
  toUpdateSubscriptionInput,
  toUpdateTopicInput
} from './entityForms'

/**
 * Edit dialogs wire the `entities.*.update` IPC channels to the shared field groups from
 * `entityForms`. Each resyncs its form from the current entity description whenever it
 * opens, so it reflects the persisted values rather than a stale prior edit (same pattern
 * as SettingsDialog). The three exported dialogs are pure configuration over the generic
 * EditEntityDialog below.
 */

interface CommonEditProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: () => void | Promise<void>
}

function EditEntityDialog<TDescription, TState>({
  title,
  idPrefix,
  description,
  fieldsFromDescription,
  Fields,
  update,
  successToast,
  open,
  onOpenChange,
  onUpdated
}: CommonEditProps & {
  title: string
  idPrefix: string
  description: TDescription
  fieldsFromDescription: (description: TDescription) => TState
  Fields: (props: {
    idPrefix: string
    mode: 'create' | 'edit'
    state: TState
    onChange: (next: TState) => void
  }) => React.JSX.Element
  update: (fields: TState) => Promise<Result<unknown>>
  successToast: string
}): React.JSX.Element {
  const [fields, setFields] = useState<TState>(() => fieldsFromDescription(description))

  useEffect(() => {
    if (open) setFields(fieldsFromDescription(description))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, description])

  return (
    <FormDialog
      title={title}
      open={open}
      onOpenChange={onOpenChange}
      submitLabel="Save"
      action={() => update(fields)}
      successToast={successToast}
      onSuccess={async () => {
        onOpenChange(false)
        await onUpdated()
      }}
    >
      <Fields idPrefix={idPrefix} mode="edit" state={fields} onChange={setFields} />
    </FormDialog>
  )
}

export function EditQueueDialog({
  profileId,
  queue,
  ...common
}: CommonEditProps & { profileId: string; queue: QueueDescription }): React.JSX.Element {
  return (
    <EditEntityDialog
      title={`Edit queue — ${queue.name}`}
      idPrefix="edit-queue"
      description={queue}
      fieldsFromDescription={queueFieldsFromDescription}
      Fields={QueueFields}
      update={(fields) =>
        window.sbAdmin.entities.queues.update(profileId, queue.name, toUpdateQueueInput(fields))
      }
      successToast={`Saved "${queue.name}"`}
      {...common}
    />
  )
}

export function EditTopicDialog({
  profileId,
  topic,
  ...common
}: CommonEditProps & { profileId: string; topic: TopicDescription }): React.JSX.Element {
  return (
    <EditEntityDialog
      title={`Edit topic — ${topic.name}`}
      idPrefix="edit-topic"
      description={topic}
      fieldsFromDescription={topicFieldsFromDescription}
      Fields={TopicFields}
      update={(fields) =>
        window.sbAdmin.entities.topics.update(profileId, topic.name, toUpdateTopicInput(fields))
      }
      successToast={`Saved "${topic.name}"`}
      {...common}
    />
  )
}

export function EditSubscriptionDialog({
  profileId,
  subscription,
  ...common
}: CommonEditProps & {
  profileId: string
  subscription: SubscriptionDescription
}): React.JSX.Element {
  return (
    <EditEntityDialog
      title={`Edit subscription — ${subscription.subscriptionName}`}
      idPrefix="edit-subscription"
      description={subscription}
      fieldsFromDescription={subscriptionFieldsFromDescription}
      Fields={SubscriptionFields}
      update={(fields) =>
        window.sbAdmin.entities.subscriptions.update(
          profileId,
          subscription.topicName,
          subscription.subscriptionName,
          toUpdateSubscriptionInput(fields)
        )
      }
      successToast={`Saved "${subscription.subscriptionName}"`}
      {...common}
    />
  )
}
