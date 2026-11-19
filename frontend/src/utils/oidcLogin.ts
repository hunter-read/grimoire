const OIDC_LOGIN = '/api/auth/openid/login'

// Pages that belong to signing in, so there is nothing to come back to.
const SIGN_IN_PATHS = ['/login', '/guest']

// Query parameters the sign-in page reads for itself.
const SIGN_IN_PARAMS = ['oidc_error', 'autoLaunch']

/**
 * The address that starts an OIDC sign-in from the page at `location`. It asks
 * the server to come back to that page afterwards, so a link opened while
 * signed out (a book, a campaign, an MCP sign-in request) still opens once
 * the provider sends the browser back. The server accepts only a same-origin
 * path (`_safe_return_to`) and falls back to `/` for anything else.
 */
export function oidcLoginUrl(location: Pick<Location, 'pathname' | 'search'>): string {
  const { pathname } = location
  if (SIGN_IN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return OIDC_LOGIN
  }
  const params = new URLSearchParams(location.search)
  SIGN_IN_PARAMS.forEach((p) => params.delete(p))
  const query = params.toString()
  const returnTo = query ? `${pathname}?${query}` : pathname
  if (returnTo === '/') return OIDC_LOGIN
  return `${OIDC_LOGIN}?${new URLSearchParams({ return_to: returnTo })}`
}

/** Send the browser to the OIDC provider, coming back to the current page. */
export function startOidcLogin(): void {
  window.location.assign(oidcLoginUrl(window.location))
}
