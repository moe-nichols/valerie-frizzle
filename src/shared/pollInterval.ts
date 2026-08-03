// Shared by the main process (persistence/clamping), the IPC schemas (validation bounds),
// and the renderer (fallback when the preference fails to load).
export const DEFAULT_POLL_INTERVAL_MS = 10_000
export const MIN_POLL_INTERVAL_MS = 2_000
export const MAX_POLL_INTERVAL_MS = 300_000
