import { contextBridge, ipcRenderer } from 'electron'
import { PURGE_PROGRESS_CHANNEL, type IpcChannels, type PurgeProgressEvent } from '../shared/ipc-contract'

function invoke<K extends keyof IpcChannels>(
  channel: K,
  request: IpcChannels[K]['request']
): Promise<IpcChannels[K]['response']> {
  return ipcRenderer.invoke(channel, request)
}

const api = {
  app: {
    ping: (message: string) => invoke('app:ping', { message })
  },
  connections: {
    list: () => invoke('connections:list', undefined),
    create: (request: IpcChannels['connections:create']['request']) =>
      invoke('connections:create', request),
    update: (request: IpcChannels['connections:update']['request']) =>
      invoke('connections:update', request),
    delete: (id: string) => invoke('connections:delete', { id }),
    connect: (id: string) => invoke('connections:connect', { id }),
    disconnect: (id: string) => invoke('connections:disconnect', { id }),
    status: (id: string) => invoke('connections:status', { id })
  },
  entities: {
    queues: {
      list: (profileId: string) => invoke('entities:queues:list', { profileId }),
      get: (profileId: string, name: string) => invoke('entities:queues:get', { profileId, name }),
      create: (profileId: string, input: IpcChannels['entities:queues:create']['request']['input']) =>
        invoke('entities:queues:create', { profileId, input }),
      update: (
        profileId: string,
        name: string,
        input: IpcChannels['entities:queues:update']['request']['input']
      ) => invoke('entities:queues:update', { profileId, name, input }),
      delete: (profileId: string, name: string) => invoke('entities:queues:delete', { profileId, name })
    },
    topics: {
      list: (profileId: string) => invoke('entities:topics:list', { profileId }),
      get: (profileId: string, name: string) => invoke('entities:topics:get', { profileId, name }),
      create: (profileId: string, input: IpcChannels['entities:topics:create']['request']['input']) =>
        invoke('entities:topics:create', { profileId, input }),
      update: (
        profileId: string,
        name: string,
        input: IpcChannels['entities:topics:update']['request']['input']
      ) => invoke('entities:topics:update', { profileId, name, input }),
      delete: (profileId: string, name: string) => invoke('entities:topics:delete', { profileId, name })
    },
    subscriptions: {
      list: (profileId: string, topicName: string) =>
        invoke('entities:subscriptions:list', { profileId, topicName }),
      get: (profileId: string, topicName: string, subscriptionName: string) =>
        invoke('entities:subscriptions:get', { profileId, topicName, subscriptionName }),
      create: (
        profileId: string,
        input: IpcChannels['entities:subscriptions:create']['request']['input']
      ) => invoke('entities:subscriptions:create', { profileId, input }),
      update: (
        profileId: string,
        topicName: string,
        subscriptionName: string,
        input: IpcChannels['entities:subscriptions:update']['request']['input']
      ) => invoke('entities:subscriptions:update', { profileId, topicName, subscriptionName, input }),
      delete: (profileId: string, topicName: string, subscriptionName: string) =>
        invoke('entities:subscriptions:delete', { profileId, topicName, subscriptionName })
    },
    rules: {
      list: (profileId: string, topicName: string, subscriptionName: string) =>
        invoke('entities:rules:list', { profileId, topicName, subscriptionName }),
      create: (profileId: string, input: IpcChannels['entities:rules:create']['request']['input']) =>
        invoke('entities:rules:create', { profileId, input }),
      delete: (profileId: string, topicName: string, subscriptionName: string, name: string) =>
        invoke('entities:rules:delete', { profileId, topicName, subscriptionName, name })
    }
  },
  messages: {
    send: (profileId: string, entityPath: string, envelope: IpcChannels['messages:send']['request']['envelope']) =>
      invoke('messages:send', { profileId, entityPath, envelope }),
    peek: (profileId: string, entityPath: string, maxCount: number, fromSequenceNumber?: number) =>
      invoke('messages:peek', { profileId, entityPath, maxCount, fromSequenceNumber }),
    receive: (
      profileId: string,
      entityPath: string,
      maxCount: number,
      mode: IpcChannels['messages:receive']['request']['mode'],
      maxWaitTimeMs: number
    ) => invoke('messages:receive', { profileId, entityPath, maxCount, mode, maxWaitTimeMs }),
    complete: (profileId: string, handleId: string) => invoke('messages:complete', { profileId, handleId }),
    abandon: (profileId: string, handleId: string) => invoke('messages:abandon', { profileId, handleId }),
    deadLetter: (profileId: string, handleId: string, reason: string, description: string) =>
      invoke('messages:deadLetter', { profileId, handleId, reason, description }),
    purgeStart: (profileId: string, entityPath: string) =>
      invoke('messages:purge:start', { profileId, entityPath }),
    onPurgeProgress: (jobId: string, callback: (event: PurgeProgressEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: PurgeProgressEvent): void => {
        if (data.jobId === jobId) callback(data)
      }
      ipcRenderer.on(PURGE_PROGRESS_CHANNEL, listener)
      return () => ipcRenderer.off(PURGE_PROGRESS_CHANNEL, listener)
    },
    resubmit: (
      profileId: string,
      handleId: string,
      message: IpcChannels['messages:resubmit']['request']['message'],
      destinationEntityPath: string,
      regenerateMessageId: boolean
    ) =>
      invoke('messages:resubmit', {
        profileId,
        handleId,
        message,
        destinationEntityPath,
        regenerateMessageId
      })
  }
}
// This app always sets contextIsolation: true (see src/main/index.ts), so contextBridge
// is the only path — no nodeIntegration fallback.
contextBridge.exposeInMainWorld('sbAdmin', api)
