import { DEFAULT_THEME, type Theme } from '@shared/theme'
import type { PreferencesRepo } from './db/preferencesRepo'

const PREFERENCE_KEY = 'theme'

/** Pure — normalizes whatever's stored to a known theme, falling back to the default.
 * Kept separate from load/save so it's unit-testable without a database, mirroring
 * pollPreference.ts's parsePollIntervalMs(). */
export function parseTheme(raw: string | undefined): Theme {
  return raw === 'light' || raw === 'dark' ? raw : DEFAULT_THEME
}

export function loadTheme(preferencesRepo: PreferencesRepo): Theme {
  return parseTheme(preferencesRepo.get(PREFERENCE_KEY))
}

// No re-parse on save: `theme` is already constrained by its type and the IPC schema
// (z.enum) — the read-path parseTheme is what defends against a hand-edited database.
export function saveTheme(preferencesRepo: PreferencesRepo, theme: Theme): Theme {
  preferencesRepo.set(PREFERENCE_KEY, theme)
  return theme
}
