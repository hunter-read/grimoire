/**
 * Shared bits for the share-link UI (issue #541).
 */
export { formatWhen } from '../settings/apiKeyUtils'

// The expiry choices offered when creating a link, in days ('' = never).
export const EXPIRY_OPTIONS = [
  { value: '1', key: 'day' },
  { value: '7', key: 'week' },
  { value: '30', key: 'month' },
  { value: '90', key: 'quarter' },
  { value: '365', key: 'year' },
  { value: '', key: 'never' },
]

// How each link state is coloured. Only "active" works; the rest say why not.
export const STATE_TONE: Record<string, string> = {
  active: 'var(--success)',
  suspended: 'var(--warning)',
  unavailable: 'var(--warning)',
  expired: 'var(--text-muted)',
  revoked: 'var(--danger)',
  // Sealed under a SECRET_KEY since replaced: dead for good, like a revoked one.
  lost: 'var(--danger)',
  disabled: 'var(--text-muted)',
}

/** Copy text to the clipboard; false when the browser refuses (insecure origin). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The address to hand out for a link the server built from BASE_URL.
 *
 * BASE_URL defaults to http://localhost:9481, and an instance that never set
 * it would otherwise give out links pointing at the recipient's own machine.
 * When the server's address is a loopback one but this page is not, the
 * address this browser reached Grimoire on is the better guess. A configured
 * BASE_URL - the public address behind a reverse proxy - is used as-is.
 */
export function publicUrl(
  url: string,
  here: Pick<Location, 'hostname' | 'origin'> = window.location
): string {
  try {
    const parsed = new URL(url)
    if (LOOPBACK.has(parsed.hostname) && !LOOPBACK.has(here.hostname)) {
      return `${here.origin}${parsed.pathname}${parsed.search}`
    }
  } catch {
    // Not an absolute URL; nothing to correct.
  }
  return url
}
