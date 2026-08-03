import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AppError, type Result } from '../../src/shared/errors'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle }
}))

vi.mock('electron-log/main', () => ({
  default: { error: mocks.logError, warn: mocks.logWarn, debug: mocks.logDebug, info: vi.fn() }
}))

import { registerHandler, toResult } from '../../src/main/ipc/wrapHandler'

describe('toResult', () => {
  beforeEach(() => {
    mocks.logError.mockClear()
    mocks.logWarn.mockClear()
    mocks.logDebug.mockClear()
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

  test('maps any other thrown error to UNEXPECTED_ERROR and logs it at error level', async () => {
    const result = await toResult(() => {
      throw new Error('boom')
    })
    expect(result).toEqual({ ok: false, error: { code: 'UNEXPECTED_ERROR', message: 'boom' } })
    expect(mocks.logError).toHaveBeenCalled()
  })

  test('logs NOT_CONNECTED at debug, not error — it is routine during background polling', async () => {
    await toResult(() => {
      throw new AppError('NOT_CONNECTED', 'profile is not connected: p1')
    })
    expect(mocks.logDebug).toHaveBeenCalled()
    expect(mocks.logWarn).not.toHaveBeenCalled()
    expect(mocks.logError).not.toHaveBeenCalled()
  })

  test('logs other domain errors at warn — expected failures, not app faults', async () => {
    await toResult(() => {
      throw new AppError('NOT_FOUND', 'queue gone')
    })
    expect(mocks.logWarn).toHaveBeenCalled()
    expect(mocks.logError).not.toHaveBeenCalled()
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
    const handler = vi.fn(() => ({ echo: 'x', timestamp: 1 }))
    const invoke = register('app:ping', handler)

    const result = await invoke({} as IpcMainInvokeEvent, { message: 123 })

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    expect(handler).not.toHaveBeenCalled()
  })

  test("passes a valid payload through and wraps the handler's return in a Result", async () => {
    const invoke = register('app:ping', (request: { message: string }) => ({
      echo: request.message,
      timestamp: 5
    }))

    const result = await invoke({} as IpcMainInvokeEvent, { message: 'hi' })

    expect(result).toEqual({ ok: true, data: { echo: 'hi', timestamp: 5 } })
  })

  test('strips unknown keys so only the declared shape reaches the handler', async () => {
    const handler = vi.fn((request: { message: string }) => ({
      echo: request.message,
      timestamp: 1
    }))
    const invoke = register('app:ping', handler)

    await invoke({} as IpcMainInvokeEvent, { message: 'hi', extra: 'should be dropped' })

    expect(handler).toHaveBeenCalledWith({ message: 'hi' }, expect.anything())
  })
})
