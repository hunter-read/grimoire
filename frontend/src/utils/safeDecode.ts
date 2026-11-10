/**
 * `decodeURIComponent` that never throws. A malformed percent-escape (a stray
 * `%`, a cut-off UTF-8 sequence like `%E0%A4%A`) gives `null` instead of a
 * `URIError`, so a hand-edited URL can't take a whole view down while it renders.
 */
export function tryDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** Decode `value`, or hand it back unchanged when it can't be decoded. */
export function safeDecodeURIComponent(value: string): string {
  return tryDecodeURIComponent(value) ?? value
}
