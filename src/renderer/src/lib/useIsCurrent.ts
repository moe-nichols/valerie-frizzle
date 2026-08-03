import { useRef } from 'react'

/**
 * Returns a predicate that reports whether `key` is still the most recent value this hook
 * has seen. An async operation captures the predicate when it starts; if the component's
 * `key` (e.g. the selected `profileId::entityName`) changes before the operation resolves,
 * the predicate returns `false` so the stale result can be discarded instead of clobbering
 * state that now belongs to a different selection.
 *
 * Works because both the predicate and the async caller are recreated together on each
 * render: a superseded caller holds a predicate closed over the old `key`, while the shared
 * ref already points at the newest one.
 */
export function useIsCurrent(key: string): () => boolean {
  const latest = useRef(key)
  latest.current = key
  return () => latest.current === key
}
