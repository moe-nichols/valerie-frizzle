import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { RefreshCw } from 'lucide-react'

/** The refresh button + "Updated {time}" pair rendered in each detail panel's title. */
export function PanelRefreshControls({
  onRefresh,
  lastRefreshed
}: {
  onRefresh: () => void
  lastRefreshed: Date | null
}): React.JSX.Element {
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" onClick={onRefresh}>
            <RefreshCw />
            <span className="sr-only">Refresh now</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Refresh now</TooltipContent>
      </Tooltip>
      {lastRefreshed && (
        <span className="text-muted-foreground text-xs font-normal">
          Updated {lastRefreshed.toLocaleTimeString()}
        </span>
      )}
    </>
  )
}
