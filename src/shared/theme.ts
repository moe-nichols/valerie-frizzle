export type Theme = 'light' | 'dark'

// The app shipped dark-only (index.html sets class="dark"), so dark stays the default for
// anything missing, malformed, or unloadable — matching the pre-toggle behavior.
export const DEFAULT_THEME: Theme = 'dark'
