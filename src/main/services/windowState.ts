import type { BrowserWindow, Rectangle } from 'electron'
import type { PreferencesRepo } from './db/preferencesRepo'

const PREFERENCE_KEY = 'windowState'

export const DEFAULT_WINDOW_STATE: Rectangle = { width: 1200, height: 800, x: 0, y: 0 }

/** Only `width`/`height` are ever required to have a value — `x`/`y` are omitted
 * (letting Electron center the window) whenever there's no saved position, or the saved
 * one doesn't land on any currently-connected display. */
export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

/** A fresh default-size state (no x/y, letting Electron center the window). A function
 * rather than a shared constant so no caller can mutate the defaults for everyone. */
function defaultSize(): WindowState {
  return { width: DEFAULT_WINDOW_STATE.width, height: DEFAULT_WINDOW_STATE.height }
}

/**
 * Pure — parses whatever's in the preferences table, falling back to defaults for
 * anything missing, malformed, or nonsensical (e.g. hand-edited or corrupted JSON, or a
 * width/height so small or large it'd be unusable). Kept separate from the impure
 * load/save so it's unit-testable without a real database or Electron.
 */
export function parseWindowState(raw: string | undefined): WindowState {
  if (!raw) return defaultSize()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return defaultSize()
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return defaultSize()
  }

  const candidate = parsed as Partial<Record<keyof WindowState, unknown>>
  const width = isFiniteInRange(candidate.width, 200, 10000)
    ? candidate.width
    : DEFAULT_WINDOW_STATE.width
  const height = isFiniteInRange(candidate.height, 200, 10000)
    ? candidate.height
    : DEFAULT_WINDOW_STATE.height
  const state: WindowState = { width, height }
  if (isFiniteInRange(candidate.x, -10000, 10000)) state.x = candidate.x
  if (isFiniteInRange(candidate.y, -10000, 10000)) state.y = candidate.y
  return state
}

/**
 * Pure — drops a saved x/y if it wouldn't land the window's top-left corner on any
 * currently-connected display. Without this, disconnecting an external monitor the
 * window was last positioned on leaves it permanently off-screen and unreachable on the
 * next launch — a real Electron footgun, not a hypothetical one.
 */
export function clampToVisibleDisplay(state: WindowState, displayBounds: Rectangle[]): WindowState {
  if (state.x === undefined || state.y === undefined) return state

  const onSomeDisplay = displayBounds.some(
    (bounds) =>
      state.x! >= bounds.x &&
      state.x! < bounds.x + bounds.width &&
      state.y! >= bounds.y &&
      state.y! < bounds.y + bounds.height
  )
  if (onSomeDisplay) return state

  const { width, height } = state
  return { width, height }
}

export function loadWindowState(
  preferencesRepo: PreferencesRepo,
  displayBounds: Rectangle[]
): WindowState {
  const raw = preferencesRepo.get(PREFERENCE_KEY)
  return clampToVisibleDisplay(parseWindowState(raw), displayBounds)
}

export function saveWindowState(preferencesRepo: PreferencesRepo, window: BrowserWindow): void {
  const bounds = window.getBounds()
  const state: WindowState = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y
  }
  preferencesRepo.set(PREFERENCE_KEY, JSON.stringify(state))
}
