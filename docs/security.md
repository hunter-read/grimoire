# Security hardening

What Grimoire does to protect a deployment out of the box, and what you should set when
it is reachable from the internet.

---

## Non-root container

The image does not run Grimoire as root. It starts as root only to hand `DATA_PATH` to an
unprivileged user, then drops to that user before Grimoire starts. Add-on scripts, the
PDF, image and archive parsers, and `ffmpeg` all run without root, so a flaw in one of
them can't reach beyond what that user can. By default the user is whoever owns the
mounted library; `PUID`/`PGID` choose it and `--user` (or Kubernetes `runAsUser`) skips the
switch entirely. See [Which user Grimoire runs as](docker-install.md#which-user-grimoire-runs-as).

The image's own code under `/app` stays owned by root, so the running app can't modify it.

## Auth rate limiting

The credential-checking endpoints - `/api/auth/login`, `/api/auth/setup`, and `/api/auth/guest-login` - are rate-limited per client IP to slow online password / invite-code guessing. Failed [API key](api.md#api-keys) attempts count against the same limit on every endpoint; only failures count, and a working key is never refused, so an integration keeps working even from an address it shares with others. The default is **`10/minute`** per IP; exceeding it returns HTTP `429`. Tune it with `AUTH_RATE_LIMIT` (a [`limits`](https://limits.readthedocs.io/en/stable/quickstart.html#rate-limit-string-notation) string such as `20/minute` or `100/hour`), or turn it off with `RATE_LIMIT_ENABLED=false`.

**Per account and per link.** Failed logins are also counted against the account being signed in to (by the username typed, whether or not it exists), and wrong share-link passwords against the link, however many addresses the attempts come from. The default is **`20/hour`**; tune it with `ACCOUNT_RATE_LIMIT`. A browser that has signed in to an account before keeps its own count (it holds an HttpOnly `grimoire_device` cookie for that account), so failed attempts elsewhere don't stop the owner signing in from their usual browser. Single sign-on and existing sessions are not affected.

### Behind a reverse proxy

`X-Forwarded-For` is only read from connections that come from a trusted proxy, and it is read from the right: each proxy appends the address it received the request from, so the right-most address that isn't itself a trusted proxy is the client. The default trust list - loopback plus the private ranges `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` and `fc00::/7` - covers a proxy or tunnel on the same host, Docker network or LAN, so nginx, Nginx Proxy Manager, SWAG, Traefik, Caddy, Cloudflare Tunnel and Tailscale need no setting. A direct connection from anywhere else is keyed on its own address, whatever header it sends.

- **Proxy on a public address** (a VPS reaching your server over the internet): add its address to `TRUSTED_PROXIES`. Until you do, every client behind it shares one bucket.
- **Cloudflare's proxy (orange cloud) in front of your own reverse proxy**, without Cloudflare Tunnel: requests reach your proxy from Cloudflare's addresses, so add [Cloudflare's IP ranges](https://www.cloudflare.com/ips/) to `TRUSTED_PROXIES` (keeping the default private ranges). Until you do, clients share Cloudflare's addresses for rate limiting and Active Sessions shows them. Cloudflare Tunnel needs nothing.
- **No proxy at all:** nothing to set; set `TRUST_FORWARDED_FOR=false` if you also want the header ignored from LAN addresses.
- **Rootless Podman on a bridge network, or Docker Desktop, exposed directly:** these port forwarders replace each client's address with an internal one, so every client looks the same to Grimoire and Active Sessions shows that internal address. The per-account limits above still apply. To see real addresses, put a reverse proxy or tunnel in front, or on recent Podman set `rootless_port_forwarder = "pasta"` in `containers.conf`.

**Multiple replicas:** when `VALKEY_URL` is set the limit counters are shared through Valkey so the limit is enforced consistently across all workers/replicas; without it each process keeps its own in-memory counters (and the limiter falls back to in-memory automatically if Valkey becomes unreachable).

## Security headers

Every response carries a `Content-Security-Policy` scoped to what the SPA actually loads (own scripts, inline styles used by React, Google Fonts, and `data:`/`blob:` images for rendered pages), plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (matching the CSP `frame-ancestors 'none'`), and `Referrer-Policy: strict-origin-when-cross-origin`. `Strict-Transport-Security` is emitted **only when the request is HTTPS** - either directly or via an `X-Forwarded-Proto: https` header from your TLS-terminating proxy - so it is never sent over plain HTTP.

## Session cookie for images and downloads

Browser `<img>` and download requests can't send an `Authorization` header, so they authenticate via an `HttpOnly`, `SameSite=Lax` session cookie (`grimoire_session`) set at login rather than a token in the URL. **This means the JWT no longer appears in image/download URLs, so a reverse proxy, CDN, or load balancer in front of Grimoire no longer records it in access logs** (query-string tokens also leaked via `Referer` headers and browser history). Set `BASE_URL` to your `https://` public URL so the cookie is marked `Secure` and only ever sent over TLS; without it, the cookie is still marked `Secure` on a request that arrived over HTTPS, or that a [trusted proxy](#behind-a-reverse-proxy) reports as `X-Forwarded-Proto: https`. A token in the URL (the old `?token=` parameter) is no longer accepted at all.

The cookie only authenticates **reads** (`GET`/`HEAD`). A browser attaches the cookie on its own, and `SameSite=Lax` still lets a page on another subdomain of your domain send it with a form post, so anything that changes data needs the `Authorization` header the app always sends, which no other page can add.

## Sessions and token revocation

Logging in issues a **short-lived access token** (30 minutes by default) plus a long-lived **refresh token** stored in an `HttpOnly` cookie. The browser refreshes in the background, so this is invisible in normal use - you stay logged in as before.

What it buys you is a kill switch. Previously a token was valid for 30 days and there was no way to revoke it short of rotating `SECRET_KEY`, which logged **everyone** out. Now every login is a session you can end individually.

**Managing your sessions.** Settings → User → *Active Sessions* lists every device signed in to your account, with its browser, IP, and when it was last used. Revoke any one of them, or use **Sign out all other devices** to end every session but the one you're on - the thing to do if you've lost a device or think someone else has your password.

Sessions are also revoked automatically when an admin changes your role or resets your password, when you change your own password (all *other* devices), when a guest's invite code is regenerated, and when an account is deleted. This works the same for OIDC/SSO logins as for local ones.

**One caveat worth understanding:** revoking a session kills its refresh token immediately, but an access token already issued stays valid until it expires - up to `ACCESS_TOKEN_EXPIRE_MINUTES` (30 by default) - for ordinary requests. This is the trade for not hitting the database on every single request. Requests from GM and admin accounts are checked against the account's current role and whether their session has ended, every time, so a role change, a deleted account or a revoked session takes effect for those roles immediately. A guest's session also ends at its next refresh once guest access is turned off or its invite is removed - so a removed guest, like a player whose sessions you ended, can keep using the token they already hold for up to that long. If you want revocation to bite faster everywhere else, lower `ACCESS_TOKEN_EXPIRE_MINUTES`; the cost is more frequent background refreshes.

Refresh tokens are single-use and rotate on every refresh, and only a hash of each is stored in the database. If a refresh token is ever presented twice - the signature of a stolen token being replayed - Grimoire revokes that entire session rather than just refusing the request.

Dead sessions are cleared out automatically: a background job runs at startup and then daily, deleting sessions that expired or were revoked more than **7 days** ago. The delay is deliberate - a refresh token replayed shortly after logout is still recognised as a reuse rather than looking like an unknown token. Nothing to configure, and it runs in only one worker regardless of `WORKERS`.

## Feed and share tokens at rest

OPDS feed URLs, calendar subscription URLs and share links each carry a token that works on its own, with no login. None of them is stored as itself. The database keeps an HMAC-SHA256 of each token, keyed by `SECRET_KEY`, which requests are matched on, and a copy of the token encrypted under a second key derived from `SECRET_KEY`, so you can copy your feed URL or a share link again later. API keys and refresh tokens are stored as hashes too.

A [backup](backups.md) therefore holds no usable feed or share URL: it contains `grimoire.db` but not `secret_key`. Backups are written with SQLite's `VACUUM INTO`, so the copy holds only live rows - nothing deleted or overwritten, which a page-by-page copy would carry along in the file's free space.

Two consequences of keying them on `SECRET_KEY`:

- **Changing `SECRET_KEY` ends every feed and share link**, just as it signs everyone out. OPDS and calendar settings offer a new URL, and share links show as **Lost** - revoke or delete them and make new ones.
- **Restoring a backup on a server with a different `SECRET_KEY`** has the same effect. Keep `secret_key` (or your `SECRET_KEY` value) with your backups if you want feeds and links to survive a move - but store it separately from them, or a stolen backup becomes usable again.

The **OIDC client secret** entered in Settings → Authentication is kept the same way: encrypted under a key derived from `SECRET_KEY`, and decrypted only when Grimoire presents it to your identity provider, so a backup does not carry it either. If `SECRET_KEY` changes, the stored secret can no longer be read; single sign-on stops until you enter the secret again, and the log says so. Setting `OIDC_CLIENT_SECRET` in the environment instead keeps it out of the database altogether and is the recommended setup.

Upgrading from a version that stored these tokens or the client secret in plaintext converts them in place, so every feed URL and share link already handed out keeps working. The first start after that upgrade also compacts the database once (a `VACUUM`), so the old plaintext does not linger in the file's free space. It needs free disk space about the size of the database for a moment; if it cannot run, the log says so and it tries again at the next start.

---

## See also

- [Configuration](configuration.md) - every variable named here
- [Users and permissions](users-and-permissions.md) - roles, restrictions, and pre-seeding
- [OpenID Connect](oidc.md) - delegating sign-in to your own identity provider
