import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AppError, type Result } from '../../src/shared/errors'

const mocks = vi.hoisted(() => ({
  handle: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle }
}))

vi.mock('electron-log/main', async () =>
  (await import('./helpers/electronLogMock')).electronLogModule()
)

import { registerHandler, toResult } from '../../src/main/ipc/wrapHandler'
import { electronLog } from './helpers/electronLogMock'

describe('toResult', () => {
  beforeEach(() => {
    electronLog.error.mockClear()
    electronLog.warn.mockClear()
    electronLog.debug.mockClear()
  })

  test('wraps a successful return value', async () => {
    await expect(toResult(() => 42)).resolves.toEqual({ ok: true, data: 42 })
  })

  test('maps an AppError to its own code', async () => {
    const result = await toResult(() => {
      throw new AppError('NOT_CONNECTED', 'profile is not connected: p1')
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_CONNECTED', message: 'profile is not connected: p1' }
    })
  })

  test('maps an SDK 404 RestError shape to NOT_FOUND', async () => {
    const restError = Object.assign(new Error('Entity does not exist'), { statusCode: 404 })
    const result = await toResult(() => {
      throw restError
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  test('maps a ServiceBusError MessagingEntityNotFound to NOT_FOUND', async () => {
    const sbError = Object.assign(new Error('entity gone'), { code: 'MessagingEntityNotFound' })
    const result = await toResult(() => {
      throw sbError
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  test("maps the emulator's MessageEntityNotFoundError RestError to NOT_FOUND", async () => {
    // The emulator answers a missing entity with HTTP 200 and this code (confirmed by
    // adminHttpsProxy.integration.test.ts) — neither of the real-Azure shapes.
    const emulatorError = Object.assign(new Error('The messaging entity "x" could not be found'), {
      code: 'MessageEntityNotFoundError',
      statusCode: 200
    })
    const result = await toResult(() => {
      throw emulatorError
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  test('maps any other thrown error to UNEXPECTED_ERROR and logs it at error level', async () => {
    const result = await toResult(() => {
      throw new Error('boom')
    })
    expect(result).toEqual({ ok: false, error: { code: 'UNEXPECTED_ERROR', message: 'boom' } })
    expect(electronLog.error).toHaveBeenCalled()
  })

  test('logs NOT_CONNECTED at debug, not error — it is routine during background polling', async () => {
    await toResult(() => {
      throw new AppError('NOT_CONNECTED', 'profile is not connected: p1')
    })
    expect(electronLog.debug).toHaveBeenCalled()
    expect(electronLog.warn).not.toHaveBeenCalled()
    expect(electronLog.error).not.toHaveBeenCalled()
  })

  test('logs other domain errors at warn — expected failures, not app faults', async () => {
    await toResult(() => {
      throw new AppError('NOT_FOUND', 'queue gone')
    })
    expect(electronLog.warn).toHaveBeenCalled()
    expect(electronLog.error).not.toHaveBeenCalled()
  })

  test('unwraps an AggregateError so its inner detail reaches the message and the log', async () => {
    // An AggregateError's own message/stack are empty — the real detail lives in `.errors`,
    // which today's log silently drops. It still maps to UNEXPECTED_ERROR, but the message
    // must now carry the unwrapped inner detail.
    const inner1 = Object.assign(new Error('link detached'), { code: 'ServiceCommunicationError' })
    const inner2 = new Error('socket hang up')
    const result = await toResult(() => {
      throw new AggregateError([inner1, inner2])
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } })
    if (result.ok) throw new Error('expected an error result')
    expect(result.error.message).toContain('ServiceCommunicationError')
    expect(result.error.message).toContain('link detached')
    expect(result.error.message).toContain('socket hang up')
    // The outer message is empty, so without unwrapping the log line would be blank.
    expect(electronLog.error).toHaveBeenCalled()
    const logged = electronLog.error.mock.calls.flat().join(' ')
    expect(logged).toContain('ServiceCommunicationError')
  })

  test('redacts a connection-string secret nested inside an AggregateError inner error', async () => {
    const inner = new Error('connect failed: Endpoint=sb://localhost;SharedAccessKey=supersecret;')
    await toResult(() => {
      throw new AggregateError([inner])
    })

    const logged = electronLog.error.mock.calls.flat().join(' ')
    expect(logged).toContain('SharedAccessKey=<redacted>')
    expect(logged).not.toContain('supersecret')
  })

  test('maps a thrown non-Error to UNEXPECTED_ERROR with its string form', async () => {
    const result = await toResult(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'string failure'
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'UNEXPECTED_ERROR', message: 'string failure' }
    })
  })
})

describe('registerHandler', () => {
  beforeEach(() => {
    mocks.handle.mockClear()
  })

  /** Registers on the given channel and returns the raw ipcMain handler for direct invocation. */
  function register<T>(
    channel: Parameters<typeof registerHandler>[0],
    handler: (request: never) => T
  ): (event: unknown, rawRequest: unknown) => Promise<Result<T>> {
    registerHandler(channel, handler as never)
    expect(mocks.handle).toHaveBeenCalledWith(channel, expect.any(Function))
    return mocks.handle.mock.calls[0][1]
  }

  test('validates the payload against the channel schema before the handler runs', async () => {
    const handler = vi.fn(() => 10_000)
    const invoke = register('preferences:pollInterval:set', handler)

    const result = await invoke({} as IpcMainInvokeEvent, { pollIntervalMs: 'not-a-number' })

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    expect(handler).not.toHaveBeenCalled()
  })

  test("passes a valid payload through and wraps the handler's return in a Result", async () => {
    const invoke = register(
      'preferences:pollInterval:set',
      (request: { pollIntervalMs: number }) => request.pollIntervalMs
    )

    const result = await invoke({} as IpcMainInvokeEvent, { pollIntervalMs: 10_000 })

    expect(result).toEqual({ ok: true, data: 10_000 })
  })

  test('strips unknown keys so only the declared shape reaches the handler', async () => {
    const handler = vi.fn((request: { pollIntervalMs: number }) => request.pollIntervalMs)
    const invoke = register('preferences:pollInterval:set', handler)

    await invoke({} as IpcMainInvokeEvent, { pollIntervalMs: 10_000, extra: 'should be dropped' })

    expect(handler).toHaveBeenCalledWith({ pollIntervalMs: 10_000 }, expect.anything())
  })
})
