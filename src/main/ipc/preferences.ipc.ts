import type { PreferencesRepo } from '../services/db/preferencesRepo'
import { loadPollIntervalMs, savePollIntervalMs } from '../services/pollPreference'
import { loadTheme, saveTheme } from '../services/themePreference'
import { registerHandler } from './wrapHandler'

export function registerPreferencesIpcHandlers(preferencesRepo: PreferencesRepo): void {
  registerHandler('preferences:pollInterval:get', () => loadPollIntervalMs(preferencesRepo))

  registerHandler('preferences:pollInterval:set', (request) =>
    savePollIntervalMs(preferencesRepo, request.pollIntervalMs)
  )

  registerHandler('preferences:theme:get', () => loadTheme(preferencesRepo))

  registerHandler('preferences:theme:set', (request) => saveTheme(preferencesRepo, request.theme))
}
