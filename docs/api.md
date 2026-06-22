# Grimoire API Reference

**Version:** 0.1.0

## Interactive docs

The live API is self-documented via OpenAPI. With the server running:

| URL | Description |
|-----|-------------|
| `http://localhost:9481/api/docs` | **Swagger UI** — interactive, try-it-out docs |
| `http://localhost:9481/api/redoc` | **ReDoc** — clean, readable reference |
| `http://localhost:9481/api/openapi.json` | Raw OpenAPI schema |
---

## Authentication

All endpoints except `/api/auth/status`, `/api/auth/setup`, `/api/auth/login`, `/api/auth/guest-login`, and `/api/auth/config` require a JWT.

**Header** (preferred for API clients):
```
Authorization: Bearer <token>
```

**Query parameter** (required for browser-embedded images and file downloads):
```
?token=<token>
```

Tokens are returned by `/api/auth/login` and expire after **30 days**.

### Roles

| Role | Permissions |
|------|-------------|
| `admin` | Full access including user management and app settings |
| `gm` | Read + edit metadata, rescan library, manage campaigns |
| `player` | Read-only access |

---

## Endpoints

### Auth

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/status` | GET | — | Returns `{"initialized": bool}` — used by the frontend to decide whether to show first-run setup |
| `/api/auth/config` | GET | — | Public auth configuration for the login screen: `{password_auth_enabled, guest_access_enabled, custom_login_message_enabled, custom_login_message, oidc_enabled, oidc_button_text, oidc_auto_launch}`. The custom message is only returned when its toggle is on. OIDC fields are only true/non-empty when the IdP is fully configured. |
| `/api/auth/setup` | POST | — | First-run admin account creation. Body: `{username, password}`. Returns `{token, user}`. Fails with 400 if any users exist. |
| `/api/auth/login` | POST | — | Authenticate. Body: `{username, password}`. Returns `{token, user}`. Returns 403 if password authentication is disabled. |
| `/api/auth/guest-login` | POST | — | Exchange a campaign guest invite code for a JWT. Body: `{code}`. Returns `{token, user, campaign_id}`. Returns 403 if guest access is disabled, 401 for an unknown/expired code. |
| `/api/auth/me` | GET | any | Current user: `{id, username, display_name, email, role, allow_explicit, campaign_access, oidc_linked}` |
| `/api/auth/openid/login` | GET | — | Start an OIDC login. Redirects to the IdP. Optional `?return_to=/path` to redirect after callback. Returns 503 if OIDC isn't configured. |
| `/api/auth/openid/callback` | GET | — | OIDC callback. Validates the code, finds/creates the local user, and redirects to the frontend with `#oidc_token=<jwt>`. |
| `/api/auth/openid/discover` | POST | admin | Server-side discovery fetch. Body: `{issuer_url}`. Returns the relevant endpoints from `.well-known/openid-configuration`. |

### Users

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/users` | GET | admin | List all users (each entry includes `email`, `allow_explicit`, `campaign_access`, and `oidc_linked`) |
| `/api/users` | POST | admin | Create a user. Body: `{username, password, role?, email?}` (role defaults to `player`; email is optional and unique case-insensitively) |
| `/api/users/:id` | PATCH | admin | Update `role`, `password`, `allow_explicit`, `campaign_access`, or `email` (use `""` to clear the email). `campaign_access: false` blocks the user from creating/joining/managing campaigns without deleting existing ones; OIDC's `campaignAccess` permissions claim overrides it on next login. |
| `/api/users/:id` | DELETE | admin | Delete a user (cannot delete self or last admin) |
| `/api/users/me/preferences` | PATCH | any | Update own `display_name`, `allow_explicit`, or `email` (use `""` to clear) |
| `/api/users/me/password` | PATCH | any | Change own password. Body: `{current_password, new_password}` |
| `/api/users/me` | DELETE | any | Delete own account (admin accounts cannot self-delete) |

### Library

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/stats` | GET | JWT **or** `X-API-Key` header | Counts, page totals, library size, version |
| `/api/scan-status` | GET | admin | Current scan state |
| `/api/rescan` | POST | admin | Trigger a background rescan and reindex |
| `/api/cancel-scan` | POST | admin | Request a graceful stop of the running scan or indexing job |

