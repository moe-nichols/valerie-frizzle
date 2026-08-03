import { cn } from '@renderer/lib/utils'

/** The muted one-liner shown when a list or panel has nothing to display. */
export function EmptyState({
  message,
  className
}: {
  message: string
  className?: string
}): React.JSX.Element {
  return <p className={cn('text-muted-foreground text-sm', className)}>{message}</p>
}
