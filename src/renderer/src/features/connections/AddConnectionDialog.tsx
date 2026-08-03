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
import { createProfile } from '@renderer/store/connectionsSlice'
import { useAppDispatch } from '@renderer/store/hooks'
import { type FormEvent, useState } from 'react'

interface AddConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddConnectionDialog({
  open,
  onOpenChange
}: AddConnectionDialogProps): React.JSX.Element {
  const dispatch = useAppDispatch()
  const [name, setName] = useState('')
  const [connectionString, setConnectionString] = useState('')
  const [managementPort, setManagementPort] = useState('5300')
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'ok' | null>(null)

  function resetForm(): void {
    setName('')
    setConnectionString('')
    setManagementPort('5300')
    setError(null)
    setTesting(false)
    setTestResult(null)
  }

  async function handleTest(): Promise<void> {
    setTesting(true)
    setError(null)
    setTestResult(null)
    const response = await window.sbAdmin.connections.test({
      connectionString,
      managementPort: Number(managementPort)
    })
    setTesting(false)
    if (response.ok) {
      setTestResult('ok')
    } else {
      setError(response.error.message)
    }
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const result = await dispatch(
      createProfile({ name, connectionString, managementPort: Number(managementPort) })
    )
    if (createProfile.rejected.match(result)) {
      setError(result.payload ?? 'Failed to create profile')
      return
    }
    resetForm()
    onOpenChange(false)
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
          <DialogTitle>Add connection profile</DialogTitle>
          <DialogDescription>
            Connect to a locally-running Azure Service Bus emulator instance.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {testResult === 'ok' && (
          <Alert>
            <AlertDescription>Connection succeeded.</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="connection-name">Name</Label>
            <Input
              id="connection-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="connection-string">Connection string</Label>
            <Input
              id="connection-string"
              value={connectionString}
              onChange={(event) => setConnectionString(event.target.value)}
              placeholder="Endpoint=sb://localhost;SharedAccessKeyName=...;UseDevelopmentEmulator=true;"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="management-port">Management port</Label>
            <Input
              id="management-port"
              type="number"
              value={managementPort}
              onChange={(event) => setManagementPort(event.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={testing || !connectionString || !managementPort}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
            <Button type="submit">Add profile</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