**Stats response:**
```json
{
  "game_systems": 12,
  "books": 340,
  "maps": 1500,
  "tokens": 800,
  "indexed_books": 320,
  "total_pages": 45000,
  "total_size_mb": 18240.5,
  "version": "1.0.0"
}
```

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
  "new_books": 5,
  "new_maps": 0,
  "new_tokens": 0,
  "indexed": 80,
  "to_index": 320
}
```

`phase` is `"scanning"`, `"indexing"`, or `null` when idle.

**Cancel-scan response:**
```json
{"status": "stop_requested"}
```
Returns `{"status": "not_running"}` if no scan is in progress. Cancellation is cooperative — the running scan checks for the stop signal after each file and exits at the next safe checkpoint. Poll `/api/scan-status` until `running` is `false` to confirm it has stopped.

### Game Systems

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/systems` | GET | any | List all systems with book counts |
| `/api/systems/:id` | GET | any | System detail + full book list |
| `/api/systems/:id` | PATCH | gm/admin | Update metadata (see fields below) |

**PATCH fields:** `name`, `slug`, `description`, `publishers`, `character_builder_url`, `cover_image`, `cover_book_id`, `tags`, `genre`, `is_explicit`

**Publishers format:** `[{"name": "Publisher Name", "url": "https://..."}]`

### Books

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/books` | GET | any | Paginated book list. Query: `system_id`, `category`, `limit` (max 500, default 100), `offset` |
| `/api/books/:id` | GET | any | Book detail with game system |
| `/api/books/:id` | PATCH | gm/admin | Update: `title`, `category`, `description`, `authors`, `publisher`, `publisher_url`, `year`, `is_explicit` |
| `/api/books/:id/file` | GET | any | Download/stream the file |
| `/api/books/:id/thumbnail` | GET | any | WebP cover thumbnail |
| `/api/books/:id/toc` | GET | any | PDF table of contents as `{title, page, level, children}[]` |
| `/api/books/:id/page/:num` | GET | any | Render PDF page as WebP. Query: `width` (default 1200, max 3000). Cached. |
| `/api/books/:id/page/:num/text` | GET | any | Plain text of a page (from FTS index or live extraction) |
| `/api/books/:id/page/:num/words` | GET | any | Word bounding boxes `{x0, y0, x1, y1, text}` for text overlay |

**Book list response:** `{"total": int, "books": [...]}`

**Categories:** `core`, `supplement`, `adventure`, `character-sheet`, `map`, `handout`, `homebrew`, `starter-set`

### Maps

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/maps` | GET | any | Paginated map list. Query: `limit`, `offset`, `tag` |
| `/api/maps/:id` | GET | any | Map detail: filename, tags, `map_type`, `grid_size`, `file_size`, `has_thumbnail` |
| `/api/maps/:id` | PATCH | gm/admin | Update `description`, `tags`, `map_type`, `grid_size` |
| `/api/maps/:id/file` | GET | any | Download/stream the map image |
| `/api/maps/:id/thumbnail` | GET | any | WebP thumbnail |
| `/api/map-folders` | GET | any | List folder tag assignments |
| `/api/map-folders` | PATCH | gm/admin | Set tags on a folder path. Body: `{path, tags}` |

### Tokens

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/tokens` | GET | any | Paginated token list. Query: `limit`, `offset`, `tag` |
| `/api/tokens/:id` | GET | any | Token detail |
| `/api/tokens/:id` | PATCH | gm/admin | Update `description`, `tags`, `is_explicit` |
| `/api/tokens/:id/file` | GET | any | Download the token image |
| `/api/tokens/:id/thumbnail` | GET | any | WebP thumbnail |
| `/api/token-folders` | GET | any | List folder tag assignments |
| `/api/token-folders` | PATCH | gm/admin | Set tags on a folder path. Body: `{path, tags}` |

### Favorites

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/favorites` | GET | any | List current user's favorites with enriched detail |
| `/api/favorites` | POST | any | Add a favorite (idempotent). Body: `{item_type, item_id}` |
| `/api/favorites/:type/:id` | DELETE | any | Remove a favorite (silent 204 if not found) |

