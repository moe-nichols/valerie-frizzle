import type { ConnectionManager } from '../services/connectionManager'
import type { PreferencesRepo } from '../services/db/preferencesRepo'
import type { ProfilesRepo } from '../services/db/profilesRepo'
import { registerConnectionsIpcHandlers } from './connections.ipc'
import { registerEntitiesIpcHandlers } from './entities.ipc'
import { registerMessagesIpcHandlers } from './messages.ipc'
import { registerPreferencesIpcHandlers } from './preferences.ipc'

export function registerIpcHandlers(
  profilesRepo: ProfilesRepo,
  preferencesRepo: PreferencesRepo,
  connectionManager: ConnectionManager
): void {
  registerConnectionsIpcHandlers(profilesRepo, connectionManager)
  registerEntitiesIpcHandlers(connectionManager)
  registerMessagesIpcHandlers(connectionManager)
  registerPreferencesIpcHandlers(preferencesRepo)
}
