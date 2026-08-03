import { AdminService } from '../services/adminService'
import type { ConnectionManager } from '../services/connectionManager'
import { registerHandler } from './wrapHandler'

export function registerEntitiesIpcHandlers(connectionManager: ConnectionManager): void {
  function adminServiceFor(profileId: string): AdminService {
    return new AdminService(connectionManager.getAdminClient(profileId))
  }

  registerHandler('entities:queues:list', (request) =>
    adminServiceFor(request.profileId).listQueues()
  )

  registerHandler('entities:queues:get', (request) =>
    adminServiceFor(request.profileId).getQueue(request.name)
  )

  registerHandler('entities:queues:create', (request) =>
    adminServiceFor(request.profileId).createQueue(request.input)
  )

  registerHandler('entities:queues:update', (request) =>
    adminServiceFor(request.profileId).updateQueue(request.name, request.input)
  )

  registerHandler('entities:queues:delete', async (request) => {
    await adminServiceFor(request.profileId).deleteQueue(request.name)
    return undefined
  })

  registerHandler('entities:topics:list', (request) =>
    adminServiceFor(request.profileId).listTopics()
  )

  registerHandler('entities:topics:get', (request) =>
    adminServiceFor(request.profileId).getTopic(request.name)
  )

  registerHandler('entities:topics:create', (request) =>
    adminServiceFor(request.profileId).createTopic(request.input)
  )

  registerHandler('entities:topics:update', (request) =>
    adminServiceFor(request.profileId).updateTopic(request.name, request.input)
  )

  registerHandler('entities:topics:delete', async (request) => {
    await adminServiceFor(request.profileId).deleteTopic(request.name)
    return undefined
  })

  registerHandler('entities:subscriptions:list', (request) =>
    adminServiceFor(request.profileId).listSubscriptions(request.topicName)
  )

  registerHandler('entities:subscriptions:get', (request) =>
    adminServiceFor(request.profileId).getSubscription(request.topicName, request.subscriptionName)
  )

  registerHandler('entities:subscriptions:create', (request) =>
    adminServiceFor(request.profileId).createSubscription(request.input)
  )

  registerHandler('entities:subscriptions:update', (request) =>
    adminServiceFor(request.profileId).updateSubscription(
      request.topicName,
      request.subscriptionName,
      request.input
    )
  )

  registerHandler('entities:subscriptions:delete', async (request) => {
    await adminServiceFor(request.profileId).deleteSubscription(
      request.topicName,
      request.subscriptionName
    )
    return undefined
  })

  registerHandler('entities:rules:list', (request) =>
    adminServiceFor(request.profileId).listRules(request.topicName, request.subscriptionName)
  )

  registerHandler('entities:rules:create', (request) =>
    adminServiceFor(request.profileId).createRule(request.input)
  )

  registerHandler('entities:rules:update', (request) =>
    adminServiceFor(request.profileId).updateRule(request.input)
  )

  registerHandler('entities:rules:delete', async (request) => {
    await adminServiceFor(request.profileId).deleteRule(
      request.topicName,
      request.subscriptionName,
      request.name
    )
    return undefined
  })
}
