export type IpcErrorCode =
  // The request payload failed schema validation before reaching a handler.
  | 'VALIDATION_ERROR'
  // The profile has no active connection — connect (or reconnect) first.
  | 'NOT_CONNECTED'
  // The addressed thing (profile, queue, topic, subscription, rule) does not exist.
  | 'NOT_FOUND'
  // The operation partly succeeded and blind retry would be harmful — e.g. a resubmit
  // whose send landed but whose DLQ-side complete failed; resubmitting again duplicates.
  | 'PARTIAL_SUCCESS'
  | 'UNEXPECTED_ERROR'

export interface IpcError {
  code: IpcErrorCode
  message: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: IpcError }

/**
 * A domain error whose code survives the IPC boundary: toResult maps it to an IpcError
 * with the same code, so the renderer can react to *what* failed (show a reconnect
 * prompt, warn against retrying a partial success) instead of pattern-matching message
 * strings. Throw one anywhere a failure is meaningful to the UI; plain Errors still cross
 * as UNEXPECTED_ERROR.
 */
export class AppError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}
