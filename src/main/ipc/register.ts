import { registerAppIpcHandlers } from './app.ipc'
import { registerConnectionsIpcHandlers } from './connections.ipc'
import { registerEntitiesIpcHandlers } from './entities.ipc'
import { registerMessagesIpcHandlers } from './messages.ipc'
import type { ProfilesRepo } from '../services/db/profilesRepo'
import type { ConnectionManager } from '../services/connectionManager'

export function registerIpcHandlers(
  profilesRepo: ProfilesRepo,
  connectionManager: ConnectionManager
): void {
  registerAppIpcHandlers()
  registerConnectionsIpcHandlers(profilesRepo, connectionManager)
  registerEntitiesIpcHandlers(connectionManager)
  registerMessagesIpcHandlers(connectionManager)
}
