# Architecture

A developer-facing map of how Grimoire fits together: what lives where, how a request
flows end-to-end, how authentication and OIDC work, and how schema changes are applied at
startup. It complements the high-level overview in [`CLAUDE.md`](../CLAUDE.md) and the
schema reference in [`docs/data-model.md`](data-model.md).

All `file_path` references point at the current code — if you change a module's shape,
update the matching section here.

## Stack

- **Frontend** — React 18 + Vite 6 SPA, React Router v6, React Context (no Redux/Zustand),
  i18next (EN/DE/FR), Vitest + React Testing Library.
- **Backend** — FastAPI (async) + SQLAlchemy 2.0, SQLite with FTS5 full-text search,
  PyMuPDF (`fitz`) for PDF→WebP rendering, PyJWT auth.
- **Optional** — Valkey/Redis for in-memory page-image caching (falls back to disk).

The FastAPI backend serves both the REST API under `/api/*` and the static React build
(`frontend/dist/`) via a catch-all route. In development, Vite proxies `/api` to the
backend on port 9481.

## Module map

### Backend

| Path | Responsibility |
| --- | --- |
| [`backend/main.py`](../backend/main.py) | FastAPI app construction, router registration, the `lifespan` startup hook (library scan, user seeding, wiki migrations, scheduler), and the SPA catch-all `serve_frontend`. |
| [`backend/config.py`](../backend/config.py) | Environment loading, `DATA_PATH`/`LIBRARY_PATH` and cache dirs, logging setup (incl. the in-memory ring buffer for `/api/logs`), the SQLAlchemy `engine` + `SessionLocal`, the `get_db` dependency, and the optional `_valkey` client. |
| [`backend/models/`](../backend/models/) | ORM models split by domain (`library.py`, `media.py`, `users.py`, `campaigns.py`, `settings.py`); `db.py` holds `init_db`, runtime migrations, and FTS5 setup. See [`docs/data-model.md`](data-model.md). |
| [`backend/auth.py`](../backend/auth.py) | JWT creation/validation, password hashing (`bcrypt_sha256`), the `get_current_user` dependency, and the role-guard dependencies (`require_admin`, `require_gm_or_admin`, `require_not_guest`). |
| [`backend/indexer.py`](../backend/indexer.py) | Library scanning, PDF FTS5 indexing, thumbnail generation, and OPF/metadata parsing. |
| [`backend/routers/`](../backend/routers/) | One package per feature area (see the router shape below). |
| [`backend/scheduler.py`](../backend/scheduler.py), [`backend/session_creator.py`](../backend/session_creator.py) | Campaign session scheduling — apply recurrence on startup and auto-create upcoming sessions. |
| [`backend/seed_users.py`](../backend/seed_users.py) | First-run / env-driven user pre-seeding. |

#### Router package shape

Every package under `backend/routers/` follows the same layout (larger packages add focused
modules like [`books/pages.py`](../backend/routers/books/pages.py) or
`campaigns/sessions.py`):

- `__init__.py` — builds the `APIRouter` and registers routes via `add_api_route(...)`.
  Auth-adjacent packages expose **two** routers: a `public_router` (mounted directly on the
  app, no auth) and a `router` (mounted under the authenticated `/api` parent). See
  [`routers/auth/__init__.py`](../backend/routers/auth/__init__.py).
- `core.py` — the endpoint handler functions (plain functions, no decorators).
- `_schemas.py` — Pydantic request/response models (when needed).
- `_helpers.py` — shared internal helpers (when needed).

### Frontend

| Path | Responsibility |
| --- | --- |
| [`frontend/src/App.jsx`](../frontend/src/App.jsx) | Router setup, protected routes, and the context-provider tree. |
| [`frontend/src/api.js`](../frontend/src/api.js) | Centralized `fetch` wrapper — attaches the JWT, handles errors, exposes the `mediaUrl(...)` helper for `?token=` image/download URLs, and the per-feature API namespaces (`campaigns`, `auth`, `settings`, …). |
| [`frontend/src/context/`](../frontend/src/context/) | `AuthContext` (token + current user), `UISettingsContext`, `FavoritesContext`. |
| [`frontend/src/views/`](../frontend/src/views/) | Page-level components — one per route. |
| [`frontend/src/components/`](../frontend/src/components/) | Shared UI components (one component per file — enforced by ESLint). |
| [`frontend/src/hooks/`](../frontend/src/hooks/), [`frontend/src/utils.js`](../frontend/src/utils.js) | Reusable hooks and helpers. |

## Request lifecycle

A typical authenticated API call:

