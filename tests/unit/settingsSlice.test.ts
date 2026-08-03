import { describe, expect, test } from 'vitest'
import {
  fetchPollInterval,
  settingsReducer,
  updatePollInterval
} from '../../src/renderer/src/store/settingsSlice'
import { DEFAULT_POLL_INTERVAL_MS } from '../../src/shared/pollInterval'

describe('settingsSlice', () => {
  test('starts with the null "still loading" sentinel so polling stays idle', () => {
    expect(settingsReducer(undefined, { type: '@@INIT' }).pollIntervalMs).toBeNull()
  })

  test('a successful load stores the persisted interval', () => {
    const state = settingsReducer(undefined, {
      type: fetchPollInterval.fulfilled.type,
      payload: 15_000
    })
    expect(state.pollIntervalMs).toBe(15_000)
  })

  test('a failed load falls back to the default instead of silently never polling', () => {
    const state = settingsReducer(undefined, { type: fetchPollInterval.rejected.type })
    expect(state.pollIntervalMs).toBe(DEFAULT_POLL_INTERVAL_MS)
  })

  test('a saved update stores the (possibly clamped) value the main process returned', () => {
    const state = settingsReducer(undefined, {
      type: updatePollInterval.fulfilled.type,
      payload: 30_000
    })
    expect(state.pollIntervalMs).toBe(30_000)
  })
})
