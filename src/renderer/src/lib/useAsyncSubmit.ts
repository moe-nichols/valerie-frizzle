import type { Result } from '@shared/errors'
import { type FormEvent, useRef, useState } from 'react'

/**
 * Shared submit state for the app's IPC-backed forms: ignores re-entrant submits while a
 * request is in flight (every dialog was double-submittable before this), surfaces a
 * failed Result's message as the form error, and clears it again on success or reset.
 * Field state stays with the form (the entityForms FieldsState pattern) — this owns only
 * the submission lifecycle.
 */
export function useAsyncSubmit(
  action: () => Promise<Result<unknown>>,
  onSuccess?: () => void | Promise<void>
): {
  submit: (event?: FormEvent) => Promise<void>
  submitting: boolean
  error: string | null
  setError: (error: string | null) => void
  reset: () => void
} {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // State updates are async, so a ref does the re-entry guard synchronously.
  const inFlight = useRef(false)

  async function submit(event?: FormEvent): Promise<void> {
    event?.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    try {
      const response = await action()
      if (response.ok) {
        setError(null)
        await onSuccess?.()
      } else {
        setError(response.error.message)
      }
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  function reset(): void {
    setError(null)
  }

  return { submit, submitting, error, setError, reset }
}
