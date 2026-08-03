import { FormDialog } from '@renderer/components/FormDialog'
import { Button } from '@renderer/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import type { Result } from '@shared/errors'
import { useState } from 'react'
import {
  emptyQueueFields,
  emptyTopicFields,
  QueueFields,
  type QueueFieldsState,
  TopicFields,
  type TopicFieldsState,
  toCreateQueueInput,
  toCreateTopicInput
} from './entityForms'

interface CreateEntityDialogProps {
  profileId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void | Promise<void>
}

/** Everything that differs between the add-queue and add-topic dialogs. */
interface EntityFormConfig<TState> {
  title: string
  idPrefix: string
  emptyFields: TState
  Fields: (props: {
    idPrefix: string
    mode: 'create' | 'edit'
    state: TState
    onChange: (next: TState) => void
  }) => React.JSX.Element
  create: (profileId: string, name: string, fields: TState) => Promise<Result<unknown>>
}

/** One parameterized add-queue/add-topic dialog: a required name plus the entity's shared
 * field group behind an "Advanced…" disclosure, submitted through FormDialog. */
function CreateEntityDialog<TState>({
  config,
  profileId,
  open,
  onOpenChange,
  onCreated
}: CreateEntityDialogProps & { config: EntityFormConfig<TState> }): React.JSX.Element {
  const [name, setName] = useState('')
  const [fields, setFields] = useState<TState>(config.emptyFields)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  function resetForm(): void {
    setName('')
    setFields(config.emptyFields)
    setAdvancedOpen(false)
  }

  return (
    <FormDialog
      title={config.title}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetForm()
        onOpenChange(nextOpen)
      }}
      submitLabel={config.title}
      action={() => config.create(profileId, name, fields)}
      onSuccess={async () => {
        resetForm()
        onOpenChange(false)
        await onCreated()
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${config.idPrefix}-name`}>Name</Label>
        <Input
          id={`${config.idPrefix}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm">
            {advancedOpen ? 'Hide advanced' : 'Advanced…'}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <config.Fields
            idPrefix={config.idPrefix}
            mode="create"
            state={fields}
            onChange={setFields}
          />
        </CollapsibleContent>
      </Collapsible>
    </FormDialog>
  )
}

const queueConfig: EntityFormConfig<QueueFieldsState> = {
  title: 'Add queue',
  idPrefix: 'new-queue',
  emptyFields: emptyQueueFields,
  Fields: QueueFields,
  create: (profileId, name, fields) =>
    window.sbAdmin.entities.queues.create(profileId, toCreateQueueInput(name, fields))
}

const topicConfig: EntityFormConfig<TopicFieldsState> = {
  title: 'Add topic',
  idPrefix: 'new-topic',
  emptyFields: emptyTopicFields,
  Fields: TopicFields,
  create: (profileId, name, fields) =>
    window.sbAdmin.entities.topics.create(profileId, toCreateTopicInput(name, fields))
}

export function CreateQueueDialog(props: CreateEntityDialogProps): React.JSX.Element {
  return <CreateEntityDialog config={queueConfig} {...props} />
}

export function CreateTopicDialog(props: CreateEntityDialogProps): React.JSX.Element {
  return <CreateEntityDialog config={topicConfig} {...props} />
}
