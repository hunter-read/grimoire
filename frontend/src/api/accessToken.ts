/**
 * The current access token, held in memory only.
 *
 * The HttpOnly session cookie already carries the same JWT for image and
 * download requests, and the refresh cookie gets a new one after a reload
 * (`AuthContext` does that at start-up), so there is no reason to also leave a
 * copy in `localStorage`, where any script on the page could read it.
 */
let accessToken: string | null = null

// Older builds kept a copy in localStorage. Nothing reads it any more; drop it.
try {
  localStorage.removeItem('grimoire_token')
} catch {
  // Storage can be unavailable (private mode, blocked site data).
}

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}
