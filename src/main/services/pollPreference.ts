import type { PreferencesRepo } from './db/preferencesRepo'

const PREFERENCE_KEY = 'pollIntervalMs'

export const DEFAULT_POLL_INTERVAL_MS = 10_000
export const MIN_POLL_INTERVAL_MS = 2_000
export const MAX_POLL_INTERVAL_MS = 300_000

/**
 * Pure — parses whatever's in the preferences table, falling back to the default for
 * anything missing, malformed, or out of the sane [MIN, MAX] range (e.g. hand-edited or
 * corrupted data). Kept separate from the impure load/save so it's unit-testable without a
 * real database, mirroring windowState.ts's parseWindowState().
 */
export function parsePollIntervalMs(raw: string | undefined): number {
  if (!raw) return DEFAULT_POLL_INTERVAL_MS

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < MIN_POLL_INTERVAL_MS || parsed > MAX_POLL_INTERVAL_MS) {
    return DEFAULT_POLL_INTERVAL_MS
  }
  return parsed
}

export function clampPollIntervalMs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_POLL_INTERVAL_MS
  return Math.min(Math.max(value, MIN_POLL_INTERVAL_MS), MAX_POLL_INTERVAL_MS)
}

export function loadPollIntervalMs(preferencesRepo: PreferencesRepo): number {
  return parsePollIntervalMs(preferencesRepo.get(PREFERENCE_KEY))
}

export function savePollIntervalMs(preferencesRepo: PreferencesRepo, value: number): number {
  const clamped = clampPollIntervalMs(value)
  preferencesRepo.set(PREFERENCE_KEY, String(clamped))
  return clamped
}
