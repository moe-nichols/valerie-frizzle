import { useEffect, useState } from 'react'
import { Loader2, MoreHorizontal, Plus } from 'lucide-react'
import type { ConnectionProfile } from '@shared/domain'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { buttonVariants } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem
} from '@renderer/components/ui/sidebar'
import { AddConnectionDialog } from './AddConnectionDialog'

interface ConnectionSidebarProps {
  selectedProfileId: string | null
  onSelectedProfileChange: (profileId: string | null) => void
}

function removeFromSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  next.delete(id)
  return next
}

export function ConnectionSidebar({
  selectedProfileId,
  onSelectedProfileChange
}: ConnectionSidebarProps): React.JSX.Element {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set())
  const [connectingIds, setConnectingIds] = useState<Set<string>>(new Set())
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    const response = await window.sbAdmin.connections.list()
    if (response.ok) {
      setProfiles(response.data)
    } else {
      setError(response.error.message)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleSelect(id: string): Promise<void> {
    if (connectedIds.has(id)) {
      onSelectedProfileChange(id)
      return
    }
    if (connectingIds.has(id)) return

    setError(null)
    setConnectingIds((prev) => new Set(prev).add(id))
    const response = await window.sbAdmin.connections.connect(id)
    setConnectingIds((prev) => removeFromSet(prev, id))

    if (response.ok) {
      setConnectedIds((prev) => new Set(prev).add(id))
      onSelectedProfileChange(id)
    } else {
      setError(response.error.message)
    }
  }

  async function handleDisconnect(id: string): Promise<void> {
    const response = await window.sbAdmin.connections.disconnect(id)
    if (response.ok) {
      setConnectedIds((prev) => removeFromSet(prev, id))
      if (selectedProfileId === id) {
        onSelectedProfileChange(null)
      }
    } else {
      setError(response.error.message)
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    const id = deletingProfileId
    if (!id) return
    setDeletingProfileId(null)

    if (connectedIds.has(id)) {
      await window.sbAdmin.connections.disconnect(id)
      setConnectedIds((prev) => removeFromSet(prev, id))
    }

    const response = await window.sbAdmin.connections.delete(id)
    if (response.ok) {
      if (selectedProfileId === id) {
        onSelectedProfileChange(null)
      }
      await refresh()
    } else {
      setError(response.error.message)
    }
  }

  const deletingProfile = profiles.find((profile) => profile.id === deletingProfileId) ?? null

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Connections</SidebarGroupLabel>
        <SidebarGroupAction title="Add connection" onClick={() => setAddDialogOpen(true)}>
          <Plus />
          <span className="sr-only">Add connection</span>
        </SidebarGroupAction>
        <SidebarGroupContent>
          {error && (
            <Alert variant="destructive" className="mb-2">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {profiles.length === 0 && (
            <p className="text-muted-foreground px-2 text-sm">No saved profiles yet.</p>
          )}
          <SidebarMenu>
            {profiles.map((profile) => {
              const isConnected = connectedIds.has(profile.id)
              const isConnecting = connectingIds.has(profile.id)
              return (
                <SidebarMenuItem key={profile.id}>
                  <SidebarMenuButton
                    isActive={selectedProfileId === profile.id}
                    tooltip={profile.name}
                    onClick={() => handleSelect(profile.id)}
                  >
                    {isConnecting ? (
                      <Loader2 className="size-4 shrink-0 animate-spin" />
                    ) : (
                      <span
                        className={cn(
                          'size-2 shrink-0 rounded-full',
                          isConnected ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                        )}
                      />
                    )}
                    <span>{profile.name}</span>
                  </SidebarMenuButton>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuAction showOnHover>
                        <MoreHorizontal />
                        <span className="sr-only">More</span>
                      </SidebarMenuAction>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start">
                      {isConnected && (
                        <DropdownMenuItem onClick={() => handleDisconnect(profile.id)}>
                          Disconnect
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeletingProfileId(profile.id)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <AddConnectionDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onCreated={refresh}
      />

      <AlertDialog
        open={deletingProfileId !== null}
        onOpenChange={(nextOpen) => !nextOpen && setDeletingProfileId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete connection profile?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove &quot;{deletingProfile?.name}&quot;. This can&apos;t be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className={buttonVariants({ variant: 'destructive' })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
