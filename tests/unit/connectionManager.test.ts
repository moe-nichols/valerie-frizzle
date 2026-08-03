import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ProfilesRepo } from '../../src/main/services/db/profilesRepo'

// Module mocks are hoisted above imports by vitest; the mocked members below are declared
// with `vi.hoisted` so they can be referenced from both the factory and the tests.
const mocks = vi.hoisted(() => {
  return {
    startAdminHttpsProxy: vi.fn(),
    proxyClose: vi.fn(async () => {}),
    ServiceBusClient: vi.fn(),
    sbClientClose: vi.fn(async () => {}),
    ServiceBusAdministrationClient: vi.fn(),
    messagingClose: vi.fn(async () => {})
  }
})

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('../../src/main/services/adminHttpsProxy.ts', () => ({
  startAdminHttpsProxy: mocks.startAdminHttpsProxy,
  buildAdminConnectionString: (cs: string) => cs
}))

vi.mock('@azure/service-bus', () => ({
  ServiceBusClient: mocks.ServiceBusClient,
  ServiceBusAdministrationClient: mocks.ServiceBusAdministrationClient
}))

vi.mock('../../src/main/services/messagingService.ts', () => ({
  MessagingService: class {
    close = mocks.messagingClose
  }
}))

import { ConnectionManager } from '../../src/main/services/connectionManager'

function fakeProfilesRepo(): ProfilesRepo {
  return {
    get: (id: string) => ({
      id,
      name: 'test',
      connectionString: 'Endpoint=sb://localhost;SharedAccessKey=x;',
      managementPort: 5300,
      createdAt: 0,
      updatedAt: 0
    })
  } as unknown as ProfilesRepo
}

/** An admin client whose listQueues() liveness check succeeds with an empty first page. */
function liveAdminClient(): unknown {
  return {
    listQueues: () => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true, value: undefined })
      })
    })
  }
}

describe('ConnectionManager.connect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startAdminHttpsProxy.mockImplementation(async () => ({
      url: 'https://127.0.0.1:12345',
      caCert: 'cert',
      close: mocks.proxyClose
    }))
    mocks.ServiceBusClient.mockImplementation(function () {
      return { close: mocks.sbClientClose }
    })
    mocks.ServiceBusAdministrationClient.mockImplementation(function () {
      return liveAdminClient()
    })
  })

  test('concurrent connects for the same profile start the proxy exactly once (F3)', async () => {
    const manager = new ConnectionManager(fakeProfilesRepo())

    await Promise.all([manager.connect('p1'), manager.connect('p1'), manager.connect('p1')])

    expect(mocks.startAdminHttpsProxy).toHaveBeenCalledTimes(1)
    expect(mocks.ServiceBusClient).toHaveBeenCalledTimes(1)
    expect(manager.isConnected('p1')).toBe(true)
  })

  test('a failure during client construction closes the already-started proxy (F10)', async () => {
    mocks.ServiceBusClient.mockImplementation(function () {
      throw new Error('bad connection string')
    })
    const manager = new ConnectionManager(fakeProfilesRepo())

    await expect(manager.connect('p1')).rejects.toThrow('could not connect to emulator')
    expect(mocks.proxyClose).toHaveBeenCalledTimes(1)
    expect(manager.isConnected('p1')).toBe(false)
  })

  test('a failed connect can be retried afterwards (in-flight guard is cleared)', async () => {
    mocks.ServiceBusAdministrationClient.mockImplementationOnce(function () {
      return {
        listQueues: () => ({
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              throw new Error('emulator down')
            }
          })
        })
      }
    })
    const manager = new ConnectionManager(fakeProfilesRepo())

    await expect(manager.connect('p1')).rejects.toThrow('could not connect to emulator')
    expect(manager.isConnected('p1')).toBe(false)

    // Second attempt uses the healthy default mock and should succeed.
    await manager.connect('p1')
    expect(manager.isConnected('p1')).toBe(true)
  })
})

