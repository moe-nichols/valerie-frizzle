import { registerHandler } from './wrapHandler'

export function registerAppIpcHandlers(): void {
  // TODO: app:ping is scaffolding with no product use — remove it (and its contract,
  // schema, and preload entries) unless it grows into a real health check.
  registerHandler('app:ping', (request) => ({ echo: request.message, timestamp: Date.now() }))
}
