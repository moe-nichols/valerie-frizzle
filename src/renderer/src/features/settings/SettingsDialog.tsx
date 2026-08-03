import { useEffect, useState, type FormEvent } from 'react'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { updatePollInterval } from '@renderer/store/settingsSlice'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): React.JSX.Element {
  const dispatch = useAppDispatch()
  const pollIntervalMs = useAppSelector((state) => state.settings.pollIntervalMs)
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Resync the field from the store whenever the dialog opens, so it reflects the current
  // persisted value rather than whatever was left over from a prior open/edit.
  useEffect(() => {
    if (open && pollIntervalMs !== null) {
      setPollIntervalSeconds(String(pollIntervalMs / 1000))
      setError(null)
    }
  }, [open, pollIntervalMs])

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const seconds = Number(pollIntervalSeconds)
    if (!Number.isFinite(seconds) || seconds <= 0) {
      setError('Enter a positive number of seconds.')
      return
    }
    const result = await dispatch(updatePollInterval(Math.round(seconds * 1000)))
    if (updatePollInterval.rejected.match(result)) {
      setError(result.payload ?? 'Failed to save settings')
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            How often the app polls the emulator for queue/topic changes and message counts.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="poll-interval-seconds">Poll interval (seconds)</Label>
            <Input
              id="poll-interval-seconds"
              type="number"
              min="2"
              max="300"
              step="1"
              value={pollIntervalSeconds}
              onChange={(event) => setPollIntervalSeconds(event.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
