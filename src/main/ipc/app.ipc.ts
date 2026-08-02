import { registerHandler } from './wrapHandler'

export function registerAppIpcHandlers(): void {
  registerHandler('app:ping', (request) => ({ echo: request.message, timestamp: Date.now() }))
}
