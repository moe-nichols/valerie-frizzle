import { describe, expect, test } from 'vitest'
import {
  parsePollIntervalMs,
  clampPollIntervalMs,
  DEFAULT_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  MAX_POLL_INTERVAL_MS
} from '../../src/main/services/pollPreference'

describe('parsePollIntervalMs', () => {
  test('falls back to the default when nothing is saved', () => {
    expect(parsePollIntervalMs(undefined)).toBe(DEFAULT_POLL_INTERVAL_MS)
  })

  test('falls back to the default on malformed data', () => {
    expect(parsePollIntervalMs('not a number')).toBe(DEFAULT_POLL_INTERVAL_MS)
  })

  test('parses a valid saved value', () => {
    expect(parsePollIntervalMs('15000')).toBe(15000)
  })

  test('clamps out-of-range values to the nearest bound, matching save-side clamping', () => {
    expect(parsePollIntervalMs(String(MIN_POLL_INTERVAL_MS - 1))).toBe(MIN_POLL_INTERVAL_MS)
    expect(parsePollIntervalMs(String(MAX_POLL_INTERVAL_MS + 1))).toBe(MAX_POLL_INTERVAL_MS)
  })

  test('accepts the boundary values', () => {
    expect(parsePollIntervalMs(String(MIN_POLL_INTERVAL_MS))).toBe(MIN_POLL_INTERVAL_MS)
    expect(parsePollIntervalMs(String(MAX_POLL_INTERVAL_MS))).toBe(MAX_POLL_INTERVAL_MS)
  })
})

describe('clampPollIntervalMs', () => {
  test('leaves an in-range value untouched', () => {
    expect(clampPollIntervalMs(20_000)).toBe(20_000)
  })

  test('clamps below the minimum', () => {
    expect(clampPollIntervalMs(0)).toBe(MIN_POLL_INTERVAL_MS)
  })

  test('clamps above the maximum', () => {
    expect(clampPollIntervalMs(1_000_000)).toBe(MAX_POLL_INTERVAL_MS)
  })

  test('falls back to the default for non-finite input', () => {
    expect(clampPollIntervalMs(Number.NaN)).toBe(DEFAULT_POLL_INTERVAL_MS)
  })
})
