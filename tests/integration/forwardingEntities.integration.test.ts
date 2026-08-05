import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { AdminService } from '../../src/main/services/adminService'
import type { MessagingService } from '../../src/main/services/messagingService'
import { connectToTestEmulator, type TestEmulatorClient } from './testClient'

// Regression coverage for auto-forwarding entities, pinned against the real emulator the
// same way adminHttpsProxy.integration.test.ts pins the emulator's 404 shape.
//
// Two independently-confirmed facts live here (verified live 2026-08-04):
//   1. The admin path (get/list) does NOT error on a forwarding entity — it returns the
//      entity with forwardTo populated. (This disproves the plan's leading hypothesis that
//      the production RestError came from listing/getting a forwardTo entity; that error's
//      real cause remains unexplained and is not this.)
//   2. The peek/browse path IS permanently unsupported for a forwarding entity — the
//      emulator's raw error message contains "auto-forwarding", which is the exact signal
//      MessagingService.withPeekedBatch keys on to produce a clear error.
//
// forwardTo can't be set through AdminService (its DTOs don't model it — deliberately, since
// the app never creates forwarding entities), so the raw admin client provisions them.

let client: TestEmulatorClient
let adminService: AdminService
let messagingService: MessagingService

const targetQueue = `fwd-target-${Date.now()}`
const sourceQueue = `fwd-source-${Date.now()}`
const topicName = `fwd-topic-${Date.now()}`
const forwardingSub = 'fwd-sub'

beforeAll(async () => {
  client = await connectToTestEmulator()
  ;({ adminService, messagingService } = client)
  await client.adminClient.createQueue(targetQueue)
  await client.adminClient.createTopic(topicName)
  // forwardTo must point at an entity that already exists in the same namespace.
  await client.adminClient.createQueue(sourceQueue, { forwardTo: targetQueue })
  await client.adminClient.createSubscription(topicName, forwardingSub, { forwardTo: targetQueue })
})

afterAll(async () => {
  await messagingService.close()
  await client.adminClient.deleteQueue(sourceQueue).catch(() => {})
  await client.adminClient.deleteTopic(topicName).catch(() => {})
  await client.adminClient.deleteQueue(targetQueue).catch(() => {})
  await client.close()
})

describe('AdminService — forwarding entities (admin path succeeds and exposes forwardTo)', () => {
  test('getQueue returns a forwarding queue with forwardTo populated', async () => {
    const queue = await adminService.getQueue(sourceQueue)
    expect(queue.name).toBe(sourceQueue)
    // The emulator reports forwardTo as the target's full sb:// address, not the bare name.
    expect(queue.forwardTo).toContain(targetQueue)
  })

  test('listQueues includes the forwarding queue without erroring', async () => {
    const queues = await adminService.listQueues()
    const found = queues.find((q) => q.name === sourceQueue)
    expect(found).toBeDefined()
    expect(found?.forwardTo).toContain(targetQueue)
  })

  test('a non-forwarding queue has no forwardTo', async () => {
    const target = await adminService.getQueue(targetQueue)
    expect(target.forwardTo).toBeUndefined()
  })

  test('getSubscription / listSubscriptions expose forwardTo on a forwarding subscription', async () => {
    const sub = await adminService.getSubscription(topicName, forwardingSub)
    expect(sub.forwardTo).toContain(targetQueue)

    const subs = await adminService.listSubscriptions(topicName)
    expect(subs.find((s) => s.subscriptionName === forwardingSub)?.forwardTo).toContain(targetQueue)
  })
})

describe('MessagingService — forwarding entities cannot be peeked/browsed', () => {
  test('the raw SDK peek fails with an "auto-forwarding" message (pins the signal we detect)', async () => {
    // If a future emulator/SDK changes this wording, withPeekedBatch's detection breaks —
    // this test is what catches that, independent of our own translation.
    const receiver = client.sbClient.createReceiver(sourceQueue)
    try {
      await expect(receiver.peekMessages(1)).rejects.toThrow(/auto-forwarding/i)
    } finally {
      await receiver.close()
    }
  })

  test('countMessages surfaces a clear auto-forwarding error for a forwarding queue', async () => {
    await expect(messagingService.countMessages(sourceQueue, 250, 0)).rejects.toThrow(
      /auto-forwarding enabled/i
    )
  })

  test('peekMessages surfaces the same clear error', async () => {
    await expect(messagingService.peekMessages(sourceQueue, 250, 0)).rejects.toThrow(
      /auto-forwarding enabled/i
    )
  })

  test('countSubscriptionMessages surfaces a clear auto-forwarding error for a forwarding subscription', async () => {
    await expect(
      messagingService.countSubscriptionMessages(topicName, forwardingSub, 250, 0)
    ).rejects.toThrow(/auto-forwarding enabled/i)
  })
})
