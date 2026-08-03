import { useState, type FormEvent } from 'react'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'

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
  const [error, setError] = useState<string | null>(null)

  function resetForm(): void {
    setName('')
    setError(null)
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const response = await window.sbAdmin.entities.topics.create(profileId, { name })
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add topic</DialogTitle>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-topic-name">Name</Label>
            <Input
              id="new-topic-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit">Add topic</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
