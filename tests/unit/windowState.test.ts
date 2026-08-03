import { describe, expect, test } from 'vitest'
import {
  clampToVisibleDisplay,
  DEFAULT_WINDOW_STATE,
  parseWindowState
} from '../../src/main/services/windowState'

describe('parseWindowState', () => {
  test('falls back to defaults when nothing is saved', () => {
    expect(parseWindowState(undefined)).toEqual({
      width: DEFAULT_WINDOW_STATE.width,
      height: DEFAULT_WINDOW_STATE.height
    })
  })

  test('falls back to defaults on malformed JSON', () => {
    expect(parseWindowState('not json')).toEqual({
      width: DEFAULT_WINDOW_STATE.width,
      height: DEFAULT_WINDOW_STATE.height
    })
  })

  test("falls back to defaults when the JSON isn't an object", () => {
    expect(parseWindowState('42')).toEqual({
      width: DEFAULT_WINDOW_STATE.width,
      height: DEFAULT_WINDOW_STATE.height
    })
    expect(parseWindowState('null')).toEqual({
      width: DEFAULT_WINDOW_STATE.width,
      height: DEFAULT_WINDOW_STATE.height
    })
  })

  test('parses a valid saved state', () => {
    expect(parseWindowState(JSON.stringify({ width: 1400, height: 900, x: 50, y: 60 }))).toEqual({
      width: 1400,
      height: 900,
      x: 50,
      y: 60
    })
  })

  test('keeps valid width/height but drops a nonsensical x/y', () => {
    expect(
      parseWindowState(JSON.stringify({ width: 1400, height: 900, x: 'not a number', y: NaN }))
    ).toEqual({ width: 1400, height: 900 })
  })

  test('falls back to default width/height when saved values are out of range', () => {
    expect(parseWindowState(JSON.stringify({ width: -5, height: 999999 }))).toEqual({
      width: DEFAULT_WINDOW_STATE.width,
      height: DEFAULT_WINDOW_STATE.height
    })
  })
})

describe('clampToVisibleDisplay', () => {
  const primaryDisplay = { x: 0, y: 0, width: 1920, height: 1080 }

  test('keeps a position that falls on a known display', () => {
    const state = { width: 1200, height: 800, x: 100, y: 100 }
    expect(clampToVisibleDisplay(state, [primaryDisplay])).toEqual(state)
  })

  test('drops x/y when the position falls on no known display', () => {
    const state = { width: 1200, height: 800, x: 5000, y: 5000 }
    expect(clampToVisibleDisplay(state, [primaryDisplay])).toEqual({ width: 1200, height: 800 })
  })

  test('checks against every display, not just the first', () => {
    const secondDisplay = { x: 1920, y: 0, width: 1920, height: 1080 }
    const state = { width: 1200, height: 800, x: 2000, y: 100 }
    expect(clampToVisibleDisplay(state, [primaryDisplay, secondDisplay])).toEqual(state)
  })

  test('leaves a state with no saved position untouched', () => {
    const state = { width: 1200, height: 800 }
    expect(clampToVisibleDisplay(state, [primaryDisplay])).toEqual(state)
  })
})
