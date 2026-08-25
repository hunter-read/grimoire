# Grimoire API Reference

**Version:** 0.1.0

## Interactive docs

The live API is self-documented via OpenAPI. With the server running:

| URL | Description |
|-----|-------------|
| `http://localhost:9481/api/docs` | **Swagger UI** - interactive, try-it-out docs |
| `http://localhost:9481/api/redoc` | **ReDoc** - clean, readable reference |
| `http://localhost:9481/api/openapi.json` | Raw OpenAPI schema |

Every JSON endpoint declares a response model, so the spec carries real response
types (usable for client generation) rather than an empty schema. The only
routes without a body schema are the ones that do not return JSON - file, image
and archive downloads, OIDC redirects, and the SPA catch-all.
`backend/tests/test_openapi_response_models.py` enforces this: a new JSON route
that omits its `response_model=` fails the suite.

---

## Authentication

All endpoints except `/api/health`, `/api/auth/status`, `/api/auth/setup`, `/api/auth/login`, `/api/auth/guest-login`, `/api/auth/logout`, `/api/auth/refresh`, and `/api/auth/config` require a JWT.

**Header** (preferred for API clients):
```
Authorization: Bearer <token>
```

**Session cookie** (used by browser-embedded images and file downloads):

On a successful `/api/auth/login`, `/api/auth/setup`, `/api/auth/guest-login`, or OIDC callback, the server also sets an `HttpOnly`, `SameSite=Lax` cookie named `grimoire_session` carrying the JWT (marked `Secure` when `BASE_URL` is `https://`). `<img>` and download requests - which can't set an `Authorization` header - authenticate via this cookie, so the token never appears in the URL. `POST /api/auth/logout` clears it.

