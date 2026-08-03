import { describe, expect, test } from 'vitest'
import {
  fetchPollInterval,
  fetchTheme,
  settingsReducer,
  updatePollInterval,
  updateTheme
} from '../../src/renderer/src/store/settingsSlice'
import { DEFAULT_POLL_INTERVAL_MS } from '../../src/shared/pollInterval'
import { DEFAULT_THEME } from '../../src/shared/theme'

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

  test('theme starts as the null "still loading" sentinel', () => {
    expect(settingsReducer(undefined, { type: '@@INIT' }).theme).toBeNull()
  })

  test('a successful theme load stores the persisted theme', () => {
    const state = settingsReducer(undefined, { type: fetchTheme.fulfilled.type, payload: 'light' })
    expect(state.theme).toBe('light')
  })

  test('a failed theme load falls back to the default instead of staying unloaded forever', () => {
    const state = settingsReducer(undefined, { type: fetchTheme.rejected.type })
    expect(state.theme).toBe(DEFAULT_THEME)
  })

  test('a saved theme update stores the value the main process returned', () => {
    const state = settingsReducer(undefined, { type: updateTheme.fulfilled.type, payload: 'light' })
    expect(state.theme).toBe('light')
  })
})
