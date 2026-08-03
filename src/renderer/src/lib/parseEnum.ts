/**
 * Narrows a raw string from a UI control (shadcn Select/RadioGroup callbacks are typed
 * `string`) to a known union member, falling back instead of blindly asserting with `as`.
 */
export function parseEnum<const T extends string>(
  values: readonly T[],
  raw: string,
  fallback: T
): T {
  return (values as readonly string[]).includes(raw) ? (raw as T) : fallback
}