Item types: `book`, `map`, `token`, `system`

### Bookmarks

Bookmarks are per-user — users cannot see or modify each other's bookmarks.

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
| `/api/search?q=` | GET | any | FTS5 full-text search. Required: `q` (min 2 chars). Optional: `book_id`, `system_id`, `limit` (default 20). Global search also matches maps and tokens by filename. |

**Response:**
```json
{
  "query": "fireball",
  "total": 42,
  "results": [{"id": "uuid", "title": "...", "game_system": "...", "page_number": 42, "snippet": "...", "category": "core"}],
  "maps":    [{"id": "uuid", "filename": "...", "relative_path": "...", "tags": [...]}],
  "tokens":  [{"id": "uuid", "filename": "...", "relative_path": "...", "tags": [...]}]
}
```

`maps` and `tokens` are empty when `book_id` or `system_id` is scoped.

### Campaigns

#### Campaign CRUD

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns` | GET | any | List own + invited campaigns (admins see only their own here). Each item includes `has_banner`, `next_session` (next scheduled date or null), and `last_accessed_at`. |
| `/api/campaigns` | POST | any (gm/admin for `is_gm_campaign: true`) | Create campaign. Body: `{name, description?, is_gm_campaign?, gm_title?, system_id?, system_name?, parent_campaign_id?, resources?}`. `description` accepts markdown. `system_name` is free text for a system not in the library (ignored when `system_id` is set). `resources` is an explicit list of `{resource_type, resource_id, visibility?, shared_user_ids?}` to link — omit it (or send `[]`) to link nothing. No resources are auto-added. Returns 403 if the user's `campaign_access` is disabled. |
| `/api/campaigns/:id` | GET | owner or member | Campaign detail with members and resources. Includes `has_banner` and `locked` (`true` when the owner's `campaign_access` is disabled — the campaign is then read-only for everyone, owner-management endpoints return 403, members keep read access) plus `owner_has_campaign_access`. Each member includes `id`, `has_art`, `has_sheet`, `character_sheet_filename`, and `campaign_access` (false → flagged as a disabled user). Opening this endpoint records `last_accessed_at` (drives recently-accessed sorting on the campaigns list). |
| `/api/campaigns/:id` | PATCH | owner | Update `name`, `description` (markdown), `gm_title`, `system_id`, `system_name`, `parent_campaign_id`. Setting `system_id` clears `system_name` and vice-versa (`system_name: ""` clears it). |
| `/api/campaigns/:id` | DELETE | owner | Delete campaign and all related data. Admins delete via the database directly. |
| `/api/campaigns/admin/by-user/:user_id` | GET | admin | Read-only minimal list of a user's campaigns (`id`, `name`, `description`, `is_gm_campaign`, `system_id`, `system_name`) for the user-management page |

#### Members

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns/:id/invite` | POST | owner | Invite a user. Body: `{user_id}`. GM campaigns only. Returns 403 if the target user's `campaign_access` is disabled. |
| `/api/campaigns/:id/members/:user_id` | PATCH | member (own) or owner | Accept/decline or set character name. Body: `{status?, character_name?}`. A user with `campaign_access` disabled cannot `accept` (403) but may `decline`. |
| `/api/campaigns/:id/members/:user_id` | DELETE | owner or self | Remove member |
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

