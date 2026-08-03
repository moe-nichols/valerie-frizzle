import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { AdminService } from '../../src/main/services/adminService'
import type { MessagingService } from '../../src/main/services/messagingService'
import { type PurgeProgress, purgeEntity } from '../../src/main/services/purgeService'
import { connectToTestEmulator, type TestEmulatorClient } from './testClient'

let client: TestEmulatorClient
let adminService: AdminService
let messagingService: MessagingService
const queueName = `test-purge-queue-${Date.now()}`

beforeAll(async () => {
  client = await connectToTestEmulator()
  ;({ adminService, messagingService } = client)
  await adminService.createQueue({ name: queueName })
})

afterAll(async () => {
  // Release any open receivers before deleting the entities they point at; close() is
  // idempotent, so client.close() calling it again is harmless.
  await messagingService.close()
  await adminService.deleteQueue(queueName)
  await client.close()
})

describe('purgeService', () => {
  test('drains all messages from a queue and reports progress', async () => {
    const messageCount = 15
    for (let i = 0; i < messageCount; i++) {
      await messagingService.sendMessage(queueName, { body: `msg-${i}`, bodyMode: 'text' })
    }

    expect(await messagingService.peekMessages(queueName, messageCount + 5)).toHaveLength(
      messageCount
    )

    const progressEvents: PurgeProgress[] = []
    const totalDeleted = await purgeEntity(messagingService, queueName, (progress) => {
      progressEvents.push(progress)
    })

    expect(totalDeleted).toBe(messageCount)
    expect(progressEvents.length).toBeGreaterThan(0)
    expect(progressEvents[progressEvents.length - 1]).toEqual({
      deletedCount: messageCount,
      done: true,
      stoppedAtCap: false
    })

    const remaining = await messagingService.peekMessages(queueName, 10)
    expect(remaining).toHaveLength(0)
  })

  test('purging an already-empty queue completes immediately with zero deletions', async () => {
    const progressEvents: PurgeProgress[] = []
    const totalDeleted = await purgeEntity(messagingService, queueName, (progress) => {
      progressEvents.push(progress)
    })

    expect(totalDeleted).toBe(0)
    expect(progressEvents).toEqual([{ deletedCount: 0, done: true, stoppedAtCap: false }])
  })
})