```mermaid
sequenceDiagram
    participant UI as React view
    participant API as api.js
    participant FA as FastAPI (/api)
    participant Dep as get_current_user
    participant H as handler (core.py)
    participant DB as SQLAlchemy / SQLite

    UI->>API: campaigns.get(id)
    API->>FA: fetch('/api/campaigns/:id')<br/>Authorization: Bearer <JWT>
    FA->>Dep: resolve dependency
    Dep-->>FA: CurrentUser (or 401)
    FA->>H: call handler(user, ...)
    H->>DB: SessionLocal() query
    DB-->>H: rows
    H-->>FA: dict / Pydantic model
    FA-->>API: JSON response
    API-->>UI: parsed body (or dispatch grimoire:unauthorized on 401)
```

Key points:

- **Frontend** — [`api.js`](../frontend/src/api.js) reads the JWT from `localStorage`
  (`grimoire_token`) and sends it as an `Authorization: Bearer` header. On any `401` it
  dispatches a `grimoire:unauthorized` window event; `AuthContext` listens and clears the
  stored token, bouncing the user to login.
- **Auth boundary** — the authenticated API is a single parent router built with
  `APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])` in
  [`main.py`](../backend/main.py#L203). Every sub-router mounted under it inherits the JWT
  requirement. Truly public endpoints (`/api/auth/status|setup|login`, OIDC, health, some
  library routes) are registered as separate `public_router`s mounted directly on the app.
- **Handler → DB** — handlers open a session via `SessionLocal()` (or the `get_db`
  dependency) and return dicts/Pydantic models that FastAPI serializes to JSON.
- **Static assets** — the Vite build's hashed assets are mounted at `/assets` via
  `StaticFiles`. Any other non-`/api` path falls through to `serve_frontend`, which returns
  the requested file if it exists (with a path-traversal guard) or `index.html` with
  `Cache-Control: no-store` so the SPA can client-route.

### Page images and caching

Book pages are rendered on demand by
[`routers/books/pages.py`](../backend/routers/books/pages.py) (`serve_book_page`):

1. If a rendered WebP is already in **Valkey** (when configured), stream it back.
2. Else if it's on the **disk cache** (`DATA_PATH/page_cache/<hash>_<page>_<width>.webp`),
   serve it (and backfill Valkey).
3. Else **render** the page with PyMuPDF, write it to both caches, and stream it.

All three paths send `Cache-Control: max-age=31536000, immutable`
(`_PAGE_CACHE_HEADERS` in [`config.py`](../backend/config.py)), so browsers and CDNs cache
aggressively. Because image/download URLs are used in `<img>`/download contexts that can't
set an `Authorization` header, they authenticate via a `?token=` query param
(`mediaUrl(...)` on the frontend, the `token` `Query` param in
[`auth.py`](../backend/auth.py#L72) on the backend). Thumbnails work the same way, cached
under `DATA_PATH/thumbnails/`.

## Authentication & OIDC

### JWT and roles

- Tokens are HS256 JWTs signed with `SECRET_KEY`, carrying `sub` (user id), `username`,
  `role`, and a 30-day `exp` — see `create_token` / `decode_token` in
  [`auth.py`](../backend/auth.py).
- **Roles**: `admin` (full access incl. user management), `gm` (edit metadata, rescan,
  manage content), `player` (read-only), plus `guest` — a campaign-scoped, code-only
  account with no library access.
- `get_current_user` accepts the token from either the `Authorization: Bearer` header **or**
  a `?token=` query param, so browser-embedded images and downloads authenticate without a
  header. Role guards (`require_admin`, `require_gm_or_admin`, `require_not_guest`) layer on
  top per-route.

### Password / guest login

`POST /api/auth/login` verifies a username/password (bcrypt) and returns a JWT.
`POST /api/auth/guest-login` exchanges a 10-char campaign invite code for a guest-scoped
JWT (only when guest access is enabled). First-run `POST /api/auth/setup` creates the
initial admin. All three are public routes — see
[`routers/auth/__init__.py`](../backend/routers/auth/__init__.py).

### OIDC (authorization code + PKCE)

Implemented in [`routers/oidc/`](../backend/routers/oidc/) against any standards-compliant
IdP (Keycloak, Authentik, Authelia, Auth0, Okta, …). The IdP is configured at runtime via
**Settings → Authentication**; each field can be pinned/locked by an environment variable
(`OIDC_*`, see the `OIDC_ENV` map in [`config.py`](../backend/config.py#L53)).

```mermaid
sequenceDiagram
    participant B as Browser
    participant G as Grimoire (/api/oidc)
    participant S as State store
    participant IdP as OIDC Provider

    B->>G: GET /api/oidc/login
    G->>S: put(state → {nonce, code_verifier, return_to})
    G-->>B: 302 to IdP authorize (code_challenge S256)
    B->>IdP: authenticate & consent
    IdP-->>B: 302 to /api/oidc/callback?code&state
    B->>G: GET /api/oidc/callback
    G->>S: pop(state) → verifier + nonce
    G->>IdP: token exchange (code + code_verifier)
    IdP-->>G: id_token + access_token
    G->>IdP: fetch JWKS, validate id_token (iss/aud/nonce)
    G->>IdP: GET /userinfo (merge groups/roles)
    G->>G: resolve/register user, create Grimoire JWT
    G-->>B: 302 return_to#oidc_token=<JWT>
```

Notes:

- **PKCE + nonce** — `oidc_login` generates a `state`, `nonce`, and PKCE verifier/challenge,
  stashes the per-flow secrets in the state store keyed by `state`, and redirects to the
  IdP's authorization endpoint (endpoints are read from config or auto-discovered from the
  issuer's `.well-known/openid-configuration`).
- **State store** — `_StateStore` in
  [`routers/oidc/_helpers.py`](../backend/routers/oidc/_helpers.py) is an in-process dict
  with a 10-minute TTL. This is sufficient for a single replica; a multi-replica deployment
  would need a shared store (tracked for the Valkey-backed state/JWKS work).
- **Callback** — `oidc_callback` validates `state`, exchanges the code for tokens, validates
  the `id_token` against the IdP's JWKS (checking issuer/audience/nonce), optionally merges
  `/userinfo` claims (some IdPs only expose groups there), resolves or auto-registers the
  user, then mints a Grimoire JWT.
- **Token handoff** — the JWT is returned in the redirect **URL fragment**
  (`#oidc_token=...`) rather than a query param, so it isn't logged by intermediate proxies.
  The frontend reads it from the fragment and stores it like any other token.

## Startup and migrations

The `lifespan` async context manager in [`main.py`](../backend/main.py#L87) runs once per
process on startup:

1. **Single-worker guard** — acquire a non-blocking `flock` on `DATA_PATH/.scan.lock`. Only
   the winning worker runs the startup library scan; others skip it. The scan runs on a
   background daemon thread so it doesn't block the app coming up.
2. **User seeding** — `seed_users(...)` applies env-driven / first-run accounts.
3. **Wiki migrations** — `wiki_migration` and `wiki_category_migration` roll legacy session
   notes and flat note-categories into the current nested-page model.
4. **Scheduler** — apply campaign session recurrence and start the session creator (skipped
   under pytest).

### Schema migrations

Schema changes are managed by **Alembic** (revisions in
[`backend/migrations/`](../backend/migrations/), config in
[`alembic.ini`](../alembic.ini)). `init_db` in
[`backend/models/db.py`](../backend/models/db.py) applies them at startup:

- **Fresh / already-on-Alembic database** → `alembic upgrade head` runs every revision
  from the baseline (or just the new ones), landing at the head revision recorded in
  `alembic_version`.
- **Existing pre-Alembic database** (real tables, but no `alembic_version`) → the legacy
  imperative `ALTER TABLE`/`CREATE INDEX` replay runs one final time to bring the schema
  exactly to the baseline, then the DB is `stamp`ed at head — the baseline migration is
  **not** re-run (which would try to recreate existing tables). This keeps upgrades from
  any prior version transparent, with no manual action.
- **Concurrency** — `init_db` runs once per worker process; a blocking file lock
  (`<db>.migrate.lock`) serializes the migration so, with multiple uvicorn workers, the
  first migrates and the rest wait and then find the DB already at head.
- After migrations, idempotent data fixups run on every startup (tag normalization,
  resource-visibility backfill from the legacy `shared`/`gm_only` flags) and the FTS5
  `book_search` virtual table is created (it's not an ORM table, so Alembic doesn't manage
  it).

SQLite's limited `ALTER TABLE` support means table rebuilds go through Alembic's **batch
mode** (`render_as_batch=True`, set in [`env.py`](../backend/migrations/env.py)).

**Authoring a migration:** change the models, then autogenerate a revision and review it:

```bash
alembic revision --autogenerate -m "describe the change"   # writes backend/migrations/versions/
alembic upgrade head                                        # apply locally
alembic downgrade -1                                        # verify it reverses
```

`env.py` targets `Base.metadata`, so autogenerate diffs the models against the DB. The
`sqlalchemy.url` isn't in `alembic.ini` — it resolves from the app config (or an
`-x url=sqlite:///...` override). Keep the schema-of-record in
[`docs/data-model.md`](data-model.md) in sync when you add a revision.
