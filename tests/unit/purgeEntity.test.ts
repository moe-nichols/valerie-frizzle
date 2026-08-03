import type { ReceivedMessageDescription } from '@shared/domain'
import { describe, expect, test } from 'vitest'
import type { MessagingService } from '../../src/main/services/messagingService'
import { type PurgeProgress, purgeEntity } from '../../src/main/services/purgeService'

function msg(sequenceNumber: number): ReceivedMessageDescription {
  return { sequenceNumber, body: '' }
}

/** A MessagingService stand-in whose receiveMessages returns a scripted sequence of
 * batches, then empties out. */
function fakeMessaging(batchSizes: number[]): MessagingService {
  let call = 0
  return {
    async receiveMessages(): Promise<ReceivedMessageDescription[]> {
      const size = batchSizes[call] ?? 0
      call++
      return Array.from({ length: size }, (_, i) => msg(i))
    }
  } as unknown as MessagingService
}

/** A MessagingService that never runs dry — always returns a non-empty batch, forcing the
 * drain loop to hit its iteration cap. */
function bottomlessMessaging(): MessagingService {
  return {
    async receiveMessages(): Promise<ReceivedMessageDescription[]> {
      return [msg(0)]
    }
  } as unknown as MessagingService
}

describe('purgeEntity', () => {
  test('reports done without stoppedAtCap when the entity drains (F6)', async () => {
    const events: PurgeProgress[] = []
    // Two non-empty batches, then empties → two consecutive empties drain it.
    await purgeEntity(fakeMessaging([2, 3, 0, 0]), 'q', (p) => events.push(p))

    const terminal = events.at(-1)!
    expect(terminal.done).toBe(true)
    expect(terminal.stoppedAtCap).toBe(false)
    expect(terminal.deletedCount).toBe(5)
  })

  test('a receive failure (e.g. connection closed mid-purge) rejects immediately', async () => {
    // Pins the behavior that lets messages:purge:start's catch report done+error to the
    // renderer: a failing receive must abort the drain loop on the spot, not keep
    // iterating toward the cap against a dead connection.
    let calls = 0
    const failing = {
      async receiveMessages(): Promise<ReceivedMessageDescription[]> {
        calls++
        if (calls === 1) return [msg(0)]
        throw new Error('connection closed')
      }
    } as unknown as MessagingService

    await expect(purgeEntity(failing, 'q', () => {})).rejects.toThrow('connection closed')
    expect(calls).toBe(2)
  })

  test('reports stoppedAtCap when the iteration cap is hit (F6)', async () => {
    const events: PurgeProgress[] = []
    const total = await purgeEntity(bottomlessMessaging(), 'q', (p) => events.push(p))

    const terminal = events.at(-1)!
    expect(terminal.done).toBe(true)
    expect(terminal.stoppedAtCap).toBe(true)
    // Never drained, so the reported count is a floor (whatever the cap allowed).
    expect(terminal.deletedCount).toBe(total)
    expect(total).toBeGreaterThan(0)
  })
})