**Query parameter** (deprecated):
```
?token=<token>
```
Still accepted so pre-existing links keep working, but the JWT in a URL leaks into proxy/access logs, `Referer` headers, and browser history (see [#156](https://github.com/hunter-read/grimoire/issues/156)). The frontend no longer generates `?token=` URLs - use the cookie instead. This fallback may be removed in a future release.

The auth precedence for any request is: `Authorization` header → `grimoire_session` cookie → `?token=` query param.

### Token lifetimes and revocation

Access tokens are **short-lived** and paired with a long-lived refresh token, so a leaked token is no longer valid for a month with no way to stop it ([#157](https://github.com/hunter-read/grimoire/issues/157)).

| Credential | Default lifetime | Env var | Where it lives |
|------------|------------------|---------|----------------|
| Access token (JWT) | 30 minutes | `ACCESS_TOKEN_EXPIRE_MINUTES` | `Authorization` header, `grimoire_session` cookie |
| Refresh token | 30 days idle | `REFRESH_TOKEN_EXPIRE_DAYS` | `grimoire_refresh` cookie (`HttpOnly`, `SameSite=Strict`, scoped to `/api/auth`) |

Every login - password, first-run setup, guest code, and OIDC - creates a row in `auth_sessions`. The refresh token is bound to that row and only its SHA-256 is stored, so a database leak yields no usable sessions.

**How revocation works.** Revoking a session invalidates its refresh token immediately. The access token stays valid until it expires (at most `ACCESS_TOKEN_EXPIRE_MINUTES`), which is the deliberate trade for keeping access-token checks stateless and database-free on the hot path. Lower `ACCESS_TOKEN_EXPIRE_MINUTES` to narrow that window.

Refresh tokens are **single-use and rotate** on every exchange. Presenting a token that was already exchanged is treated as evidence it leaked and revokes the entire session rather than merely refusing the call.

Sessions are revoked automatically when:

- the user logs out (that session only);
- an admin changes the user's role or resets their password (all sessions);
- the user changes their own password (all sessions *except* the current one);
- a guest is removed or their invite code is regenerated;
- the user account is deleted.

When an access token expires, the response carries an `X-Token-Expired: 1` header alongside the 401 so clients can distinguish "refresh and retry" from a genuine authentication failure. The web client refreshes and replays the request automatically, sharing one in-flight refresh across concurrent 401s (parallel exchanges would rotate each other into invalidity).

### Rate limiting

The credential-checking endpoints - `/api/auth/login`, `/api/auth/setup`, `/api/auth/guest-login`, and `/api/stats` - are rate-limited per client IP (default `10/minute`, configurable via `AUTH_RATE_LIMIT`). Exceeding the limit returns `429 Too Many Requests` with `{"error": "Rate limit exceeded: ..."}`. Keying honors `X-Forwarded-For` behind a reverse proxy. See [Security hardening](../README.md#security-hardening).

### Roles

| Role | Permissions |
|------|-------------|
| `admin` | Full access including user management and app settings |
| `gm` | Read + edit metadata, rescan library, manage campaigns |
| `player` | Read-only access |

---

## Endpoints

### Health

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/health` | GET | - | Unauthenticated readiness probe used by the container `HEALTHCHECK`. Checks the database (always) and Valkey (only when configured). Returns `200` with `{"status": "ok", "checks": {...}}` when all dependencies are reachable, or `503` with `{"status": "unhealthy", ...}` otherwise. |

### Auth

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/status` | GET | - | Returns `{"initialized": bool}` - used by the frontend to decide whether to show first-run setup |
| `/api/auth/config` | GET | - | Public auth configuration for the login screen: `{password_auth_enabled, guest_access_enabled, custom_login_message_enabled, custom_login_message, oidc_enabled, oidc_button_text, oidc_auto_launch}`. The custom message is only returned when its toggle is on. OIDC fields are only true/non-empty when the IdP is fully configured. |
| `/api/auth/setup` | POST | - | First-run admin account creation. Body: `{username, password}`. Returns `{token, user}` and sets the `grimoire_session` cookie. Fails with 400 if any users exist. |
| `/api/auth/login` | POST | - | Authenticate. Body: `{username, password}`. Returns `{token, user}` (`user` includes `display_name`) and sets the `grimoire_session` cookie. Returns 403 if password authentication is disabled. |
| `/api/auth/guest-login` | POST | - | Exchange a campaign guest invite code for a JWT. Body: `{code}`. Returns `{token, user, campaign_id}` and sets the `grimoire_session` cookie - `user.display_name` is the GM-set guest nickname. Returns 403 if guest access is disabled, 401 for an unknown/expired code. |
| `/api/auth/logout` | POST | - | Revokes the current session (identified by the `grimoire_refresh` cookie) and clears both auth cookies. Requires no auth so a client with an expired access token can still log out. The refresh token dies immediately; the current access token remains valid until it expires. |
| `/api/auth/refresh` | POST | - | Exchanges the `grimoire_refresh` cookie for a new access token, rotating the refresh token. Returns `{token, user}` and re-sets both cookies. Returns 401 when the refresh token is missing, expired, or revoked; reusing an already-rotated token revokes the whole session. Rate-limited like the other credential endpoints. |
| `/api/auth/me` | GET | any | Current user: `{id, username, display_name, email, role, allow_explicit, campaign_access, oidc_linked}`. Also (re-)sets the `grimoire_session` cookie when the request authenticated via header but had no cookie, so clients that predate the cookie get one on next load. |
| `/api/auth/sessions` | GET | any | The caller's own live sessions, newest first: `[{id, origin, user_agent, ip_address, created_at, last_used_at, expires_at, current}]`. `origin` is `password`, `guest`, or `oidc`; `current` marks the session backing this request. |
| `/api/auth/sessions/others` | DELETE | any | Logs out everywhere else - revokes all of the caller's sessions except the current one. Returns `{ok, revoked, kept_current}`. |
| `/api/auth/sessions/{session_id}` | DELETE | any | Revokes a single session belonging to the caller. Returns 404 for an unknown session or one owned by another user. |
| `/api/auth/openid/login` | GET | - | Start an OIDC login. Redirects to the IdP. Optional `?return_to=/path` to redirect after callback. Returns 503 if OIDC isn't configured. |
| `/api/auth/openid/callback` | GET | - | OIDC callback. Validates the code, finds/creates the local user, opens a revocable session (`origin: "oidc"`), sets the `grimoire_session` and `grimoire_refresh` cookies, and redirects to the frontend with `#oidc_token=<jwt>`. Only the short-lived access token travels in the fragment; the refresh token is cookie-only. |
| `/api/auth/openid/discover` | POST | admin | Server-side discovery fetch. Body: `{issuer_url}`. Returns the relevant endpoints from `.well-known/openid-configuration`. |

### Users

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/users` | GET | admin | List all users (each entry includes `email`, `allow_explicit`, `campaign_access`, `campaign_count` (number of campaigns the user owns), and `oidc_linked`) |
| `/api/users` | POST | admin | Create a user. Body: `{username, password?, role?, email?, allow_explicit?, campaign_access?}` (role defaults to `player`; email is optional and unique case-insensitively; `password` may be omitted to create an OIDC-only account when password auth is disabled, otherwise it must be ≥8 chars). Returns the created user with `allow_explicit`, `campaign_access`, `campaign_count`, and `oidc_linked`. |
| `/api/users/guests` | GET | admin | List every per-campaign guest account. Each entry: `{id, display_name, created_at, campaign_id, campaign_name, invited_by}` (`invited_by` is the campaign owner's display name/username). Guests never appear in `GET /api/users`. |
| `/api/users/:id` | PATCH | admin | Update `role`, `password`, `allow_explicit`, `campaign_access`, or `email` (use `""` to clear the email). `campaign_access: false` blocks the user from creating/joining/managing campaigns without deleting existing ones; OIDC's `campaignAccess` permissions claim overrides it on next login. Changing a GM's role **drops their access grants** - see [Access levels](#access-levels-issue-258). |
| `/api/users/:id/convert` | POST | admin | Convert a guest account to a permanent user. Body: `{username, password?, role?}` (role defaults to `player`, cannot be `guest`). `password` is required only when password auth is enabled; ≥8 chars. Keeps the guest's campaign membership and character, clears its invite code, and returns the promoted user. 400 if the target isn't a guest or the username is taken. |
| `/api/users/:id/merge` | POST | admin | Fold one or more guest accounts into the account at `:id`, so someone invited to several campaigns ends up with a single login. Body: `{source_ids: [...]}` (non-empty, no duplicates, cannot contain `:id`). Moves each source's campaign memberships, notes, characters, and personal rows onto the target, then deletes the emptied sources and ends their sessions. Merged-in memberships have their invite code cleared - campaign access comes from the membership itself, so the person keeps every campaign and uses the surviving account's credentials. Rows that would collide (target is already in that campaign) are dropped in favour of the target's. Sources must be guests; the target may be a guest or a permanent user. Returns `{id, display_name, merged_ids, memberships_moved}`. 400 if a source isn't a guest or `:id` is among the sources, 404 if the target or any source is missing. |
| `/api/users/:id` | DELETE | admin | Delete a user (cannot delete self or last admin). Also the way to remove a guest account, including one orphaned by its campaign's deletion (null `campaign_id`/`invited_by`). |
| `/api/users/:id/access-grants` | GET | admin | List this user's library access grants. Each: `{id, user_id, scope_type, scope_id, scope_name, level}`. `scope_name` is `""` when the granted system/book has since been deleted. |
| `/api/users/:id/access-grants` | POST | admin | Grant access to one restricted system or book. Body: `{scope_type: "system"\|"book", scope_id, level: "gm"\|"admin"}`. Only **GMs** may hold grants (400 otherwise) - admins already see everything and players cannot be granted past a restriction. Re-granting an existing scope updates its level rather than erroring. 404 if the target system/book does not exist. See [Access levels](#access-levels-issue-258). |
| `/api/users/:id/access-grants/:grant_id` | DELETE | admin | Revoke a grant. `204` on success. |
| `/api/users/me/preferences` | PATCH | any | Update own `display_name`, `allow_explicit`, or `email` (use `""` to clear) |
| `/api/users/me/password` | PATCH | any | Change own password. Body: `{current_password, new_password}` |
| `/api/users/me` | DELETE | any | Delete own account (admin accounts cannot self-delete) |

### Library

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/stats` | GET | JWT **or** `X-API-Key` header | Counts, page totals, library size |
| `/api/about` | GET | any (JWT) | Build info for the About dialog: `{version, commit_hash, python_version}`. Deliberately **not** exposed on `/api/stats`, so these details aren't readable via the `X-API-Key` fallback. |
| `/api/latest-release` | GET | any (JWT) | Latest published release for the update-available check: `{latest_version}` (or `null`). Proxies GitHub's releases API server-side (cached ~1h) so the browser makes a same-origin request that request blockers won't block. Returns `null` when `DISABLE_VERSION_CHECKING` is set or GitHub is unreachable. |
| `/api/scan-status` | GET | admin | Current scan state. `phase` is `scanning` (file walk), `indexing` (text-layer extraction), or `ocr` (deferred OCR of scanned/image-only PDFs). During the `ocr` phase, `total_ocr`/`ocr_done`/`ocr_current` report the OCR queue's progress. |
| `/api/rescan` | POST | admin | Trigger a background rescan and reindex (optionally scoped, with a metadata-refresh mode) |
| `/api/cancel-scan` | POST | admin | Request a graceful stop of the running scan or indexing job |

**Stats response:**
```json
{
  "game_systems": 12,
  "books": 340,
  "maps": 1500,
  "tokens": 800,
  "audio": 250,
  "indexed_books": 320,
  "total_pages": 45000,
  "total_size_mb": 18240.5
}
```

`/api/stats` is the only endpoint that accepts the `X-API-Key` header, so it's
the safe way to surface library counts on an external dashboard. Generate a key
as an admin under **Settings → App Settings → Stats API Key** (regenerate or
revoke it there at any time).

**Homepage Custom API widget** - add this to your Homepage `services.yaml`
([Custom API widget docs](https://gethomepage.dev/widgets/services/customapi/)):

```yaml
- Grimoire:
    href: https://grimoire.example.com
    icon: grimoire.png
    widget:
      type: customapi
      url: https://grimoire.example.com/api/stats
      refreshInterval: 60000
      headers:
        X-API-Key: your-key-here
      mappings:
 - field: books
          label: Books
          format: number
 - field: maps
          label: Maps
          format: number
 - field: tokens
          label: Tokens
          format: number
 - field: total_size_mb
          label: Size
          format: float
          scale: 0.001
          suffix: " GB"
```

Homepage shows up to four fields per row; pick the counts you care about from the
available fields below. Use a `refreshInterval` of 60s or higher - `/api/stats`
is rate limited.

| Field | Meaning | Suggested `format` |
|-------|---------|--------------------|
| `game_systems` | Number of game systems. Excludes special collections and container folders, but *includes* the systems nested inside a container | `number` |
| `books` | Total books (PDFs) | `number` |
| `maps` | Total maps | `number` |
| `tokens` | Total tokens | `number` |
| `audio` | Total audio tracks | `number` |
| `indexed_books` | Books with a searchable full-text index | `number` |
| `total_pages` | Sum of all book page counts | `number` |
| `total_size_mb` | Total library size in MB | `float` - add `scale: 0.001` + `suffix: " GB"` to show GB |

**Scan-status response:**
```json
{
  "running": true,
  "phase": "scanning",
  "scanned_books": 120,
  "total_books": 340,
  "scanned_maps": 0,
  "total_maps": 1500,
  "scanned_tokens": 0,
  "total_tokens": 800,
  "scanned_audio": 0,
  "total_audio": 250,
  "new_books": 5,
  "new_maps": 0,
  "new_tokens": 0,
  "new_audio": 0,
  "updated_books": 0,
  "indexed": 80,
  "to_index": 320
}
```

`phase` is `"scanning"`, `"indexing"`, or `null` when idle. `updated_books` counts books whose metadata was re-applied from sidecar files during a metadata-refresh rescan. `replaced_books` counts books whose contents changed under an unchanged path (re-indexed in place), and `moved_files` counts files recognised as moved rather than deleted-and-re-added.

**Rescan request body** (all fields optional):
```json
{
  "scope": "books/D&D 5e/adventure",
  "metadata_mode": "missing"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `scope` | `null` | Restrict the rescan to a subtree relative to the library root. Must begin with `books/`, `maps/`, `tokens/`, or `audio/`. Omit to rescan the whole library. Paths that escape the library root return `400`. |
| `metadata_mode` | `"new"` | `"new"` adds new files and flags missing ones (existing records untouched). `"missing"` additionally fills **empty** book fields from sidecar metadata (`<stem>.opf` / `metadata.opf`), leaving fields you've already set in place. `"replace"` overwrites fields wherever the sidecar provides a value (destructive to UI-edited metadata). |

Returns `{"status": "scan_started"}`, or `{"status": "already_running"}` if a scan is already in progress (scoped and global rescans share the same single-worker lock).

**Cancel-scan response:**
```json
{"status": "stop_requested"}
```
Returns `{"status": "not_running"}` if no scan is in progress. Cancellation is cooperative - the running scan checks for the stop signal after each file and exits at the next safe checkpoint. Poll `/api/scan-status` until `running` is `false` to confirm it has stopped.

### Bulk operations

Every bulk-editable collection (`books`, `systems`, `maps`, `tokens`, `audio`)
exposes the same pair of endpoints, and the three media folder collections
(`map-folders`, `token-folders`, `audio-folders`) expose a bulk folder-tag route.
All require the gm/admin role.

| Route | Body | Purpose |
|-------|------|---------|
| `POST /api/<collection>/bulk` | `{items: [{id, ...PATCH fields}]}` | Per-item field edits. A per-item `tags` list **replaces** that item's tags |
| `POST /api/<collection>/bulk/tags` | `{ids: [...], tags: [...]}` | **Additively** applies tags - existing tags are kept |
| `POST /api/{map,token,audio}-folders/bulk` | `{folders: [{path, tags}]}` | Sets tags on many folder paths |

Each request is applied in a **single transaction**, which is what makes them
safe: the previous client-side approach of one PATCH per selected item raced on
the unique `tags.internal` constraint when several requests created the same new
tag concurrently, returning intermittent `500`s (issue #270).

All three return the same shape:

```json
{"updated": ["id1", "id2"], "errors": [{"id": "id3", "detail": "Token not found"}]}
```

Items that cannot be applied - an unknown id, or a system rename that clashes
with an existing name - are reported in `errors` and **skipped**, so one bad
entry never discards the rest of the batch. `bulk/tags` additionally returns
`tags` keyed by id with each resource's resulting tag list, letting clients patch
local state without refetching. A batch is capped at 1000 items; `ids`/`items`
must be non-empty (`422` otherwise).

### Game Systems

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/systems` | GET | any | List all systems with book counts, `total_page_count`, and metadata. Query: `sort` (`name`\|`book_count`\|`page_count`\|`year`), `order` (`asc`\|`desc`), `genre`, `family`, `parent_system`, `edition`, `license`, `explicit` (bool), `parent_id` (list one container's children), `include_children` (bool; flat list including nested systems) |
| `/api/systems/:id` | GET | any | System detail + full book list, plus `children` (the nested systems when this is a container). Query: `book_sort` (`category`\|`title`\|`page_count`\|`year`), `book_order`, `explicit` (bool), `genre`, `category` filter the returned books |
| `/api/systems/:id` | PATCH | gm/admin | Update metadata (see fields below) |
| `/api/systems/bulk` | POST | gm/admin | Bulk update. Body: `{items: [{id, ...PATCH fields}]}`. A name clash fails only that item |
| `/api/systems/bulk/tags` | POST | gm/admin | Bulk **add** tags. Body: `{ids, tags}` |
| `/api/systems/:id/cover` | GET | any | Serves the system's folder cover art or uploaded cover image. 404 when it has neither |
| `/api/systems/:id/cover` | POST | gm/admin | Upload a cover image (multipart `file`). PNG/JPEG/WebP/GIF, max 10 MB |
| `/api/systems/:id/cover/from-source` | POST | gm/admin | Set the cover from an image Grimoire already holds. Body: `{source_type, source_id}` - see [Setting an image from an existing asset](#setting-an-image-from-an-existing-asset) |
| `/api/systems/:id/cover` | DELETE | gm/admin | Remove the uploaded cover. Folder art is library-managed and unaffected |
| `/api/systems/:id/book-folders` | GET | any | Book subcategory folders for this system and their tags. Returns `{folders: [{path, tags}]}` |
| `/api/systems/:id/book-folders` | PATCH | gm/admin | Create or replace a folder's tag list. Body `{path, tags}`. `path` must be `{system_id}/{category}/{subfolder…}` for this system - 400 otherwise |
| `/api/systems/:id/book-folders` | DELETE | gm/admin | Delete a folder row and its tags. Query: `path` (same grammar as PATCH). 404 when no such row |

**PATCH fields:** `name`, `slug`, `description`, `publishers`, `character_builder_url` (legacy), `character_builder_urls`, `urls`, `cover_image`, `cover_book_id`, `tags`, `genre` (legacy), `genres`, `dice_materials`, `system_family`, `parent_system`, `edition`, `license`, `year`, `is_explicit`, `access_level` (**admin only**; `""`/`"gm"`/`"admin"` - a system has no `inherit` state. See [Access levels](#access-levels-issue-258))

**Publishers format:** `[{"name": "Publisher Name", "url": "https://..."}]`

**Link-list format** (`urls`, `character_builder_urls`): `[{"label": "DriveThruRPG", "url": "https://..."}]`

**Multi-value metadata** (issue #202): `genres` and `dice_materials` are string arrays; `genres` supersedes the legacy single `genre`, and `urls`/`character_builder_urls` supersede the legacy single-URL fields (the legacy fields remain accepted for backward compatibility). Systems in the special one-page collection carry `is_one_page: true` (grouped with `is_system_agnostic` in the library UI).

**Cover art:** a system's cover resolves in precedence order - a `cover.*`/`folder.*` image at its library folder root, then an uploaded image, then a book thumbnail. The first two are served by `/api/systems/:id/cover`; the third is a plain `/api/books/:cover_book_id/thumbnail` URL. The `has_cover` field says whether the cover endpoint will return an image, so clients can pick a source without a speculative 404. Container folders hold no books, so the endpoint is their only source of art.

**System containers:** a books folder can hold *systems* rather than categories (issues #261/#262/#301) - a parent system with its editions (`books/Dungeons & Dragons/5e/…`), a one-page/micro-RPG collection where each subfolder and loose file is its own small game, a system family grouping related-but-distinct systems (`books/d20 System/Pathfinder/…`), a publisher grouping one company's systems, or a bare `.container` shelf that groups without claiming any relationship. Family and publisher containers populate their children's `system_family`/`publishers` from the container name, and containers may nest (a family holding a parent-system container). Only a parent-system container sets its children's `parent_system` - the other kinds hold independent systems, not variants. Every system summary carries `container_kind` (`""`, `"parent"`, `"one-page"`, `"family"`, `"publisher"`, `"generic"`), `parent_id`, `child_count`, `name_is_custom`, and `category_depth`. `category_depth` is the index of the category dir within the system's book paths - 2 for a top-level system, one deeper per enclosing container - so clients can split a book's `relative_path` into subfolder segments without walking the container chain themselves (issue #357). Container children are omitted from `GET /api/systems` unless `parent_id` or `include_children` is passed, and `GET /api/systems/:id` returns them in `children`. Renaming a system via `PATCH` sets `name_is_custom`, which stops the scanner reverting the name on the next rescan.

**Parent system / edition:** `parent_system` (e.g. `"Dungeons & Dragons"`) is the mid-tier grouping between the broad `system_family` (`"d20 System"`) and a concrete system; `edition` (`"5e"`, `"Red"`, `"2020"`) combines with it for display (`"Cyberpunk Red"`). Both are free-text; `parent_system` values are curated via the `/api/parent-systems` lookup. Both are filterable on `/api/systems`.

#### Metadata lookup from add-ons (issue #203)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/systems/:id/metadata-sources` | GET | gm/admin | Installed, enabled add-ons that can supply game system metadata. Returns `{sources: [{id, name, description, homepage, attribution, supports_paste}]}` |
| `/api/systems/:id/metadata-search` | POST | gm/admin | Ranked candidates from one source. Body `{source_id, query?}` - a blank `query` defaults to the system's own name. Returns `{query, results: [{identity, label, score, url}]}` |
| `/api/systems/:id/metadata-fetch` | POST | gm/admin | One candidate's fields, diffed against the system. Body `{source_id, identity?, query?, paste?}`. Returns `{source_id, identity, url, attribution, fields}` |

All three are **read-only** - they never write to `game_systems`. Applying goes
through `PATCH /api/systems/:id` with only the fields the user selected, so a
fetch can never overwrite a value on its own.

**Diff rows** (`fields`) carry `{field, current, incoming, status}`, where `status` is:

| Status | Meaning |
|--------|---------|
| `only_incoming` | The system has no value yet - safe to fill in (pre-selected in the UI) |
| `differs` | Both have a value and they disagree - needs a human decision |
| `same` | Already matches; nothing to apply |

Rows are ordered `only_incoming` → `differs` → `same`. Fields the source has no
data for are omitted entirely rather than offered as empty, so a sparse source
never proposes blanking something the user filled in.

**Link lists merge, they do not replace.** For `urls` and
`character_builder_urls`, `incoming` is the **union** of the resource's current
links and the source's, de-duplicated by URL (case-insensitively), with the
user's own entries first and their labels winning. Applying therefore adds the
source's link without discarding anything the user collected, and the row is
`only_incoming` (so it is pre-selected) whenever the union differs from what is
already stored - `same` when the source adds nothing new. Every other field
still replaces.

**Skipping the search (`paste`):** instead of an `identity` from a previous
search, the client may send `paste` - a source URL or bare ID the user supplied
directly. Grimoire resolves it via the add-on's `identity_pattern` and fetches
that item, returning the resolved value in `identity` so the client can show
what it actually looked up. Only offered by sources whose
`supports_paste` is true. Exactly one of `identity` or `paste` is required.

**Errors:** an unreachable or malformed source returns **502** with a message
safe to display. **400** covers a disabled/unapproved add-on, an unknown
`identity`, pasted text that does not match the source's pattern, a source that
does not support pasting, and a request with neither `identity` nor `paste`.

### Books

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/books` | GET | any | Paginated book list. Query: `system_id`, `category`, `limit` (max 500, default 100), `offset` |
| `/api/books/:id` | GET | any | Book detail with game system |
| `/api/books/:id` | PATCH | gm/admin | Update: `title`, `category`, `description`, `authors`, `artists`, `genres`, `publisher`, `publisher_url` (legacy), `urls`, `isbn`, `version`, `language`, `license`, `year`, `month` (1–12), `day` (1–31), `tags`, `is_explicit`, `access_level` (**admin only**). `license` overrides the system license for this book (blank inherits it). Changing `category` also **moves the file** - see below. `file_size`/`page_count`/`mime_type` are read-only. Sending `access_level` as a non-admin returns 403 - see [Access levels](#access-levels-issue-258). |
| `/api/books/bulk` | POST | gm/admin | Bulk update. Body: `{items: [{id, ...PATCH fields}]}` |
| `/api/books/bulk/tags` | POST | gm/admin | Bulk **add** tags. Body: `{ids, tags}` |
| `/api/books/:id/reindex` | POST | gm/admin | Re-run OCR on a scanned book. Optional query `ocr_dpi` (72–600) re-reads this book at a higher resolution than the global `OCR_DPI`; omit for the default. Clears the book's search index and re-queues it (OCR runs in the background - poll `/api/scan-status`). 400 if the book has an embedded text layer (nothing to OCR). Returns `{status: "reindex_queued", ocr_dpi}`. |
| `/api/books/:id/rescan` | POST | gm/admin | Re-read a single book from disk and rebuild its search index, for a file edited externally. Unlike `/reindex` this works for any indexable format (PDF, EPUB, DjVu, `.txt`/`.md`/`.rtf`): a text-layer book is re-extracted and its FTS rows rebuilt; an image-only PDF is re-queued for OCR. Refreshes page count and cover thumbnail if the file changed, and drops everything cached from the previous contents (page renders, open document handle, search rows). Runs in the background (poll `/api/scan-status`); no-ops if a library scan is already running. 400 for formats that cannot be indexed (archives, images), 404 if the file is missing on disk. Returns `{status: "rescan_queued"}`. |
| `/api/books/:id/file` | GET | any | Download/stream the file |
| `/api/books/:id/thumbnail` | GET | any | WebP cover thumbnail. Sends an `ETag` derived from the file's content hash and honours `If-None-Match` (`304`), so a replaced cover is picked up despite the `immutable` cache policy. |
| `/api/books/:id/toc` | GET | any | Table of contents as `{title, page, level, children}[]`. Available for PDF, EPUB, and DjVu; other formats 404 |
| `/api/books/:id/page/:num` | GET | any | Render a document page (PDF/EPUB/DjVu) as WebP. Comic archives (`.cbz`/`.cbr`/`.cb7`/`.cbt`) return the stored page image from inside the archive as-is; single-image books return the file and accept only page 1; text books 404 (no rendered page). Query: `width` (default 1200, max 3000), `v` (the book's `content_token`, cache-busting; ignored server-side). Cached under a content-addressed key, so replacing the file supersedes earlier renders. Sends an `ETag` and honours `If-None-Match` (`304`). |
| `/api/books/:id/page/:num/text` | GET | any | Plain text of a page (from FTS index or live extraction). Serves any indexable format - PDF, EPUB, DjVu, and `.txt`/`.md`/`.rtf` |
| `/api/books/:id/page/:num/words` | GET | any | Word bounding boxes `{x0, y0, x1, y1, text}` for text overlay. Only rendered documents have page geometry; comics and text books return an empty overlay |

**Book list response:** `{"total": int, "books": [...]}`

**Access control on by-id routes:** `GET /api/books` (the library browse) is blocked for guests, but the by-id content routes (`:id`, `:id/file`, `:id/thumbnail`, `:id/toc`, `:id/page/...`) are reachable by any authenticated user and enforce access themselves. Guests may only read a book **shared into a campaign they belong to** (via a `CampaignResource` whose visibility permits them); an unshared or `gm`-only book returns 403. For non-guests, an `is_explicit` book returns 403 when the caller has `allow_explicit` disabled - the file/page routes enforce this the same way `GET /api/books/:id` does. A book deliberately shared into a guest's campaign is served regardless of its explicit flag (guests have no NSFW preference of their own).

#### Access levels (issue #258)

A book can be restricted to a minimum role, so a library shared with players can
withhold the adventure module they are currently inside. Both `Book` and
`GameSystem` carry an `access_level`, and a category-wide default lives in the
`restricted_categories` app setting.

| Value | Meaning |
|---|---|
| `""` | Open - every user, including players and guests |
| `"gm"` | GMs and admins only |
| `"admin"` | Admins only |
| `null` | **Books only:** inherit (no book-level opinion) |

The effective level resolves most-specific-first: **book → system → category
default → open**. On a book, `null` means "inherit" and continues the cascade,
while `""` is an *explicit* open that ends it - that is how a freely-shared
player's guide stays visible inside an otherwise admin-only system. A system has
no inherit state; it sits at the top of the cascade.

`PATCH`/bulk bodies use the string `"inherit"` for the null write, because the
handlers drop `null` fields so an omitted key leaves the book alone.

**Effect on reads.** Restricted content is *hidden*, not locked. It is filtered
out of `GET /api/books`, `GET /api/systems` (and their counts), `/api/search`,
`/api/favorites`, the OPDS feeds, and bulk `/api/downloads` archives. By-id
routes return **404**, not 403, so a restricted book is indistinguishable from
one that does not exist and ids cannot be probed to enumerate the library.
Guests are held to the player ceiling (open books only) *and* still restricted to
their campaign shares.

**Grants** (`/api/users/:id/access-grants`) raise one user's ceiling within one
system or book. Only GMs may hold them: admins already see everything, and
players and guests are exactly who restrictions exclude.

**Campaigns.** A restricted book linked into a campaign is forced to `gm`
visibility and cannot be made `public` or `private`; restricting a book demotes
its existing shares.

**Categories:** `core`, `supplement`, `adventure`, `character-sheet`, `map`, `handout`, `homebrew`, `starter-set`

#### Metadata lookup from add-ons (issue #203)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/books/:id/metadata-sources` | GET | gm/admin | Installed, enabled add-ons that can supply book metadata |
| `/api/books/:id/metadata-search` | POST | gm/admin | Ranked candidates. Body `{source_id, query?}` - a blank `query` defaults to the book's title |
| `/api/books/:id/metadata-fetch` | POST | gm/admin | One candidate's fields, diffed against the book. Body `{source_id, identity?, query?, paste?}` |

Identical in shape and semantics to the game-system endpoints above (same
`status` values, same ordering, same read-only guarantee); only the target
differs. Applying goes through `PATCH /api/books/:id`.

Book scrapers may map: `title`, `description`, `authors`, `artists`,
`publisher`, `publisher_url`, `urls`, `genres`, `isbn`, `version`, `language`,
`license`, `year`, `month`, `day`, `tags`.

**`query` on fetch:** sources that answer per query (a search endpoint) rather
than serving a whole catalogue need the query to re-find the chosen candidate,
so clients echo back the query the candidate came from. Catalogue-backed sources
ignore it.

### Metadata lookups (genres, families, parent systems, licenses, dice/materials)

Curated reference values that power the editor pickers/comboboxes and the
"Metadata" settings tab (issue #202). Reads are open to any authenticated user;
mutations require admin. Every list is managed in **Settings → Metadata**, where
each section is collapsible.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/genres` | GET | any | `{"genres": [{id, name, parent_id, is_default, sort_order}]}`. Tiered via `parent_id` (e.g. Cyberpunk → Science Fiction). |
| `/api/genres` | POST | admin | Create a genre. Body `{name, parent_id?}`. 409 if the name exists. |
| `/api/genres/:id` | DELETE | admin | Delete a genre (and its children). 409 with `{detail: {message, name, usage_count}}` if attached to a system/book, unless `?force=true`. |
| `/api/system-families` | GET | any | `{"families": [{id, name, is_default, sort_order}]}` |
| `/api/system-families` | POST | admin | Create a family. Body `{name}`. 409 if the name exists. |
| `/api/system-families/:id` | DELETE | admin | Delete a family. 409 if in use unless `?force=true`. |
| `/api/parent-systems` | GET | any | `{"parent_systems": [{id, name, is_default, sort_order}]}`. Empty by default (library-specific). |
| `/api/parent-systems` | POST | admin | Create a parent system. Body `{name}`. 409 if the name exists. |
| `/api/parent-systems/:id` | DELETE | admin | Delete a parent system. 409 if in use unless `?force=true`. |
| `/api/licenses` | GET | any | `{"licenses": [{id, name, is_default, sort_order}]}`. Seeded with common TTRPG licenses (OGL, ORC, CC-BY, Proprietary, …). |
| `/api/licenses` | POST | admin | Create a license. Body `{name}`. 409 if the name exists. |
| `/api/licenses/:id` | DELETE | admin | Delete a license. 409 if used by a system or book unless `?force=true`. |
| `/api/dice-materials` | GET | any | `{"dice_materials": [{id, name, group, is_default, sort_order}]}`. `group` is one of `Dice`\|`Cards`\|`Other`\|`Custom`. Sources the editor's dice/materials picker options. |
| `/api/dice-materials` | POST | admin | Create a dice/material. Body `{name, group?}` (defaults to `Custom`). 409 if the name exists. The editor picker best-effort POSTs here (as group `Custom`) when an admin types a new value, so it becomes reusable. |
| `/api/dice-materials/:id` | DELETE | admin | Delete a dice/material. 409 if in use unless `?force=true`. |

Defaults for both tables are seeded on migration and are removable. A genre or
family removed while attached to systems/books is detached from them (`?force=true`).

**Variants (issues #304, #306):** a book, map, token, or audio record may be a
*variant* of another — a printer-friendly cut, a gridless map, an older version.
A variant is **hidden from list endpoints, counts, and search**, so one book
occupies one shelf slot, but it stays fully reachable by id: `GET /api/books/:id`,
its page renders, and its thumbnail all work normally. Detail responses carry
`variant_parent_id`, `variant_kind`, `variant_label`, `variant_main_id` (the
entry that represents the family in listings), and `variants` (the full sibling
list, so a version picker needs no second request). List rows carry
`variant_count`. Variants are deliberately **included** in bulk downloads and the
OPDS catalogue — an archive or a feed should be complete — and in
`/api/stats`'s `total_size_mb`, since those bytes really are on disk, while the
item counts exclude them.

### Maps

Archive files (`.zip`, `.rar`, `.7z`, `.tar`, `.tar.gz`, …) under `maps/`, `tokens/`,
and `audio/` are indexed as opaque items in their collection and carry
`is_archive: true` in both list and detail payloads. They have no thumbnail,
no dimensions, and no embedded metadata - clients should offer a download rather
than a preview. The comic-book extensions (`.cbz`, `.cbr`, `.cb7`, `.cbt`) are
books-only and are not indexed here.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/maps` | GET | any | Paginated map list (items include `is_archive`). Query: `limit`, `offset`, `map_type`, `folder` (exact folder path; `""` for top level) |
| `/api/maps/:id` | GET | any | Map detail: filename, tags, `map_type`, `grid_size`, `file_size`, `has_thumbnail`, `is_archive`, `is_pdf`, `page_count` (PDF maps only; `null` otherwise) |
**Changing a book's category moves its file.** The folder a book sits in is what
the next rescan reads, so recording a new category without moving the file would
let the scan silently revert the edit. The book is moved into the sibling folder
whose *inferred category* matches the new one - an existing `Rulebooks` shelf is
reused rather than a second `Core` being created beside it - and the folder is
created with its canonical name when nothing covers that category yet.

Best-effort by design, and **never an error**: on a read-only library the
category is recorded and nothing moves, because the user asked to change a
category, not to move a file. The same applies to a name collision at the
destination (the file lands under a suffixed name), a book outside `books/`, and
a book whose file is missing.

| `/api/maps/:id` | PATCH | gm/admin | Update `description`, `tags`, `map_type`, `grid_size` |
| `/api/maps/:id/file` | GET | any | Download/stream the original map image, PDF, or archive (served with the archive's MIME type) |
| `/api/maps/:id/page/:n` | GET | any | Render page `n` of a PDF map to WebP (`width?` target pixel width, default 1600, max 3000). Image maps stream as-is and only accept page 1; archives return 400 |
| `/api/maps/:id/thumbnail` | GET | any | WebP thumbnail |
| `/api/maps/bulk` | POST | gm/admin | Bulk update. Body: `{items: [{id, description?, tags?, map_type?, grid_size?}]}` |
| `/api/maps/bulk/tags` | POST | gm/admin | Bulk **add** tags. Body: `{ids, tags}` |
| `/api/map-folders` | GET | any | List folder tag assignments |
| `/api/map-folders` | PATCH | gm/admin | Set tags on a folder path. Body: `{path, tags}` |
| `/api/map-folders/bulk` | POST | gm/admin | Set tags on many folders. Body: `{folders: [{path, tags}]}` |

### Tokens

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/tokens` | GET | any | Paginated token list (items include `is_archive`). Query: `limit`, `offset`, `tag` |
| `/api/tokens/:id` | GET | any | Token detail incl. `is_archive` (`pixel_width`/`pixel_height` are `null` for archives) |
| `/api/tokens/:id` | PATCH | gm/admin | Update `description`, `tags`, `is_explicit` |
| `/api/tokens/:id/file` | GET | any | Download the token image, or the archive (served with the archive's MIME type) |
| `/api/tokens/:id/thumbnail` | GET | any | WebP thumbnail |
| `/api/tokens/bulk` | POST | gm/admin | Bulk update. Body: `{items: [{id, description?, tags?, is_explicit?}]}` |
| `/api/tokens/bulk/tags` | POST | gm/admin | Bulk **add** tags. Body: `{ids, tags}` |
| `/api/token-folders` | GET | any | List folder tag assignments |
| `/api/token-folders` | PATCH | gm/admin | Set tags on a folder path. Body: `{path, tags}` |
| `/api/token-folders/bulk` | POST | gm/admin | Set tags on many folders. Body: `{folders: [{path, tags}]}` |

### Audio

Audio tracks behave like maps/tokens, with embedded metadata. Supported formats: `.mp3`, `.ogg`, `.opus`, `.flac`, `.wav`, `.m4a`, `.aac`.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/audio` | GET | any | Paginated audio list (collection key `audio`). Query: `limit`, `offset`. Items include `duration`, `title`, `artist`, `album`, `has_artwork`, `is_archive` |
| `/api/audio/:id` | GET | any | Track detail incl. `folder_path` and `folder_tags` |
| `/api/audio/:id` | PATCH | gm/admin | Update `description`, `tags` |
| `/api/audio/:id/file` | GET | any | Stream/download the audio file (supports HTTP range requests), or the archive (served with the archive's MIME type) |
| `/api/audio/:id/artwork` | GET | any | Track artwork, resolving a cover set through the UI first, then folder cover art, then embedded album art. 404 if none |
| `/api/audio/:id/cover` | GET | gm/admin | Only a cover set through the UI, for the editor preview. 404 when the track has none, even if it has folder or embedded art |
| `/api/audio/:id/cover` | POST | gm/admin | Upload a cover image (multipart `file`). PNG/JPEG/WebP/GIF, max 10 MB. Takes precedence over folder and embedded art |
| `/api/audio/:id/cover/from-source` | POST | gm/admin | Set the cover from an image Grimoire already holds. Body: `{source_type, source_id}` - see [Setting an image from an existing asset](#setting-an-image-from-an-existing-asset) |
| `/api/audio/:id/cover` | DELETE | gm/admin | Remove the set cover. Folder and embedded art are untouched and take over again |
| `/api/audio/bulk` | POST | gm/admin | Bulk update. Body: `{items: [{id, description?, tags?}]}` |
| `/api/audio/bulk/tags` | POST | gm/admin | Bulk **add** tags. Body: `{ids, tags}` |
| `/api/audio-folders` | GET | any | List folder tag assignments |
| `/api/audio-folders` | PATCH | gm/admin | Set tags on a folder path. Body: `{path, tags}` |
| `/api/audio-folders/bulk` | POST | gm/admin | Set tags on many folders. Body: `{folders: [{path, tags}]}` |

**Access control on media by-id routes:** As with books, the library-browse list routes (`GET /api/maps`, `/api/tokens`, `/api/audio` and their `*-folders`) are blocked for guests, but the by-id routes (`:id`, `:id/file`, `:id/thumbnail`, `:id/artwork`) are reachable by any authenticated user and enforce access themselves. A guest may only read a map/token/audio item **shared into a campaign they belong to** (via a `CampaignResource` whose visibility permits them); otherwise the route returns 403. An explicit token returns 403 for a non-guest who has `allow_explicit` disabled, on the file/thumbnail routes as well as `GET /api/tokens/:id`. An item deliberately shared into a guest's campaign is served regardless of its explicit flag.

### Favorites

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/favorites` | GET | any | List current user's favorites with enriched detail |
| `/api/favorites` | POST | any | Add a favorite (idempotent). Body: `{item_type, item_id}` |
| `/api/favorites/:type/:id` | DELETE | any | Remove a favorite (silent 204 if not found) |

Item types: `book`, `map`, `token`, `audio`, `system`, `tag` (a `tag` favorite's
`item_id` is the tag's internal key; it enriches to `{internal, display, count}`).

### Tags

Application-wide tags shared across systems, books, maps, tokens, and audio. Each
tag has a lowercased **internal** key (used for matching/dedup) and an editable
**display** value (the casing first entered). The internal key normally stays put,
but a rename that changes the display's normalized form re-keys it (a typo fix like
`freinds` → `friends`), merging into an existing tag if one already owns the new key.
A resource's tags are set through its own update endpoint (e.g. `PATCH /api/books/:id`
with `tags`); these endpoints manage the shared tag catalog and browse items by tag.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/tags` | GET | any | List tags with usage `count` and `is_favorite` (for the current user). Query `in_use_by=system\|book\|map\|token\|audio` restricts to tags used on that resource type. Folder tags (from `tags.json`/folder tagging, including **book subcategory folders**) are merged in and counted by the items they cover |
| `/api/tags` | POST | gm/admin | Create a tag up front (idempotent by internal key). Body: `{value, display?}` |
| `/api/tags/:internal/items` | GET | any | Items carrying the tag: `items` (directly tagged, enriched like favorites) plus `folders` (folder-derived - each `{resource_type, path, items}` lists the whole folder's contents; book folders show only their subfolder path). Query `resource_type=` filters by type. Explicit items are hidden from users who can't see them |
| `/api/tags/:internal` | PATCH | gm/admin | Rename a tag's display value; when the new display normalizes to a different key the internal is re-keyed too (merging into an existing tag on collision). Works for **folder-only** tags too (a tag that lives only in folder JSON is materialised into a catalog row so the rename persists - no 404). Body: `{display}` |
| `/api/tags/:internal/merge` | POST | gm/admin | Merge this tag into another, re-pointing all links. Body: `{into}` |
| `/api/tags/:internal` | DELETE | gm/admin | Delete a tag and unlink it from every resource |

Tag object shape: `{internal, display, category}` (list/item endpoints also include
`count`; the list adds `is_favorite`). A tag's **category** is the single resource
type it is used on (`system`/`book`/`map`/`token`/`audio`), or `shared` once it spans
more than one type. The reported category is *effective*: it reconciles the tag's
stored category (direct usage) with every resource type it appears on via folder tags,
so a tag on a book plus a map folder resolves to `shared` even though folder tags never
rewrite the stored row. Migrated tag displays default to Title Case; users favorite
tags via the favorites endpoints (`item_type: "tag"`). Resource types: `system`,
`book`, `map`, `token`, `audio`.

Book subcategory folders are tagged via `PATCH /api/systems/:id/book-folders` (path
`{system_id}/{category}/{subfolder…}`) and surface on the tags page under **Books**,
alongside the `tags.json`-style folder tags on maps/tokens/audio.

**Folder tags** (the JSON `tags` lists on `*_folders`/`book_folders`) store tag
**internal keys**; their display casing comes from the tag catalog (folder read
endpoints resolve them back to display strings). Saving folder tags registers a
catalog row for each (new tags take the entered casing as their default display;
existing tags keep theirs). Because the library is read-only, `tags.json` is an
**additive** input: on rescan it only *adds* tags - it never removes a folder or
item tag set/removed in the UI, and never overwrites an existing tag's display.

### Saved filters

Per-user named sort/filter presets for a library scope. At most one preset per
(user, scope) may be the **default** - the view the user lands on. Setting a
preset default clears the flag on any sibling in the same scope.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/saved-filters` | GET | any | List the user's saved filters. Optional query `scope` limits to one scope. Returns `{filters: [{id, scope, name, state, is_default}]}` |
| `/api/saved-filters` | POST | any | Create a preset. Body `{scope, name, state, is_default?}`. Re-saving an existing `(scope, name)` overwrites its `state`. |
| `/api/saved-filters/:id` | PATCH | any | Rename, replace `state`, and/or set as the scope default. Body `{name?, state?, is_default?}` |
| `/api/saved-filters/:id` | DELETE | any | Delete one of the user's saved filters |

Scopes: `systems`, `books`, `maps`, `tokens`, `audio`. `state` is an opaque
sort/filter object the client interprets (e.g. `{sort, order, filters}`).

### Bookmarks

Bookmarks are per-user - users cannot see or modify each other's bookmarks.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/bookmarks?book_id=` | GET | any | List user's bookmarks for a book, sorted by page |
| `/api/bookmarks` | POST | any | Create a bookmark. Body: `{book_id, page_number, label?, notes?, selected_text?}` |
| `/api/bookmarks/:id` | PATCH | any | Update `label` or `notes` |
| `/api/bookmarks/:id` | DELETE | any | Delete a bookmark |

`selected_text` is `null` for page bookmarks; non-null for text-selection bookmarks.

### Search

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/search?q=` | GET | any | FTS5 full-text search. Required: `q` (min 2 chars). Optional: `book_id`, `system_id`, `limit` (default 20). Global search also matches maps, tokens, and audio by filename/folder/tag (audio additionally matches embedded title/artist/album). |

**Response:**
```json
{
  "query": "fireball",
  "total": 42,
  "results": [{"id": "uuid", "title": "...", "game_system": "...", "page_number": 42, "snippet": "...", "category": "core"}],
  "maps":    [{"id": "uuid", "filename": "...", "relative_path": "...", "tags": [...]}],
  "tokens":  [{"id": "uuid", "filename": "...", "relative_path": "...", "tags": [...]}],
  "audio":   [{"id": "uuid", "filename": "...", "relative_path": "...", "title": "...", "tags": [...]}]
}
```

`maps` and `tokens` are empty when `book_id` or `system_id` is scoped.

**Variants and search:** global and system-scoped search return only variant
parents, so one book yields one result rather than five. A consequence worth
knowing: text that exists *only* in a variant — errata added in a v1.0.1, or the
OCR'd copy of a scan — is not findable from global search. Scoping with
`book_id` searches that specific record, variant or not, which is how the reader
searches inside whichever version is open.

Each result's `snippet` is HTML-safe: the matched term is wrapped in `<mark>…</mark>`
and all surrounding text (which originates from an untrusted PDF text layer) is
HTML-escaped server-side, so the client can render it via `dangerouslySetInnerHTML`
without risking markup injection.

### Campaigns

#### Campaign CRUD

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns` | GET | any | List own + invited campaigns (admins see only their own here). Each item includes `has_banner`, `next_session` (next scheduled date or null), `last_accessed_at`, `is_archived`, and `archived_at`. Archived campaigns are omitted unless `?include_archived=true`, which returns archived campaigns *alongside* active ones (not archived-only). |
| `/api/campaigns` | POST | any (gm/admin for `is_gm_campaign: true`) | Create campaign. Body: `{name, description?, is_gm_campaign?, gm_title?, system_id?, system_name?, parent_campaign_id?, resources?}`. `description` accepts markdown. `system_name` is free text for a system not in the library (ignored when `system_id` is set). `resources` is an explicit list of `{resource_type, resource_id, visibility?, shared_user_ids?}` to link - omit it (or send `[]`) to link nothing. No resources are auto-added. Returns 403 if the user's `campaign_access` is disabled. |
| `/api/campaigns/:id` | GET | owner or member | Campaign detail with members and resources. The `resources` array is filtered by the caller's visibility (same rule as `GET /api/campaigns/:id/resources`): members never receive `gm`-only or unshared-`private` resource ids. Includes `has_banner`, `is_archived`, `archived_at`, and `locked` (`true` when the campaign is archived **or** the owner's `campaign_access` is disabled - the campaign is then read-only for everyone, write endpoints return 409 for archived / 403 for disabled access, and members keep read access) plus `owner_has_campaign_access` (which stays `true` for a merely-archived campaign, so the two causes are distinguishable). Each member includes `id`, `has_art`, `has_sheet`, `character_sheet_filename`, and `campaign_access` (false → flagged as a disabled user). Opening this endpoint records `last_accessed_at` (drives recently-accessed sorting on the campaigns list). |
| `/api/campaigns/:id` | PATCH | owner | Update `name`, `description` (markdown), `gm_title`, `system_id`, `system_name`, `parent_campaign_id`. Setting `system_id` clears `system_name` and vice-versa (`system_name: ""` clears it). |
| `/api/campaigns/:id` | DELETE | owner | Delete campaign and all related data. Admins delete via the database directly. |
| `/api/campaigns/:id/convert-to-group` | POST | owner (gm/admin) | Promote a personal campaign to a GM-run group campaign, unlocking members, guests, and the schedule. Body: `{gm_title?}` (blank/omitted keeps the current title). Nothing is migrated - the campaign's existing resources, wiki, and sessions carry over untouched and the member list starts empty. **One-way**: there is no group → personal route. Returns 409 if the campaign is already a group campaign, 403 if the caller is not a gm/admin. |
| `/api/campaigns/:id/archive` | PUT | owner | Archive or unarchive a campaign. Body: `{archived: true|false}`. Archiving hides it from every member's campaign list (unless `?include_archived=true`) and freezes it read-only: all write endpoints return 409 until it is unarchived, while reads and `DELETE` still work. Sets/clears `archived_at`. |
| `/api/campaigns/admin/by-user/:user_id` | GET | admin | Read-only minimal list of a user's campaigns (`id`, `name`, `description`, `is_gm_campaign`, `system_id`, `system_name`) for the user-management page |
| `/api/campaigns/invites` | GET | any | The current user's pending invitations (members in `invited` status). Returns a list of `{campaign_id, name, description, owner_display_name}`. Invitations to archived campaigns are omitted (they reappear, still pending, if the owner unarchives). Powers the app-level invite banner. |

#### Members

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns/:id/invite` | POST | owner | Invite a user. Body: `{user_id}`. GM campaigns only. Returns 403 if the target user's `campaign_access` is disabled. |
| `/api/campaigns/:id/members/:user_id` | PATCH | member (own) or owner | Accept/decline or set character name. Body: `{status?, character_name?}`. A user with `campaign_access` disabled cannot `accept` (403) but may `decline`. |
| `/api/campaigns/:id/members/:user_id` | DELETE | owner or self | Remove member. A member removing **themselves** works even on an archived campaign (nobody is held in a campaign because its GM archived it); the owner removing *someone else* is a roster edit and returns 409 while archived. |
| `/api/campaigns/:id/eligible-members` | GET | owner | Users eligible to be invited (each includes `campaign_access`) |

Member statuses: `invited` → `accepted` or `declined`

#### Guests

Guests are code-only accounts (role `guest`) scoped to a single GM campaign. All endpoints require the campaign owner and a server with guest access enabled (the global `guest_access_enabled` setting, or the `GUEST_ACCESS_ENABLED` env pin); otherwise they return 403. Guest members appear in the campaign-detail member list flagged with `is_guest: true`.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns/:id/guests` | POST | owner | Create a guest. Body: `{nickname}`. Returns `{id, user_id, nickname, guest_code, status, ...}` with a unique 10-char code. GM campaigns only (400 otherwise). |
| `/api/campaigns/:id/guests` | GET | owner | List the campaign's guests with their codes. |
| `/api/campaigns/:id/guests/:member_id/regenerate` | POST | owner | Issue a new code for a guest, invalidating the old one. |
| `/api/campaigns/:id/guests/:member_id/share-template` | GET | owner | Returns share content: `{code, link, message, mailto_url, discord_message}`. `link` is a `/guest?code=…` deep link built from `BASE_URL`. |
| `/api/campaigns/:id/guests/:member_id` | DELETE | owner | Remove a guest; also deletes the backing guest account and its contributions. |

Guests authenticate via [`/api/auth/guest-login`](#auth) and may write only their own character name, art, sheet, session notes, and availability - everything else is read-only. The shared library, maps, tokens, and search return 403 for guests.

#### Setting an image from an existing asset

Three targets - the campaign banner, a game system's cover, and an audio track's
cover - can be set from an image Grimoire already holds instead of a fresh upload
from the user's device, via a `POST .../from-source` endpoint taking
`{source_type, source_id}`.

| `source_type` | Resolves to | Available on |
|---------------|-------------|--------------|
| `map` | The map image itself, or its generated thumbnail for a PDF/archive map | all three |
| `token` | The token image, or its thumbnail | all three |
| `book` | The book's cover thumbnail | all three |
| `audio` | The track's folder or embedded artwork | all three |
| `campaign_file` | An image uploaded to the campaign (`is_image`) | banner only |

The chosen bytes are **copied** into the target's own storage exactly as an
upload is, so the result survives the source asset being deleted or the library
being reorganised, and the GET endpoints are unchanged. `campaign_file` is
campaign-scoped and is rejected (422) on the system and audio endpoints, which
have no campaign context to resolve it against.

Authorisation is enforced twice: the caller must be allowed to write the target
(campaign owner, or gm/admin for a system/track) **and** must be able to read the
source in its own right, under the same rules its own content route applies. The
picker therefore grants no access the caller did not already have. Unknown source
types are rejected with 422; a source that is missing, or that has no image to
give (a book with no cover thumbnail, a track with no artwork), returns 404.

#### Banner, character art & sheets

Files are stored on disk under `DATA_PATH/campaign_uploads/`. Banners are keyed by campaign id; character art and sheets are keyed by the **CampaignMember id** (`member.id` from the campaign-detail response), so a player in multiple campaigns gets a distinct file per membership. Image uploads (banner, art) accept PNG/JPEG/WebP/GIF up to 5 MB; sheets additionally accept PDF up to 15 MB. Serving endpoints authenticate via the `grimoire_session` cookie for use in `<img>`/download URLs (the deprecated `?token=` query param is still accepted - see [Authentication](#authentication)).

The GET (serving) endpoints for banners, art, sheets, and campaign files (`/files/:file_id`) set `Cache-Control: private, max-age=300, must-revalidate` along with `ETag`/`Last-Modified` validators derived from the file's mtime + size. A conditional request (`If-None-Match`/`If-Modified-Since`) with a matching validator returns `304 Not Modified`; re-uploading a file changes its validator so clients refetch.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns/:id/banner` | POST | owner | Upload/replace campaign banner (multipart `file`). A downscaled (≤1000px-wide WebP) copy is generated for fast display alongside the stored original. |
| `/api/campaigns/:id/banner` | GET | member or owner | Banner image. Defaults to the downscaled WebP; pass `?size=full` for the original upload. The small copy is generated on first access for banners uploaded before downscaling existed. |
| `/api/campaigns/:id/banner` | DELETE | owner | Remove banner. Also resets `banner_focus_y` to 50, so a stale focal point never carries onto the next banner |
| `/api/campaigns/:id/banner/from-source` | POST | owner | Set the banner from an image Grimoire already holds. Body: `{source_type, source_id}` - see [Setting an image from an existing asset](#setting-an-image-from-an-existing-asset) |
| `/api/campaigns/:id/banner/focus` | PUT | owner | Set where the banner sits vertically in the 2:1 hero. Body: `{focus_y}`, 0-100 (50 = centred). Returns `{banner_focus_y}` |
| `/api/campaigns/:id/members/:member_id/art` | POST | member (own) or owner | Upload/replace character art (multipart `file`) |
| `/api/campaigns/:id/members/:member_id/art` | GET | member or owner | Character art image |
| `/api/campaigns/:id/members/:member_id/art` | DELETE | member (own) or owner | Remove character art |
| `/api/campaigns/:id/members/:member_id/sheet` | POST | member (own) or owner | Upload/replace character sheet (multipart `file`) |
| `/api/campaigns/:id/members/:member_id/sheet` | GET | member or owner | Download character sheet (original filename) |
| `/api/campaigns/:id/members/:member_id/sheet` | DELETE | member (own) or owner | Remove character sheet |
| `/api/campaigns/:id/members/:member_id/sheet/duplicate` | POST | member (own) or owner | Copy a blank PDF into the member's sheet (body `{ source_type: "book"\|"file", source_id }`) |
| `/api/campaigns/:id/sheet-sources` | GET | member or owner | List duplicatable blank sheets (`{ books, files }`): library `character-sheet` PDFs (filtered to the campaign's system when set) and campaign PDF files |

#### Resources

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns/resources/search` | GET | any | Search books/maps/tokens/audio. Matching runs in SQL across the whole library. Books match on title, relative path, category, or game-system name (filter with `system_id?`); maps/tokens/audio match on filename or relative path, and audio also on its title. Results are ranked with folder-path matches above name-only matches. A `system_id` naming a container system (issues #261/#262) also matches its child systems' books, since a container holds none of its own. Each result's `subtitle` is its folder-tree path, letting the picker build a nested tree: for books this is `<System>/<category>/<subcategory>/…` (the game system leads; falls back to `<System>/<category>` when the book sits directly in the system dir); for media it is the folder path under the top-level media dir. Query: `q`, `resource_type?`, `system_id?`, `limit?` (default 5000, clamped to 20000) - `limit` applies **per resource type**, so requesting several types does not shrink each one's share |
| `/api/campaigns/resources/suggested/:system_id` | GET | any | Books in a game system for the create wizard. Core-category books are flagged `suggested` and ordered first. |
| `/api/campaigns/:id/resources` | GET | member or owner | List linked resources (each with `visibility`, `category_id`, `sort_order`, `has_thumbnail`; owner items also include `shared_user_ids`). Ordered public → private → gm, then by `sort_order`. Players see only what their visibility allows. |
| `/api/campaigns/:id/resources` | POST | owner | Link a resource. Body: `{resource_type, resource_id, visibility?, shared_user_ids?, category_id?}` |
| `/api/campaigns/:id/resources/bulk` | POST | owner | Link many resources at once. Body: `{resources: [{resource_type, resource_id, visibility?, ...}]}`. Duplicates/unknown types are skipped; returns the rows created. |
| `/api/campaigns/:id/resources/reorder` | PUT | owner | Drag-and-drop order. Body: `{ordered_ids}` |
| `/api/campaigns/:id/resources/:res_id` | PATCH | owner | Update visibility/shares/category. Body: `{visibility?, shared_user_ids?, category_id?}` (each optional; `category_id: ""` clears it) |
| `/api/campaigns/:id/resources/:res_id` | DELETE | owner | Unlink resource (deletes the underlying file for `file` resources) |
| `/api/campaigns/:id/files` | POST | owner | Upload a campaign file (multipart `file`); links it as a `file` resource. Subject to admin upload limits (admins exempt). |
| `/api/campaigns/:id/images` | POST | owner | Upload an image (multipart `file`, image types only) to embed in a wiki note; links it as a `file` resource with `is_image: true`. Optional multipart fields: `category_id` (file it under an existing resource category) or `new_category_name` (create a category and file it there). |
| `/api/campaigns/:id/files/:file_id` | GET | per visibility | Download a campaign file (honours the linking resource's visibility); for an image this also serves it inline/as its thumbnail |

Resource types: `book`, `map`, `token`, `audio`, `file` (a GM-uploaded file stored under `DATA_PATH/campaign_uploads/files/`, separate from the library). Listed/serialized resources include `is_image` (true for `file` resources that hold an image upload - those render inline with a thumbnail instead of as a download card).

Resource **visibility** is one of: `public` (every accepted member), `private` (the owner plus the users in `shared_user_ids`), or `gm` (owner only). The character-sheet upload endpoints also accept a URL alternative via the member PATCH: `PATCH /api/campaigns/:id/members/:user_id` with `{character_sheet_url}` (`""` clears it; setting a URL clears any uploaded sheet, and uploading a sheet clears the URL).

App-wide admin settings gate campaign file uploads (admins are exempt): `campaign_uploads_disabled` (bool), `campaign_upload_max_file_mb` (int, 0 = unlimited), `campaign_upload_max_total_mb` (int, 0 = unlimited). They are settable via `PATCH /api/settings` and exposed on `GET /api/settings/ui`.

#### Entry icons

Wiki pages and campaign categories each carry an optional `icon` and `icon_color`, used to make entries distinguishable at a glance in the campaign tree.

`icon` is either a **built-in icon key** (a short name from the app's curated Lucide set, e.g. `swords`, `castle`, `mask`) or an **emoji character** stored verbatim (e.g. `🐉`). Values are not validated against the curated set, so a key the frontend doesn't recognise simply renders as the default icon rather than erroring.

`icon_color` tints the icon. It is either a **preset token** - `red`, `orange`, `gold`, `green`, `teal`, `blue`, `purple`, `pink`, `brown`, `gray` - or a **`#rrggbb` hex literal**. Values are normalised to lowercase, and anything else is rejected with 422 (the value reaches a CSS style attribute, so the accepted shapes are deliberately narrow). Null or `""` means the icon inherits its row's text colour.

Both fields round-trip through wiki export/import. On import the file is untrusted, so an `icon_color` that would fail validation is dropped rather than stored.

Visibility is **not** encoded in the icon colour: it has its own indicator in the UI, so the colour is free to be a user choice.

#### Categories

GM-defined groupings for linked **resources**, scoped per campaign. Resources carry an optional `category_id` (null = grouped under their built-in type group: Books / Maps / Tokens / Files), set via the resource PATCH endpoint (`category_id`), using `""` to clear it. Wiki pages no longer use categories - they nest under parent pages instead (see Wiki). `kind` `note` is retired: `POST` with `kind: "note"` returns 400, and legacy note categories are converted to parent pages on startup.

The resource panel's **group display order** (custom categories interleaved with the built-in type groups) is stored per campaign as `resource_group_order` (returned by the campaign GET): an ordered list of group keys - `type:book`, `type:map`, `type:token`, `type:file`, and `cat:<category_id>`. Groups absent from the list fall to the end in their default order; an empty list means the default order (categories then type groups).

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns/:id/categories` | GET | member or owner | List categories. Query: `kind?` (`resource`) |
| `/api/campaigns/:id/categories` | POST | owner | Create. Body: `{name, kind, icon?, icon_color?}` (`kind` must be `resource`; see [Entry icons](#entry-icons) for `icon`/`icon_color`) |
| `/api/campaigns/:id/categories/reorder` | PUT | owner | Set category sort order. Body: `{ordered_ids}` |
| `/api/campaigns/:id/resource-group-order` | PUT | owner | Set the resource panel's group display order (categories + type groups). Body: `{ordered_keys}` (keys `type:book`/`type:map`/`type:token`/`type:file`/`cat:<id>`; unknown or duplicate keys are dropped) |
| `/api/campaigns/:id/categories/:cat_id` | PATCH | owner | Rename / set icon. Body: `{name?, icon?, icon_color?}` (`""` clears either icon field) |
| `/api/campaigns/:id/categories/:cat_id` | DELETE | owner | Delete. Query: `mode` = `uncategorize` (default; resources kept, moved out of the category) or `delete_items` (resources unlinked) |

#### Wiki (notes)

The campaign notebook is a set of markdown **wiki pages**. Pages link to one another with `[[Page Title]]` (or `[[Page Title|label]]`) syntax and embed campaign content inline with `[[book:ID]]`, `[[book:ID:PAGE]]`, `[[map:ID]]`, `[[token:ID]]`, `[[audio:ID]]` (an inline audio player), `[[file:ID]]` (a download card for a campaign file), or `[[image:ID]]` (an uploaded image rendered inline). `ID` is the resource's underlying id; the embed picker lists only resources already linked to the campaign (and offers an image upload). On save the body is re-parsed: unknown `[[Page Title]]` targets auto-create a stub page (inheriting the source page's visibility), embed tokens are skipped (never create stubs), and backlink rows are rebuilt.

##### Link target syntax

A page-link target is a mandatory title plus two optional suffixes - `[[Page Title:id-<page_id>:#Heading]]`:

| Form | Resolves to |
|------|-------------|
| `[[Page Title]]` | the page whose slug matches the title |
| `[[Page Title:id-<page_id>]]` | that exact page, by id |
| `[[Page Title:#Heading]]` | the page, scrolled to the named heading |
| `[[Page Title:id-<page_id>:#Heading]]` | both |

The `:id-` suffix pins a link to a page's stable identity, which makes it survive renames and lets a title that collides with another page be addressed at all (two titles differing only in case or punctuation share a slug, so the second gets a `-2` slug that a bare title can never reach). Resolution is identity-first: when `:id-` is present it is the only thing consulted, so a link whose id no longer exists renders as broken rather than silently re-pointing at whatever page holds that title now.

Parsing is suffix-driven and right-to-left - a trailing `:id-…` / `:#…` is only split off when it matches that exact shape - so a title containing an ordinary colon (`[[Ancient Ruins: The Depths]]`) needs no escaping. The heading is everything after the first `:#`, so a heading that itself begins with `#` needs none either: the markdown heading `# # of coin` is linked as `[[Prices:## of coin]]`. A `:#Heading` is addressing only; the stored link row is page-to-page, and a heading never creates a stub. When several headings share text, `:#Heading` resolves to the most prominent (H1 over H2 over H3) and, among equals, the first in the page.

Two behaviours keep links honest as pages change. **Renaming** a page rewrites the title portion of inbound `[[…]]` links in the bodies that point at it, preserving each link's `|label`, `:id-` and `:#Heading` (a rename that leaves the slug unchanged, e.g. recasing, rewrites nothing). **Stub auto-creation applies only to unpinned links** - a pinned `:id-` target that no longer resolves means the page was deleted, so it stays broken instead of being resurrected as an empty duplicate. Deleting a page also recomputes the link rows of the pages that referenced it.

Because import assigns fresh page ids, an incoming `:id-` pin is dropped on import (the title, which *is* remapped, is the identity that survives); `:#Heading` suffixes are preserved.

Pages nest: each page has an optional `parent_id` (null = top level), forming a tree of arbitrary depth (a "category" is just a page with children). Deleting a page re-parents its children to the deleted page's parent rather than removing the subtree. A page may not be its own parent or be moved under one of its own descendants (400).

##### Page permissions

Every level is available to every campaign member: what each one *means* is relative to whoever authored the page, so a player keeps private notes on the same terms as the GM (issues #232, #233).

| Visibility | Who can read | Who can edit |
|------------|--------------|--------------|
| `gm` | the author alone | the author alone |
| `group` ("Public") | every campaign viewer | every campaign viewer |
| `members` ("Private") | the author, plus `shared_user_ids` | the author, plus `shared_write_user_ids` |

**Personal (non-GM) campaigns have no visibility levels.** They hold exactly one viewer, so every level would mean the same thing: the server stores `gm` on create regardless of what is sent, and ignores a `visibility` change on update rather than rejecting it (the UI has no control to have sent it from, so a `400` would turn a harmless no-op into an error). The frontend hides the dropdowns, badges, and row glyphs there entirely. Converting a personal campaign to a group one leaves its pages author-only, which is the safe direction - the GM opens up what they choose to.

`gm` means **author only**, not "the campaign owner" - the campaign owner has no read access to a page they did not write. The UI labels it "GM only" on the GM's own pages and "Self only" on a player's, but it is one level with one rule. This is symmetric by design: a player's private note is as closed to their GM as the GM's is to them.

Sharing is two lists. `shared_user_ids` grants read; `shared_write_user_ids` grants read **and** write - naming a user only in the write list is enough, since the server adds the read grant. Both lists are returned only to the page's author; to anyone else they come back empty, so a reader cannot enumerate who else holds access.

Three rights are narrower than editing:

- **Deleting** is the author's alone. A public page is editable by everyone but destroyable only by the person who wrote it; anyone else who wants it gone from their view [hides it](#hidden-pages) instead.
- **Reclassifying** (changing `visibility`, `shared_user_ids`, or `shared_write_user_ids`) is the author's alone, so a contributor to a public page cannot take it private and remove it from everyone else. `403` otherwise.
- **Nesting** a page under a parent requires *write* access to that parent, so children cannot be grafted onto someone else's page. A parent the caller cannot write is `403`; one they cannot even read is reported as `400 Invalid parent page`, so the response does not confirm that a hidden page exists.

##### Hidden pages

Any user may hide any page they can see, including ones they can neither edit nor delete. This is per-user decluttering, not a permission: it changes nothing for anybody else. Hiding a parent hides its whole subtree, resolved at read time from `parent_id` rather than stored per descendant - so moving a page out of a hidden subtree un-hides it, and a page created under a hidden parent starts hidden. Hidden pages are excluded from the list and from `search`; `GET /wiki?include_hidden=true` brings them back, each flagged with `is_hidden`. Unlike other wiki writes, hiding is permitted on an **archived** campaign, since it writes nothing to the campaign's content.

**Personal campaigns have no hidden pages.** The feature exists so one person can put *someone else's* notes out of their own way, and there is nobody else - deleting already covers your own. `POST .../hide` returns `409` there, and every read path (list, detail, `search`) reports nothing as hidden regardless of what rows exist. That last part matters for a campaign that was a group one when a row was written, or one predating the guard: honouring a stale row would drop the page from the list with no UI able to bring it back. `DELETE .../hide` stays available for exactly that reason - clearing the state is always safe.

##### GM secrets

Within a page body, text wrapped in `||double pipes||` is a **GM-only secret** - finer-grained than page visibility, it hides a span inside an otherwise shared page. The campaign owner always receives the raw `||...||`. For every player the secret (markers and enclosed text, which may span multiple lines) is **fully stripped** from the page `body` server-side, leaving no trace - no secret text and no placeholder - so a player never learns a secret exists or where, whether in the rendered page, the raw editor body, or a `search` snippet/match. Personal (non-GM) campaigns are never stripped, since only the owner can view them.

**Secrets are keyed on campaign ownership, not authorship** - deliberately unlike every other rule on this page. A secret's purpose is to hide text from *players*, so it belongs to the GM wherever the page came from: the GM may annotate a player-authored session log with hidden notes that page's own author cannot see. The visibility rework made read/write/delete author-relative; this mechanism did not follow.

A player typing `||` is not the mirror of that. Their pipes are **escaped to literal text** on save - each `|` in a run of two or more is stored as `\|` - rather than honoured or rejected. Honouring them would create a secret the player themselves could not see: they would write a sentence, save, and watch it vanish on the next read. Escaping keeps what they typed on screen (markdown renders `\|` as a literal `|`) and stops it ever being mistaken for a GM secret. Single pipes are untouched, so markdown tables round-trip unchanged, and the escape is idempotent, so re-saving never stacks backslashes. Applied on both create and update, to every non-owner submission; wiki *import* is owner-only, so pipes arriving that way are the GM's and are left alone.

Because a player edits this stripped body, a player saving an edit would otherwise erase the secrets - which matters far more now that a `group` page is editable by the whole party, so any player may be the one saving over a GM's page. On such a save the stored secrets are **re-woven back by position** server-side: the stripped text the player was last shown is diffed against their submission, and each secret is re-inserted at the point its surrounding text maps to. A secret therefore stays exactly where the GM placed it even when the player edits the text above and/or below it (it does not drift past later paragraphs). If the text on both sides of a secret was rewritten past recognition, that secret is appended at the end of the body - preserved, never lost. The GM submits the raw body (secrets and all), which is stored verbatim.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns/:id/wiki` | GET | member or owner | List pages the caller can see (`id, title, slug, visibility, page_type, session_date, parent_id, icon, icon_color, sort_order, updated_at, can_edit, can_delete, is_mine, is_hidden`), ordered by `sort_order`. Build the page tree client-side from `parent_id`. Query: `mine=true` restricts to pages the caller authored; `include_hidden=true` also returns the pages they have [hidden](#hidden-pages) (omitted by default) |
| `/api/campaigns/:id/wiki` | POST | member or owner | Create a page. Body: `{title?, body?, visibility?, page_type?, session_date?, shared_user_ids?, shared_write_user_ids?, parent_id?, icon?, icon_color?}` (`parent_id` nests the page and requires write access to that parent; see [Page permissions](#page-permissions) and [Entry icons](#entry-icons)). Any visibility may be created by any member |
| `/api/campaigns/:id/wiki/search` | GET | member or owner | Search visible pages by title/body. Query: `q` |
| `/api/campaigns/:id/wiki/titles` | GET | member or owner | `{id, title, slug, ambiguous, parent_title, headings[]}` list for `[[link]]` autocomplete. `ambiguous` is true when another visible page normalizes to the same slug (the editor then emits `:id-`, and labels the suggestion `Title (parent_title)` to tell the collisions apart); `parent_title` is the immediate parent's title, or null at top level **or when that parent isn't visible to the caller**; `headings` is the page's ATX headings as `{text, level}` in document order, for `:#Heading` completions. Headings inside `\|\|GM secrets\|\|` are omitted for non-owners |
| `/api/campaigns/:id/wiki/reorder` | PUT | member or owner | Drag-and-drop order. Body: `{ordered_ids}`. **Relative, not absolute**: `sort_order` is global but a caller only sees a subset, so the submitted list is applied as an ordering *of the slots those pages already occupy* - the pages named are redealt into their own existing positions, and every other page (invisible to the caller, or visible but not writable by them) keeps the `sort_order` it had. A caller's drag therefore never renumbers pages they cannot see. Ids the caller cannot write are skipped and hold their slot; unknown and duplicate ids are ignored rather than rejected |
| `/api/campaigns/:id/wiki/export` | GET | owner or member | Export the wiki - a member can take their own copy of a campaign with them (e.g. when leaving, or moving to another platform), and this **works on an archived campaign** since it only reads. Everyone receives exactly what they can see in the app: pages failing the `can_view_page` check are omitted, and `||GM secrets||` are stripped from a player's bodies. The page filter now applies to the campaign owner too - since `gm` visibility means author-only, a GM is no more entitled to export a player's self-only note than to read it - but secrets stay GM-only regardless of who authored the page holding them. Query: `format` = `md` (a `.zip` of one Markdown file per page, with YAML frontmatter incl. `parent` slug - Obsidian-friendly), `mdfile` (a single `.md` file with every page concatenated in sidebar order, page titles as headings nested by tree depth and each page's own headings shifted below its title - for reading or printing, not re-import), or `json` (a Grimoire JSON bundle: `{grimoire_wiki_version, campaign, pages[]}`, each page carrying its `parent` slug). Returns a file download |
| `/api/campaigns/:id/wiki/import` | POST | owner | Import pages from a multipart `file`. Accepts a single `.md`/`.markdown`/`.txt`, a Grimoire `.json` bundle, a LegendKeeper export (`.json`/`.lk` - a per-page export or a current `{version, resources[]}` bundle with ProseMirror bodies), or a `.zip` (Markdown vault, Grimoire bundle, or LegendKeeper directory export). LegendKeeper HTML and ProseMirror bodies are converted to Markdown (lossy for LegendKeeper-only blocks, which are dropped); page nesting (`parent`/`parentId`) is preserved. Import is non-destructive: every record becomes a new page (slugs de-duplicated), existing pages are never overwritten, and internal links are remapped. Returns `{imported, format, pages[]}` |
| `/api/campaigns/:id/wiki/templates` | GET | owner | The campaign's note templates. Returns `{templates[], campaign_system, downloads_enabled}`; each template carries `{id, name, system, category, description, source_id, source_url, source_version, created_at}` (no `body` - use the detail read). `campaign_system` is the linked game-system name, falling back to free-text `system_name`, else `""`. `downloads_enabled` is false when `DISABLE_EXTERNAL_ADD_ON_INSTALL` is set. Also returns `categories` (the suggested set plus any the campaign already uses, for the editor's dropdown) and `authored_system` (the marker stored on hand-written templates) |
| `/api/campaigns/:id/wiki/templates` | POST | owner | Write a new template. Body: `{name, category?, description?, body?, defaults?}`. `name` is required and non-blank. There is no `system`: a hand-written template is stored with the `__authored__` marker (reported as `authored_system` on the list endpoint). `defaults` is `{title?, icon?, icon_color?, visibility?, page_type?}` and is stored as a YAML frontmatter block on the body, so authored, uploaded, and downloaded templates all share one on-disk shape. Returns the template incl. `body` and `defaults` |
| `/api/campaigns/:id/wiki/templates/browse` | GET | owner | The community catalogue as a folder tree. Returns `{folders[], downloaded_ids[], campaign_system, index_url, is_custom_url, generated}`; each folder is `{path, name, templates[]}` with the generic folder pinned first and the rest alphabetical. Each template is `{id, name, version, system, category, description, author, author_url}`, where `author` is the "by <author>" credit and `author_url` its server-derived GitHub profile link (both `""` when absent). Query `refresh=true` bypasses the 1-hour cache. `403` when downloading is disabled, `502` when the catalogue is unreachable |
| `/api/campaigns/:id/wiki/templates/upload` | POST | owner | Add a template from a multipart `file` (max 512 KB), either a `.md`/`.markdown`/`.txt` or a `.zip` in the export layout (`<id>/<id>.yml` + `<id>/<id>.md`). For markdown, the frontmatter `title` names it, falling back to the filename; for a zip, the manifest supplies `name`/`category`/`description`, falling back to the body's frontmatter when absent or malformed. Zips are detected by magic bytes as well as extension, `__MACOSX/` and dotfiles are skipped, and a member declaring more than the size cap is refused with `413` before decompression. A zip with no markdown in it, or a corrupt archive, is `400`. **Works even when downloading is disabled** - the hand-copy path for locked-down servers |
| `/api/campaigns/:id/wiki/templates/source` | PUT | owner | Set the catalogue URL. Body: `{index_url}`; `""` restores the built-in default. Must be http(s). Returns `{index_url, is_custom_url}` |
| `/api/campaigns/:id/wiki/templates/download/:template_id` | POST | owner | Copy a community template into the campaign, verifying the body against the catalogue's `body_sha256`. Recorded with `source_id`/`source_url`/`source_version`. Downloading the same template twice deliberately makes a second copy. `403` when disabled, `404` if unknown, `502` if the fetch fails |
| `/api/campaigns/:id/wiki/templates/:template_id` | GET | owner | One template. `body` is the Markdown **without** its frontmatter block; the block's contents come back separately as `defaults` `{title, icon, icon_color, visibility, page_type}`, so the editor can show form controls instead of raw YAML. A body with no frontmatter reports empty defaults |
| `/api/campaigns/:id/wiki/templates/:template_id` | PATCH | owner | Edit a template; every field optional. A blank `name` is rejected with `400`. `body` and `defaults` are two halves of one stored string: sending either rebuilds it from the current value of the other, so a body-only edit keeps the page defaults and vice versa. Any frontmatter still on an incoming `body` is stripped before the block is rebuilt, so a client that round-trips the whole document cannot stack two blocks |
| `/api/campaigns/:id/wiki/templates/:template_id` | DELETE | owner | Delete the template. Pages already created from it are unaffected |
| `/api/campaigns/:id/wiki/templates/:template_id/export` | GET | owner | Download the template as a `.zip` holding `<id>/<id>.yml` + `<id>/<id>.md` - the community repo's folder layout, ready to contribute back. Uses `source_id` as the folder name when the template was downloaded, else a slug of its name |
| `/api/campaigns/:id/wiki/templates/:template_id/use` | POST | owner | Create a wiki page from the template server-side. The Markdown body (with its frontmatter) is run through the same parser as file import. Non-destructive: always a new page with a de-duplicated slug. Returns `{imported, template_id, pages[]}`. **The web UI does not use this** - it reads the template and opens an unsaved editor instead, so picking the wrong template costs a cancel rather than a delete. Kept for API clients that do want a page created in one call |
| `/api/campaigns/:id/wiki/:page_id` | GET | per visibility | Page detail incl. `body`, `backlinks`, `icon`, `icon_color`, `can_edit`, `can_delete`, `is_mine`, `is_hidden`. `shared_user_ids` / `shared_write_user_ids` are populated only for the page's author and empty for everyone else |
| `/api/campaigns/:id/wiki/:page_id` | PATCH | page author, or anyone with write access | Update fields (each optional; `icon: ""` / `icon_color: ""` clear those fields). Body and metadata follow write access, but `visibility` / `shared_user_ids` / `shared_write_user_ids` are author-only (`403` otherwise), and either share list alone is a full replacement of the pair - the one you omit is preserved as stored. See [Page permissions](#page-permissions) |
| `/api/campaigns/:id/wiki/:page_id` | DELETE | page author | Delete the page and its link rows. Author-only: neither the campaign owner nor a member with write access may delete a page they did not author (`403`) |
| `/api/campaigns/:id/wiki/:page_id/hide` | POST | per visibility | [Hide](#hidden-pages) the page from the caller's own view. Available on any page they can see, including ones they cannot edit or delete, and permitted on an archived campaign. `409` in a personal campaign, which has no hidden pages |
| `/api/campaigns/:id/wiki/:page_id/hide` | DELETE | any member | Un-hide a page the caller had hidden. Clears only their own row; a page hidden because an ancestor is hidden has no row of its own, so this is a no-op for it. Allowed in a personal campaign even though hiding is not - clearing state is always safe, and refusing would strand a row written before that guard existed |

#### Sessions (legacy)

Superseded by the wiki. On startup, any non-empty legacy session notes are rolled into wiki pages (GM internal → a `gm` page, GM external → a `group` page, each player note → a `group` page) and the legacy session rows are removed; empty sessions are simply purged. These endpoints remain for backward compatibility.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns/:id/sessions` | GET | member or owner | List sessions sorted by date |
| `/api/campaigns/:id/sessions` | POST | member or owner | Create session. Body: `{session_date, title?}` (date: `YYYY-MM-DD`) |
| `/api/campaigns/:id/sessions/:sid` | GET | member or owner | Session detail. GM sees `internal_content`; members see only `external_content`. |
| `/api/campaigns/:id/sessions/:sid` | PATCH | owner | Update `title` |
| `/api/campaigns/:id/sessions/:sid` | DELETE | owner | Delete session and all notes |
| `/api/campaigns/:id/sessions/:sid/notes/player` | PUT | member or owner | Save own player note. Body: `{content}` |
| `/api/campaigns/:id/sessions/:sid/notes/gm` | PUT | owner | Save GM notes. Body: `{internal_content?, external_content?}` |

#### Schedule

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns/:id/schedule` | GET | member or owner | Returns `{definition, enabled, next_sessions}`. When `enabled` is false the definition is preserved but `next_sessions` is empty. |
| `/api/campaigns/:id/schedule` | PUT | owner | Create or update schedule (GM campaigns only). Body accepts `enabled` (default true); setting it false keeps the definition but deactivates the schedule (no next sessions, no availability chart). |
| `/api/campaigns/:id/schedule` | DELETE | owner | Remove schedule |

**Schedule body:**
```json
{
  "frequency": "weekly",
  "days": [5],
  "time_local": "18:00",
  "timezone": "America/Los_Angeles",
  "biweekly_reference": "2026-01-03",
  "monthly_week": null,
  "custom_dates": null
}
```

| Field | Description |
|-------|-------------|
| `frequency` | `weekly`, `biweekly`, `monthly`, or `custom` |
| `days` | Local weekday indices - `0` = Monday … `6` = Sunday |
| `time_local` | Session time (`HH:MM`) in the zone named by `timezone` |
| `timezone` | IANA zone the days and time are expressed in (e.g. `America/Los_Angeles`) |
| `time_utc` | **Deprecated.** A UTC clock; still accepted from older clients and converted to `time_local` on write |
| `biweekly_reference` | Anchor date for biweekly cadence (`YYYY-MM-DD`) |
| `monthly_week` | Week of month: `1`–`4`, or `-1` for last |
| `custom_dates` | Array of explicit dates (`YYYY-MM-DD`) for `custom` frequency |

#### Availability

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns/:id/availability` | GET | member or owner | Availability chart for next 10 scheduled sessions |
| `/api/campaigns/:id/availability/:date` | PUT | member or owner | Set own availability. Body: `{status}` |
| `/api/campaigns/:id/availability/:date/cancel` | PUT | owner | Toggle session cancellation for a date |

Availability statuses: `available`, `tentative`, `unavailable`

#### Calendar export and subscription

Campaign schedules can be exported as iCalendar (`text/calendar`) - either a one-off download or a live feed a calendar app subscribes to and re-polls.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns/:id/calendar.ics` | GET | member or owner | Download the campaign's upcoming sessions as an `.ics` file |
| `/api/campaigns/calendar/subscription` | GET | any user | Own subscription state. Optional `?campaign_id=` adds `campaign_feed_url` |
| `/api/campaigns/calendar/subscription` | POST | any user | Mint or rotate the feed token; the previous URL stops working immediately |
| `/api/campaigns/calendar/subscription` | DELETE | any user | Revoke the feed token |
| `/api/campaigns/calendar/:token/:id.ics` | GET, HEAD | feed token | Live feed for one campaign |
| `/api/campaigns/calendar/:token/all.ics` | GET, HEAD | feed token | Live feed merging every campaign the token's user belongs to |

**Feed-token auth.** Calendar apps cannot send an `Authorization` header, so the two feed endpoints carry a per-user token in the path and sit *outside* the JWT-protected `/api` dependency. The token is a dedicated `users.calendar_token`, not the JWT and not `opds_token`: it grants read access to schedule data alone and rotates independently of login sessions and OPDS. An unknown, rotated, or revoked token returns **404** rather than 401, so probing cannot distinguish a revoked feed from one that never existed.

The token identifies the user; membership still authorises. A feed for a campaign the user has left - or that has been archived - returns 404, and the aggregate feed simply omits it.

**Session times are published as local wall clocks with an explicit `TZID`.** A schedule's `days` are *local* weekday indices and its stored time is a *local* clock, so the definition also carries an optional IANA `timezone` (captured from the browser on save, validated on write). When it is present the feed emits `DTSTART;TZID=<zone>:<local time>` and ships a matching `VTIMEZONE`, so the session keeps its weekday in every reader's rendering and stays correct across DST.

> Publishing a UTC instant instead is what put evening games on the wrong day. Collapsing "Sunday 19:30 America/Los_Angeles" to `20260816T023000Z` is arithmetically correct but *already Monday in UTC*, and every client re-renders that in the viewer's own zone - showing Saturday night to the Pacific players whose game it is. The instant was right; the format threw the weekday away.

> **The storage model changed with it.** Schedules previously stored a *local* weekday beside a *UTC* clock, and the browser's conversion dropped the day the clock rolled into: 19:30 Pacific was saved as `02:30` while `days` still said Sunday, so the pair described Saturday evening and the feed published it faithfully. Both halves are now local (`time_local` + local `days`), which removes the rollover by construction. A startup migration (`_migrate_schedule_times_to_local`) converts existing rows back through their recorded zone, repairing the clock and leaving `days` untouched - the weekday was always the half the UI displayed correctly. It is marker-guarded (`time_model: "local"`) and therefore idempotent. Rows with no `timezone` have nothing to convert against and keep their clock; re-saving the schedule records a zone.

A schedule with no zone publishes a *floating* local time (`DTSTART:<local>`, no `TZID`, no trailing `Z`) - RFC 5545 §3.3.5 reads that in the viewer's own zone, which is the best available interpretation of a bare `19:30` and, unlike the old UTC form, cannot shift the weekday.

`VTIMEZONE` components are derived from the events themselves - every zone referenced by a `TZID` gets one emitted ahead of the events, with an explicit `STANDARD`/`DAYLIGHT` subcomponent per transition in the published window rather than an `RRULE`. Events carry `SEQUENCE:1`, bumped from `0` when the format changed so subscribers holding the old UTC events accept the correction.

**Feeds answer `HEAD` as well as `GET`.** Google Calendar's *From URL* flow probes a subscription URL with `HEAD` before accepting it, and rejects the feed outright if that probe is not a success - importing nothing and surfacing no error. Both feed routes therefore register `HEAD`, which returns the real status and `Content-Type` with an empty body.

**Feeds are served `inline`; only the download is an `attachment`.** Google Calendar's *From URL* fetcher rejects an ICS feed sent with `Content-Disposition: attachment` - it reads the header as "save this file" rather than "poll this calendar". Apple Calendar and Outlook ignore the header on a URL they were explicitly asked to subscribe to, which is why an `attachment` feed appears to work everywhere *except* Google. Both feed routes therefore send `inline`; the one-off `/:id/calendar.ics` download keeps `attachment`, where prompting a save with a filename is the point.

**Subscription URLs require `BASE_URL`.** The server has to know its own public origin to build a URL a calendar app can reach, so `GET`/`POST /calendar/subscription` report `base_url_configured: false` and withhold every URL while `BASE_URL` is still the `http://localhost:9481` default; `POST` returns 400. The one-off `.ics` download is unaffected. Responses also include `webcal_url` - the same URL under the `webcal://` scheme, which makes desktop calendar apps subscribe rather than download a static copy.

> **Google Calendar fetches server-side, so the feed must be publicly reachable.** Unlike Apple Calendar and Outlook, which poll from the user's own machine, Google fetches the URL from its infrastructure - a LAN address, a `.local` hostname, a Tailscale/VPN-only origin, or anything behind an authenticating reverse proxy will fail no matter what the feed returns. Google also requires the `https://` form: it does not understand `webcal://`, so paste `feed_url`, not `webcal_url`. Plain `http://` is likewise unreliable.

**Feed contents.** Up to 26 upcoming sessions per campaign. Each `VEVENT` uses a stable UID (`grimoire-session-<campaign_id>-<YYYY-MM-DD>@grimoire`), so rescheduling updates the existing event in place instead of duplicating it, and a cancelled session is published as `STATUS:CANCELLED` rather than disappearing. Sessions carry `DTSTART`/`DTEND` in UTC when the schedule sets a time, and are all-day events when it does not.

Feeds are **personalised to the token's owner**: each event's `SUMMARY` and `DESCRIPTION` reflect that user's own availability, and `URL` deep-links to the campaign's schedule tab.

> **RSVP does not travel back over a subscription.** A subscribed ICS feed is fetched by HTTP `GET`; iCalendar defines no write path back, so Accept/Tentative/Decline is inert in Google Calendar, Apple Calendar, and Outlook for subscribed events. Genuine RSVP requires iMIP (emailed `METHOD:REQUEST` invitations with replies parsed from a mailbox) or a CalDAV server - neither of which Grimoire implements. The deep link in every event is the round trip instead.

### Settings *(admin only)*

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/settings` | GET | Get all application settings |
| `/api/settings` | PATCH | Update application settings |
| `/api/settings/ui` | GET | UI visibility flags (any authenticated user) |
| `/api/settings/api-key/generate` | POST | Generate a stats API key |
| `/api/settings/api-key` | DELETE | Revoke the stats API key |

`GET /api/settings/ui` also returns `library_writable`: whether the library root
can be written to at all. It is not a stored setting - it is probed at request
time - and it gates the move / rename / delete affordances in views outside the
file manager, which have no folder listing of their own to ask. Clients should
treat a missing value as `false` so the destructive actions stay hidden rather
than appearing and failing.

**Configurable settings:**

| Key | Type | Description |
|-----|------|-------------|
| `rescan_schedule_enabled` | bool | Enable automatic library rescans |
| `rescan_schedule_interval` | string | `hourly`, `daily`, or `weekly` |
| `rescan_schedule_hour` | int | UTC hour (0–23) for daily/weekly rescans |
| `rescan_schedule_minute` | int | UTC minute (0–59) |
| `rescan_schedule_weekday` | int | Weekday (0–6) for weekly rescans |
| `hide_maps` | bool | Hide the maps section in the UI |
| `hide_tokens` | bool | Hide the tokens section in the UI |
| `hide_audio` | bool | Hide the audio section in the UI |
| `hide_campaigns` | bool | Hide the campaigns section in the UI |
| `restricted_categories` | object | `{category_slug: "gm"\|"admin"}` restricting whole categories library-wide (issue #258). The category-level tier of the access cascade; a book or system still overrides it in either direction. `core` and `character-sheet` are rejected with 400 - everyone at the table needs those. An entry set to `""` is dropped rather than stored, since "open" is the absence of an entry. See [Access levels](#access-levels-issue-258). |
| `show_stat_systems` | bool | Show/hide game system count in sidebar |
| `show_stat_books` | bool | Show/hide book count in sidebar |
| `show_stat_pages` | bool | Show/hide page count in sidebar |
| `show_stat_maps` | bool | Show/hide map count in sidebar |
| `show_stat_tokens` | bool | Show/hide token count in sidebar |
| `show_stat_audio` | bool | Show/hide audio track count in sidebar (default off) |
| `show_stat_size` | bool | Show/hide library size in sidebar |
| `show_stat_version` | bool | Show/hide version in sidebar |
| `password_auth_enabled` | bool | Allow password sign-in. Cannot be patched if `ALLOW_PASSWORD_AUTHENTICATION` is set in the environment (returns 400). The `password_auth_env_locked` field on the GET response indicates whether the env override is active. |
| `guest_access_enabled` | bool | Allow GMs/admins to create guest invite codes. Cannot be patched if `GUEST_ACCESS_ENABLED` is set in the environment (returns 400). The `guest_access_env_locked` field on the GET response indicates whether the env override is active. |
| `disable_folder_category_inference` | bool | When `true`, the indexer does not infer a book's category from its folder names; books fall back to `uncategorized`. Cannot be patched if `DISABLE_FOLDER_CATEGORY_INFERENCE` is set in the environment (returns 400). The `disable_folder_category_inference_env_locked` field on the GET response indicates whether the env override is active. A per-system `.no-auto-category` marker file disables inference for just that system. |
| `custom_login_message_enabled` | bool | Show a custom message above the sign-in form |
| `custom_login_message` | string | HTML for the login message. Sanitized server-side: only `<b>`, `<strong>`, `<i>`, `<em>`, `<s>`, `<strike>`, `<del>`, `<u>`, `<p>`, `<br>`, `<ul>`, `<ol>`, `<li>`, and `<a href>` (http/https/mailto/relative) are allowed; everything else is dropped. |
| `oidc_enabled` | bool | Master toggle for OIDC sign-in. Has no effect until issuer / client id / client secret are also set. |
| `oidc_issuer_url` | string | Base URL of the IdP (e.g. `https://idp.example.com/realms/main`). |
| `oidc_authorization_endpoint` | string | Discovered or manual authorization endpoint URL. |
| `oidc_token_endpoint` | string | Discovered or manual token endpoint URL. |
| `oidc_userinfo_endpoint` | string | Discovered or manual userinfo endpoint URL. |
| `oidc_jwks_uri` | string | Discovered or manual JWKS URL - required to validate the ID token signature. |
| `oidc_end_session_endpoint` | string | Optional RP-initiated logout endpoint. |
| `oidc_client_id` | string | Client ID issued by the IdP. |
| `oidc_client_secret` | string | **Write-only.** Setting a non-empty string saves it. Empty string is a no-op (so form re-submits don't clobber). The literal `"__CLEAR__"` wipes the stored secret. GET responses never return the value - instead, `oidc_client_secret_set: bool` and `oidc_client_secret_length: int` are returned. |
| `oidc_signing_alg` | string | One of `RS256`/`RS384`/`RS512`/`ES256`/`ES384`/`ES512`/`PS256`/`PS384`/`PS512`/`HS256`. Default `RS256`. |
| `oidc_button_text` | string | Label for the SSO button on the login page. |
| `oidc_groups_claim` | string | Optional. Name of the claim containing group memberships. When set, roles are assigned from groups named (case-insensitively) `admin`, `gm`, or `player`; users without a matching group are denied. |
| `oidc_permissions_claim` | string | Optional. Name of the claim containing a permissions object (e.g. `{viewNSFW: bool}`). When set, the claim must be present in every login or access is denied. |
| `oidc_match_by` | string | One of `none`, `email`, `username`. How to link an existing local account to an OIDC subject on first login. |
| `oidc_auto_launch` | bool | When true, `/login` immediately redirects to the IdP. Suppress with `?autoLaunch=0`. |
| `oidc_auto_register` | bool | Auto-create local accounts on first OIDC login. |

GET responses also include a sibling `<key>_env_locked: bool` for each individual OIDC setting, indicating whether the value is pinned by an environment variable. Patching a locked field returns 400. The fixed callback URL is exposed as `oidc_redirect_uri`.

### Add-ons *(admin only)*

Community add-ons are installable metadata scrapers, authored in the separate
[`grimoire-codex/community-add-ons`](https://github.com/grimoire-codex/community-add-ons)
repo. See [`docs/addons.md`](addons.md) for the full picture.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/addons` | GET | admin | Installed add-ons, everything in the cached index, and add-on settings |
| `/api/addons/refresh` | POST | admin | Re-fetch the community index. Returns `{status, count}` |
| `/api/addons/update-all` | POST | admin | Refresh the index, then update every installed add-on with a newer version. Returns `{status, updated: [{id, from, to}], failed: [{id, error}]}` |
| `/api/addons/settings` | PATCH | admin | Set `index_url` and/or `allow_scripts` |
| `/api/addons/:id/install` | POST | admin | Install or update from the index. Body `{approve_script: bool}` |
| `/api/addons/:id` | PATCH | admin | Set `enabled` and/or `script_approved` |
| `/api/addons/:id` | DELETE | admin | Uninstall and forget its state |

**Installed add-on fields:** `id`, `name`, `version`, `kind`, `target`,
`description`, `homepage`, `author`, `author_url`, `attribution`, `requires_script`,
`script_approved`, `enabled`, `runnable`, `blocked_reason`, `source`,
`available_version`, `update_available`. `runnable` is false (with a
human-readable `blocked_reason`) when an add-on is disabled, or is script-backed
and lacks either consent.

`author` is who wrote the add-on - a GitHub username or display name, shown as a
"by <author>" byline. It is distinct from `attribution`, which credits the
upstream data source the add-on scrapes; both are `""` when the manifest omits
them.

`author_url` is **derived by the server**, never taken from the manifest: when
`author` is a valid GitHub username (a leading `@` is accepted, as is a bare
`https://github.com/<username>`), it resolves to that profile, and is `""`
otherwise. Because the manifest cannot supply a URL of its own, a `javascript:`
value, another host, or a `github.com` lookalike can never be linked. The name
itself always renders as plain text - only a separate GitHub icon is clickable.

**Available add-on fields:** the index entry plus `installed` and
`update_available`. The index relays `author` too, so the byline shows before
an add-on is installed.

### Themes

Colour themes, installed **per user**. Any authenticated user may install and
select their own; only the catalogue URL is admin-only, being server-wide
configuration. See [`docs/themes.md`](themes.md).

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/themes` | GET | user | The user's installed themes plus their selection in one app mode and the catalogue settings. `?app_mode=` selects which (default `grimoire`) |
| `/api/themes` | POST | user | Install a pasted/uploaded theme. Body is the theme document. Works even when external installs are disabled |
| `/api/themes/browse` | GET | user | The community catalogue, each entry marked `installed`. 403 when downloads are disabled, 502 when the catalogue is unreachable |
| `/api/themes/selection` | PUT | user | Set `mode` (`light`/`dark`/`system`) and/or `theme_id` (`""` clears it) for one `app_mode` |
| `/api/themes/source` | PUT | **admin** | Set the catalogue `index_url` |
| `/api/themes/install/:id` | POST | user | Install one theme from the catalogue into the user's account |
| `/api/themes/:id` | DELETE | user | Uninstall a theme. Also deselects it if it was active |

**Listing fields:** `installed[]`, `built_in[]`, `app_mode`, `app_modes[]`,
`mode`, `theme_id`, `downloads_enabled`, `index_url`, `default_index_url`,
`is_custom_url`.

**Theme fields:** `id`, `name`, `mode`, `modes[]`, `app_mode`, `variants`,
`tokens`, `source_id`, `source_url`, `source_version`, `is_community`.

**Catalogue entry fields** (from `/api/themes/browse`): `id`, `name`,
`description`, `mode`, `app_mode`, `modes[]`, `version`, `author`, `author_url`,
`path`, `sha256`, `grimoire_min_version`, `installed`. `author`/`author_url` are
the same credit and derived profile link add-ons and note templates carry.

`variants` maps a colour mode to its token set, so one theme can cover light and
dark and **System** can follow the OS within it. `modes[]` lists what it covers,
for a picker row reading "light & dark"; `mode` is the primary one and `tokens`
duplicates that variant. A theme sent with only `tokens` is read as covering its
one `mode`, so the older shape keeps working.

**App modes** are `grimoire` (TTRPG) and `codex` (wargaming), a second axis
alongside the light/dark colour `mode`. Selection is stored per app mode, so
switching restores what was chosen there. `built_in[]` lists the bundled themes
- their colours live in the stylesheet, so they carry no `tokens` and can be
selected without being installed. A theme's own `app_mode` is a preference the
picker sorts by, not a restriction.

Token names are validated against a closed allowlist and values against a
plain-colour grammar, on write **and** on read. Anything else is dropped; a
theme setting nothing recognisable is rejected with a 400. Downloaded themes are
verified against the catalogue's SHA-256 and pinned to the catalogue's host.

**Updates:** a scraper definition is expected to change whenever its source
does, so `available_version` and `update_available` are reported on each
*installed* add-on (not just the available list) - an update is only actionable
if it is visible on the row the admin is looking at. Versions compare as semver,
so `1.10.0` is correctly newer than `1.9.0` and a downgrade in the index is
never offered as an update. Applying an update is the same
`POST /api/addons/:id/install` call. `update-all` continues past individual
failures rather than aborting the batch. An add-on installed by hand has no
index entry and therefore never reports an update.

**Script safety:** an add-on may ship a Python script for sources YAML cannot
express. Grimoire runs one only when `allow_scripts` is on **and** that add-on
was approved at install time (`approve_script: true`). Scripts execute in an
isolated subprocess with a timeout and no database access. Approval is tied to
the script's digest, so an update that changes the script drops back to
unapproved - including via `update-all`, which never silently re-grants consent.
Downloads are verified against the SHA-256 the index declares and refused on
mismatch.

**Storage:** installed add-ons live in `DATA_PATH/add-ons/<id>/`; a directory
placed there by hand works without any UI step. Config and install state ride in
the generic `app_settings` table under `addons.*` keys, so this feature adds no
schema.

### Duplicates *(admin only)*

Finding files that look like copies of one another, and deciding what to do
about them (issues #304, #306).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/duplicates/scan-status` | GET | Progress of the detection scan |
| `/api/duplicates/scan` | POST | Start a scan. Body: `resource_types` (empty = all four) |
| `/api/duplicates/cancel-scan` | POST | Stop a running scan |
| `/api/duplicates/groups` | GET | Candidate groups from the last completed scan. Query: `resource_type`, `min_confidence`, `limit` (max 200), `offset`. `total` counts the open groups walked to fill the page, not the whole table - a short page means the end |
| `/api/duplicates/compare` | GET | Side-by-side data for 2–4 items. Query: `resource_type`, repeated `ids` |
| `/api/duplicates/link` | POST | File items under a parent as its variants |
| `/api/duplicates/promote` | POST | Make a different copy the main version of an existing family |
| `/api/duplicates/unlink` | POST | Promote variants back to standalone entries |
| `/api/duplicates/merge-metadata` | POST | Copy chosen metadata fields between two records |
| `/api/duplicates/items/:type/:id` | DELETE | Delete one record, optionally its file |
| `/api/duplicates/dismiss` | POST | Record that a group is *not* duplicates |
| `/api/duplicates/dismissals` | GET | List dismissed groups |
| `/api/duplicates/dismissals/:id` | DELETE | Undo a dismissal |

**Nothing is ever deleted automatically.** Detection only surfaces candidates;
every deletion, link, and metadata copy is one explicit request about one group
the user looked at. There is no setting that changes this.

**Detection** is an explicitly triggered scan, never part of the normal rescan,
and it refuses to start (409) while a library scan is running. Three signals,
each catching what the others cannot:

- `hash` — byte-identical files, from the `content_hash` the scanner already
  stores. Confidence 1.0, and free: no file is re-read.
- `metadata` — near-identical titles and authors, catching `book.pdf` beside
  `book_v2.pdf`. Comparison is blocked on a title prefix so a large library
  stays tractable.
- `text` — overlapping extracted text from the FTS index, for the same book
  scanned twice or a PDF beside a CBZ of one scan. Only computed for pairs a
  cheaper signal already flagged.

Maps additionally get a `grid` signal, pairing `Tavern_grid.png` with
`Tavern_nogrid.png` by filename marker and comparable file size.

**Dismissals persist across rescans**, and are remembered pair-wise rather than
per group: dismissing {A,B} keeps that pair suppressed even when a later scan
finds a third copy C, while C still surfaces against both. A dismissal is
dropped automatically once any of its members is deleted.

**Search accuracy.** `POST /duplicates/scan` takes an `accuracy` of `exact`,
`high`, `medium` (default), or `low`. `exact` runs only the byte-identical pass —
an indexed lookup with no file reads and no false positives; the looser levels
progressively lower the title and text-overlap cutoffs, taking longer and
returning matches that need judging. `exact` disables the fuzzy signals outright
rather than running them with an impossible threshold, which is what makes it
fast rather than merely strict.

**Cross-system matching.** A title match between two different game systems is
discounted, and suppressed entirely when either file is under 10 pages: generic
handouts ("Character Sheet.pdf") exist once per system and are not copies of one
another. A missing `game_system_id` is not treated as "a different system" —
maps and tokens are routinely system-agnostic. Byte-identical matches are
unaffected: the same bytes are the same file wherever they are filed.

**Group edges.** A group's `edges` list the pairwise matches it was built from
(`{a, b, reason, score}`). Clustering is transitive, so a group is *not* a set of
mutual duplicates: if D resembles A, B, and C while the only real duplicate is
A–B, all four land in one group. Reviewing that as "D versus everything" would
invent pairs that never matched and hide the pair that did, so clients should
render the edges rather than the member cross-product. Dismissing a pair removes
the matching edge from the live results — and with it the transitive path that
would otherwise put the rejected pair back on screen.

**Variants** are how #306 collapses versions. `POST /duplicates/link` points one
record at another via `variant_parent_id`, with a `kind` from `printer-friendly`,
`form-fillable`, `spreads`, `single-page`, `version`, `black-and-white`,
`gridded`, `gridless`, `other`, and a free-text `label` ("v1.0.1"). Only two
levels are allowed — a variant cannot itself have variants — which makes cycles
impossible and keeps the version picker flat. Deleting a record that has
variants requires `reparent_to`: either an id naming which variant inherits the
rest, or `""` to promote them all. A variant is never left pointing at a deleted
parent.

`POST /duplicates/promote` re-elects the main version of a family that already
exists. It is separate from `link` because `link` refuses to file a parent under
something else — the two-level rule — which would otherwise leave a user stuck
with whichever copy they happened to review first: link the printable cut under
the form-fillable one, then meet the lined edition you actually consider the
original, and there is no way to say so. Promote moves the whole family at once:
`new_parent_id` becomes the main version, `old_parent_id` becomes one of its
variants carrying the given `kind`/`label`, and the old parent's children
re-home onto the new parent rather than dangling one level too deep. It returns
`moved`, the number of rows re-homed including the demoted parent. The new
parent may already be a variant of the old one (the common case — promoting a
copy you linked earlier); a new parent belonging to a *different* family is a
409.

**Merge whitelist:** `merge-metadata` accepts only descriptive fields. Anything
identifying the file — `filepath`, `filename`, `relative_path`, `content_hash`,
`file_size`, `game_system_id`, and the `variant_*` columns — is rejected with a
400. `tags` merges additively; it never removes a tag from the record being kept.

### Maintenance *(admin only)*

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/maintenance/cleanup-missing` | POST | Remove DB records for files no longer present on disk |
| `/api/maintenance/sidecars/settings` | GET | Read metadata sidecar export settings |
| `/api/maintenance/sidecars/settings` | PUT | Configure sidecar export (`formats`, `covers`, `overwrite_foreign`) |
| `/api/maintenance/sidecars/export` | POST | Write metadata sidecars for the whole library |

Sidecar export (issue #300) writes Grimoire's curated metadata next to the
content files so the library folder is self-describing. It is **off by default**:
`formats` is empty until an admin enables at least one of `opf`, `nfo`,
`json`, or `yaml`, and `POST /sidecars/export` returns 400 while it is
disabled. The backfill is additive: it writes only the sidecars that are
missing and leaves existing files alone, so re-running it is safe. Books newly
indexed by a library scan also get their sidecars written automatically while
export is enabled.

The export response reports what the run did rather than failing on the first
problem - `written`, `skipped_foreign` (files Grimoire did not write and so will
not replace), `skipped_missing`, `failed`, `covers`, `read_only`, and a bounded
`errors` list. A read-only library mount sets `read_only: true` with an
actionable message instead of raising. See [`sidecars.md`](sidecars.md) for the
per-format field mapping and how export interacts with sidecar import.

### Backups *(admin only)*

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/backups` | GET | List backups, newest first, with `created_at`, `size_bytes`, and `version` |
| `/api/backups` | POST | Create a backup now |
| `/api/backups/settings` | GET | Read backup schedule, retention, and storage location |
| `/api/backups/settings` | PUT | Configure schedule, retention, and storage location |
| `/api/backups/{backup_id}/download` | GET | Download a backup archive (`application/zip`) |
| `/api/backups/{backup_id}` | DELETE | Delete a backup archive (`204`) |

A backup is a single timestamped `.zip` named `grimoire-backup-<UTC timestamp>.zip`,
holding a consistent snapshot of the SQLite database (taken with SQLite's online
backup API, not a file copy) plus the user-authored directories under `DATA_PATH`:
`campaign_uploads/`, `system_covers/`, and `audio_covers/`. A `details.json`
manifest records the app version, timestamp, and trigger. The **library is never
included**, nor are the regenerable caches (`thumbnails/`, `page_cache/`).

The `backup_id` is the timestamp portion of the filename (e.g. `20260821T140355Z`)
and is matched against a strict pattern before it reaches the filesystem, so it
cannot be used to read a file outside the backup directory.

`GET /api/backups` is what makes a check-before-destructive-operation flow possible:
a client can read the newest `created_at`, decide whether it is stale, and `POST` a
fresh backup before running a destructive rescan or cleanup. `version` comes from
the archive's manifest (`"unknown"` if it is missing or unreadable), which makes a
cross-version restore detectable.

Creating a backup pauses database writes for the length of the snapshot, and a
second concurrent create returns `409`.

**There is no restore endpoint, by design** - restoring replaces the live database
and is done by hand with the server stopped. See
[`restore-from-backup.md`](../restore-from-backup.md).

Backup settings are `backup_schedule` (`off` | `hourly` | `daily` | `weekly`),
`backup_schedule_hour` / `_minute` / `_weekday` (UTC), `backup_retention_count`,
`backup_retention_gb`, and `backup_dir`. Retention limits apply independently -
oldest-first pruning runs once *either* is exceeded, always leaving at least one
backup - and pruning happens after a new archive is written, so the ceiling can be
briefly exceeded. Each setting can be pinned by an environment variable
(`BACKUP_SCHEDULE`, `BACKUP_RETENTION_COUNT`, `BACKUP_RETENTION_GB`, `BACKUP_DIR`);
when pinned, the response flags it via `*_env_locked` and a `PUT` touching it
returns `400`.

### Files *(admin only)*

Structural file management for the library (issue #302). Every path is relative
to the library root, forward-slashed, and validated against path traversal -
requests resolving outside the library root are rejected with `403`. These
endpoints **write to the library**, so they require the library volume to be
mounted read-write; a read-only mount returns `409` with an actionable message
rather than failing with a server error.

Moves and renames relink the existing DB record in place: the record `id` never
changes, so tags, favorites, reading progress, bookmarks, campaign links, and FTS
entries all survive. A book's `game_system_id` and `category` are re-derived from
the destination path, and path-keyed caches (thumbnails, rendered pages, FTS
rows) are re-homed or invalidated so no item silently loses its cover.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/files/browse` | GET | List one library folder, merged with each file's indexing state |
| `/api/files/move` | POST | Move files/folders into a destination folder, relinking records |
| `/api/files/rename` | POST | Rename a file or folder on disk, relinking records |
| `/api/files/folder` | POST | Create a folder, writing container/NSFW marker files |
| `/api/files/folder/markers` | PUT | Set or clear a folder's container-kind and NSFW markers |
| `/api/files/folder` | DELETE | Delete a folder, recursively when confirmed by name |
| `/api/files/folder/contents` | GET | Report whether a folder holds content |
| `/api/files/delete` | POST | Delete a file or folder, with its record and sidecars |
| `/api/files/folder/scaffold` | POST | Create the standard category folders in a system folder |
| `/api/files/upload` | POST | Upload a single file into a library folder |

**`GET /api/files/browse`** - `?path=` (omit for the library root), `?limit=`
(default and maximum 2000). Metadata sidecars (`<stem>.opf`, `.nfo`,
`.grimoire.json`, `.grimoire.yaml`, `.cover.jpg`) are omitted from `entries` and
from `total` when a content file with the same stem sits beside them; an
orphaned one is listed normally. They are moved and re-stemmed automatically by
`/api/files/move` and `/api/files/rename`. Returns
`{path, parent, writable, entries[], total, truncated}`. Each entry carries
`name`, `path`, `is_dir`, and `size`; folders add `container_kind`, `nsfw`, and
`child_count`, while files add `record_id`, `title`, `collection`,
`has_thumbnail`, and `is_missing` when Grimoire has indexed them. A folder
directly under `books/` that maps to a game system also carries `record_id`,
`title`, and `collection: "system"`, so a client can offer the system editor on
it. Note `collection` names the *library folder* (`books`, `maps`, …) for files
but the resource type (`system`) for system folders. Marker/dotfiles
are surfaced as folder properties, never as listable entries.

The listing is **one folder's immediate children only** - it does not recurse -
and is bounded: `total` is the folder's true entry count and `truncated` says
whether `entries` is a prefix of it, so a client can report what it is hiding
instead of presenting a partial folder as complete. `child_count` is capped
(counting stops at 1000) because an exact count of a very large folder costs a
full directory walk per row; it is `null` when the folder cannot be read.

**`POST /api/files/move`** - `{sources: [path], destination: path, on_conflict}`.
`on_conflict` is `skip` (default - report the collision and leave the file) or
`rename` (land it under a suffixed name). Neither ever overwrites an existing
file. Per-item failures are collected rather than aborting the batch: the
response is `{moved: [...], skipped: [{path, reason, code}], count}`. Moving a
folder relinks every record beneath it.

**`POST /api/files/rename`** - `{path, new_name}`. `new_name` is a bare name, not
a path. This renames the file on disk, distinct from editing an item's display
title. Returns `{from, to, records}`.

**`POST /api/files/folder`** - `{parent, name, container_kind, nsfw}`.
`container_kind` is one of `parent`, `one-page`, `agnostic`, `family`,
`publisher`, `generic`, or `""` for a plain folder; it writes the corresponding
marker file (`.parent-system-container`, `.one-page-container`,
`.system-agnostic-container`, `.system-family-container`, `.publisher-container`,
`.container`), and `nsfw` writes `.nsfw`.

`one-page` and `agnostic` are **singletons**: they name *the* collection of their
sort, so a request to give a second folder a kind another folder already holds is
rejected with `409`. `GET /api/files/browse` reports which are claimed in
`singletons_taken` (`{kind: path}`) so a client can offer only the kinds still
available. A folder merely *named* by the reserved convention (`one-page-rpgs`,
`system-agnostic`, …) counts as the incumbent.

**`PUT /api/files/folder/markers`** - `{path, container_kind?, nsfw?}`. Omitted
fields are left untouched. Container kinds are mutually exclusive: setting one
clears the others.

**`DELETE /api/files/folder`** - `{path, confirm_name?}`. Same handler as
`POST /api/files/delete`; both are described below.

**`POST /api/files/delete`** - `{path, confirm_name?}`. Deletes a file or a
folder. Returns `{path, records, files}`: how many indexed rows were removed and
how many files went with them.

**Irreversible, and guarded in proportion to the blast radius.** The file is
unlinked rather than moved to a trash folder, and its record is deleted with it,
taking every tag, favorite, bookmark, reading-progress entry, and campaign link
keyed to that id. A file's sidecars (`.opf`, `.nfo`, `.grimoire.yaml`, exported
cover) go too, since they describe a file that no longer exists.

The guard scales rather than being uniform, because a uniform guard trains people
to click through it:

* A **file** deletes on request.
* A folder holding nothing but marker files and **empty descendants** deletes on
  request. "Empty" is recursive on purpose - a shell of empty shells holds
  nothing a user would miss, and making them delete it a level at a time is
  busywork. An *orphaned* sidecar, whose content is already gone, counts as
  content: it stays visible and manageable rather than being swept up.
* A folder that still holds **content** is refused with `428` and
  `confirm_required` until `confirm_name` matches the folder's own name exactly.

Collection roots (`books/`, `maps/`, …) and the library root are always refused
with `403`.

**`GET /api/files/folder/contents`** - `?path=`. Returns
`{path, name, has_content}`. Asked before opening a delete dialog so the UI knows
which guard applies. Answered server-side deliberately: the browse listing hides
sidecars and marker files, so a client counting rows would disagree with the
check the delete itself performs.

**`POST /api/files/upload`** - multipart form: `file`, `destination`,
`relative_dir` (optional), `on_conflict` (default `rename`). Returns
`{path, name, size}`.

**One file per request, by design.** A batch endpoint would make a 200-file
import succeed or fail as a unit, leaving no way to say which files landed or to
retry just the ones that did not. Sending files individually lets a client report
per-file progress and retry failures in isolation.

The file is streamed to disk in chunks rather than buffered in memory, written
under a temporary name, and renamed into place only once complete - so an
interrupted upload never leaves a truncated file for the scanner to index.

Validation is per collection: only extensions the destination tree actually
indexes are accepted (documents/images/archives under `books/`, images and
archives under `maps/` and `tokens/`, audio under `audio/`), because a file the
scanner ignores is an upload that silently does nothing. Uploads into the library
root are refused. The supplied filename is reduced to its final component, so a
path smuggled through the multipart body cannot escape the destination, and
hidden files are rejected outright - a dotfile upload could otherwise write a
container marker and reclassify a shelf. Single files are capped at 8 GB
(`413` past that), and an upload never overwrites: a name clash is suffixed.

`relative_dir` carries the sub-path from a folder upload (the browser's
`webkitRelativePath` minus the file name) so a dropped folder keeps its
structure; it is validated against the library root like any other path.

**`POST /api/files/folder/scaffold`** - `{path}`. Creates the standard category
folders (`Core`, `Supplements`, `Adventures`, `Character Sheets`, `Maps`,
`Handouts`, `Homebrew`, `Starter Sets`) inside a system folder. Each name is
chosen to infer back to its canonical category slug, so the folders classify
correctly on the next scan. Only valid for a folder directly under `books/`.
Returns `{path, created, existing}`. A category is skipped when an existing
folder already *resolves to* it, matched on the inferred category rather than the
folder name - a system holding `Rules` will not gain a second `Core`, and one
holding `Modules` will not gain `Adventures`. `existing` reports the incumbent
folder's real name, so running it on a partly-organised system fills only the
genuine gaps.

### Downloads

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/downloads/archive` | GET | user | Stream a collection of files as one archive |

**Query parameters:** `type` (required) selects the scope, `fmt` selects the
format — `zip` (default), `tar`, `tar.gz`, `tar.bz2` — and the remaining
parameters depend on the scope:

| `type` | Required params | Contents |
|--------|-----------------|----------|
| `system` | `id` | Every book in a game system, foldered by category |
| `system_category` | `id`, `category` | Every book in one category of a system |
| `book_folder` | `id`, `folder` | Books in a nested subfolder, sub-hierarchy preserved |
| `map_folder` | `folder` | Every map under a maps subfolder |
| `token_folder` | `folder` | Every token under a tokens subfolder |
| `audio_folder` | `folder` | Every track under an audio subfolder |
| `library_folder` *(admin)* | `folder` | Any library folder **as it sits on disk** |

Every scope except `library_folder` is built from indexed records, so each is
filtered by what the caller may see: explicit content is dropped for users with
`allow_explicit` off, and books are filtered through the same access rules the
browse endpoints use — a bulk archive is the easiest way to walk out with a
restricted book. Variants are deliberately **included** (issues #304, #306): a
"download this whole system" archive should hold every file the user owns.

`library_folder` is the file manager's scope and works differently. It walks the
filesystem rather than the index, so the archive holds *everything* under the
folder — loose files the scanner ignored, unindexed formats, sidecars — with
in-archive paths relative to the requested folder. That is the point: the file
manager browses the filesystem, and an archive of only the rows Grimoire happens
to have would silently drop files the user can plainly see. Because nothing here
resolves through a book row, no per-book access rule can be applied to it, so the
scope is **admin-only** — the same audience as the file manager itself. Dotfiles
are skipped, symlinks pointing outside the library are dropped, `folder` is
validated against traversal (`403`), and the walk is capped at 5000 files /
50 GB (`413` past that, asking for a subfolder instead).

Archive entry paths are sanitised for cross-platform extraction: Windows-illegal
characters are replaced, leading/trailing dots and spaces stripped, and each
component clamped to 255 bytes. Responses stream with a
`Content-Disposition: attachment` filename derived from the scope. `404` when the
scope resolves to no files.

### Logs *(admin only)*

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/logs` | GET | admin | Retrieve recent log entries from the in-memory ring buffer |

**Query parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `level` | `info` | Minimum log level: `debug`, `info`, `warning`, `error`, `critical`. Follows standard hierarchy - `debug` returns all levels, `info` returns info and above, etc. |
| `limit` | `200` | Max entries to return (1–20000) |
| `offset` | `0` | Skip this many of the most-recent matching entries (historical pagination, ignored when `after_seq` is set) |
| `after_seq` | - | Return only entries with `seq` greater than this value. Use the `max_seq` from the previous response as a cursor for live polling. Exact even when hundreds of entries arrive between polls. |

**Response:**
```json
{
  "entries": [
    {
      "seq": 142,
      "timestamp": "2026-04-10T12:34:56.789Z",
      "level": "INFO",
      "logger": "grimoire",
      "message": "File scan start"
    }
  ],
  "total": 42,
  "max_seq": 142,
  "level": "info",
  "limit": 200,
  "offset": 0
}
```

> **Note:** Console/Docker log verbosity is controlled by the `LOG_LEVEL` environment variable (default `info`). The `/api/logs` endpoint always has access to `DEBUG`-level entries regardless of `LOG_LEVEL`, because the in-memory buffer captures all levels. The buffer holds up to 20 000 entries.

**Cleanup response:**
```json
{
  "removed": {
    "books": 2,
    "maps": 0,
    "tokens": 1,
    "audio": 0,
    "systems": 0
  }
}
```

---

## Error responses

All errors follow FastAPI's standard format:

```json
{"detail": "Human-readable error message"}
```

| Status | Meaning |
|--------|---------|
| `400` | Bad request - validation failed or business rule violated |
| `401` | Not authenticated - missing or invalid token |
| `403` | Forbidden - insufficient role or not a campaign member |
| `404` | Resource not found |
| `409` | Conflict - duplicate (e.g. duplicate username, resource already linked) |
| `422` | Unprocessable entity - request body failed schema validation |

---

## Library directory structure

The scanner expects files organized as:

```
/library/
  books/
    {System Name}/
      core/            → category: core
      supplement/      → category: supplement
      adventure/       → category: adventure
      character-sheet/ → category: character-sheet
      map/             → category: map
      handout/         → category: handout
      homebrew/        → category: homebrew
      {custom name}/   → category: slugified folder name
  maps/
    {any folder structure}/
  tokens/
    {any folder structure}/
```

Game system records are created automatically from the folder names under `books/`. Append `(nsfw)` to a system folder name to mark all its content as explicit.

### OPF sidecar metadata

When a book is first indexed, the scanner looks for an OPF metadata file alongside the PDF. Two locations are checked in order:

1. `<bookname>.opf` - same directory, same stem as the PDF.
2. `metadata.opf` - same directory (Calibre's per-book-folder format).

Fields read: `dc:title`, `dc:creator` (role=aut → authors), `dc:publisher`, `dc:date` (year), `dc:description` (HTML stripped), `dc:subject` (→ tags). Cover images referenced in the OPF `<guide>` are excluded from the book list automatically.

By default OPF metadata is applied only on a book's first scan, and ordinary rescans (`metadata_mode: "new"`) do not overwrite values edited via the API. To re-apply sidecar metadata to already-indexed books, rescan with `metadata_mode: "missing"` (fills empty fields only, non-destructive) or `metadata_mode: "replace"` (overwrites with the sidecar's values). Combine with `scope` to refresh just one folder.
