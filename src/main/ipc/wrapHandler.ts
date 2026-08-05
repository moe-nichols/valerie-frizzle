import { AppError, type Result } from '@shared/errors'
import type { IpcChannels } from '@shared/ipc-contract'
import { ipcRequestSchemas } from '@shared/ipc-schemas'
import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import log from 'electron-log/main'
import { ZodError, type ZodType } from 'zod'

/** Runs fn and converts a thrown error into a Result — handlers should never let a raw
 * Error cross the IPC boundary, since Electron serializes thrown Errors lossily. Every
 * IPC call in the app funnels through here (via registerHandler), so it's also the single
 * place that logs every real user-facing failure (validation/connection/CRUD/messaging/
 * purge/resubmit errors) — the only place that matters for a packaged build with no
 * attached terminal. */
export async function toResult<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    logRedacted(err)
    if (err instanceof ZodError) {
      return {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: `invalid request: ${formatZodError(err)}` }
      }
    }
    if (err instanceof AppError) {
      return { ok: false, error: { code: err.code, message: err.message } }
    }
    const message = err instanceof Error ? err.message : String(err)
    if (isEntityNotFoundError(err)) {
      return { ok: false, error: { code: 'NOT_FOUND', message } }
    }
    // AggregateError still maps to UNEXPECTED_ERROR (no renderer-visible differentiation is
    // needed yet, and IpcErrorCode is a closed, exhaustively-consumed union — see
    // shared/errors.ts), but its outer message is empty; fold in the inner detail so the
    // renderer surface and the log line are actually diagnosable.
    return {
      ok: false,
      error: { code: 'UNEXPECTED_ERROR', message: enrichAggregateMessage(err, message) }
    }
  }
}

/** SDK connection failures can embed the full connection string (endpoint + SAS key) in
 * their message; the key must not land in the on-disk log file even though it's an
 * emulator-only dev credential. */
function redactSecrets(text: string): string {
  return text.replace(/SharedAccessKey=[^;\s'"]+/gi, 'SharedAccessKey=<redacted>')
}

/** Expected failures must not spam the on-disk log at error level: NOT_CONNECTED is
 * routine whenever a background poll outlives a disconnect, and other domain errors
 * (validation, not-found, partial success) are user-facing outcomes, not app faults.
 * Only genuinely unexpected errors keep the error level. */
function logLevelFor(err: unknown): 'debug' | 'warn' | 'error' {
  if (err instanceof AppError) return err.code === 'NOT_CONNECTED' ? 'debug' : 'warn'
  if (err instanceof ZodError) return 'warn'
  return 'error'
}

function logRedacted(err: unknown): void {
  const level = logLevelFor(err)
  if (err instanceof Error) {
    log[level](`${err.name}: ${redactSecrets(err.message)}`, redactSecrets(err.stack ?? ''))
  } else {
    log[level](redactSecrets(String(err)))
  }
  // An AggregateError's own message/stack are empty — the real detail (and any embedded
  // connection string) lives in `.errors`. Log each inner error at the same level, still
  // redacted, so a retry-exhaustion failure is diagnosable instead of a blank line.
  const inner = aggregateInnerErrors(err)
  if (inner) {
    for (const innerError of inner) {
      const stack = innerError instanceof Error ? redactSecrets(innerError.stack ?? '') : ''
      log[level](`  ↳ ${describeInnerError(innerError)}`, stack)
    }
  }
}

/** AggregateError (and duck-typed lookalikes carrying an `errors` array — the SDK's retry
 * helper produces this shape when multiple attempts fail) hides its real detail in
 * `.errors`. Returns those inner errors when present, else undefined. */
function aggregateInnerErrors(err: unknown): unknown[] | undefined {
  if (typeof err !== 'object' || err === null) return undefined
  const { errors } = err as { errors?: unknown }
  return Array.isArray(errors) && errors.length > 0 ? errors : undefined
}

/** One redacted, single-line summary per inner error: `name [code]: message`. */
function describeInnerError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code
    const codePart = code != null ? ` [${String(code)}]` : ''
    return redactSecrets(`${err.name}${codePart}: ${err.message}`)
  }
  return redactSecrets(String(err))
}

/** Folds an AggregateError's inner detail into the (otherwise empty) outer message so the
 * renderer-facing message isn't blank. Non-aggregate errors pass through unchanged. */
function enrichAggregateMessage(err: unknown, message: string): string {
  const inner = aggregateInnerErrors(err)
  if (!inner) return message
  const details = inner.map(describeInnerError).join('; ')
  return message ? `${message} (${details})` : details
}

/** Recognizes the "it doesn't exist" error shapes without importing SDK classes: a
 * management RestError with HTTP 404 or a ServiceBusError coded MessagingEntityNotFound
 * (real Azure), plus the emulator's own variant — its management API answers a missing
 * entity with HTTP 200 and a RestError coded MessageEntityNotFoundError (pinned by
 * adminHttpsProxy.integration.test.ts). */
function isEntityNotFoundError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const { statusCode, code } = err as { statusCode?: unknown; code?: unknown }
  return (
    statusCode === 404 ||
    code === 'MessagingEntityNotFound' ||
    code === 'MessageEntityNotFoundError'
  )
}

function formatZodError(err: ZodError): string {
  return err.issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

/** What a handler must return for a given channel — the `T` inside its `Result<T>`
 * response. Handlers return the raw data; registerHandler wraps it in a Result (and turns
 * thrown errors into error Results) via toResult. */
type ResponseData<K extends keyof IpcChannels> =
  IpcChannels[K]['response'] extends Result<infer T> ? T : never

type ChannelHandler<K extends keyof IpcChannels> = (
  request: IpcChannels[K]['request'],
  event: IpcMainInvokeEvent
) => Promise<ResponseData<K>> | ResponseData<K>

/**
 * Registers an ipcMain handler for a channel with three guarantees baked in: the incoming
 * payload is validated against the channel's zod schema before the handler runs (a bad
 * payload becomes a VALIDATION_ERROR Result, never an SDK call); the handler's return
 * value / thrown error is funnelled through toResult, which preserves AppError codes and
 * maps SDK not-found shapes so the renderer can react to *what* failed; and every failure
 * is logged here (with connection-string secrets redacted) — the single logging choke
 * point for the app. Handlers therefore deal only in validated requests and plain return
 * values.
 */
export function registerHandler<K extends keyof IpcChannels>(
  channel: K,
  handler: ChannelHandler<K>
): void {
  const schema = ipcRequestSchemas[channel] as ZodType<IpcChannels[K]['request']>
  ipcMain.handle(channel, (event, rawRequest): Promise<IpcChannels[K]['response']> => {
    return toResult(() => {
      const request = schema.parse(rawRequest)
      return handler(request, event)
    }) as Promise<IpcChannels[K]['response']>
  })
}
