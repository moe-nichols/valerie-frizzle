import type { QueueProperties, ServiceBusAdministrationClient } from '@azure/service-bus'
import { describe, expect, test, vi } from 'vitest'
import { AdminService } from '../../src/main/services/adminService'

function asyncIterableOf<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items
    }
  }
}

function queueProps(overrides: Partial<QueueProperties> = {}): QueueProperties {
  return {
    name: 'q1',
    maxSizeInMegabytes: 1024,
    defaultMessageTimeToLive: 'P14D',
    lockDuration: 'PT30S',
    requiresDuplicateDetection: false,
    duplicateDetectionHistoryTimeWindow: 'PT10M',
    requiresSession: false,
    deadLetteringOnMessageExpiration: true,
    maxDeliveryCount: 10,
    status: 'Active',
    ...overrides
  } as QueueProperties
}

describe('AdminService list mapping', () => {
  test('drains the paged iterable and maps each item to its DTO', async () => {
    const client = {
      listQueues: () =>
        asyncIterableOf([queueProps(), queueProps({ name: 'q2', status: 'Disabled' })])
    } as unknown as ServiceBusAdministrationClient

    const queues = await new AdminService(client).listQueues()

    expect(queues.map((queue) => queue.name)).toEqual(['q1', 'q2'])
    expect(queues[1]).toMatchObject({ status: 'Disabled', maxDeliveryCount: 10 })
    // The DTO must not leak SDK-only fields.
    expect(Object.keys(queues[0])).not.toContain('authorizationRules')
  })
})

describe('AdminService merged updates', () => {
  test('fetches, merges the partial input over the existing properties, and puts back', async () => {
    const existing = queueProps()
    const updateQueue = vi.fn(async (merged: QueueProperties) => merged)
    const client = {
      getQueue: vi.fn(async () => existing),
      updateQueue
    } as unknown as ServiceBusAdministrationClient

    const updated = await new AdminService(client).updateQueue('q1', { maxDeliveryCount: 3 })

    expect(updateQueue).toHaveBeenCalledWith({ ...existing, maxDeliveryCount: 3 })
    expect(updated.maxDeliveryCount).toBe(3)
    // Untouched fields survive the merge.
    expect(updated.lockDuration).toBe('PT30S')
  })

  test("retries via refetch when the emulator's PUT response triggers PARSE_ERROR", async () => {
    // The emulator's PUT responses are missing fields the SDK's deserializer requires, so
    // updateQueue throws client-side even though the update landed — the workaround
    // refetches and returns the (updated) GET result.
    const afterUpdate = queueProps({ maxDeliveryCount: 3 })
    const getQueue = vi
      .fn<() => Promise<QueueProperties>>()
      .mockResolvedValueOnce(queueProps())
      .mockResolvedValueOnce(afterUpdate)
    const client = {
      getQueue,
      updateQueue: vi.fn(async () => {
        throw Object.assign(new Error('unexpected end of input'), { code: 'PARSE_ERROR' })
      })
    } as unknown as ServiceBusAdministrationClient

    const updated = await new AdminService(client).updateQueue('q1', { maxDeliveryCount: 3 })

    expect(getQueue).toHaveBeenCalledTimes(2)
    expect(updated.maxDeliveryCount).toBe(3)
  })

  test('propagates real update failures instead of masking them as successes', async () => {
    const client = {
      getQueue: vi.fn(async () => queueProps()),
      updateQueue: vi.fn(async () => {
        throw Object.assign(new Error('TTL out of range'), { code: 'InvalidRequestError' })
      })
    } as unknown as ServiceBusAdministrationClient

    await expect(
      new AdminService(client).updateQueue('q1', { maxDeliveryCount: 3 })
    ).rejects.toThrow('TTL out of range')
  })
})
