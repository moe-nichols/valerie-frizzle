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

export function saveTheme(preferencesRepo: PreferencesRepo, theme: Theme): Theme {
  const normalized = parseTheme(theme)
  preferencesRepo.set(PREFERENCE_KEY, normalized)
  return normalized
}
