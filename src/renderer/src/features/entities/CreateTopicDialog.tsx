import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { useAsyncSubmit } from '@renderer/lib/useAsyncSubmit'
import { useState } from 'react'
import { emptyTopicFields, TopicFields, toCreateTopicInput } from './entityForms'

interface CreateTopicDialogProps {
  profileId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void | Promise<void>
}

export function CreateTopicDialog({
  profileId,
  open,
  onOpenChange,
  onCreated
}: CreateTopicDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [fields, setFields] = useState(emptyTopicFields)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const { submit, submitting, error, reset } = useAsyncSubmit(
    () => window.sbAdmin.entities.topics.create(profileId, toCreateTopicInput(name, fields)),
    async () => {
      resetForm()
      onOpenChange(false)
      await onCreated()
    }
  )

  function resetForm(): void {
    setName('')
    setFields(emptyTopicFields)
    setAdvancedOpen(false)
    reset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetForm()
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add topic</DialogTitle>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-topic-name">Name</Label>
            <Input
              id="new-topic-name"
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
              <TopicFields idPrefix="new-topic" mode="create" state={fields} onChange={setFields} />
            </CollapsibleContent>
          </Collapsible>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              Add topic
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
