import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  PEEK_COUNT_CAP,
  PEEK_FROM_START,
  fetchQueueMessageCount,
  fetchSubscriptionMessageCount,
  formatMessageCount
} from '../../src/renderer/src/lib/messageCount'

const countMock = vi.fn()
const countSubscriptionMock = vi.fn()

vi.stubGlobal('window', {
  sbAdmin: { messages: { count: countMock, countSubscription: countSubscriptionMock } }
})

afterEach(() => {
  countMock.mockReset()
  countSubscriptionMock.mockReset()
})

describe('fetchQueueMessageCount', () => {
  test('counts from the very start of the entity, capped', async () => {
    countMock.mockResolvedValue({ ok: true, data: 3 })

    const result = await fetchQueueMessageCount('p1', 'q1')

    expect(countMock).toHaveBeenCalledWith('p1', 'q1', PEEK_COUNT_CAP, PEEK_FROM_START)
    expect(result).toEqual({ count: 3, approximate: false })
  })

  test('a count equal to the cap is flagged approximate ("N+")', async () => {
    countMock.mockResolvedValue({ ok: true, data: PEEK_COUNT_CAP })

    const result = await fetchQueueMessageCount('p1', 'q1')

    expect(result).toEqual({ count: PEEK_COUNT_CAP, approximate: true })
  })

  test('returns null on failure so callers show nothing rather than a misleading zero', async () => {
    countMock.mockResolvedValue({ ok: false, error: { code: 'UNEXPECTED_ERROR', message: 'x' } })

    expect(await fetchQueueMessageCount('p1', 'q1')).toBeNull()
  })
})

describe('fetchSubscriptionMessageCount', () => {
  test('addresses the subscription and applies the same cap semantics', async () => {
    countSubscriptionMock.mockResolvedValue({ ok: true, data: 7 })

    const result = await fetchSubscriptionMessageCount('p1', 't1', 's1')

    expect(countSubscriptionMock).toHaveBeenCalledWith(
      'p1',
      't1',
      's1',
      PEEK_COUNT_CAP,
      PEEK_FROM_START
    )
    expect(result).toEqual({ count: 7, approximate: false })
  })
})

describe('formatMessageCount', () => {
  test('formats exact and approximate counts', () => {
    expect(formatMessageCount({ count: 12, approximate: false })).toBe('12')
    expect(formatMessageCount({ count: 250, approximate: true })).toBe('250+')
  })
})
