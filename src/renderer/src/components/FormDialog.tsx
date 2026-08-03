import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { useAsyncSubmit } from '@renderer/lib/useAsyncSubmit'
import type { Result } from '@shared/errors'
import { useEffect } from 'react'

interface FormDialogProps {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  submitLabel: string
  /** The IPC call. A failed Result's message renders as the dialog's error alert. */
  action: () => Promise<Result<unknown>>
  /** Runs after a successful submit — closing the dialog and refreshing belong here. */
  onSuccess?: () => void | Promise<void>
  children: React.ReactNode
}

/** The one dialog shell for IPC-backed forms: title, error alert, double-submit guard,
 * and a submit button that disables while the request is in flight. Field state stays
 * with the caller (the entityForms FieldsState pattern). */
export function FormDialog({
  title,
  open,
  onOpenChange,
  submitLabel,
  action,
  onSuccess,
  children
}: FormDialogProps): React.JSX.Element {
  const { submit, submitting, error, reset } = useAsyncSubmit(action, onSuccess)

  // A stale error from a prior attempt must not greet the next open.
  useEffect(() => {
    if (open) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form onSubmit={submit} className="space-y-3">
          {children}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