Guests authenticate via [`/api/auth/guest-login`](#auth) and may write only their own character name, art, sheet, session notes, and availability — everything else is read-only. The shared library, maps, tokens, and search return 403 for guests.

#### Banner, character art & sheets

Files are stored on disk under `DATA_PATH/campaign_uploads/`. Banners are keyed by campaign id; character art and sheets are keyed by the **CampaignMember id** (`member.id` from the campaign-detail response), so a player in multiple campaigns gets a distinct file per membership. Image uploads (banner, art) accept PNG/JPEG/WebP/GIF up to 5 MB; sheets additionally accept PDF up to 15 MB. Serving endpoints accept the `?token=` query param for use in `<img>`/download URLs.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns/:id/banner` | POST | owner | Upload/replace campaign banner (multipart `file`) |
| `/api/campaigns/:id/banner` | GET | member or owner | Banner image |
| `/api/campaigns/:id/banner` | DELETE | owner | Remove banner |
| `/api/campaigns/:id/members/:member_id/art` | POST | member (own) or owner | Upload/replace character art (multipart `file`) |
| `/api/campaigns/:id/members/:member_id/art` | GET | member or owner | Character art image |
| `/api/campaigns/:id/members/:member_id/art` | DELETE | member (own) or owner | Remove character art |
| `/api/campaigns/:id/members/:member_id/sheet` | POST | member (own) or owner | Upload/replace character sheet (multipart `file`) |
| `/api/campaigns/:id/members/:member_id/sheet` | GET | member or owner | Download character sheet (original filename) |
| `/api/campaigns/:id/members/:member_id/sheet` | DELETE | member (own) or owner | Remove character sheet |
| `/api/campaigns/:id/members/:member_id/sheet/fields` | GET | member (own) or owner | Read a sheet's fillable PDF form fields (`{ fillable, fields: [{name, type, value, options?}] }`; `fillable: false` when not a form-fillable PDF) |
| `/api/campaigns/:id/members/:member_id/sheet/fields` | PUT | member (own) or owner | Write form field values back into the sheet PDF (body `{ fields: {name: value} }`); returns the refreshed fields |
| `/api/campaigns/:id/members/:member_id/sheet/duplicate` | POST | member (own) or owner | Copy a blank PDF into the member's sheet (body `{ source_type: "book"\|"file", source_id }`) |
| `/api/campaigns/:id/sheet-sources` | GET | member or owner | List duplicatable blank sheets (`{ books, files }`): library `character-sheet` PDFs (filtered to the campaign's system when set) and campaign PDF files |

#### Resources

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns/resources/search` | GET | any | Search books/maps/tokens. Books match on title (filter with `system_id?`); maps/tokens match on folder path first then filename, with the folder in `subtitle`. Query: `q`, `resource_type?`, `system_id?`, `limit?` (default 30) |
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

Resource types: `book`, `map`, `token`, `file` (a GM-uploaded file stored under `DATA_PATH/campaign_uploads/files/`, separate from the library). Listed/serialized resources include `is_image` (true for `file` resources that hold an image upload — those render inline with a thumbnail instead of as a download card).

Resource **visibility** is one of: `public` (every accepted member), `private` (the owner plus the users in `shared_user_ids`), or `gm` (owner only). The character-sheet upload endpoints also accept a URL alternative via the member PATCH: `PATCH /api/campaigns/:id/members/:user_id` with `{character_sheet_url}` (`""` clears it; setting a URL clears any uploaded sheet, and uploading a sheet clears the URL).

App-wide admin settings gate campaign file uploads (admins are exempt): `campaign_uploads_disabled` (bool), `campaign_upload_max_file_mb` (int, 0 = unlimited), `campaign_upload_max_total_mb` (int, 0 = unlimited). They are settable via `PATCH /api/settings` and exposed on `GET /api/settings/ui`.

#### Categories

GM-defined groupings for linked **resources**, scoped per campaign. Resources carry an optional `category_id` (null = grouped under their built-in type group: Books / Maps / Tokens / Files), set via the resource PATCH endpoint (`category_id`), using `""` to clear it. Wiki pages no longer use categories — they nest under parent pages instead (see Wiki). `kind` `note` is retired: `POST` with `kind: "note"` returns 400, and legacy note categories are converted to parent pages on startup.

The resource panel's **group display order** (custom categories interleaved with the built-in type groups) is stored per campaign as `resource_group_order` (returned by the campaign GET): an ordered list of group keys — `type:book`, `type:map`, `type:token`, `type:file`, and `cat:<category_id>`. Groups absent from the list fall to the end in their default order; an empty list means the default order (categories then type groups).

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns/:id/categories` | GET | member or owner | List categories. Query: `kind?` (`resource`) |
| `/api/campaigns/:id/categories` | POST | owner | Create. Body: `{name, kind, icon?}` (`kind` must be `resource`; `icon` = a Lucide icon name) |
| `/api/campaigns/:id/categories/reorder` | PUT | owner | Set category sort order. Body: `{ordered_ids}` |
| `/api/campaigns/:id/resource-group-order` | PUT | owner | Set the resource panel's group display order (categories + type groups). Body: `{ordered_keys}` (keys `type:book`/`type:map`/`type:token`/`type:file`/`cat:<id>`; unknown or duplicate keys are dropped) |
| `/api/campaigns/:id/categories/:cat_id` | PATCH | owner | Rename / set icon. Body: `{name?, icon?}` (`icon: ""` clears it) |
| `/api/campaigns/:id/categories/:cat_id` | DELETE | owner | Delete. Query: `mode` = `uncategorize` (default; resources kept, moved out of the category) or `delete_items` (resources unlinked) |

#### Wiki (notes)

The campaign notebook is a set of markdown **wiki pages**. Pages link to one another with `[[Page Title]]` (or `[[Page Title|label]]`) syntax and embed campaign content inline with `[[book:ID]]`, `[[book:ID:PAGE]]`, `[[map:ID]]`, `[[token:ID]]`, `[[file:ID]]` (a download card for a campaign file), or `[[image:ID]]` (an uploaded image rendered inline). `ID` is the resource's underlying id; the embed picker lists only resources already linked to the campaign (and offers an image upload). On save the body is re-parsed: unknown `[[Page Title]]` targets auto-create a stub page (inheriting the source page's visibility), embed tokens are skipped (never create stubs), and backlink rows are rebuilt.

Pages nest: each page has an optional `parent_id` (null = top level), forming a tree of arbitrary depth (a "category" is just a page with children). Deleting a page re-parents its children to the deleted page's parent rather than removing the subtree. A page may not be its own parent or be moved under one of its own descendants (400).

Each page has a **visibility**: `gm` (owner only), `group` (all accepted members), or `members` (owner plus the users in `shared_user_ids`). The owner may create/edit/delete any page; a member may create `group` pages and edit/delete pages they authored, but cannot set `gm`/`members` visibility.

Within a page body, text wrapped in `||double pipes||` is a **GM-only secret** — finer-grained than page visibility, it hides a span inside an otherwise shared page. Those spans (markers and enclosed text, which may span multiple lines) are stripped server-side from the `body` returned to anyone other than the campaign owner, and from `search` snippets/matches for non-owners. The owner always receives the raw `||...||`. Personal (non-GM) campaigns are never stripped, since only the owner can view them.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/campaigns/:id/wiki` | GET | member or owner | List pages the caller can see (`id, title, slug, visibility, page_type, session_date, parent_id, icon, sort_order, updated_at, can_edit`), ordered by `sort_order`. Build the page tree client-side from `parent_id` |
| `/api/campaigns/:id/wiki` | POST | member or owner | Create a page. Body: `{title?, body?, visibility?, page_type?, session_date?, shared_user_ids?, parent_id?, icon?}` (`parent_id` nests the page; `icon` = a Lucide icon name) |
| `/api/campaigns/:id/wiki/search` | GET | member or owner | Search visible pages by title/body. Query: `q` |
| `/api/campaigns/:id/wiki/titles` | GET | member or owner | `{title, slug}` list for `[[link]]` autocomplete |
| `/api/campaigns/:id/wiki/reorder` | PUT | owner | Drag-and-drop order. Body: `{ordered_ids}` |
| `/api/campaigns/:id/wiki/export` | GET | owner | Export all pages. Query: `format` = `md` (a `.zip` of one Markdown file per page, with YAML frontmatter incl. `parent` slug — Obsidian-friendly) or `json` (a Grimoire JSON bundle: `{grimoire_wiki_version, campaign, pages[]}`, each page carrying its `parent` slug). Returns a file download |
| `/api/campaigns/:id/wiki/import` | POST | owner | Import pages from a multipart `file`. Accepts a single `.md`/`.markdown`/`.txt`, a Grimoire `.json` bundle, a LegendKeeper export (`.json`/`.lk` — a per-page export or a current `{version, resources[]}` bundle with ProseMirror bodies), or a `.zip` (Markdown vault, Grimoire bundle, or LegendKeeper directory export). LegendKeeper HTML and ProseMirror bodies are converted to Markdown (lossy for LegendKeeper-only blocks, which are dropped); page nesting (`parent`/`parentId`) is preserved. Import is non-destructive: every record becomes a new page (slugs de-duplicated), existing pages are never overwritten, and internal links are remapped. Returns `{imported, format, pages[]}` |
| `/api/campaigns/:id/wiki/:page_id` | GET | per visibility | Page detail incl. `body`, `backlinks`, `shared_user_ids`, `icon`, `can_edit` |
| `/api/campaigns/:id/wiki/:page_id` | PATCH | owner or page author | Update fields (each optional; `icon: ""` clears it) |
| `/api/campaigns/:id/wiki/:page_id` | DELETE | owner or page author | Delete the page and its link rows |

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
  "time_utc": "18:00",
  "biweekly_reference": "2026-01-03",
  "monthly_week": null,
  "custom_dates": null
}
```

| Field | Description |
|-------|-------------|
| `frequency` | `weekly`, `biweekly`, `monthly`, or `custom` |
| `days` | Weekday indices — `0` = Monday … `6` = Sunday |
| `time_utc` | Session time in UTC (`HH:MM`) |
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

### Settings *(admin only)*

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/settings` | GET | Get all application settings |
| `/api/settings` | PATCH | Update application settings |
| `/api/settings/ui` | GET | UI visibility flags (any authenticated user) |
| `/api/settings/api-key/generate` | POST | Generate a stats API key |
| `/api/settings/api-key` | DELETE | Revoke the stats API key |

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
| `hide_campaigns` | bool | Hide the campaigns section in the UI |
| `show_stat_systems` | bool | Show/hide game system count in sidebar |
| `show_stat_books` | bool | Show/hide book count in sidebar |
| `show_stat_pages` | bool | Show/hide page count in sidebar |
| `show_stat_maps` | bool | Show/hide map count in sidebar |
| `show_stat_tokens` | bool | Show/hide token count in sidebar |
| `show_stat_size` | bool | Show/hide library size in sidebar |
| `show_stat_version` | bool | Show/hide version in sidebar |
| `password_auth_enabled` | bool | Allow password sign-in. Cannot be patched if `ALLOW_PASSWORD_AUTHENTICATION` is set in the environment (returns 400). The `password_auth_env_locked` field on the GET response indicates whether the env override is active. |
| `guest_access_enabled` | bool | Allow GMs/admins to create guest invite codes. Cannot be patched if `GUEST_ACCESS_ENABLED` is set in the environment (returns 400). The `guest_access_env_locked` field on the GET response indicates whether the env override is active. |
| `custom_login_message_enabled` | bool | Show a custom message above the sign-in form |
| `custom_login_message` | string | HTML for the login message. Sanitized server-side: only `<b>`, `<strong>`, `<i>`, `<em>`, `<s>`, `<strike>`, `<del>`, `<u>`, `<p>`, `<br>`, `<ul>`, `<ol>`, `<li>`, and `<a href>` (http/https/mailto/relative) are allowed; everything else is dropped. |
| `oidc_enabled` | bool | Master toggle for OIDC sign-in. Has no effect until issuer / client id / client secret are also set. |
| `oidc_issuer_url` | string | Base URL of the IdP (e.g. `https://idp.example.com/realms/main`). |
| `oidc_authorization_endpoint` | string | Discovered or manual authorization endpoint URL. |
| `oidc_token_endpoint` | string | Discovered or manual token endpoint URL. |
| `oidc_userinfo_endpoint` | string | Discovered or manual userinfo endpoint URL. |
| `oidc_jwks_uri` | string | Discovered or manual JWKS URL — required to validate the ID token signature. |
| `oidc_end_session_endpoint` | string | Optional RP-initiated logout endpoint. |
| `oidc_client_id` | string | Client ID issued by the IdP. |
| `oidc_client_secret` | string | **Write-only.** Setting a non-empty string saves it. Empty string is a no-op (so form re-submits don't clobber). The literal `"__CLEAR__"` wipes the stored secret. GET responses never return the value — instead, `oidc_client_secret_set: bool` and `oidc_client_secret_length: int` are returned. |
| `oidc_signing_alg` | string | One of `RS256`/`RS384`/`RS512`/`ES256`/`ES384`/`ES512`/`PS256`/`PS384`/`PS512`/`HS256`. Default `RS256`. |
| `oidc_button_text` | string | Label for the SSO button on the login page. |
| `oidc_groups_claim` | string | Optional. Name of the claim containing group memberships. When set, roles are assigned from groups named (case-insensitively) `admin`, `gm`, or `player`; users without a matching group are denied. |
| `oidc_permissions_claim` | string | Optional. Name of the claim containing a permissions object (e.g. `{viewNSFW: bool}`). When set, the claim must be present in every login or access is denied. |
| `oidc_match_by` | string | One of `none`, `email`, `username`. How to link an existing local account to an OIDC subject on first login. |
| `oidc_auto_launch` | bool | When true, `/login` immediately redirects to the IdP. Suppress with `?autoLaunch=0`. |
| `oidc_auto_register` | bool | Auto-create local accounts on first OIDC login. |

GET responses also include a sibling `<key>_env_locked: bool` for each individual OIDC setting, indicating whether the value is pinned by an environment variable. Patching a locked field returns 400. The fixed callback URL is exposed as `oidc_redirect_uri`.

### Maintenance *(admin only)*

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/maintenance/cleanup-missing` | POST | Remove DB records for files no longer present on disk |

### Logs *(admin only)*

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/logs` | GET | admin | Retrieve recent log entries from the in-memory ring buffer |

**Query parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `level` | `info` | Minimum log level: `debug`, `info`, `warning`, `error`, `critical`. Follows standard hierarchy — `debug` returns all levels, `info` returns info and above, etc. |
| `limit` | `200` | Max entries to return (1–20000) |
| `offset` | `0` | Skip this many of the most-recent matching entries (historical pagination, ignored when `after_seq` is set) |
| `after_seq` | — | Return only entries with `seq` greater than this value. Use the `max_seq` from the previous response as a cursor for live polling. Exact even when hundreds of entries arrive between polls. |

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
    "tokens": 1
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
| `400` | Bad request — validation failed or business rule violated |
| `401` | Not authenticated — missing or invalid token |
| `403` | Forbidden — insufficient role or not a campaign member |
| `404` | Resource not found |
| `409` | Conflict — duplicate (e.g. duplicate username, resource already linked) |
| `422` | Unprocessable entity — request body failed schema validation |

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

1. `<bookname>.opf` — same directory, same stem as the PDF.
2. `metadata.opf` — same directory (Calibre's per-book-folder format).

Fields read: `dc:title`, `dc:creator` (role=aut → authors), `dc:publisher`, `dc:date` (year), `dc:description` (HTML stripped), `dc:subject` (→ tags). Cover images referenced in the OPF `<guide>` are excluded from the book list automatically.

OPF metadata is applied only on first scan. Subsequent rescans do not overwrite values edited via the API.
