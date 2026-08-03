import { useState, type FormEvent } from 'react'
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
import { emptyQueueFields, QueueFields, toCreateQueueInput } from './entityForms'

interface CreateQueueDialogProps {
  profileId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void | Promise<void>
}

export function CreateQueueDialog({
  profileId,
  open,
  onOpenChange,
  onCreated
}: CreateQueueDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [fields, setFields] = useState(emptyQueueFields)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetForm(): void {
    setName('')
    setFields(emptyQueueFields)
    setAdvancedOpen(false)
    setError(null)
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const response = await window.sbAdmin.entities.queues.create(
      profileId,
      toCreateQueueInput(name, fields)
    )
    if (response.ok) {
      resetForm()
      onOpenChange(false)
      await onCreated()
    } else {
      setError(response.error.message)
    }
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
          <DialogTitle>Add queue</DialogTitle>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-queue-name">Name</Label>
            <Input
              id="new-queue-name"
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
              <QueueFields idPrefix="new-queue" mode="create" state={fields} onChange={setFields} />
            </CollapsibleContent>
          </Collapsible>

          <DialogFooter>
            <Button type="submit">Add queue</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
