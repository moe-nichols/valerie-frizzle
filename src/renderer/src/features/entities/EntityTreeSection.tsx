import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import {
  SidebarGroupLabel,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem
} from '@renderer/components/ui/sidebar'
import { MoreHorizontal, Plus, RefreshCw } from 'lucide-react'

interface EntityTreeSectionProps<T extends { name: string }> {
  label: string
  addLabel: string
  entities: T[]
  loaded: boolean
  emptyText: string
  activeName: string | null
  onSelect: (entity: T) => void
  onRefresh: () => void
  onAdd: () => void
  onEdit: (entity: T) => void
  onDelete: (entity: T) => void
  /** Rendered between the entity name and its actions menu (e.g. count badges). */
  renderBadges?: (entity: T) => React.ReactNode
}

/** One sidebar section of the entity tree — the Queues and Topics lists are this same
 * header/refresh/add/empty/rows structure differing only in data and handlers. */
export function EntityTreeSection<T extends { name: string }>({
  label,
  addLabel,
  entities,
  loaded,
  emptyText,
  activeName,
  onSelect,
  onRefresh,
  onAdd,
  onEdit,
  onDelete,
  renderBadges
}: EntityTreeSectionProps<T>): React.JSX.Element {
  return (
    <SidebarMenuSub className="border-l-0 px-0">
      <div className="flex items-center justify-between px-2">
        <SidebarGroupLabel className="p-0">{label}</SidebarGroupLabel>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            title="Refresh now"
            onClick={onRefresh}
          >
            <RefreshCw />
            <span className="sr-only">Refresh now</span>
          </Button>
          <Button variant="ghost" size="icon" className="size-5" title={addLabel} onClick={onAdd}>
            <Plus />
            <span className="sr-only">{addLabel}</span>
          </Button>
        </div>
      </div>
      {entities.length === 0 && (
        <p className="text-muted-foreground px-2 text-xs">{loaded ? emptyText : 'Loading…'}</p>
      )}
      {entities.map((entity) => (
        <SidebarMenuSubItem key={entity.name} className="flex items-center gap-1">
          <SidebarMenuSubButton asChild isActive={activeName === entity.name} className="flex-1">
            <button type="button" onClick={() => onSelect(entity)}>
              <span className="truncate">{entity.name}</span>
            </button>
          </SidebarMenuSubButton>
          {renderBadges?.(entity)}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-5 shrink-0">
                <MoreHorizontal />
                <span className="sr-only">More</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start">
              <DropdownMenuItem onClick={() => onEdit(entity)}>Edit</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(entity)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  )
}
