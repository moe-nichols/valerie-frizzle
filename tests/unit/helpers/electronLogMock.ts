import { vi } from 'vitest'

/**
 * The electron-log surface the main-process code uses, as one shared set of spies.
 * vi.mock factories are hoisted above imports, so register it with the async form:
 *
 *   vi.mock('electron-log/main', async () =>
 *     (await import('./helpers/electronLogMock')).electronLogModule()
 *   )
 */
export const electronLog = {
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  info: vi.fn()
}

export function electronLogModule(): { default: typeof electronLog } {
  return { default: electronLog }
}