describe('ConnectionManager.disconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startAdminHttpsProxy.mockImplementation(async () => ({
      url: 'https://127.0.0.1:12345',
      caCert: 'cert',
      close: mocks.proxyClose
    }))
    mocks.ServiceBusClient.mockImplementation(function () {
      return { close: mocks.sbClientClose }
    })
    mocks.ServiceBusAdministrationClient.mockImplementation(function () {
      return liveAdminClient()
    })
  })

  test('a failing close does not strand the other resources or reject', async () => {
    mocks.messagingClose.mockRejectedValueOnce(new Error('AMQP link torn down'))
    const manager = new ConnectionManager(fakeProfilesRepo())
    await manager.connect('p1')

    await expect(manager.disconnect('p1')).resolves.toBeUndefined()

    expect(mocks.sbClientClose).toHaveBeenCalledTimes(1)
    expect(mocks.proxyClose).toHaveBeenCalledTimes(1)
    expect(manager.isConnected('p1')).toBe(false)
  })

  test('disconnect during an in-flight connect waits for it and still tears it down', async () => {
    // Gate the connect attempt mid-flight so disconnect races it deterministically.
    let releaseConnect = (): void => {}
    const gate = new Promise<void>((resolve) => {
      releaseConnect = resolve
    })
    mocks.startAdminHttpsProxy.mockImplementation(async () => {
      await gate
      return { url: 'https://127.0.0.1:12345', caCert: 'cert', close: mocks.proxyClose }
    })
    const manager = new ConnectionManager(fakeProfilesRepo())

    const connecting = manager.connect('p1')
    const disconnecting = manager.disconnect('p1')
    releaseConnect()
    await Promise.all([connecting, disconnecting])

    expect(manager.isConnected('p1')).toBe(false)
    expect(mocks.sbClientClose).toHaveBeenCalledTimes(1)
    expect(mocks.proxyClose).toHaveBeenCalledTimes(1)
  })

  test('disconnect during a failing connect resolves without stranding anything', async () => {
    let releaseConnect = (): void => {}
    const gate = new Promise<void>((resolve) => {
      releaseConnect = resolve
    })
    mocks.startAdminHttpsProxy.mockImplementation(async () => {
      await gate
      throw new Error('bind failed')
    })
    const manager = new ConnectionManager(fakeProfilesRepo())

    const connecting = manager.connect('p1')
    const disconnecting = manager.disconnect('p1')
    releaseConnect()
    await expect(connecting).rejects.toThrow('could not connect to emulator')
    await expect(disconnecting).resolves.toBeUndefined()

    expect(manager.isConnected('p1')).toBe(false)
  })

  test('disconnectAll tears down profiles whose connects are still in flight', async () => {
    let releaseConnect = (): void => {}
    const gate = new Promise<void>((resolve) => {
      releaseConnect = resolve
    })
    mocks.startAdminHttpsProxy.mockImplementation(async () => {
      await gate
      return { url: 'https://127.0.0.1:12345', caCert: 'cert', close: mocks.proxyClose }
    })
    const manager = new ConnectionManager(fakeProfilesRepo())

    const connecting = manager.connect('p1')
    const disconnectingAll = manager.disconnectAll()
    releaseConnect()
    await Promise.all([connecting, disconnectingAll])

    expect(manager.isConnected('p1')).toBe(false)
    expect(mocks.proxyClose).toHaveBeenCalledTimes(1)
  })

  test("disconnectAll survives one profile's close failure and still closes the rest", async () => {
    mocks.sbClientClose.mockRejectedValueOnce(new Error('socket already destroyed'))
    const manager = new ConnectionManager(fakeProfilesRepo())
    await manager.connect('p1')
    await manager.connect('p2')

    await expect(manager.disconnectAll()).resolves.toBeUndefined()

    expect(mocks.proxyClose).toHaveBeenCalledTimes(2)
    expect(manager.isConnected('p1')).toBe(false)
    expect(manager.isConnected('p2')).toBe(false)
  })
})
