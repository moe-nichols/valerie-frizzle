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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import { updatePollInterval, updateTheme } from '@renderer/store/settingsSlice'
import { MAX_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS } from '@shared/pollInterval'
import { type FormEvent, useEffect, useState } from 'react'

const MIN_SECONDS = MIN_POLL_INTERVAL_MS / 1000
const MAX_SECONDS = MAX_POLL_INTERVAL_MS / 1000

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): React.JSX.Element {
  const dispatch = useAppDispatch()
  const pollIntervalMs = useAppSelector((state) => state.settings.pollIntervalMs)
  const theme = useAppSelector((state) => state.settings.theme)
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
    if (!Number.isFinite(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
      setError(`Enter between ${MIN_SECONDS} and ${MAX_SECONDS} seconds.`)
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
              min={MIN_SECONDS}
              max={MAX_SECONDS}
              step="1"
              value={pollIntervalSeconds}
              onChange={(event) => setPollIntervalSeconds(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Theme</Label>
            {/* Applied immediately on selection (persisted + reflected on <html>), so it's
                not gated behind the poll-interval Save button. */}
            <Select
              value={theme ?? 'dark'}
              onValueChange={(value) => dispatch(updateTheme(value as 'light' | 'dark'))}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="light">Light</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
