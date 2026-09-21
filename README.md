<div align="center">
  <img src="frontend/static/grimoire-logo.svg" alt="Grimoire" width="144">

# Grimoire - Self-Hosted TTRPG Library Manager

[![Discord](https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/9Sd4CGZC63)
[![CI](https://github.com/hunter-read/grimoire/actions/workflows/ci.yml/badge.svg)](https://github.com/hunter-read/grimoire/actions/workflows/ci.yml)
[![Backend coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/hunter-read/ae49bfa368af7a6492b40a0e4ae2455a/raw/grimoire-backend-coverage.json)](https://github.com/hunter-read/grimoire/actions/workflows/ci.yml)
[![Frontend coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/hunter-read/975eddb70b9da1a0a43f34f7cf193335/raw/grimoire-frontend-coverage.json)](https://github.com/hunter-read/grimoire/actions/workflows/ci.yml)
[![Python](https://img.shields.io/badge/python-3.12-blue?logo=python&logoColor=white)](https://www.python.org/)
[![React](https://img.shields.io/badge/react-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![License](https://img.shields.io/github/license/hunter-read/grimoire)](LICENSE)
[![Docker](https://img.shields.io/docker/pulls/hunterreadca/grimoire?logo=docker&logoColor=white)](https://hub.docker.com/r/hunterreadca/grimoire)

**[Website](https://grimoirecodex.org)** · **[Documentation](https://docs.grimoirecodex.org)** · **[Live Demo](https://demo.grimoirecodex.org)** · **[Join our Discord](https://discord.gg/9Sd4CGZC63)**

</div>

A self-hosted web app for your tabletop RPG library. Point it at a folder of PDFs, maps,
tokens, audio, and 3D models, and Grimoire turns it into a searchable library you can
read from any device - every page of every book indexed, including scanned ones.

It runs as a single Docker container against a directory you already own, and by default
never writes to it.

## Features

### Library

- **Library browser** - Organizes your collection by game system from the folder structure, with card, compact, and list layouts.
- **Full-text search** - Every page of every PDF is indexed with SQLite FTS5. Also finds books by title, author, or publisher, and maps, tokens, audio, and models by filename, folder, or tag. Narrow with `title:`, `author:`, `tag:` and friends - see [Searching your library](docs/search.md).
- **Sort, filter, and saved presets** - Filter on genre, system family, edition, dice/materials, tags, favourites, and explicit content. Tag filters are boolean groups (`Building` AND `store OR shop`), and named presets save to your account with one default per view.
- **Shared tags** - One tag catalog across every resource type, with a Tags page to rename, merge, delete, and browse by tag, and per-tag downloads.
- **Metadata editor** - Rich metadata for systems and books, drawn from curated lists you manage in **Settings → Metadata**. Parent systems group related lines ("Cyberpunk" + "Red" → "Cyberpunk Red").
- **Bulk actions** - Multi-select books, maps, tokens, audio, and models, then bulk tag, add to a campaign, or edit metadata via a carousel.
- **Duplicate detection** - An admin scan finds byte-identical files, near-identical titles, overlapping page text, and gridded/gridless map pairs. Nothing is ever deleted automatically; you review each pair side by side.

### Reading

- **Page-by-page viewer** - PDFs rendered server-side as images for fast mobile viewing, with pinch-to-zoom, swipe navigation, and spread mode.
- **Bookmarks** - Per-user page and text-selection bookmarks with inline highlights.
- **Favorites** - Star systems, books, maps, tokens, audio, and models from a card, a list row, or the item's own page.
- **OPDS catalog** - A personal feed URL per user, to connect e-reader apps directly to your library.

### Maps

- **Map gallery** - Browse battlemaps by folder with tag filtering, grid metadata, and full-res download. Image, PDF, animated (`.webm`/`.mp4`), and Universal VTT maps all display in-app; large maps load through a downscaled preview while downloads stay untouched.
- **UVTT editor** - Export any image map as a Universal VTT file, drawing the walls, doors, and lights a virtual tabletop uses for dynamic lighting. Opens existing `.uvtt` files on the geometry they already carry.

### Tokens

- **Token browser** - Browse and tag character tokens and portrait assets.
- **Token editor** - Turn any picture into a VTT-ready token: position the art, pick a frame and output size, and export it. See [Token editor](docs/token-editor.md).

### Audio

- **Audio library** - Ambient tracks, soundscapes, music, and effects (MP3, OGG, Opus, FLAC, WAV, M4A, AAC), reading embedded duration, tags, and album art.
- **Global player** - A persistent pop-out player that keeps playing as you navigate, with a queue you can reorder and a repeat toggle.
- **Soundboard** - A floating, draggable grid of one-tap pads that play _over_ the player and each other, with per-pad loop toggles and a configurable grid up to 8×15.
- **Saved sets** - Name and keep playlists and boards. They live on your account rather than one browser, so a board built at home is there at the table.

### Campaigns

- **Campaigns** - Track GM-run and personal campaigns with character art and sheets, linked resources, and scheduling.
- **Wiki** - A markdown notes wiki with deep linking, Markdown/JSON/LegendKeeper import and export.
- **Wiki note templates** - Start a page from a community template, write your own, or upload a Markdown file or `.zip`. Templates belong to the campaign, so downloaded ones are yours to edit. See [Wiki note templates](docs/wiki-templates.md).

### Administration

- **Book restrictions** - Restrict a book, system, or category to _GMs and admins_ or _admins only_. Restricted content is hidden outright - from library, search, downloads, favourites, and OPDS - since the title and cover are the spoiler. See [Restricting books](docs/users-and-permissions.md#restricting-books).
- **Community add-ons** - Install community metadata scrapers to fill in system and book details from external sources, reviewing a field-by-field diff before anything is written. See [Community add-ons](docs/addons.md).
- **Character sheets** - A schema-driven character builder: install a sheet for your system, build characters against it, browse a content catalogue, and give each table its own ruleset of allowed content. Sheets are per user, so no admin approval is involved. See [Character sheets](docs/characters.md).
- **Themes and light mode** - Light, dark, or system, plus installable colour themes (including a WCAG AAA **High Contrast** palette). Themes are per user, so no admin approval is involved. See [Themes](docs/themes.md).
- **Docker ready** - One command to run, mount your library directory, done. Works on desktop, tablet, and phone.

---

## Who it's for

Grimoire is for people who have **bought a lot of TTRPG material and want it in one
place**. If your collection is a folder of PDFs from twenty Humble Bundles and three
Kickstarters, spread across a NAS and a laptop, this is the problem it solves.

- **Players and GMs** who want their books searchable from the table - on a phone, a
  tablet, or the laptop already open for notes.
- **GMs running a campaign**, who need the map, the token, the statblock, and last
  session's notes in the same place, and who need some of it hidden from the players.
- **Self-hosters**, who would rather run one Docker container against a folder they own
  than upload their library to somebody else's service.

It is **not** a store, a pirate tool, or a PDF editor. Grimoire reads a library you
already have, and by default never writes to it.

## Requirements

Docker, a folder of TTRPG files, and somewhere to run it - a NAS, a home server, a spare
mini-PC, or your desktop. It is happy on a Raspberry Pi and scales up to libraries of
thousands of books.

## Screenshots

### Library and browsing

| Systems                                         | System detail                                                 |
| ----------------------------------------------- | ------------------------------------------------------------- |
| ![Systems view](docs/images/Systems%20View.png) | ![System detail view](docs/images/System%20Detail%20View.png) |

| Search                                         | Tag browser                                   |
| ---------------------------------------------- | --------------------------------------------- |
| ![Search your library](docs/images/Search.png) | ![Tag browser](docs/images/Tag%20Browser.png) |

| Favourites                                           |     |
| ---------------------------------------------------- | --- |
| ![Favourites page](docs/images/Favorites%20Page.png) |     |

### Reading

| Book view with table of contents                                | In-book search                                            |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| ![Book view with ToC](docs/images/Book%20View%20with%20ToC.png) | ![Book view search](docs/images/Book%20View%20Search.png) |

### Maps, tokens, and models

| Maps                                      | Tokens                                      |
| ----------------------------------------- | ------------------------------------------- |
| ![Maps page](docs/images/Maps%20Page.png) | ![Token page](docs/images/Token%20Page.png) |

| Token editor                                    | 3D models                                     |
| ----------------------------------------------- | --------------------------------------------- |
| ![Token editor](docs/images/Token%20Editor.png) | ![Models page](docs/images/Models%20Page.png) |

| Universal VTT map editor                                | Token vision preview                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| ![UVTT map editor](docs/images/UVTT%20Map%20Editor.png) | ![UVTT map editor token vision preview](docs/images/UVTT%20Map%20Editor%20Token%20Vision%20Preview.png) |

### Audio

| Audio page with soundboard and playlist                                                                       |     |
| ------------------------------------------------------------------------------------------------------------- | --- |
| ![Audio page with soundboard and playlist](docs/images/Audio%20page%20with%20soundboard%20and%20playlist.png) |     |

### Campaigns

| Campaign overview                                         | Campaign notes wiki                                             |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| ![Campaign overview](docs/images/Campaign%20Overview.png) | ![Campaign notes page](docs/images/Campaign%20Notes%20Page.png) |

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
├── tokens/
│   └── Monsters/
│       └── goblin.png
├── audio/
│   └── Ambient/
│       ├── cover.jpg
│       └── tavern-night.mp3
└── models/
    └── Goblins/
        ├── Presupported/
        │   └── goblin-archer.stl
        └── Unsupported/
            └── goblin-archer.stl
```

See [Library structure](docs/library-structure.md) for the full layout, category rules, and the marker files that group systems together.

### 2. Run with Docker Compose

Copy the default compose file, set your volume paths, then start:

```bash
cp docs/docker/docker-compose.yml docker-compose.yml
# Edit docker-compose.yml and set the volume paths
docker compose up -d
open http://localhost:9481
```

On first launch you'll be prompted to create an admin account, or you can pre-seed users automatically (see [Pre-seeding users](docs/users-and-permissions.md#pre-seeding-users)).

### 3. Pull from DockerHub

```bash
docker pull hunterreadca/grimoire:latest
```

Or pin to a specific release:

```bash
docker pull hunterreadca/grimoire:1.5.0
```

**Image variants:** the default tags (`latest`, `1.5.0`, …) include the Tesseract OCR engine so image-only PDFs are searchable (see [OCR](docs/performance.md#ocr)). If you don't need OCR and prefer a smaller image, use the matching `-slim` tag (e.g. `hunterreadca/grimoire:latest`'s slim counterpart `:slim`, or a pinned `:1.5.0-slim`), which omits Tesseract.

### 4. Minimal `docker-compose.yml`

```yaml
services:
  grimoire:
    image: hunterreadca/grimoire:latest
    ports:
 - "9481:9481"
    volumes:
 - /path/to/your/library:/app/library   # add ":ro" to keep it read-only (see Volumes)
 - /path/to/grimoire/data:/app/data
```

### 5. Example compose files

Ready-to-use compose files for common setups are in [`docs/docker/`](docs/docker/):

| File                                                                                       | What it runs                                                   |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| [`docs/docker/docker-compose.yml`](docs/docker/docker-compose.yml)                         | Grimoire (default, no extras)                                  |
| [`docs/docker/docker-compose.valkey.yml`](docs/docker/docker-compose.valkey.yml)           | Grimoire + Valkey page cache (recommended for large libraries) |
| [`docs/docker/docker-compose.calibre.yml`](docs/docker/docker-compose.calibre.yml)         | Grimoire + Calibre full desktop (metadata editing, OPF export) |
| [`docs/docker/docker-compose.calibre-web.yml`](docs/docker/docker-compose.calibre-web.yml) | Grimoire + Calibre-Web (lightweight Calibre browser UI)        |

Each file has inline comments explaining the options. Copy and edit the one that fits your setup:

```bash
cp docs/docker/docker-compose.valkey.yml docker-compose.yml
# Edit the volume paths, then:
docker compose up -d
```

### 6. Container health

The image ships a `HEALTHCHECK` that probes the unauthenticated `GET /api/health`
endpoint. It verifies the app is serving on port 9481 and can reach the database
(and Valkey, when configured), so `docker ps` shows `(healthy)` / `(unhealthy)`
rather than just "running". Orchestrators can gate startup on it:

```yaml
depends_on:
  grimoire:
    condition: service_healthy
```

---

## Persistent data

The database, search index, and rendered thumbnails are all stored under `DATA_PATH` (the `/app/data` volume). Back this directory up to preserve your library metadata and user accounts.

## Upgrading

Pull the new image and restart (`docker compose pull && docker compose up -d`). Database schema changes are applied automatically on startup via [Alembic](https://alembic.sqlalchemy.org/) - **no manual action is required** when upgrading, including from versions that predate Alembic. On first run under the new system, an existing database is detected and stamped at the correct baseline, so only genuinely new migrations run thereafter. Back up `DATA_PATH` before upgrading, as always.

## Running from source

Prefer to build the image yourself or run Grimoire directly on the host (Python 3.12+, Node 20+) without Docker? See [Running from source](docs/running-from-source.md).

---

## Documentation

> ### 📖 [docs.grimoirecodex.org](https://docs.grimoirecodex.org)
>
> The **documentation site** is the best place to read all of this - searchable, with a
> sidebar, and including an interactive
> [Compose Generator](https://docs.grimoirecodex.org/compose-generator) that builds a
> `docker-compose.yml`, a Podman Compose file, or systemd Quadlet units from your answers.
>
> See also the [website](https://grimoirecodex.org), the
> [live demo](https://demo.grimoirecodex.org), and
> [our Discord](https://discord.gg/9Sd4CGZC63).

This page covers what Grimoire is and how to install it. Everything else lives in
[`docs/`](docs/) alongside the code - the same material the documentation site publishes,
kept in the repo so it versions with the release you are running:

### Setting up

| Guide                                              | What's in it                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [Docker installation](docs/docker-install.md)      | Step-by-step first install for Windows, macOS, and Linux                                     |
| [Library structure](docs/library-structure.md)     | How folders become systems and categories, supported formats, `tags.json`, `.grimoireignore` |
| [Configuration](docs/configuration.md)             | Every environment variable, and read-only vs writable mounts                                 |
| [Running from source](docs/running-from-source.md) | Building the image yourself, or running without Docker                                       |
| [Docker image tags](docs/dockerhub.md)             | `latest`, `nightly`, `-slim`, and the supported architectures                                |

### Using it

| Guide                                         | What's in it                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| [Searching your library](docs/search.md)      | Field searches (`title:`, `tag:`, `year:`) and how ranking works                |
| [File management](docs/file-management.md)    | The in-app file manager, duplicates and versions, and adding files from outside |
| [Metadata sidecars](docs/sidecars.md)         | Reading `.opf` in, and writing metadata back out to your library                |
| [Campaigns](docs/campaigns.md)                | Characters, resources, the notes wiki, scheduling, and calendar export          |
| [Wiki note templates](docs/wiki-templates.md) | Starting a campaign page from a template                                        |
| [Token editor](docs/token-editor.md)          | Turning any picture into a VTT-ready token                                      |
| [Universal VTT editor](docs/uvtt-editor.md)   | Drawing walls, doors, and lights for dynamic lighting                           |
| [Setting images](docs/setting-images.md)      | Campaign banners, system covers, and audio artwork                              |
| [Character sheets](docs/characters.md)        | The schema-driven character builder, content packs, and rulesets                |
| [Themes](docs/themes.md)                      | Light, dark, and installable colour themes                                      |

### Administration

| Guide                                                  | What's in it                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| [Users and permissions](docs/users-and-permissions.md) | Roles, pre-seeding accounts, and restricting books              |
| [Security hardening](docs/security.md)                 | Rate limiting, security headers, sessions, and revocation       |
| [OpenID Connect](docs/oidc.md)                         | Delegating sign-in to Keycloak, Authentik, Authelia, and others |
| [Performance and indexing](docs/performance.md)        | OCR tuning, page rendering, caching, and large galleries        |
| [Backups](docs/backups.md)                             | Scheduling, retention, and what is _not_ included               |
| [Restoring from a backup](docs/restore-from-backup.md) | The by-hand restore procedure                                   |
| [Community add-ons](docs/addons.md)                    | Installable metadata scrapers                                   |
| [OPDS catalog](docs/opds.md)                           | Connecting e-reader apps to your library                        |

### Reference

| Guide                                | What's in it                                                       |
| ------------------------------------ | ------------------------------------------------------------------ |
| [FAQ](docs/faq.md)                   | Common problems, and worked OIDC examples for Authentik and Google |
| [API reference](docs/api.md)         | Every endpoint, with roles and request bodies                      |
| [Architecture](docs/architecture.md) | Module map, request lifecycle, auth flow - for contributors        |
| [Data model](docs/data-model.md)     | ER diagram and table-by-table schema                               |
| [CI/CD pipelines](docs/pipelines.md) | Workflows, coverage gates, and the release checklist               |

The live API is also self-documenting while the server is running:
[`/api/docs`](http://localhost:9481/api/docs) (Swagger UI),
[`/api/redoc`](http://localhost:9481/api/redoc), and
[`/api/openapi.json`](http://localhost:9481/api/openapi.json).

## Contributing

Grimoire is open source and contributions are welcome - bug reports, feature ideas, docs, and code.

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for full details on reporting issues, submitting pull requests, and setting up a local development environment.

To report a security vulnerability privately, see [SECURITY.md](.github/SECURITY.md).

---

## License

GNU General Public License v3.0 - see [LICENSE](LICENSE) for details.
