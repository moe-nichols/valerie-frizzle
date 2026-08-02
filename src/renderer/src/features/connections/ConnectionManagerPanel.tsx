import { useEffect, useState, type FormEvent } from 'react'
import type { ConnectionProfile } from '@shared/domain'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'

interface ConnectionManagerPanelProps {
  onActiveProfileChange: (profileId: string | null) => void
}

export function ConnectionManagerPanel({
  onActiveProfileChange
}: ConnectionManagerPanelProps): React.JSX.Element {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [connectionString, setConnectionString] = useState('')
  const [managementPort, setManagementPort] = useState('5300')

  async function refresh(): Promise<void> {
    const response = await window.sbAdmin.connections.list()
    if (response.ok) {
      setProfiles(response.data)
      setError(null)
    } else {
      setError(response.error.message)
    }
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault()
    const response = await window.sbAdmin.connections.create({
      name,
      connectionString,
      managementPort: Number(managementPort)
    })
    if (response.ok) {
      setName('')
      setConnectionString('')
      setManagementPort('5300')
      await refresh()
    } else {
      setError(response.error.message)
    }
  }

  async function handleDelete(id: string): Promise<void> {
    const response = await window.sbAdmin.connections.delete(id)
    if (response.ok) {
      setConnectedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      onActiveProfileChange(null)
      await refresh()
    } else {
      setError(response.error.message)
    }
  }

  async function handleToggleConnect(id: string): Promise<void> {
    const isConnected = connectedIds.has(id)
    const response = isConnected
      ? await window.sbAdmin.connections.disconnect(id)
      : await window.sbAdmin.connections.connect(id)
    if (response.ok) {
      setConnectedIds((prev) => {
        const next = new Set(prev)
        if (isConnected) {
          next.delete(id)
        } else {
          next.add(id)
        }
        return next
      })
      onActiveProfileChange(isConnected ? null : id)
      setError(null)
    } else {
      setError(response.error.message)
    }
  }

  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading connection profiles…</p>
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Connection profiles</h2>
        {profiles.length === 0 && <p className="text-muted-foreground text-sm">No saved profiles yet.</p>}
        <ul className="space-y-2">
          {profiles.map((profile) => (
            <li
              key={profile.id}
              className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
            >
              <span className="font-medium">{profile.name}</span>
              <span className="text-muted-foreground text-sm">
                {profile.connectionString.slice(0, 40)}
                {profile.connectionString.length > 40 ? '…' : ''} (mgmt port{' '}
                {profile.managementPort})
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => handleToggleConnect(profile.id)}>
                  {connectedIds.has(profile.id) ? 'Disconnect' : 'Connect'}
                </Button>
                <Badge data-testid="connection-status" variant={connectedIds.has(profile.id) ? 'default' : 'secondary'}>
                  {connectedIds.has(profile.id) ? 'connected' : 'disconnected'}
                </Badge>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(profile.id)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Add profile</h2>
        <form onSubmit={handleCreate} className="max-w-md space-y-3">
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
          <Button type="submit">Add profile</Button>
        </form>
      </div>
    </div>
  )
}
