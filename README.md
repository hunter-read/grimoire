<div align="center">
  <img src="frontend/static/android-chrome-192x192.png" alt="Grimoire" width="144">

  # Grimoire — Self-Hosted TTRPG Library Manager

  [![CI](https://github.com/hunter-read/grimoire/actions/workflows/ci.yml/badge.svg)](https://github.com/hunter-read/grimoire/actions/workflows/ci.yml)
  [![Python](https://img.shields.io/badge/python-3.12-blue?logo=python&logoColor=white)](https://www.python.org/)
  [![React](https://img.shields.io/badge/react-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
  [![License](https://img.shields.io/github/license/hunter-read/grimoire)](LICENSE)
  [![Docker](https://img.shields.io/docker/pulls/hunterreadca/grimoire?logo=docker&logoColor=white)](https://hub.docker.com/r/hunterreadca/grimoire)
</div>


A Docker-based web application for managing your tabletop RPG PDF collection. Browse, search, and read your entire library from any device with a clean, responsive UI.

## Features

- **Library Browser** — Organizes your collection by game system with automatic folder detection
- **Full-Text Search** — Every page of every PDF is indexed with SQLite FTS5 for instant search; also finds maps and tokens by filename, folder, or tag
- **Page-by-Page Viewer** — PDFs rendered as images for fast mobile viewing with pinch-to-zoom, swipe navigation, and spread mode
- **Map Gallery** — Browse battlemaps by directory structure with tag filtering, grid metadata, and full-res download
- **Token Browser** — Browse and tag character tokens and portrait assets
- **Bookmarks** — Per-user page and text-selection bookmarks with inline highlights
- **Favorites** — Save systems, books, maps, and tokens for quick access
- **Metadata Editor** — Add descriptions, tags, genre, publisher links, and character builder URLs
- **Campaigns** — Track GM-run and personal campaigns; session notes, player notes, linked resources, and scheduling
- **OPDS Catalog** — Each user can generate a personal OPDS feed URL to connect e-reader apps directly to their library
- **Docker Ready** — One command to run, mount your library directory, done
- **Responsive** — Works on desktop, tablet, and phone with mobile navigation

---

## Screenshots

| Library | Reader |
|---------|--------|
| ![Library](docs/images/library.png) | ![Reader](docs/images/reader.png) |

| Search | Favorites |
|--------|-----------|
| ![Search](docs/images/search.png) | ![Favorites](docs/images/favorites.png) |

| Maps | Tokens |
|------|--------|
| ![Maps](docs/images/maps.png) | ![Tokens](docs/images/tokens.png) |

| Campaigns | Scheduling |
|-----------|------------|
| ![Campaigns](docs/images/campaigns.png) | ![Scheduling](docs/images/scheduling.png) |

---

## Quick Start

> New to Docker? See the [Docker Installation Guide](docs/docker-install.md) for a step-by-step walkthrough for Windows, macOS, and Linux.

### 1. Organize your library

Create a `library/` folder with this structure:

```
library/
├── books/
│   └── Dungeons and Dragons 5e/
│       ├── core/
│       │   ├── Players Handbook.pdf
│       │   ├── Dungeon Masters Guide.pdf
│       │   └── monsters/              ← subfolder within a category
│       │       ├── Monster Manual.pdf
│       │       └── Mordenkainen's Monsters.pdf
│       ├── supplements/
│       ├── adventures/
│       │   ├── Curse of Strahd/       ← adventure path subfolder
│       │   │   ├── Curse of Strahd.pdf
│       │   │   └── Strahd DM Screen.pdf
│       │   └── Lost Mine of Phandelver/
│       │       └── Lost Mine of Phandelver.pdf
│       ├── character-sheets/
│       ├── handouts/
│       └── homebrew/
├── maps/
│   └── Sunken Temple (22x22)/
│       ├── Sunken Temple Basement.png
│       └── The Sunken Temple.png
└── tokens/
    └── Monsters/
        └── goblin.png
```

See [Library Structure](#library-structure) for the full layout and category rules.

### 2. Run with Docker Compose

Edit `docker-compose.yml` and set your `SECRET_KEY`, then start:

```bash
# Edit docker-compose.yml and set SECRET_KEY
docker compose up -d
open http://localhost:9481
```

On first launch you'll be prompted to create an admin account, or you can pre-seed users automatically (see [Pre-seeding users](#pre-seeding-users)).

### 3. Pull from DockerHub

```bash
docker pull hunterreadca/grimoire:latest
```

Or pin to a specific release:

```bash
docker pull hunterreadca/grimoire:1.0.0
```

### 4. Minimal `docker-compose.yml`

```yaml
services:
  grimoire:
    image: hunterreadca/grimoire:latest
    ports:
      - "9481:9481"
    environment:
      SECRET_KEY: "generate-with-openssl-rand-hex-32"
    volumes:
      - /path/to/your/library:/app/library:ro
      - /path/to/grimoire/data:/app/data
```

### 5. With Valkey page cache (recommended for large libraries)

```yaml
services:
  grimoire:
    image: hunterreadca/grimoire:latest
    ports:
      - "9481:9481"
    environment:
      SECRET_KEY: "generate-with-openssl-rand-hex-32"
      VALKEY_URL: "redis://valkey:6379/0"
    volumes:
      - /path/to/your/library:/app/library:ro
      - /path/to/grimoire/data:/app/data
    depends_on:
      - valkey

  valkey:
    image: valkey/valkey:8-alpine
    volumes:
      - valkey_data:/data

volumes:
  valkey_data:
```

### 6. Build from source

```bash
docker build --build-arg APP_VERSION=1.0.0 -t grimoire:1.0.0 .
```

---

## Running without Docker

If you prefer to run Grimoire directly on the host, you need Python 3.12+ and Node 20+.

### 1. Build the frontend

```bash
cd frontend
npm install
npm run build
cd ..
```

This produces a `frontend/dist/` directory that the backend serves as static files.

### 2. Install backend dependencies

```bash
pip install -r backend/requirements.txt
```

### 3. Set environment variables

```bash
export SECRET_KEY=$(openssl rand -hex 32)
export LIBRARY_PATH=/path/to/your/library
export DATA_PATH=/path/to/your/data
```

See [Configuration](#configuration) for the full list of environment variables.

### 4. Start the server

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 9481
```

Open `http://localhost:9481`. On first launch you'll be prompted to create an admin account.

### Persistent data

The database, search index, and rendered thumbnails are all stored under `DATA_PATH`. Back this directory up to preserve your library metadata and user accounts.

### Optional: Valkey/Redis page cache

Set `VALKEY_URL` to a Redis-compatible URL to enable in-memory page caching:

```bash
export VALKEY_URL=redis://localhost:6379/0
```

Without it, rendered pages are cached to disk under `DATA_PATH`.

---

## Library Structure

### Books — one folder per game system

Each top-level folder under `books/` becomes a **game system**. Subfolders are auto-detected as categories based on their name.

Folder name matching is **case-insensitive**, and hyphens, underscores, and spaces are interchangeable — `Character-Sheets`, `character_sheets`, and `Character Sheets` all map to the same category.

| Category | Recognized folder names | What goes here |
|---|---|---|
| Core Rulebooks | `core`, `rulebooks`, `rules` | Player handbooks, GM guides, base rules |
| Starter Set | `starter-set`, `starter kit`, `beginner box`, `boxed set`, `essentials` | Starter/beginner boxes, introductory sets |
| Supplements | `supplements`, `sourcebooks`, `expansions` | Sourcebooks, expansions, setting guides |
| Adventures | `adventures`, `modules`, `campaigns` | Published modules, campaigns, one-shots |
| Character Sheets | `character-sheets`, `character sheets`, `charsheets` | Fillable sheets, alternative layouts |
| Handouts | `handouts`, `reference`, `screen` | Reference cards, DM screens, quick-ref sheets |
| Homebrew | `homebrew`, `custom`, `house-rules` | Community/custom content, house rules |

> Files placed directly in a system folder (not in a subfolder) default to the **core** category.
>
> Any subfolder name that doesn't match the recognized keywords becomes its own category, slugified from the folder name. For example, a folder named `Bestiary` becomes the `bestiary` category.
>
> After adding new files, use **Rescan** in the sidebar (or Settings → Maintenance) to pick up the changes.

#### Subfolders within a category

Any category folder can contain named subfolders to group related books together. Grimoire detects these automatically and displays them as collapsible folder groups within the category section — no configuration needed.

```
books/
└── Pathfinder 2e/
    ├── core/
    │   ├── Core Rulebook.pdf          ← ungrouped, shown at top of Core Rulebooks
    │   └── monsters/                  ← subfolder group "Monsters"
    │       ├── Bestiary.pdf
    │       ├── Bestiary 2.pdf
    │       └── Bestiary 3.pdf
    └── adventures/
        ├── Standalone Adventure.pdf   ← ungrouped
        ├── Abomination Vaults/        ← subfolder group "Abomination Vaults"
        │   ├── Ruins of Gauntlight.pdf
        │   ├── Hands of the Devil.pdf
        │   └── Eyes of Empty Death.pdf
        └── Outlaws of Alkenstar/
            └── ...
```

Books without a subfolder are shown ungrouped at the top of their category section, above any subfolder groups. Subfolder groups are collapsible and include a download button for the whole group.

#### System-agnostic collections

Some books don't belong to a single game system — reference material, zines, art books, or rulesets like Ironsworn or Mothership that span multiple systems. Create a folder whose name is one of the recognized system-agnostic names and Grimoire will display its contents in a separate **System-Agnostic** section on the library page, outside the normal game-system grid.

**Recognized folder names** (case-insensitive):

| Folder name | Example |
|---|---|
| `System Agnostic` | `books/System Agnostic/` |
| `Generic` | `books/Generic/` |
| `Any` | `books/Any/` |

Subfolders directly under the agnostic root become **custom category headings** — whatever you name them is what appears in the UI. There is no keyword matching; the folder name is used as-is (slugified).

```
books/
└── System Agnostic/
    ├── Ironsworn/
    │   ├── Ironsworn.pdf
    │   └── Ironsworn Delve.pdf
    ├── OSR Zines/
    │   └── Knock Issue 1.pdf
    └── Art Books/
        └── MCDM Strongholds and Followers.pdf
```

Books placed directly in the root (without a subfolder) appear under an **Uncategorized** heading.

#### Marking a system as explicit

Append `(nsfw)` to the folder name to mark all content in that system as explicit:

```
books/
└── Some Adult Game (nsfw)/
    └── core/
        └── rulebook.pdf
```

Users with explicit content disabled will not see this system or its books.

### Maps — organize by creator or collection

```
maps/
└── Creator Name/
    └── map-file.png
```

The folder name is shown as a group header in the map gallery.

### Tokens — organize by type

```
tokens/
└── Category/
    └── token-file.png
```

---

## Tagging with tags.json

Drop a `tags.json` file into any `maps/` or `tokens/` folder (or subfolder) to automatically apply tags when the library is scanned. You can also place one inside a game system folder under `books/` to tag the system itself.

`tags.json` is a plain JSON object. Keys are paths resolved relative to the folder the file lives in:

| Key | What gets tagged |
|---|---|
| `"."` | The containing folder (shown as folder tags in the gallery) |
| `"file.png"` | A file in the same folder |
| `"subfolder"` | A subfolder |
| `"subfolder/file.png"` | A file inside a subfolder |

Values are arrays of tag strings.

```json
{
  ".": ["dungeon", "fantasy"],
  "cave-entrance.png": ["cave", "outdoors"],
  "boss-arena": ["combat", "finale"],
  "boss-arena/throne-room.png": ["throne", "indoor"]
}
```

Tags are applied (or updated) every time the library is rescanned. Tags set via the web UI are replaced by the values in `tags.json` on the next scan.

---

## Configuration

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | — | **Required.** JWT signing secret. Generate: `openssl rand -hex 32` |
| `WORKERS` | `2` | Number of uvicorn worker processes |

| `LIBRARY_PATH` | `/app/library` | Optional path to your library directory inside the container if not mounted at /app/library |
| `DATA_PATH` | `/app/data` | Optional path for the database, thumbnails, and search cache inside the container if not mounted at /app/data |
| `BASE_URL` | `http://localhost:9481` | Public base URL of this instance. Set this to the URL you use to access Grimoire (e.g. `https://grimoire.example.com`) when running behind a reverse proxy — used to build absolute links in OPDS feeds and other places that need a fully-qualified URL. |
| `VALKEY_URL` | — | Optional Redis-compatible cache URL for rendered page images (e.g. `redis://valkey:6379/0`) |
| `OPDS_ENABLED` | `false` | Optional, Set to `true` to enable the OPDS catalog. See [OPDS](#opds) below. |
| `LOG_LEVEL` | `info` | Optional Console/Docker log verbosity: `debug`, `info`, `warning`, `error`, or `critical`. The in-app Logs tab (Settings → Logs) always captures `debug`-level entries regardless of this setting. |

### Volumes

```yaml
volumes:
  # Your library — read-only is fine, Grimoire never modifies your files
  - /path/to/your/library:/app/library:ro

  # Persistent data (database, thumbnails, page cache)
  - grimoire_data:/app/data
```

---

## Performance

### Indexing

On first startup Grimoire scans the library and indexes every PDF page for full-text search. This can take several minutes for large collections. The index is stored in the data volume and subsequent startups are fast.

Use the **Rescan** button in the sidebar to pick up newly added files, or configure a scheduled rescan in **Settings → Maintenance**.

### Page rendering

PDFs are rendered page-by-page server-side as WebP images rather than streamed as raw files. This keeps the viewer fast on mobile and avoids loading large files into the browser. Switch to the native PDF viewer anytime via the toolbar.

### Caching

Rendered pages are cached to disk by default. Provide a `VALKEY_URL` to use an in-memory Redis-compatible cache instead for faster repeat loads.

---

## Pre-seeding users

Drop a `users.json` file into your data directory before first start and Grimoire will create those accounts automatically. The file is renamed to `users.json.imported` afterwards and never processed again.

### Format

```json
[
  {
    "username": "admin",
    "password": "changeme",
    "role": "admin"
  },
  {
    "username": "gm",
    "password": "$bcrypt-sha256$v=2,t=2b,r=12$...",
    "role": "gm"
  },
  {
    "username": "alice",
    "password": "alicepassword",
    "role": "player",
    "denyExplicit": true
  }
]
```

| Field | Required | Description |
|---|---|---|
| `username` | Yes | Login username |
| `password` | Yes | Plaintext password **or** a pre-hashed `$bcrypt-sha256$` string |
| `role` | No | `admin`, `gm`, or `player` — defaults to `player` if missing |
| `denyExplicit` | No | `true` to restrict explicit content for this user — defaults to `false` |

**Rules:**
- At least one entry must have `"role": "admin"` — the file is rejected otherwise.
- Entries whose username already exists in the database are silently skipped.
- On parse or validation errors the file is left untouched so you can fix and restart.

### Generating a pre-hashed password

Pre-hashing lets you avoid storing plaintext passwords in the JSON file. Grimoire uses passlib's `bcrypt_sha256` scheme:

```bash
python3 -c "from passlib.hash import bcrypt_sha256; print(bcrypt_sha256.hash('yourpassword'))"
```

Copy the output (starts with `$bcrypt-sha256$`) into the `password` field.

### Docker example

```bash
# Place users.json in your data volume before starting
cp users.json.example /path/to/data/users.json
# Edit the file, then:
docker compose up -d
```

---

## User roles

| Role | What they can do |
|---|---|
| `admin` | Everything — user management, app settings, metadata editing, rescan |
| `gm` | Read everything, edit metadata, create GM campaigns |
| `player` | Read-only access, personal campaigns, session notes |

Create additional accounts in **Settings → Users** after logging in as admin.

---

## Campaigns

Grimoire has a built-in campaign tracker with two modes:

- **GM Campaigns** — Created by GMs or admins. Supports player invitations, shared/private resource linking, GM session notes (internal and shared), per-player session notes, and scheduling.
- **Personal Campaigns** — Private to a single user. Notes expand inline per session. No sharing.

Campaign members can set a **character name** per campaign (editable by both the GM and the player). Users can also set a **display name** in Account Settings that appears in place of their username across the app.

### Session scheduling

GM campaigns support recurring session schedules:

- **Weekly** — same day(s) every week
- **Biweekly** — every other week (anchored to a reference date)
- **Monthly** — nth weekday of the month (e.g. "first Friday")
- **Custom** — explicit list of dates

Session note stubs are auto-created the day before each scheduled session. Players can mark their availability for upcoming dates, and the GM can cancel individual dates.

---

## OPDS

Grimoire supports the [OPDS 1.2](https://specs.opds.io/opds-1.2) catalog format, allowing e-reader apps (Panels, Chunky, Kybook, KOReader, etc.) to browse and download books directly from your library.

### Enabling OPDS

Set `OPDS_ENABLED=true` and `BASE_URL` to your instance's public URL in your compose file:

```yaml
environment:
  OPDS_ENABLED: "true"
  BASE_URL: "https://grimoire.example.com"
```

### Personal feed URLs

OPDS access is per-user. Each user generates their own opaque feed URL in **Settings → Account → OPDS Feed**. The URL contains a long random token — no username or password is needed by the OPDS client.

- **Enable** — generates a unique feed URL
- **Copy** — copies the URL to the clipboard
- **Regenerate** — issues a new token; the old URL stops working immediately
- **Disable** — revokes the token; the feed URL stops working immediately

### Feed URL structure

```
https://grimoire.example.com/opds/{token}          ← navigation root
https://grimoire.example.com/opds/{token}/all       ← all books
https://grimoire.example.com/opds/{token}/entry/{id}  ← single book
https://grimoire.example.com/opds/{token}/download/{id}  ← file download
```

### Content filtering

The OPDS feed respects each user's explicit-content preference. Users with explicit content disabled will not see explicit books in their feed and cannot download them via OPDS.

---

## API

The live API is self-documented via OpenAPI. With the server running:

| URL | Description |
|-----|-------------|
| `http://localhost:9481/api/docs` | Swagger UI — interactive docs |
| `http://localhost:9481/api/redoc` | ReDoc — readable reference |
| `http://localhost:9481/api/openapi.json` | Raw OpenAPI schema |

---

## Contributing

Grimoire is open source and contributions are welcome — bug reports, feature ideas, docs, and code.

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for full details on reporting issues, submitting pull requests, and setting up a local development environment.

To report a security vulnerability privately, see [SECURITY.md](.github/SECURITY.md).

---

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE) for details.
