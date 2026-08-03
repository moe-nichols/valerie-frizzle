import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { connectToTestEmulator, type TestEmulatorClient } from './testClient'

// The proxy is exercised indirectly by every admin call in the other suites; this file
// pins its two load-bearing behaviors directly: the TLS-terminated round trip to the
// emulator's plain-HTTP management API, and error passthrough (a 404 must reach the SDK
// with its status intact so wrapHandler can map it to NOT_FOUND).

let client: TestEmulatorClient

beforeAll(async () => {
  client = await connectToTestEmulator()
})

afterAll(async () => {
  await client.close()
})

describe('adminHttpsProxy', () => {
  test('round-trips an admin request through the local TLS proxy', async () => {
    const queueName = `proxy-roundtrip-${Date.now()}`
    await client.adminService.createQueue({ name: queueName })
    try {
      const queues = await client.adminService.listQueues()
      expect(queues.map((queue) => queue.name)).toContain(queueName)
    } finally {
      await client.adminService.deleteQueue(queueName)
    }
  })

  test('passes a missing-entity error through in a shape wrapHandler maps to NOT_FOUND', async () => {
    // The emulator does NOT 404 a missing queue the way real Azure does — it answers
    // HTTP 200 and the SDK raises a RestError coded MessageEntityNotFoundError. This
    // pins that the error crosses the proxy intact in that shape (which
    // wrapHandler.isEntityNotFoundError recognizes alongside the real-Azure shapes).
    await expect(client.adminService.getQueue('no-such-queue-ever')).rejects.toMatchObject({
      code: 'MessageEntityNotFoundError'
    })
  })
})
