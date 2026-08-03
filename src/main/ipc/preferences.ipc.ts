import type { PreferencesRepo } from '../services/db/preferencesRepo'
import { loadPollIntervalMs, savePollIntervalMs } from '../services/pollPreference'
import { registerHandler } from './wrapHandler'

export function registerPreferencesIpcHandlers(preferencesRepo: PreferencesRepo): void {
  registerHandler('preferences:pollInterval:get', () => loadPollIntervalMs(preferencesRepo))

  registerHandler('preferences:pollInterval:set', (request) =>
    savePollIntervalMs(preferencesRepo, request.pollIntervalMs)
  )
}
