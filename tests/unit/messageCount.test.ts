import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  formatMessageCount,
  observeQueueCount,
  observeSubscriptionCount
} from '@renderer/lib/messageCount.ts'
import { failure, ok, queue, subscription } from './entityFixtures'

const countMock = vi.fn()
const countSubscriptionMock = vi.fn()

vi.stubGlobal('window', {
  sbAdmin: { messages: { count: countMock, countSubscription: countSubscriptionMock } }
})

afterEach(() => {
  countMock.mockReset()
  countSubscriptionMock.mockReset()
})

describe('count observation', () => {
  test('counts from the very start of the entity, capped', async () => {
    countMock.mockResolvedValue({ ok: true, data: 3 })

    const result = await observeQueueCount('p1', queue('q1'), 'active')

    expect(countMock).toHaveBeenCalledWith('p1', 'q1', 250, 0)
    expect(result).toEqual({ status: 'observed', count: 3, approximate: false })
  })

  test('a count equal to the cap is flagged approximate ("N+")', async () => {
    countMock.mockResolvedValue({ ok: true, data: 250 })

    const result = await observeQueueCount('p1', queue('q1'), 'active')

    expect(result).toEqual({ status: 'observed', count: 250, approximate: true })
  })

  test('preserves structured failures and successful zero independently', async () => {
    const response = failure()
    countMock.mockResolvedValueOnce(response).mockResolvedValueOnce(ok(0))
    const result = await observeQueueCount('p1', queue(), 'active')
    expect(result).toEqual({ status: 'failed', error: response.error })
    if (result.status === 'failed') expect(result.error).toBe(response.error)
    expect(await observeQueueCount('p1', queue(), 'deadLetter')).toEqual({
      status: 'observed',
      count: 0,
      approximate: false
    })
  })

  test.each([
    [undefined, undefined],
    ['destination', undefined],
    [undefined, 'destination'],
    ['destination', 'destination']
  ])(
    'independent eligibility: active %s, DLQ %s',
    async (forwardTo, forwardDeadLetteredMessagesTo) => {
      countMock.mockResolvedValue(ok(1))
      countSubscriptionMock.mockResolvedValue(ok(2))
      const flags = { forwardTo, forwardDeadLetteredMessagesTo }
      for (const target of ['active', 'deadLetter'] as const) {
        countMock.mockClear()
        countSubscriptionMock.mockClear()
        const blocked = Boolean(target === 'active' ? forwardTo : forwardDeadLetteredMessagesTo)
        const active = await observeQueueCount('p1', queue('q1', flags), target)
        const sub = await observeSubscriptionCount('p1', subscription(flags), target)
        expect(active.status).toBe(blocked ? 'unavailable' : 'observed')
        expect(sub.status).toBe(blocked ? 'unavailable' : 'observed')
        expect(countMock).toHaveBeenCalledTimes(blocked ? 0 : 1)
        expect(countSubscriptionMock).toHaveBeenCalledTimes(blocked ? 0 : 1)
        if (!blocked) {
          expect(countMock).toHaveBeenCalledWith(
            'p1',
            target === 'active' ? 'q1' : 'q1/$DeadLetterQueue',
            250,
            0
          )
          expect(countSubscriptionMock).toHaveBeenCalledWith(
            'p1',
            'events',
            'worker',
            250,
            0,
            target === 'deadLetter'
          )
        }
      }
    }
  )

  test('does not swallow unexpected rejection', async () => {
    countMock.mockRejectedValue(new Error('broken bridge'))
    await expect(observeQueueCount('p1', queue(), 'active')).rejects.toThrow('broken bridge')
  })
})

describe('subscription count observation', () => {
  test.each([0, 249, 250])(
    'interprets subscription count %s with the same cap semantics',
    async (count) => {
      countSubscriptionMock.mockResolvedValue(ok(count))
      expect(await observeSubscriptionCount('p1', subscription(), 'deadLetter')).toEqual({
        status: 'observed',
        count,
        approximate: count === 250
      })
    }
  )

  test('preserves a subscription failure without suppressing a valid DLQ observation', async () => {
    const response = failure()
    countSubscriptionMock.mockResolvedValueOnce(response).mockResolvedValueOnce(ok(2))
    const active = await observeSubscriptionCount('p1', subscription(), 'active')
    expect(active).toEqual({ status: 'failed', error: response.error })
    expect(await observeSubscriptionCount('p1', subscription(), 'deadLetter')).toMatchObject({
      status: 'observed',
      count: 2
    })
  })

  test('addresses the subscription and applies the same cap semantics', async () => {
    countSubscriptionMock.mockResolvedValue({ ok: true, data: 7 })

    const result = await observeSubscriptionCount(
      'p1',
      subscription({ topicName: 't1', subscriptionName: 's1' }),
      'active'
    )

    expect(countSubscriptionMock).toHaveBeenCalledWith('p1', 't1', 's1', 250, 0, false)
    expect(result).toEqual({ status: 'observed', count: 7, approximate: false })
  })
})

describe('formatMessageCount', () => {
  test('formats exact and approximate counts', () => {
    expect(formatMessageCount({ count: 12, approximate: false })).toBe('12')
    expect(formatMessageCount({ count: 250, approximate: true })).toBe('250+')
  })
})
