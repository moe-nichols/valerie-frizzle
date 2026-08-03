import {
  DEFAULT_POLL_INTERVAL_MS,
  MAX_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS
} from '@shared/pollInterval'
import type { PreferencesRepo } from './db/preferencesRepo'

const PREFERENCE_KEY = 'pollIntervalMs'

/**
 * Pure — parses whatever's in the preferences table: missing or malformed values fall back
 * to the default, out-of-range values are clamped to the nearest bound (matching how a set
 * request is clamped, so the same value never yields two different results depending on
 * whether it was loaded or saved). Kept separate from the impure load/save so it's
 * unit-testable without a real database, mirroring windowState.ts's parseWindowState().
 */
export function parsePollIntervalMs(raw: string | undefined): number {
  if (!raw) return DEFAULT_POLL_INTERVAL_MS
  const parsed = Number(raw)
  return clampPollIntervalMs(parsed)
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
