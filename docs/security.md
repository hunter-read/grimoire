# Security hardening

What Grimoire does to protect a deployment out of the box, and what you should set when
it is reachable from the internet.

---

## Auth rate limiting

The credential-checking endpoints - `/api/auth/login`, `/api/auth/setup`, and `/api/auth/guest-login` - are rate-limited per client IP to slow online password / invite-code brute-forcing. Failed [API key](api.md#api-keys) attempts count against the same limit on every endpoint; only failures count, so a working integration is never throttled, and an IP over the limit is refused even with a valid key so a guess can't be confirmed. The default is **`10/minute`** per IP; exceeding it returns HTTP `429`. Tune it with `AUTH_RATE_LIMIT` (a [`limits`](https://limits.readthedocs.io/en/stable/quickstart.html#rate-limit-string-notation) string such as `20/minute` or `100/hour`), or turn it off with `RATE_LIMIT_ENABLED=false`.

**Behind a reverse proxy:** keying is done on the left-most `X-Forwarded-For` address by default (`TRUST_FORWARDED_FOR=true`) so each real client - not the proxy - gets its own bucket. Make sure your proxy sets `X-Forwarded-For`. If Grimoire is exposed directly with no trusted proxy in front, set `TRUST_FORWARDED_FOR=false` so a spoofed header can't be used to sidestep the limit.

**Multiple replicas:** when `VALKEY_URL` is set the limit counters are shared through Valkey so the limit is enforced consistently across all workers/replicas; without it each process keeps its own in-memory counters (and the limiter falls back to in-memory automatically if Valkey becomes unreachable).

## Security headers

Every response carries a `Content-Security-Policy` scoped to what the SPA actually loads (own scripts, inline styles used by React, Google Fonts, and `data:`/`blob:` images for rendered pages), plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (matching the CSP `frame-ancestors 'none'`), and `Referrer-Policy: strict-origin-when-cross-origin`. `Strict-Transport-Security` is emitted **only when the request is HTTPS** - either directly or via an `X-Forwarded-Proto: https` header from your TLS-terminating proxy - so it is never sent over plain HTTP.

## Session cookie for images and downloads

Browser `<img>` and download requests can't send an `Authorization` header, so they authenticate via an `HttpOnly`, `SameSite=Lax` session cookie (`grimoire_session`) set at login rather than a token in the URL. **This means the JWT no longer appears in image/download URLs, so a reverse proxy, CDN, or load balancer in front of Grimoire no longer records it in access logs** (query-string tokens also leaked via `Referer` headers and browser history). Set `BASE_URL` to your `https://` public URL so the cookie is marked `Secure` and only ever sent over TLS. The old `?token=` query param is still accepted for backward compatibility but is deprecated.

## Sessions and token revocation

Logging in issues a **short-lived access token** (30 minutes by default) plus a long-lived **refresh token** stored in an `HttpOnly` cookie. The browser refreshes in the background, so this is invisible in normal use - you stay logged in as before.

What it buys you is a kill switch. Previously a token was valid for 30 days and there was no way to revoke it short of rotating `SECRET_KEY`, which logged **everyone** out. Now every login is a session you can end individually.

**Managing your sessions.** Settings → User → *Active Sessions* lists every device signed in to your account, with its browser, IP, and when it was last used. Revoke any one of them, or use **Sign out all other devices** to end every session but the one you're on - the thing to do if you've lost a device or think someone else has your password.

Sessions are also revoked automatically when an admin changes your role or resets your password, when you change your own password (all *other* devices), when a guest's invite code is regenerated, and when an account is deleted. This works the same for OIDC/SSO logins as for local ones.

**One caveat worth understanding:** revoking a session kills its refresh token immediately, but an access token already issued stays valid until it expires - up to `ACCESS_TOKEN_EXPIRE_MINUTES` (30 by default). This is the trade for not hitting the database on every single request. If you want revocation to bite faster, lower `ACCESS_TOKEN_EXPIRE_MINUTES`; the cost is more frequent background refreshes.

Refresh tokens are single-use and rotate on every refresh, and only a hash of each is stored in the database. If a refresh token is ever presented twice - the signature of a stolen token being replayed - Grimoire revokes that entire session rather than just refusing the request.

Dead sessions are cleared out automatically: a background job runs at startup and then daily, deleting sessions that expired or were revoked more than **7 days** ago. The delay is deliberate - a refresh token replayed shortly after logout is still recognised as a reuse rather than looking like an unknown token. Nothing to configure, and it runs in only one worker regardless of `WORKERS`.

---

## See also

- [Configuration](configuration.md) - every variable named here
- [Users and permissions](users-and-permissions.md) - roles, restrictions, and pre-seeding
- [OpenID Connect](oidc.md) - delegating sign-in to your own identity provider
