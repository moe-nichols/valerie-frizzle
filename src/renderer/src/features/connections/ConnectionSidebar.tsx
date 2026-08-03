import { ConfirmDialog, permanentRemovalDescription } from '@renderer/components/ConfirmDialog'
import { EmptyState } from '@renderer/components/EmptyState'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
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
import { EntityTree } from '@renderer/features/entities/EntityTree'
import { cn } from '@renderer/lib/utils'
import {
  deleteProfile,
  disconnectProfile,
  fetchProfiles,
  profileSelected,
  selectProfile
} from '@renderer/store/connectionsSlice'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import { Loader2, MoreHorizontal, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AddConnectionDialog } from './AddConnectionDialog'

export function ConnectionSidebar(): React.JSX.Element {
  const dispatch = useAppDispatch()
  const profiles = useAppSelector((state) => state.connections.profiles)
  const connectedIds = useAppSelector((state) => state.connections.connectedIds)
  const connectingIds = useAppSelector((state) => state.connections.connectingIds)
  const selectedProfileId = useAppSelector((state) => state.connections.selectedProfileId)

  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load(): Promise<void> {
      const result = await dispatch(fetchProfiles())
      if (fetchProfiles.rejected.match(result)) {
        setError(result.payload ?? 'Failed to load connection profiles')
      }
    }
    load()
  }, [dispatch])

  async function handleSelect(id: string): Promise<void> {
    if (connectedIds.includes(id)) {
      dispatch(profileSelected(id))
      return
    }
    if (connectingIds.includes(id)) return

    setError(null)
    const result = await dispatch(selectProfile(id))
    if (selectProfile.rejected.match(result)) {
      setError(result.payload ?? 'Failed to connect')
    }
  }

  async function handleDisconnect(id: string): Promise<void> {
    setError(null)
    const result = await dispatch(disconnectProfile(id))
    if (disconnectProfile.rejected.match(result)) {
      setError(result.payload ?? 'Failed to disconnect')
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    const id = deletingProfileId
    if (!id) return
    const name = deletingProfile?.name
    setDeletingProfileId(null)
    setError(null)

    const result = await dispatch(deleteProfile(id))
    if (deleteProfile.rejected.match(result)) {
      setError(result.payload ?? 'Failed to delete')
    } else {
      toast.success(`Deleted profile "${name}"`)
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
            <EmptyState message="No saved profiles yet." className="px-2" />
          )}
          <SidebarMenu>
            {profiles.map((profile) => {
              const isConnected = connectedIds.includes(profile.id)
              const isConnecting = connectingIds.includes(profile.id)
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
                  {profile.id === selectedProfileId && <EntityTree profileId={profile.id} />}
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <AddConnectionDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />

      <ConfirmDialog
        open={deletingProfileId !== null}
        onOpenChange={(nextOpen) => !nextOpen && setDeletingProfileId(null)}
        title="Delete connection profile?"
        description={permanentRemovalDescription(deletingProfile?.name ?? '')}
        onConfirm={handleConfirmDelete}
      />
    </>
  )
}
