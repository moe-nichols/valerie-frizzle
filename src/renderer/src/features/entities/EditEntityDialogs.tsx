import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { useAsyncSubmit } from '@renderer/lib/useAsyncSubmit'
import type { QueueDescription, SubscriptionDescription, TopicDescription } from '@shared/domain'
import { type FormEvent, useEffect, useState } from 'react'
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
 * Edit dialogs wire the `entities.*.update` IPC channels — which existed but had no UI —
 * to the shared field groups from `entityForms`. Each resyncs its form from the current
 * entity description whenever it opens, so it reflects the persisted values rather than a
 * stale prior edit (same pattern as SettingsDialog).
 */

interface DialogShellProps {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  error: string | null
  submitting: boolean
  onSubmit: (event: FormEvent) => void
  children: React.ReactNode
}

function EditDialogShell({
  title,
  open,
  onOpenChange,
  error,
  submitting,
  onSubmit,
  children
}: DialogShellProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form onSubmit={onSubmit} className="space-y-3">
          {children}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EditQueueDialog({
  profileId,
  queue,
  open,
  onOpenChange,
  onUpdated
}: {
  profileId: string
  queue: QueueDescription
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: () => void | Promise<void>
}): React.JSX.Element {
  const [fields, setFields] = useState(() => queueFieldsFromDescription(queue))
  const { submit, submitting, error, reset } = useAsyncSubmit(
    () => window.sbAdmin.entities.queues.update(profileId, queue.name, toUpdateQueueInput(fields)),
    async () => {
      onOpenChange(false)
      await onUpdated()
    }
  )

  useEffect(() => {
    if (open) {
      setFields(queueFieldsFromDescription(queue))
      reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, queue])

  return (
    <EditDialogShell
      title={`Edit queue — ${queue.name}`}
      open={open}
      onOpenChange={onOpenChange}
      error={error}
      submitting={submitting}
      onSubmit={submit}
    >
      <QueueFields idPrefix="edit-queue" mode="edit" state={fields} onChange={setFields} />
    </EditDialogShell>
  )
}

export function EditTopicDialog({
  profileId,
  topic,
  open,
  onOpenChange,
  onUpdated
}: {
  profileId: string
  topic: TopicDescription
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: () => void | Promise<void>
}): React.JSX.Element {
  const [fields, setFields] = useState(() => topicFieldsFromDescription(topic))
  const { submit, submitting, error, reset } = useAsyncSubmit(
    () => window.sbAdmin.entities.topics.update(profileId, topic.name, toUpdateTopicInput(fields)),
    async () => {
      onOpenChange(false)
      await onUpdated()
    }
  )

  useEffect(() => {
    if (open) {
      setFields(topicFieldsFromDescription(topic))
      reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, topic])

  return (
    <EditDialogShell
      title={`Edit topic — ${topic.name}`}
      open={open}
      onOpenChange={onOpenChange}
      error={error}
      submitting={submitting}
      onSubmit={submit}
    >
      <TopicFields idPrefix="edit-topic" mode="edit" state={fields} onChange={setFields} />
    </EditDialogShell>
  )
}

export function EditSubscriptionDialog({
  profileId,
  subscription,
  open,
  onOpenChange,
  onUpdated
}: {
  profileId: string
  subscription: SubscriptionDescription
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: () => void | Promise<void>
}): React.JSX.Element {
  const [fields, setFields] = useState(() => subscriptionFieldsFromDescription(subscription))
  const { submit, submitting, error, reset } = useAsyncSubmit(
    () =>
      window.sbAdmin.entities.subscriptions.update(
        profileId,
        subscription.topicName,
        subscription.subscriptionName,
        toUpdateSubscriptionInput(fields)
      ),
    async () => {
      onOpenChange(false)
      await onUpdated()
    }
  )

  useEffect(() => {
    if (open) {
      setFields(subscriptionFieldsFromDescription(subscription))
      reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subscription])

  return (
    <EditDialogShell
      title={`Edit subscription — ${subscription.subscriptionName}`}
      open={open}
      onOpenChange={onOpenChange}
      error={error}
      submitting={submitting}
      onSubmit={submit}
    >
      <SubscriptionFields
        idPrefix="edit-subscription"
        mode="edit"
        state={fields}
        onChange={setFields}
      />
    </EditDialogShell>
  )
}
