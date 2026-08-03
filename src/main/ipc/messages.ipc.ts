import { randomUUID } from 'node:crypto'
import { PURGE_PROGRESS_CHANNEL, type PurgeProgressEvent } from '@shared/ipc-contract'
import type { ConnectionManager } from '../services/connectionManager'
import { purgeEntity } from '../services/purgeService'
import { resubmitMessage } from '../services/replayService'
import { registerHandler } from './wrapHandler'

export function registerMessagesIpcHandlers(connectionManager: ConnectionManager): void {
  registerHandler('messages:send', async (request) => {
    await connectionManager
      .getMessagingService(request.profileId)
      .sendMessage(request.entityPath, request.envelope)
    return undefined
  })

  registerHandler('messages:peek', (request) =>
    connectionManager
      .getMessagingService(request.profileId)
      .peekMessages(request.entityPath, request.maxCount, request.fromSequenceNumber)
  )

  registerHandler('messages:peekSubscription', (request) =>
    connectionManager
      .getMessagingService(request.profileId)
      .peekSubscriptionMessages(
        request.topicName,
        request.subscriptionName,
        request.maxCount,
        request.fromSequenceNumber,
        request.deadLetter
      )
  )

  registerHandler('messages:count', (request) =>
    connectionManager
      .getMessagingService(request.profileId)
      .countMessages(request.entityPath, request.maxCount, request.fromSequenceNumber)
  )

  registerHandler('messages:countSubscription', (request) =>
    connectionManager
      .getMessagingService(request.profileId)
      .countSubscriptionMessages(
        request.topicName,
        request.subscriptionName,
        request.maxCount,
        request.fromSequenceNumber,
        request.deadLetter
      )
  )

  registerHandler('messages:receive', (request) =>
    connectionManager
      .getMessagingService(request.profileId)
      .receiveMessages(request.entityPath, request.maxCount, request.mode, request.maxWaitTimeMs)
  )

  registerHandler('messages:receiveSubscription', (request) =>
    connectionManager
      .getMessagingService(request.profileId)
      .receiveSubscriptionMessages(
        request.topicName,
        request.subscriptionName,
        request.maxCount,
        request.mode,
        request.maxWaitTimeMs,
        request.deadLetter
      )
  )

  registerHandler('messages:complete', async (request) => {
    await connectionManager.getMessagingService(request.profileId).completeMessage(request.handleId)
    return undefined
  })

  registerHandler('messages:abandon', async (request) => {
    await connectionManager.getMessagingService(request.profileId).abandonMessage(request.handleId)
    return undefined
  })

  registerHandler('messages:deadLetter', async (request) => {
    await connectionManager
      .getMessagingService(request.profileId)
      .deadLetterMessage(request.handleId, request.reason, request.description)
    return undefined
  })

  registerHandler('messages:purge:start', (request, event) => {
    const jobId = randomUUID()
    const sender = event.sender
    const messagingService = connectionManager.getMessagingService(request.profileId)

    // The renderer can navigate away or be destroyed mid-purge (reload, window close);
    // sending to a destroyed webContents throws. Guard every send so a gone window silently
    // drops progress instead of crashing the drain loop — and, critically, so the catch
    // handler below can't itself throw a second time on a destroyed sender.
    const sendProgress = (payload: PurgeProgressEvent): void => {
      if (!sender.isDestroyed()) {
        sender.send(PURGE_PROGRESS_CHANNEL, payload)
      }
    }

    // Fire-and-forget: purging can take a while on a large queue, so this doesn't block the
    // invoke call — progress is pushed separately as the loop runs.
    purgeEntity(messagingService, request.entityPath, (progress) => {
      sendProgress({ jobId, ...progress })
    }).catch((err) => {
      sendProgress({
        jobId,
        deletedCount: 0,
        done: true,
        error: err instanceof Error ? err.message : String(err)
      })
    })

    return { jobId }
  })

  registerHandler('messages:resubmit', async (request) => {
    await resubmitMessage(
      connectionManager.getMessagingService(request.profileId),
      request.handleId,
      request.message,
      request.destinationEntityPath,
      request.regenerateMessageId
    )
    return undefined
  })
}
