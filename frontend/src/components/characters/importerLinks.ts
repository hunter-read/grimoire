/**
 * A link from an add-on's manifest - its website, an example of the links it
 * reads - as something safe to put in an `href`: an absolute http(s) URL, or
 * null. A manifest is someone else's text, so `javascript:` and friends never
 * become links.
 */
export function safeLink(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return null
  try {
    const { protocol } = new URL(text)
    return protocol === 'http:' || protocol === 'https:' ? text : null
  } catch {
    return null
  }
}
