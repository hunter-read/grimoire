# Configuration

Every setting below is optional unless noted - Grimoire boots with sensible defaults and
generates its own `SECRET_KEY` on first run. Set the variables you need in your
`docker-compose.yml`, under `environment:`.

Many of these pin a setting that is otherwise editable in the app. When an environment
variable is set, its value wins and the matching field is shown read-only in Settings.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | auto-generated | JWT signing secret. Leave unset and Grimoire generates a random key on first boot and persists it at `DATA_PATH/secret_key`, reusing it across restarts. Set it explicitly (`openssl rand -hex 32`) if you run multiple replicas that don't share `DATA_PATH`. Grimoire refuses to start if it's set to a placeholder published in these docs (`change-me`, `replace-this-with-a-long-random-string`, `grimoire-dev-secret-change-in-production`) - see the [FAQ](faq.md#grimoire-wont-start-and-the-log-mentions-secret_key). |
| `WORKERS` | `2` | Number of uvicorn worker processes |
| `LIBRARY_PATH` | `/app/library` | Optional path to your library directory inside the container if not mounted at /app/library |
| `DATA_PATH` | `/app/data` | Optional path for the database, thumbnails, and search cache inside the container if not mounted at /app/data |
| `BASE_URL` | `http://localhost:9481` | Public base URL of this instance. Set this to the URL you use to access Grimoire (e.g. `https://grimoire.example.com`) when running behind a reverse proxy - used to build absolute links in OPDS feeds, campaign calendar subscription links, and other places that need a fully-qualified URL. |
| `APP_VERSION` | from `VERSION` file | Optional. The version shown in the About dialog. The official images bake this in at build time; everything else reads the `VERSION` file that ships in the repo root, so a source checkout or an extracted release tarball reports itself correctly without setting this. Only needed if you run from a directory without that file, where the version otherwise shows as `unknown`. |
| `VALKEY_URL` | - | Optional Redis-compatible cache URL for rendered page images (e.g. `redis://valkey:6379/0`) |
| `PAGE_CACHE_TTL` | `604800` | Optional. Seconds a rendered page stays in the Valkey cache (default 7 days). `0` means no expiry. Ignored when `VALKEY_URL` is unset. |
| `PAGE_CACHE_MAX_MB` | `2048` | Optional. Size ceiling for the on-disk rendered-page cache at `DATA_PATH/page_cache`. Trimmed oldest-first at startup and after each library scan. `0` disables the trim and lets it grow without bound. |
| `OCR_ENABLED` | `true` | Optional. Set to `false` to disable OCR of image-only PDFs even on the OCR-capable image. See [OCR](performance.md#ocr). |
| `OCR_LANGUAGES` | `eng` | Optional. Tesseract language codes for OCR, e.g. `eng` or `eng+deu+fra`. Extra languages require their tessdata files to be present (see [OCR](performance.md#ocr)). |
| `OCR_CONCURRENCY` | `1` | Optional. Number of scanned books OCR'd in parallel by the background OCR worker. Raise on multi-core hosts with spare CPU; keep at `1` on small boxes. Set to `0` to turn OCR off (same as `OCR_ENABLED=false`). See [Speeding up OCR](performance.md#speeding-up-ocr). |
| `OCR_DPI` | `150` | Optional. Resolution scanned pages are rasterized at before OCR (clamped 72–600). Higher = more accurate but slower and more memory per page. See [Speeding up OCR](performance.md#speeding-up-ocr). |
| `OCR_PAGE_TIMEOUT` | `120` | Optional. Seconds a single page may take to OCR before it is skipped and the book moves on. Raise it on slow hardware, where a dense scan can legitimately need several minutes per page. `0` means no limit. See [Speeding up OCR](performance.md#speeding-up-ocr). |
| `OPDS_ENABLED` | `false` | Optional, Set to `true` to enable the OPDS catalog. See [OPDS](opds.md). |
| `BACKUP_DIR` | `DATA_PATH/backups` | Optional. Where backup archives are written. Point this at another mounted volume to keep backups off the main disk. When set, the field is read-only in Settings → Maintenance. See [Backups](backups.md). |
| `BACKUP_SCHEDULE` | `off` | Optional. `off`, `hourly`, `daily`, or `weekly`. When set, pins the backup schedule and the control is shown read-only in the UI. See [Backups](backups.md). |
| `BACKUP_RETENTION_COUNT` | `0` | Optional. Keep at most this many backups, deleting oldest-first. `0` means unlimited. When set, the field is read-only in the UI. See [Backups](backups.md). |
| `BACKUP_RETENTION_GB` | `0` | Optional. Keep at most this many gigabytes of backups in total, deleting oldest-first. `0` means unlimited. When set, the field is read-only in the UI. See [Backups](backups.md). |
| `LOG_LEVEL` | `info` | Optional Console/Docker log verbosity: `debug`, `info`, `warning`, `error`, or `critical`. The in-app Logs tab (Settings → Logs) always captures `debug`-level entries regardless of this setting. |
| `TZ` | `UTC` | Optional. Timezone for all log timestamps - both console/Docker output and the in-app Logs tab. Use an IANA zone name such as `America/Toronto` or `Europe/Berlin`. Defaults to UTC when unset; an unknown zone name logs a warning and uses UTC. |
| `UMASK` | inherited | Optional. Octal umask applied to everything Grimoire writes - uploaded files, exported sidecars, thumbnails, and the database (e.g. `022` for `rw-r--r--`, `002` for group-writable, `000` for `rw-rw-rw-`, which is what Unraid users usually want). Useful where you cannot set the process umask yourself, such as Kubernetes. `GRIMOIRE_UMASK` is accepted as an alias. Left unset, Grimoire keeps whatever umask it inherited; an unparseable value is ignored with a warning rather than guessed at. |
| `ALLOW_PASSWORD_AUTHENTICATION` | - | Optional, `true` or `false`. When set, pins password authentication on or off and overrides the toggle in Settings → Authentication (the toggle is shown read-only). When unset, the in-app setting is used. First-run admin setup always requires a username and password regardless of this value. |
| `GUEST_ACCESS_ENABLED` | - | Optional, `true` or `false`. When set, pins guest invite codes on or off and overrides the toggle in Settings → Authentication (the toggle is shown read-only). When unset, the in-app setting is used. See [Guest invites](campaigns.md#guest-invites). |
| `DISABLE_FOLDER_CATEGORY_INFERENCE` | - | Optional, `true` or `false`. When set, pins folder-name category inference on or off and overrides the toggle in Settings → Application (shown read-only). When `true`, books are not auto-assigned a category from their folder names and fall back to `uncategorized`. A per-system `.no-auto-category` marker file disables inference for just that system. |
| `DISABLE_EXTERNAL_ADD_ON_INSTALL` | `false` | Optional, `true` or `false`. When `true`, Grimoire never fetches anything from a community repository: wiki note templates, metadata add-ons, and themes alike. The **Browse** tabs disappear and the catalogue endpoints refuse. Writing templates in the app, uploading a `.md`, and pasting a theme still work, so a locked-down or air-gapped server keeps every feature - it just stops fetching. **Replaces `WIKI_TEMPLATES_DOWNLOAD_DISABLED`**, which is no longer read. See [Themes](themes.md) and [Wiki note templates](wiki-templates.md). |
| `OIDC_*` env vars | - | Optional. Each OIDC setting (`OIDC_ENABLED`, `OIDC_ISSUER_URL`, `OIDC_TOKEN_ISSUER`, `OIDC_AUTHORIZATION_ENDPOINT`, `OIDC_TOKEN_ENDPOINT`, `OIDC_USERINFO_ENDPOINT`, `OIDC_JWKS_URI`, `OIDC_END_SESSION_ENDPOINT`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SIGNING_ALG`, `OIDC_BUTTON_TEXT`, `OIDC_GROUPS_CLAIM`, `OIDC_PERMISSIONS_CLAIM`, `OIDC_MATCH_BY`, `OIDC_AUTO_LAUNCH`, `OIDC_AUTO_REGISTER`) can be pinned via env. When set, the field is read-only in Settings → Authentication. When unset, the in-app value is used. See [OpenID Connect](oidc.md). |
| `AUTH_RATE_LIMIT` | `10/minute` | Per-IP throttle applied to the credential-checking endpoints (`/api/auth/login`, `/api/auth/setup`, `/api/auth/guest-login`, and the API-key-guarded `/api/stats`). Exceeding it returns `429`. Uses a [`limits`](https://limits.readthedocs.io/en/stable/quickstart.html#rate-limit-string-notation) string like `20/minute` or `100/hour`. See [Security hardening](security.md). |
| `RATE_LIMIT_ENABLED` | `true` | Optional. Set to `false` to disable auth rate limiting entirely. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | Optional. How long an access token stays valid. This is also the longest a revoked session can keep working, so lowering it tightens revocation at the cost of more background refreshes. See [Sessions and token revocation](security.md#sessions-and-token-revocation). |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` | Optional. How long a session survives without use before you must log in again. The clock resets on every refresh, so an actively-used session stays alive indefinitely. |
| `TRUST_FORWARDED_FOR` | `true` | Optional. When `true`, the rate limiter keys on the left-most `X-Forwarded-For` address so each client gets its own bucket behind a reverse proxy. Set to `false` only if Grimoire is exposed directly (no trusted proxy), so a spoofed header can't sidestep the limit. |

## Volumes

```yaml
volumes:
  # Your library - writable, so you can manage files from inside Grimoire.
  # Append ":ro" if you would rather Grimoire could not modify it (see below).
 - /path/to/your/library:/app/library

  # Persistent data (database, thumbnails, page cache)
 - grimoire_data:/app/data
```

### Read-only or writable?

Grimoire only writes to your library when you ask it to. Browsing, searching,
reading, and metadata editing never touch the files, and no background job
rewrites your library. Two features do write, and both are opt-in and admin-only:

| Feature | Needs | What it writes |
|---|---|---|
| [File management](file-management.md) - upload, move, rename, delete, new folders | Writable mount | The files and folders you act on |
| [Sidecar export](sidecars.md) - `.opf` / `.nfo` / `.json` | Writable mount | Sidecar files next to your content |
| Everything else - browse, search, read, tags, favorites, campaigns, metadata edits | Either | Nothing in the library folder |

**Writable (the default)** is the recommended setup for most people: leave the
`:ro` suffix off and uploading a new PDF is a drag-and-drop into the browser
rather than a trip to the shell. Writes stay confined to the library root, and
the destructive ones are guarded - deleting a folder that still holds files makes
you type its name first.

**Read-only** is opt-in hardening: append `:ro` and the container cannot modify
the library at all. Everything except the two features above behaves identically,
and nothing half-fails - the file manager browses normally and tells you the
library is read-only, file actions on a book's ⋮ menu are not shown, changing a
book's category saves the category without moving the file, and sidecar export
reports the read-only mount and skips the write while your metadata edits are
still saved.

The mount is not a one-way decision and nothing in Grimoire's database depends on
it. Edit the volume line, `docker compose up -d`, and the write features appear
or disappear accordingly.

---

## See also

- [Performance](performance.md) - what `OCR_*`, `PAGE_CACHE_*`, and `WORKERS` actually change
- [Security hardening](security.md) - the rate-limit, session, and proxy variables in context
- [Backups](backups.md) - the `BACKUP_*` variables
- [OpenID Connect](oidc.md) - the `OIDC_*` variables
- [Docker installation guide](docker-install.md) - where to put them if you are new to Docker
