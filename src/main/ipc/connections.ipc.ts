import type { ProfilesRepo } from '../services/db/profilesRepo'
import type { ConnectionManager } from '../services/connectionManager'
import { registerHandler } from './wrapHandler'

export function registerConnectionsIpcHandlers(
  profilesRepo: ProfilesRepo,
  connectionManager: ConnectionManager
): void {
  registerHandler('connections:list', () => profilesRepo.list())

  registerHandler('connections:create', (request) => profilesRepo.create(request))

  registerHandler('connections:test', async (request) => {
    await connectionManager.testConnection(request.connectionString, request.managementPort)
    return undefined
  })

  registerHandler('connections:update', (request) => {
    const { id, ...input } = request
    return profilesRepo.update(id, input)
  })

  registerHandler('connections:delete', async (request) => {
    await connectionManager.disconnect(request.id)
    profilesRepo.delete(request.id)
    return undefined
  })

  registerHandler('connections:connect', async (request) => {
    await connectionManager.connect(request.id)
    return undefined
  })

  registerHandler('connections:disconnect', async (request) => {
    await connectionManager.disconnect(request.id)
    return undefined
  })

  registerHandler('connections:status', (request) => ({
    connected: connectionManager.isConnected(request.id)
  }))
}
