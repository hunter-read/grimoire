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

  **[Website](https://grimoirecodex.org)**  ·  **[Documentation](https://docs.grimoirecodex.org)**  ·  **[Live Demo](https://demo.grimoirecodex.org)**  ·  **[Join our Discord](https://discord.gg/9Sd4CGZC63)**
</div>


A Docker-based web application for managing your tabletop RPG PDF collection. Browse, search, and read your entire library from any device with a clean, responsive UI.

## Features

- **Library Browser** - Organizes your collection by game system with automatic folder detection
- **Full-Text Search** - Every page of every PDF is indexed with SQLite FTS5 for instant search; also finds maps, tokens, and audio by filename, folder, or tag
- **Page-by-Page Viewer** - PDFs rendered as images for fast mobile viewing with pinch-to-zoom, swipe navigation, and spread mode
- **Map Gallery** - Browse battlemaps by directory structure with tag filtering, grid metadata, and full-res download. Image and PDF maps both display in-app; multi-page PDF maps open in a viewer with single-page, two-page spread, and raw-PDF modes
- **Token Browser** - Browse and tag character tokens and portrait assets
- **Audio Library** - Browse ambient tracks, soundscapes, music, and sound effects by directory structure with tag filtering and in-browser playback (MP3, OGG, Opus, FLAC, WAV, M4A, AAC). Reads embedded duration and title/artist/album tags, and uses folder `cover`/`folder` images or embedded album art for artwork
- **Global Audio Player** - A persistent pop-out player that keeps playing while you navigate. Build a local queue by playing a whole folder, queueing tracks one at a time ("Play Next"), having a GM play a campaign resource group, or playing all the audio embedded in a wiki note. Expand it to see and reorder upcoming tracks, with a repeat-current-track toggle
- **Bookmarks** - Per-user page and text-selection bookmarks with inline highlights
- **Favorites** - Save systems, books, maps, tokens, and audio for quick access
- **Shared Tags** - One tag catalog across systems, books, maps, tokens, and audio. Tags match on a lowercased internal key with an editable display name, so "Draw Steel" and "draw steel" are the same tag. A dedicated Tags page lists every tag with usage counts, lets you rename/merge/delete, and browses all items carrying a tag; clicking a tag anywhere jumps there. Filter dropdowns show only tags used on the current page, and campaign resources can be bulk-added by tag
- **View Modes** - Toggle the systems, books, maps, tokens, and audio grids between card, compact, and list layouts; each content type remembers its own default (configurable in Account Settings) while the in-page toggle is a per-tab override. Cards and list rows include quick download and favorite buttons.
- **Metadata Editor** - Rich metadata for systems (multiple genres, dice/materials, system family, parent system + edition, license, year, and multiple generic + character-builder links) and books (authors, artists, genres, ISBN, version, language, a per-book license override, a variable-precision publication date, and multiple links). Genres, system families, parent systems, licenses, and dice/materials are drawn from curated lists you manage in **Settings → Metadata** (each section collapsible; defaults plus your own custom values). A *parent system* groups related systems (e.g. D&D 5e and AD&D under "Dungeons & Dragons"), and an *edition* string combines with it for display ("Cyberpunk" + "Red" → "Cyberpunk Red")
- **Community Add-ons** - Install metadata scrapers contributed by the community to fill in game system and book details from external sources (TTRPG Wiki for systems, DriveThruRPG for books). Open a system or book, hit **Fetch metadata**, pick a match, and review a field-by-field diff before anything is written - values you have already set are never pre-selected. Definitions live in the separate [community-add-ons](https://github.com/grimoire-codex/community-add-ons) repo, so a source that changes can be fixed without waiting for a Grimoire release. Manage and update them in **Settings → Add-ons**; see [`docs/addons.md`](docs/addons.md)
- **Wiki Note Templates** - Start a campaign wiki page from a template instead of a blank note. Browse a community catalogue as a folder tree (Generic, Draw Steel, Dungeons & Dragons 5e, …) and download copies into your campaign, write your own, or upload a Markdown file or template `.zip`. Templates belong to the campaign, so you can edit a downloaded one freely; any template exports as a ready-to-contribute folder that uploads straight back in. Downloading can be turned off with `WIKI_TEMPLATES_DOWNLOAD_DISABLED` while authoring and upload keep working; see [`docs/wiki-templates.md`](docs/wiki-templates.md)
- **Sort & Filter** - Sort systems by name, book count, total page count, or year, and books by title, page count, or year. A shared filter modal covers genre, system family, parent system, edition, dice/materials, tags, favourites, and explicit content. Named filter presets are saved to your account (server-side, so they follow you across devices), and one preset per view can be set as the default you land on. Sort, filters, saved presets, multi-select, and the view switcher share a single toolbar row that stays pinned to the top of the page as you scroll, so bulk-selecting entries near the bottom of a long library no longer means scrolling back up
- **Bulk Actions** - Multi-select books, maps, tokens, and audio (click, shift-click for a range, ⌘/Ctrl-click to toggle) then bulk tag, add to a campaign, or edit metadata via a carousel. An "apply to all" button opens a checklist of fields to copy from the item you are on to the whole selection - tick Category and every selected book moves at once - and books and systems can pull metadata from an installed add-on without leaving the carousel. A single book can be added to a campaign without multi-select from its actions menu (**⋮**)
- **Campaigns** - Track GM-run and personal campaigns; a markdown notes wiki with deep linking, Markdown/JSON/LegendKeeper import & export, character art and sheets, linked resources, and scheduling
- **OPDS Catalog** - Each user can generate a personal OPDS feed URL to connect e-reader apps directly to their library
- **Docker Ready** - One command to run, mount your library directory, done
- **Responsive** - Works on desktop, tablet, and phone with mobile navigation

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
└── audio/
    └── Ambient/
        ├── cover.jpg
        └── tavern-night.mp3
```

See [Library Structure](#library-structure) for the full layout and category rules.

### 2. Run with Docker Compose

Copy the default compose file, set your `SECRET_KEY`, then start:

```bash
cp docs/docker/docker-compose.yml docker-compose.yml
# Edit docker-compose.yml and set SECRET_KEY and volume paths
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
docker pull hunterreadca/grimoire:1.5.0
```

**Image variants:** the default tags (`latest`, `1.5.0`, …) include the Tesseract OCR engine so image-only PDFs are searchable (see [OCR](#ocr)). If you don't need OCR and prefer a smaller image, use the matching `-slim` tag (e.g. `hunterreadca/grimoire:latest`'s slim counterpart `:slim`, or a pinned `:1.5.0-slim`), which omits Tesseract.

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
 - /path/to/your/library:/app/library:ro   # read-only - use Filebrowser or Calibre to manage files
 - /path/to/grimoire/data:/app/data
```

### 5. Example compose files

Ready-to-use compose files for common setups are in [`docs/docker/`](docs/docker/):

| File | What it runs |
|---|---|
| [`docs/docker/docker-compose.yml`](docs/docker/docker-compose.yml) | Grimoire (default, no extras) |
| [`docs/docker/docker-compose.valkey.yml`](docs/docker/docker-compose.valkey.yml) | Grimoire + Valkey page cache (recommended for large libraries) |
| [`docs/docker/docker-compose.filebrowser.yml`](docs/docker/docker-compose.filebrowser.yml) | Grimoire + Filebrowser Quantum (browser-based file uploads) |
| [`docs/docker/docker-compose.calibre.yml`](docs/docker/docker-compose.calibre.yml) | Grimoire + Calibre full desktop (metadata editing, OPF export) |
| [`docs/docker/docker-compose.calibre-web.yml`](docs/docker/docker-compose.calibre-web.yml) | Grimoire + Calibre-Web (lightweight Calibre browser UI) |

Each file has inline comments explaining the options. Copy and edit the one that fits your setup:

```bash
cp docs/docker/docker-compose.valkey.yml docker-compose.yml
# Edit SECRET_KEY and volume paths, then:
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

Prefer to build the image yourself or run Grimoire directly on the host (Python 3.12+, Node 20+) without Docker? See [docs/running-from-source.md](docs/running-from-source.md).

---

## Library Structure

### Books - one folder per game system

Each top-level folder under `books/` becomes a **game system**. Subfolders are auto-detected as categories based on their name.

Folder name matching is **case-insensitive**, and hyphens, underscores, and spaces are interchangeable - `Character-Sheets`, `character_sheets`, and `Character Sheets` all map to the same category.

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
> **Prefer to organize categories yourself?** Turn folder-name inference off in **Settings → Maintenance → Folder Category Inference** (or pin it with the `DISABLE_FOLDER_CATEGORY_INFERENCE` env var); books then fall back to the `uncategorized` category. To disable inference for a single system only, drop an empty `.no-auto-category` file at that system's folder root.
>
> After adding new files, use **Rescan** in the sidebar (or Settings → Maintenance) to pick up the changes. For large libraries you can also rescan a single corner: every system, category, subfolder, and map/token group has its own rescan button that re-scans just that folder.

#### Subfolders within a category

Any category folder can contain named subfolders to group related books together. Grimoire detects these automatically and displays them as collapsible folder groups within the category section - no configuration needed.

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

#### Archive files

Archive files placed anywhere under `books/` are shown alongside your books in their category - handy for bundling a set of related files (a maps pack, a COMP/CON export, loose handouts) next to the book they belong to. Recognized extensions:

| Type | Extensions |
|---|---|
| Zip | `.zip`, `.cbz` |
| RAR | `.rar`, `.cbr` |
| 7-Zip | `.7z`, `.cb7` |
| Tar | `.tar`, `.cbt`, `.tar.gz`, `.tgz`, `.tar.bz2`, `.tbz2` |

Archives are treated as opaque downloads - Grimoire does not extract or read their contents, so clicking one downloads the file rather than opening the reader. They're also included when you download a whole system, category, or subfolder as an archive. Comic-book archives (`.cbz`, `.cbr`, `.cb7`, `.cbt`) additionally get a cover thumbnail generated from the first image inside them.

Archives are also recognized under `maps/`, `tokens/`, and `audio/`, where they appear in the gallery next to your images and tracks marked with an **Archive** badge. Map packs and art collections are often distributed zipped alongside supplementary files (PSDs, STLs, source files), so bundling them keeps the extras with the maps they belong to without cluttering the gallery. Opening one offers a download instead of a preview - there is no thumbnail, no image viewer, and no audio player, since the contents are never extracted. The comic-book extensions (`.cbz`, `.cbr`, `.cb7`, `.cbt`) are books-only and are skipped in these collections.

#### Special collections (system-agnostic & one-page)

Some books don't belong to a single game system - reference material, zines, art books, or rulesets like Ironsworn or Mothership that span multiple systems. And some "systems" are really a bucket of many tiny games: one-page and small RPGs. Create a folder whose name is one of the recognized names below and Grimoire will display its contents in a separate **Special Collections** section on the library page, outside the normal game-system grid.

**Recognized folder names** (case-insensitive):

| Folder name | Collection | Example |
|---|---|---|
| `System Agnostic` | System-agnostic | `books/System Agnostic/` |
| `Generic` | System-agnostic | `books/Generic/` |
| `Any` | System-agnostic | `books/Any/` |
| `One-Page RPGs` | One-page / small RPGs | `books/One-Page RPGs/` |
| `Single-Page RPGs` | One-page / small RPGs | `books/Single-Page RPGs/` |
| `One-Shot RPGs` | One-page / small RPGs | `books/One-Shot RPGs/` |
| `Micro RPGs` | One-page / small RPGs | `books/Micro RPGs/` |

For the **system-agnostic** collections, subfolders directly under the root become **custom category headings** - whatever you name them is what appears in the UI. There is no keyword matching; the folder name is used as-is (slugified).

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

The **one-page / small RPG** collections behave differently: they are *system containers*, described next.

#### System containers (parent systems & sub-libraries)

Sometimes a folder isn't a game system - it's a shelf holding several. Grimoire supports five flavours, and in every case the folder's immediate children become game systems in their own right, each with its own metadata, tags, cover, and place in the system filters.

**Parent systems** group the editions of one game:

```
books/
└── Dungeons & Dragons/          ← a container, not a system
    ├── .parent-system-container ← marker file declaring it
    ├── 3e/
    │   └── core/
    │       └── Players Handbook.pdf
    └── 5e/
        └── core/
            └── Players Handbook.pdf
```

This yields two systems - "Dungeons & Dragons 3e" and "Dungeons & Dragons 5e" - each with `Parent System` set to "Dungeons & Dragons" and `Edition` set to the folder name, so you can filter the library by either. Category folders (`core`, `adventure`, …) work normally *inside* each edition.

**System families** group related but *distinct* systems that share a lineage - not editions of one game:

```
books/
└── d20 System/                    ← .system-family-container
    ├── Pathfinder/                ← .parent-system-container (nesting is fine)
    │   ├── 1e/
    │   └── 2e/
    ├── Mutants & Masterminds/
    └── d20 Modern/
```

Each child is an independent system, and the container's name fills in its `System Family` field - so the folder structure and the family filter finally line up. Children keep their own names (no `{Parent} {Child}` prefixing) and get no `Edition`/`Parent System`, because they aren't variants of anything. As shown above, a family can hold a multi-edition system: the nested `.parent-system-container` resolves its editions normally, and inherits the family name itself.

**Publisher containers** group the systems one company puts out:

```
books/
└── Paizo/                         ← .publisher-container
    ├── Pathfinder 2e/
    └── Starfinder/
```

Each child is an independent system with the container's name recorded as its `Publisher`.

> Family and publisher containers only *fill in* metadata a system doesn't already have. If a book's OPF sidecar, an add-on, or your own edit already set the family or publisher, a rescan leaves it alone.

**Generic containers** are the escape hatch. A bare `.container` marker says only "the folders in here are systems" and claims nothing about how they relate, so it propagates no metadata at all - use it when your shelf doesn't fit any of the named kinds:

```
books/
└── Kickstarter Hauls/             ← .container
    ├── Mörk Borg/
    └── Mothership/
```

**One-page / micro-RPG collections** are sub-libraries of many tiny games. Here, *both* subfolders and loose files at the root become systems:

```
books/
└── One-Page RPGs/               ← a container (recognized by name)
    ├── honey-heist.pdf          → system "Honey Heist" (1 book)
    ├── lasers-and-feelings.pdf  → system "Lasers And Feelings" (1 book)
    └── cbr+pnk/                 → system "Cbr+pnk" (2 books)
        ├── core/
        │   └── core-rules.pdf
        └── character-sheets/
            └── character.pdf
```

A single-file game becomes a system holding that one book; a folder-backed game keeps its internal category structure. Either way each game gets full system-level metadata and tagging, while the collection itself stays as one tidy entry in the **Special Collections** strip instead of flooding the main grid.

**Declaring a container.** Any of these work, and they can be combined with `(nsfw)` and sort-order prefixes:

| Method | Example | Kind |
|---|---|---|
| Marker file | `books/D&D/.parent-system-container` | Parent system |
| Marker file | `books/Itch Bundle/.one-page-container` | One-page collection |
| Marker file | `books/d20 System/.system-family-container` | System family |
| Marker file | `books/Paizo/.publisher-container` | Publisher |
| Marker file | `books/Kickstarter Hauls/.container` | Generic |
| Folder-name suffix | `books/Cyberpunk (parent-system)/` | Parent system |
| Folder-name suffix | `books/Jam Games (one-page)/` | One-page collection |
| Folder-name suffix | `books/Powered by the Apocalypse (system-family)/` | System family |
| Folder-name suffix | `books/Chaosium (publisher)/` | Publisher |
| Folder-name suffix | `books/My Shelf (container)/` | Generic |
| Recognized name | `books/One-Page RPGs/` | One-page collection |

If a folder somehow carries more than one declaration, the most specific kind wins, in this order: **parent system → one-page → system family → publisher → generic**. Every recognized suffix is stripped from the stored name either way, so a stray `(publisher)` never shows up in the UI.

**Naming.** Child systems get a sensible default name - `{Parent} {Edition}` for parent systems, the prettified file/folder name for one-page games, and their own folder name for family, publisher, and generic children. Rename any of them in the UI and your name sticks: rescans never overwrite a system you've renamed, so "Dungeons & Dragons 2e" can become "Advanced Dungeons & Dragons".

**Reorganizing an existing library.** If you move a flat `books/Dungeons & Dragons 5e/` into `books/Dungeons & Dragons/5e/`, the generated child name matches the system you already have - so Grimoire adopts that existing system rather than creating a duplicate. Its books, metadata, tags, and cover all follow it into the container.

**Cover art.** A container holds no books of its own, so there's no thumbnail to derive a cover from. Give it art either way:

```
books/
└── Dungeons & Dragons/
    ├── .parent-system-container
    ├── cover.jpg           ← folder artwork (cover.* or folder.*)
    └── 5e/
```

Or upload one from the container's page (**Cover image**, GM/admin only). A `cover.*`/`folder.*` file in the library folder takes precedence over an upload, and both beat the book thumbnail an ordinary system falls back to. This works for any system, not just containers.

**Grouping toggle.** Containers are a way to organize the grid, not a cage. The **Group collections** switch beside the "Your Collection" heading (shown only when you actually have a container) flattens them: the container cards drop out and their child systems take their place, so you get a plain A-Z list of every real system with the usual sorting and filters applied. Switch it back on to return to the drill-down view. Your choice is remembered across sessions.

One-page collections are the deliberate exception - they stay grouped either way. Keeping a pile of tiny one-book games out of the main grid is the whole reason that collection exists, so flattening leaves its chip in the Special Collections strip and its games reachable by drilling in.

> **Note:** systems nested inside a container count toward your library's game-system total. If you already used a `One-Page RPGs` folder, expect that number to rise after the first rescan as each game inside it becomes its own system.

#### Marking a system as explicit

Append `(nsfw)` to the folder name to mark all content in that system as explicit:

```
books/
└── Some Adult Game (nsfw)/
    └── core/
        └── rulebook.pdf
```

Users with explicit content disabled will not see this system or its books.

Alternatively, drop an empty `.nsfw` file at the system's root - useful when parenthesised folder names are awkward for your filesystem or sync tool:

```
books/
└── Some Adult Game/
    ├── .nsfw
    └── core/
        └── rulebook.pdf
```

#### Sort-order prefixes

To pull a system to the top of an alphabetically-sorted file browser, you can
prefix its folder name with `!`, `$`, or `%`. Grimoire strips a leading run of
those characters when deriving the system name (only the leading run — internal
occurrences are kept):

```
books/
├── !!Dungeons & Dragons/   → "Dungeons & Dragons"
├── !system-agnostic/       → still the System-Agnostic collection
└── $%Pathfinder 2e/        → "Pathfinder 2e"
```

The prefix stacks with `(nsfw)`, so `!!Forbidden Lore (NSFW)` becomes the
explicit system "Forbidden Lore".

### Book metadata from OPF files

Grimoire reads [OPF](https://idpf.org/epub/20/spec/OPF_2.0.1_draft.htm) sidecar files to populate book metadata automatically on first scan. OPF files are the format used by [Calibre](https://calibre-ebook.com/) and many other library managers.

#### Supported fields

| OPF element | Book field |
|---|---|
| `dc:title` | Title |
| `dc:creator` (role=aut) | Authors |
| `dc:publisher` | Publisher |
| `dc:date` | Year (4-digit year extracted) |
| `dc:description` | Description (HTML tags stripped) |
| `dc:subject` | Tags (lowercased) |
| `guide/reference[@type='cover']` | Cover image (file is excluded from the book list) |

`dc:contributor` entries (e.g. Calibre's own tool credit) and `dc:identifier` (UUID/ISBN) are intentionally ignored. `dc:language` is parsed but not stored (no matching field).

#### OPF file discovery

The scanner checks two locations for each book file, in priority order:

1. **`<bookname>.opf`** - a sidecar file with the same stem as the PDF, in the same directory. Suits hand-crafted or single-file layouts.
2. **`metadata.opf`** - a file named `metadata.opf` in the same directory. This is the format Calibre uses when it exports each book into its own subfolder.

A typical Calibre export looks like this and is fully supported:

```
books/
└── Dungeons & Dragons/
    └── core/
        ├── Players Handbook/
        │   ├── players_handbook.pdf
        │   ├── metadata.opf
        │   └── cover.jpg          ← skipped (referenced as cover in OPF)
        └── Dungeon Masters Guide/
            ├── dungeon_masters_guide.pdf
            ├── metadata.opf
            └── cover.jpg
```

OPF metadata is only applied when a book is **first indexed**, and ordinary rescans leave existing books alone, so edits made via the web UI are not overwritten. To pick up an OPF or `tags.json` you added or corrected after the initial scan, choose a metadata-refresh mode in the rescan dialog (available on the global Rescan button and every per-folder rescan button):

- **Find new files** - the default: add new files, flag missing ones, leave existing records untouched.
- **Update missing metadata** - additionally fill **empty** book fields from sidecar files, without touching anything you've already set (non-destructive).
- **Replace all metadata** - overwrite fields with whatever the sidecar files provide (this discards UI edits the sidecar covers).

### Maps - organize by creator or collection

```
maps/
└── Creator Name/
    └── map-file.png
```

The folder name is shown as a group header in the map gallery. Both image maps and PDF maps (including multi-page PDFs) are supported and viewable in-app.

### Tokens - organize by type

```
tokens/
└── Category/
    └── token-file.png
```

### Audio - organize by category or creator

```
audio/
└── Category or Creator/
    ├── cover.jpg        # optional folder artwork (cover.* or folder.*)
    └── track.mp3
```

The folder name is shown as a group header in the audio library. Supported formats: `.mp3`, `.ogg`, `.opus`, `.flac`, `.wav`, `.m4a`, `.aac`. Duration and embedded title/artist/album tags are read on scan. For artwork, Grimoire uses a `cover.*` or `folder.*` image in the track's folder if present, otherwise falls back to embedded album art.

---

## Tagging with tags.json

Drop a `tags.json` file into any `maps/`, `tokens/`, or `audio/` folder (or subfolder) to automatically apply tags when the library is scanned. You can also place one inside a game system folder under `books/` to tag the system itself.

`tags.json` is a plain JSON object. Keys are paths resolved relative to the folder the file lives in:

| Key | What gets tagged |
|---|---|
| `"."` | The containing folder (shown as folder tags in the gallery) |
| `"file.png"` | A file in the same folder |
| `"subfolder"` | A subfolder |
| `"subfolder/file.png"` | A file inside a subfolder |

Values are arrays of tag strings. The casing you write is used as the tag's
display name the first time it's seen.

```json
{
  ".": ["Dungeon", "Fantasy"],
  "cave-entrance.png": ["Cave", "Outdoors"],
  "boss-arena": ["Combat", "Finale"],
  "boss-arena/throne-room.png": ["Throne", "Indoor"]
}
```

`tags.json` is **additive and read-only**: on every rescan it only *adds* the
tags it lists — it never removes tags you set (or removed) in the web UI, and it
never overwrites a tag's display name once the tag exists. A new tag is created
using the casing in the file; renaming a tag later in the web UI sticks, because
the display name lives in the app's tag catalog rather than in `tags.json` (which
the app treats as read-only and never rewrites). Tags are matched
case-insensitively, so `"dungeon"` and `"Dungeon"` are the same tag.

---

## Ignoring Files with .grimoireignore

Add a `.grimoireignore` file to keep files on disk but out of Grimoire. It uses the same syntax as `.gitignore` / `.dockerignore`, so anything matched by a rule is skipped during scanning and never appears in the UI — useful when a book ships extra print variants (black-and-white single pages, zine-sized layouts) you want kept next to the book but hidden.

Place it at your **library root** to apply everywhere, or in any subfolder to add rules for just that subtree. Rules are cumulative and nested, like git.

```
library/
├── .grimoireignore              ← applies to the whole library
└── books/
    └── Example TTRPG/
        ├── core/
        │   └── Players Handbook.pdf
        └── ignore/               ← whole folder skipped
            └── Players Handbook BW Single Pages.pdf
```

```
# .grimoireignore
ignore/                 # skip an entire folder
*BW Single Pages*.pdf   # skip print variants anywhere
!keep-this.pdf          # re-include a file an earlier rule excluded
```

The full gitignore dialect is supported (`!` negation, `**` for arbitrary depth, anchoring with `/`), and rules apply to every collection: `books/`, `maps/`, `tokens/`, and `audio/`. Changes take effect on the next scan. Adding a rule that matches an already-indexed file hides it (marked missing) on the next rescan; remove the rule and rescan to bring it back.

---

## Adding Files to Your Library

Grimoire mounts your library folder **read-only** and never modifies your files. To upload, organize, or remove content, use a companion tool that mounts the same library folder with write access.

Two tools integrate especially well:

- **[Filebrowser Quantum](docs/file-management.md#filebrowser-quantum)** - drag-and-drop file uploads from any browser, no desktop app needed
- **[Calibre](docs/file-management.md#calibre)** - full book management with metadata editing; Grimoire reads the `.opf` sidecar files Calibre writes ([see OPF support](#book-metadata-from-opf-files))

See [docs/file-management.md](docs/file-management.md) for Docker Compose examples for each tool.

After adding files, trigger a **Rescan** in Grimoire (sidebar or Settings → Maintenance) to index the new content.

---

## Configuration

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | - | **Required.** JWT signing secret. Generate: `openssl rand -hex 32` |
| `WORKERS` | `2` | Number of uvicorn worker processes |
| `LIBRARY_PATH` | `/app/library` | Optional path to your library directory inside the container if not mounted at /app/library |
| `DATA_PATH` | `/app/data` | Optional path for the database, thumbnails, and search cache inside the container if not mounted at /app/data |
| `BASE_URL` | `http://localhost:9481` | Public base URL of this instance. Set this to the URL you use to access Grimoire (e.g. `https://grimoire.example.com`) when running behind a reverse proxy - used to build absolute links in OPDS feeds and other places that need a fully-qualified URL. |
| `VALKEY_URL` | - | Optional Redis-compatible cache URL for rendered page images (e.g. `redis://valkey:6379/0`) |
| `OCR_ENABLED` | `true` | Optional. Set to `false` to disable OCR of image-only PDFs even on the OCR-capable image. See [OCR](#ocr) below. |
| `OCR_LANGUAGES` | `eng` | Optional. Tesseract language codes for OCR, e.g. `eng` or `eng+deu+fra`. Extra languages require their tessdata files to be present (see [OCR](#ocr)). |
| `OCR_CONCURRENCY` | `1` | Optional. Number of scanned books OCR'd in parallel by the background OCR worker. Raise on multi-core hosts with spare CPU; keep at `1` on small boxes. Set to `0` to turn OCR off (same as `OCR_ENABLED=false`). See [OCR performance](#ocr-performance--resource-tuning). |
| `OCR_DPI` | `150` | Optional. Resolution scanned pages are rasterized at before OCR (clamped 72–600). Higher = more accurate but slower and more memory per page. See [OCR performance](#ocr-performance--resource-tuning). |
| `OPDS_ENABLED` | `false` | Optional, Set to `true` to enable the OPDS catalog. See [OPDS](#opds) below. |
| `LOG_LEVEL` | `info` | Optional Console/Docker log verbosity: `debug`, `info`, `warning`, `error`, or `critical`. The in-app Logs tab (Settings → Logs) always captures `debug`-level entries regardless of this setting. |
| `TZ` | `UTC` | Optional. Timezone for all log timestamps — both console/Docker output and the in-app Logs tab. Use an IANA zone name such as `America/Toronto` or `Europe/Berlin`. Defaults to UTC when unset; an unknown zone name logs a warning and uses UTC. |
| `ALLOW_PASSWORD_AUTHENTICATION` | - | Optional, `true` or `false`. When set, pins password authentication on or off and overrides the toggle in Settings → Authentication (the toggle is shown read-only). When unset, the in-app setting is used. First-run admin setup always requires a username and password regardless of this value. |
| `GUEST_ACCESS_ENABLED` | - | Optional, `true` or `false`. When set, pins guest invite codes on or off and overrides the toggle in Settings → Authentication (the toggle is shown read-only). When unset, the in-app setting is used. See [Guest invites](#guest-invites) below. |
| `DISABLE_FOLDER_CATEGORY_INFERENCE` | - | Optional, `true` or `false`. When set, pins folder-name category inference on or off and overrides the toggle in Settings → Maintenance (shown read-only). When `true`, books are not auto-assigned a category from their folder names and fall back to `uncategorized`. A per-system `.no-auto-category` marker file disables inference for just that system. |
| `WIKI_TEMPLATES_DOWNLOAD_DISABLED` | `false` | Optional, `true` or `false`. When `true`, Grimoire never fetches wiki note templates from a community catalogue: the wiki's **Browse** tab disappears and the catalogue endpoints refuse. Writing templates in the app and uploading a `.md` still work, so a GM can hand-copy a template in. See [Wiki note templates](docs/wiki-templates.md). |
| `OIDC_*` env vars | - | Optional. Each OIDC setting (`OIDC_ENABLED`, `OIDC_ISSUER_URL`, `OIDC_TOKEN_ISSUER`, `OIDC_AUTHORIZATION_ENDPOINT`, `OIDC_TOKEN_ENDPOINT`, `OIDC_USERINFO_ENDPOINT`, `OIDC_JWKS_URI`, `OIDC_END_SESSION_ENDPOINT`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SIGNING_ALG`, `OIDC_BUTTON_TEXT`, `OIDC_GROUPS_CLAIM`, `OIDC_PERMISSIONS_CLAIM`, `OIDC_MATCH_BY`, `OIDC_AUTO_LAUNCH`, `OIDC_AUTO_REGISTER`) can be pinned via env. When set, the field is read-only in Settings → Authentication. When unset, the in-app value is used. See [OpenID Connect](#openid-connect) below. |
| `AUTH_RATE_LIMIT` | `10/minute` | Per-IP throttle applied to the credential-checking endpoints (`/api/auth/login`, `/api/auth/setup`, `/api/auth/guest-login`, and the API-key-guarded `/api/stats`). Exceeding it returns `429`. Uses a [`limits`](https://limits.readthedocs.io/en/stable/quickstart.html#rate-limit-string-notation) string like `20/minute` or `100/hour`. See [Security hardening](#security-hardening) below. |
| `RATE_LIMIT_ENABLED` | `true` | Optional. Set to `false` to disable auth rate limiting entirely. |
| `TRUST_FORWARDED_FOR` | `true` | Optional. When `true`, the rate limiter keys on the left-most `X-Forwarded-For` address so each client gets its own bucket behind a reverse proxy. Set to `false` only if Grimoire is exposed directly (no trusted proxy), so a spoofed header can't sidestep the limit. |

### Volumes

```yaml
volumes:
  # Your library - read-only is fine, Grimoire never modifies your files
 - /path/to/your/library:/app/library:ro

  # Persistent data (database, thumbnails, page cache)
 - grimoire_data:/app/data
```

---

## Performance

### Indexing

On first startup Grimoire scans the library and indexes every PDF page for full-text search. This can take several minutes for large collections. The index is stored in the data volume and subsequent startups are fast.

Use the **Rescan** button in the sidebar to pick up newly added files, or configure a scheduled rescan in **Settings → Maintenance**.

### OCR

Some PDFs contain only scanned page images with no embedded text layer (common with older, scanned game books). These can't be full-text searched from their text layer alone and show an **Image Only** badge.

The default Grimoire image bundles the [Tesseract](https://github.com/tesseract-ocr/tesseract) OCR engine (English), so scanned image-only PDFs are run through OCR and their recognised text is added to the search index. Books indexed this way show an **OCR** badge. No extra container or service is required.

OCR runs quietly in the background, so it never holds up the rest of your library. A scan indexes all your regular (text-based) books, maps, tokens, and audio first - those are searchable right away - and then works through the scanned books afterward. Even if you add 100+ scanned books at once, the rest of your library stays available while they're being processed.

Scanned books are also processed **page by page**, and progress is saved as it goes. If the server restarts (or you stop and start a scan), OCR simply picks up where it left off instead of starting the book over - so even a very large scanned book will finish, however long it takes.

- **Progress:** the admin scan status shows an OCR phase with a progress bar and the book currently being processed.
- **Disable OCR:** set `OCR_ENABLED=false`. Scanned image-only PDFs are then left unindexed, the same as on the slim image.
- **Slim image:** the `-slim` tags (e.g. `hunterreadca/grimoire:v1.5.0-slim`, `:slim`) omit Tesseract for a smaller image. OCR is automatically disabled there.
- **Upgrading to OCR:** if you enable OCR later (or switch from a slim image), any books that were previously skipped as image-only are automatically queued for OCR on the next scan.
- **Additional languages:** set `OCR_LANGUAGES` to a `+`-joined list of Tesseract language codes (e.g. `eng+deu+fra`). The extra languages' data files must be present in the image - mount a directory of `.traineddata` files (or point `TESSDATA_PREFIX` at one) to add languages without rebuilding.

#### Speeding up OCR

Scanning a large book takes a while, and it happens quietly in the background - you can browse and search the rest of your library the whole time, and OCR picks up where it left off if the server restarts. If you have a big collection of scanned books and want it to finish faster, two optional settings help:

- **`OCR_CONCURRENCY`** - how many scanned books to work on at once. The default is `1`, which is gentle on small devices. If you're running on a machine with several CPU cores and plenty of memory to spare, raising this (e.g. `2`–`8`) processes books in parallel and gets through the queue faster. On a small device like a Raspberry Pi, leave it at `1`. Set it to `0` to turn OCR off entirely - handy if OCR keeps failing or running your machine out of memory and you just want it to stop, without switching to the slim image.
  - Each parallel worker uses roughly 50–250 MB of RAM depending on the pdf page image size, so make sure you have that much to spare per unit, and don't set it higher than the number of CPU cores (virtual/hyper-threaded cores count) or the workers just compete for the same processors without going any faster.
- **`OCR_DPI`** - how sharp the scanned pages are rendered before reading them (default `150`). Lowering it (e.g. `120`) makes OCR faster and lighter; raising it (e.g. `200`–`300`) can improve results on faint or low-quality scans at the cost of speed. Note: OCR scanned books can be individually rescaned at a higher DPI if needed from the application.

A rough guide: a small always-on device (like a Pi) is happiest at the defaults; a typical NAS can handle `OCR_CONCURRENCY=2`; a powerful desktop or server can go higher. It's safe to start low and raise it later - the queue just continues faster.

#### Re-OCR a single book at a higher DPI

`OCR_DPI` sets the resolution for the whole library, and `150` is usually plenty. But the occasional faint or low-quality scan reads better at a higher resolution. Rather than raise the global default (and re-OCR everything), you can re-OCR just that one book: on an OCR-badged book, open the actions menu (**⋮**) and choose **Re-OCR…**, optionally enter a DPI (e.g. `300`), and run it. The book is re-read in the background at that resolution while the rest of the library is untouched; leave the DPI blank to re-OCR at the global default. It appears only for scanned/OCR'd books and requires GM or admin.

#### Re-scan &amp; re-index a single book

Edited a PDF in place (embedded encounter notes, added errata)? Its search index goes stale until the next full library rescan. Instead, on that book open the actions menu (**⋮**) and choose **Re-scan &amp; re-index** to re-read just that file: its page count and thumbnail refresh, and its text is re-extracted and re-indexed in the background (an image-only PDF is re-queued for OCR). Works for any PDF and requires GM or admin.

### Page rendering

PDFs are rendered page-by-page server-side as WebP images rather than streamed as raw files. This keeps the viewer fast on mobile and avoids loading large files into the browser. Switch to the native PDF viewer anytime via the toolbar.

### Caching

Rendered pages are cached to disk by default. Provide a `VALKEY_URL` to use an in-memory Redis-compatible cache instead for faster repeat loads.

---

## Security hardening

### Auth rate limiting

The credential-checking endpoints - `/api/auth/login`, `/api/auth/setup`, `/api/auth/guest-login`, and the API-key-guarded `/api/stats` - are rate-limited per client IP to slow online password / invite-code brute-forcing. The default is **`10/minute`** per IP; exceeding it returns HTTP `429`. Tune it with `AUTH_RATE_LIMIT` (a [`limits`](https://limits.readthedocs.io/en/stable/quickstart.html#rate-limit-string-notation) string such as `20/minute` or `100/hour`), or turn it off with `RATE_LIMIT_ENABLED=false`.

**Behind a reverse proxy:** keying is done on the left-most `X-Forwarded-For` address by default (`TRUST_FORWARDED_FOR=true`) so each real client - not the proxy - gets its own bucket. Make sure your proxy sets `X-Forwarded-For`. If Grimoire is exposed directly with no trusted proxy in front, set `TRUST_FORWARDED_FOR=false` so a spoofed header can't be used to sidestep the limit.

**Multiple replicas:** when `VALKEY_URL` is set the limit counters are shared through Valkey so the limit is enforced consistently across all workers/replicas; without it each process keeps its own in-memory counters (and the limiter falls back to in-memory automatically if Valkey becomes unreachable).

### Security headers

Every response carries a `Content-Security-Policy` scoped to what the SPA actually loads (own scripts, inline styles used by React, Google Fonts, and `data:`/`blob:` images for rendered pages), plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (matching the CSP `frame-ancestors 'none'`), and `Referrer-Policy: strict-origin-when-cross-origin`. `Strict-Transport-Security` is emitted **only when the request is HTTPS** - either directly or via an `X-Forwarded-Proto: https` header from your TLS-terminating proxy - so it is never sent over plain HTTP.

### Session cookie for images and downloads

Browser `<img>` and download requests can't send an `Authorization` header, so they authenticate via an `HttpOnly`, `SameSite=Lax` session cookie (`grimoire_session`) set at login rather than a token in the URL. **This means the JWT no longer appears in image/download URLs, so a reverse proxy, CDN, or load balancer in front of Grimoire no longer records it in access logs** (query-string tokens also leaked via `Referer` headers and browser history). Set `BASE_URL` to your `https://` public URL so the cookie is marked `Secure` and only ever sent over TLS. The old `?token=` query param is still accepted for backward compatibility but is deprecated.

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
| `role` | No | `admin`, `gm`, or `player` - defaults to `player` if missing |
| `denyExplicit` | No | `true` to restrict explicit content for this user - defaults to `false` |

**Rules:**
- At least one entry must have `"role": "admin"` - the file is rejected otherwise.
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
| `admin` | Everything - user management, app settings, metadata editing, rescan |
| `gm` | Read everything, edit metadata, create GM campaigns |
| `player` | Read-only access, personal campaigns, session notes |
| `guest` | Code-only account scoped to a single campaign. No access to the library, maps, tokens, audio, or search. See [Guest invites](#guest-invites). |

Create additional accounts in **Settings → Users** after logging in as admin.

---

## Campaigns

Grimoire has a built-in campaign tracker with two modes:

- **GM Campaigns** - Created by GMs or admins. Supports player invitations, a banner image, character art and character sheets per member (uploaded file or an external link), resource linking with per-resource visibility, a markdown wiki for notes, and scheduling.
- **Personal Campaigns** - Private to a single user. No sharing.

Campaign creation uses a short wizard: pick a system, then choose resources - the system's core books are suggested by default and anything can be added (with a search) or removed, each set to **Shared with players**, **GM only**, or **Private**. The campaign **description** supports markdown, and you can name a **custom game system** that isn't in your library (handy for keeping notes on a system you don't own).

A personal campaign can be **converted to a group campaign** later (**Convert to group** on the campaign page, GMs and admins only) - useful when solo prep turns into a game you want to run. Everything already in it (resources, wiki, sessions) carries over untouched, and invitations, guests, and scheduling unlock. This is **one-way**: a group campaign can't be turned back into a personal one, since that would strand its members and schedule.

### Archiving campaigns

Finished a game? **Archive** it from the campaign page instead of deleting it. An archived campaign:

- Is **hidden from everyone's campaign list** - yours and your players' - until you switch on the **Archived** toggle above the list, which shows archived campaigns alongside the active ones. It is tucked away, not gone: anyone who was in it can still open it from there.
- Becomes **read-only for everyone, including you**: the wiki, session notes, resources, and roster stay exactly as they were left. Pending invitations to it stop appearing in the invite banner.
- Stays **fully readable** - open it any time to reread notes.

Two things a player can always do, archived or not:

- **Leave the campaign** (**Leave campaign** on the campaign page). Archiving never traps anyone in a game they're done with. The GM removing *someone else* is still a roster edit, so that waits for an unarchive.
- **Export the wiki** (**Export** in the wiki sidebar, Markdown zip or JSON) - so anyone can take their own copy of a campaign with them, including when moving to another platform. A player's export contains exactly what they can see in the app: GM-only pages are left out and `||GM secrets||` are stripped. The GM's export is the complete wiki. Importing writes pages, so it stays GM-only and is unavailable while archived.

Archiving is reversible: **Unarchive** restores writes and puts it back in the normal list. Deleting an archived campaign still works if you want it gone for good.

When a GM invites you to a campaign, an **invite banner** appears at the top of the app so you can **accept** (join the campaign) or **decline** it from anywhere. You can dismiss the banner for the current browser session; it reappears the next time you open the app while an invite is still pending.

Campaign members can set a **character name** per campaign (editable by both the GM and the player), upload **character art** (shown as their avatar) and a **character sheet** (PDF or image). A player can also **create a sheet from a template** - duplicating a form-fillable PDF from the library's Character Sheets category (filtered to the campaign's system) or a campaign file - and **fill it in directly in the app**: the real PDF is rendered in the browser and the player types into the form fields on the page itself, then saves a filled copy. The same in-app editing works for any form-fillable PDF a player uploads, so sheets can be updated as characters advance. Sheets can be downloaded at any time, and re-uploading prompts a warning (with an option to download the current version first) before the previous one is replaced. Users can also set a **display name** in Account Settings that appears in place of their username across the app.

### Per-user campaign access

Each user has a **campaign access** toggle (admins manage it per user in **Settings → Users**; enabled by default). Disabling it does **not** delete any existing campaigns - it only:

- Prevents the user from creating campaigns, being added to new ones, and editing/linking resources.
- Keeps their read access to campaigns they already own or belong to; in member lists they are flagged as **Access disabled**.
- Locks any campaign they **own** to read-only for everyone (players keep view access, lose all edits) until the owner's access is restored.

When OIDC is configured, this flag can be driven by the provider's [permissions claim](#openid-connect) (`campaignAccess`); a missing key leaves access enabled.

### Guest invites

Guests let you share a single campaign with people who don't have full accounts - for example a player who's only joining one game. A guest is a code-only account: no password, no OIDC, and no access to the library, maps, tokens, audio, or search. They can only see the campaign they were invited to (and its shared resources, wiki, and schedule), and can edit only their **own** character name, character art, character sheet, session notes, and availability.

- **Enable it server-wide** in **Settings → Authentication → Guest Access**, or pin it with the `GUEST_ACCESS_ENABLED` environment variable. It's off by default.
- **Invite from a GM campaign** - open the members roster and use **Guests** (admins and GMs only). Add a guest with a nickname; each guest gets a unique 10-character invite code. A campaign can have multiple guests.
- **Share the code** with the built-in **Share** button: copy a ready-made message, copy a version for a Discord DM, or open a pre-filled email. The message includes a deep link (`/guest?code=…`) and the code itself.
- **Manage codes** - regenerate a guest's code (invalidating the old one) or remove the guest entirely (which deletes their guest account and contributions).
- **Guests log in** from the login screen via **Have an invite code?**, which works even on OIDC-only servers where password login is disabled. In the app a guest sees the nickname their GM gave them and a **GUEST** role.
- **Admin overview** - **Settings → Users** lists every guest account (grouped separately from full users) with its nickname, the campaign it's attached to, and who invited it. From there an admin can **convert a guest to a permanent user**: give it a username (and a password when password auth is enabled) and it keeps its campaign membership and character.

### Notes wiki

Each campaign has a full-page markdown **wiki** (opened from the campaign overview) for building out the world - a place for session recaps, lore, NPCs, and plans:

- **Markdown** with tables, images, and the usual formatting, edited side-by-side with a live preview.
- **Visibility per page** - *GM only*, *Public* (all members), or *Private* (specific members - e.g. a secret shared with one player). Change it straight from the visibility badge on the page: the badge is a dropdown, and for *Private* pages it lists members so you can grant or revoke access without opening the editor. In the sidebar tree, restricted pages (*GM only* / *Private*) carry a small lock-style glyph at the end of their row and read slightly dimmer; *Public* pages show their glyph on hover, and it's clickable to change the level without leaving the list. Visibility is never conveyed by colour alone.
- **Custom icons per entry** - give any page (or resource category) its own icon so a long sidebar is easy to scan. The picker is searchable - search by concept, not just name ("tree" finds the pine, "disguise" finds the mask) - and offers a **built-in** set of 200+ icons plus an **emoji** tab. Tint any icon with a preset colour or a custom hex value.
- **GM secrets inline** - wrap text in `||double pipes||` (or use the **GM secret** button) to hide just that span inside an otherwise shared page. The GM sees it highlighted; players never receive it - it's stripped on the server before the page is sent. (Personal campaigns keep everything, since only you can read them.)
- **Nested pages** - organize the sidebar as a tree: any page can hold subpages, to any depth (a "category" is just a page with children). Drag pages to re-nest them, add a subpage from the parent row, and collapse/expand branches. Deleting a page lifts its subpages up to the parent rather than removing them.
- **Page links** - write `[[Page Title]]` to link pages; missing targets are auto-created as stubs, and each page shows what links back to it. Type `[[` and a **suggestion list** appears, matching page titles as you type (on any word, so `[[gob` finds *Boblin the Goblin*) - pick with the arrow keys and Enter. Links follow their target: **renaming** a page updates the links pointing at it instead of leaving them dangling, and where two pages share a title the suggestions show each one's parent page in brackets - *Ancient Ruins (Northlands)* vs *Ancient Ruins (Southmarch)* - and add a hidden id (`[[Page Title:id-…]]`) so you always link the one you picked.
- **Link to a heading** - suggestions include the headings inside each page, so you can point at a specific section: `[[Bestiary:#Goblins]]` opens *Bestiary* scrolled to its *Goblins* heading. Titles containing a colon (`[[Ancient Ruins: The Depths]]`) and headings starting with `#` (`[[Prices:## of coin]]` for a `# # of coin` heading) work without escaping.
- **Grimoire embeds** - drop a book (optionally at a page), map, token, audio track (plays in the global player; a note with several can be played as a playlist via "Play all"), or campaign file straight into a page. The embed picker lists the campaign's **linked resources** (link new library content in the Resources panel first). You can also **upload an image** right from the picker - it's embedded inline and added to your linked resources, filed under an existing category or a new one you name on the spot (e.g. *NPC art*).
- **Import & export** (GM only) - export the whole wiki as a Markdown `.zip` (one file per page with YAML frontmatter - an Obsidian-style vault) or a JSON bundle, and import pages from Markdown, a Grimoire JSON bundle, or a **LegendKeeper** export (`.json`, `.lk`, or `.zip` - both the per-page export and the current `{version, resources}` bundle). LegendKeeper HTML and ProseMirror page bodies are converted to Markdown and the page hierarchy is preserved; LegendKeeper-only block types (e.g. secrets, embeds) are dropped, matching LegendKeeper's own export caveats. Imports are non-destructive - pages are always added, never overwritten.

- **Note templates** (GM only) - **Templates** in the wiki sidebar starts a page from a template instead of a blank one. Templates belong to the campaign and arrive three ways: **downloaded** from a community catalogue (browsed as a collapsible folder tree - Generic first, then a folder per game system, with the campaign's own system opened for you), **written** in the app, or **uploaded** as a `.md` file or a `.zip`. Each is a working copy, so editing a downloaded template never touches another campaign's. Any template **exports** as a `.zip` in the community repo's folder layout, ready to contribute back or keep in your own fork - and that same `.zip` uploads straight back in, so export/upload doubles as copying a template between campaigns. Downloading obeys `WIKI_TEMPLATES_DOWNLOAD_DISABLED` - with it set, browsing is off but authoring and upload still work, so you can hand-copy a `.md` from the repo. Picking a template opens an unsaved page editor rather than creating the page, so a mis-click costs a cancel instead of a delete; like every other wiki import it is non-destructive. See [`docs/wiki-templates.md`](docs/wiki-templates.md)

Existing session notes are automatically rolled into wiki pages (nested under a "Session Notes" page) the first time the new version starts; empty notes are discarded.

**Resources** - link books, maps, tokens, and audio, or upload campaign files (handouts, images, etc.) the GM keeps with the campaign. Each resource has a visibility: **Public** (all players), **Private** (shared with specific players - e.g. a handout for 2 of 4), or **GM only**. Resources group under their type by default, but the GM can create custom categories (e.g. *Player Handouts*), drag items between categories and reorder them, and delete categories (keeping items uncategorized or unlinking them). Each group can be **collapsed or expanded** (remembered per campaign), and the GM can **reorder all the groups** - custom categories and the built-in Books / Maps / Tokens / Audio / Files groups together - from the category manager.

Uploaded campaign files live in the data directory, separate from the library. Admins can disable these uploads app-wide or cap them by per-file and per-campaign size in **Settings → App** (admins themselves are exempt).

### Session scheduling

GM campaigns support recurring session schedules:

- **Weekly** - same day(s) every week
- **Biweekly** - every other week (anchored to a reference date)
- **Monthly** - nth weekday of the month (e.g. "first Friday")
- **Custom** - explicit list of dates

Session note stubs are auto-created the day before each scheduled session. Players can mark their availability for upcoming dates, and the GM can cancel individual dates.

---

## OpenID Connect

Grimoire supports authentication via any OpenID Connect–compliant identity provider (Keycloak, Authentik, Authelia, Auth0, Okta, etc.). This lets you delegate sign-in to your existing IdP and optionally auto-create accounts for new users.

### Configure

Open **Settings → Authentication** as an admin:

1. Set the **Issuer URL** (e.g. `https://idp.example.com/realms/main`) and click **Autopopulate** - the server fetches the IdP's `.well-known/openid-configuration` and fills in the endpoint URLs. You can also paste the full discovery document URL directly (e.g. `https://idp.example.com/realms/main/.well-known/openid-configuration`).
2. Paste the **Client ID** and **Client Secret** issued by your IdP.
3. Register the displayed **Redirect URI** with your IdP. The path is fixed - set `BASE_URL` so the host portion reflects your public origin:
   ```
   https://<your.server.com>/api/auth/openid/callback
   ```
4. Enable **OpenID Connect**.
5. (Optional) Configure:
 - **Token Issuer** - the exact `iss` value your IdP puts in tokens. Leave blank to auto-detect from the discovery document. Set this explicitly if auto-detection fails or if your IdP's issuer differs from the Issuer URL (e.g. Authentik application providers). Can also be set via `OIDC_TOKEN_ISSUER`.
 - **Groups Claim** - name of the OIDC claim that contains the user's groups. When set, roles are assigned from groups named (case-insensitively) `admin`, `gm`, or `player`. Highest level wins; users without any matching group are denied access.
 - **Advanced Permissions Claim** - name of the OIDC claim containing a permissions object for non-admin users. Supports `{viewNSFW: bool, campaignAccess: bool}`. A missing `viewNSFW` key defaults to `false`; a missing `campaignAccess` key leaves [campaign access](#per-user-campaign-access) enabled. If the entire claim is missing, access is denied.
 - **Match Existing Users By** - link an existing local account to the OIDC subject by email or username on first login. Subsequent logins always match by stable subject claim.
 - **Auto-launch** - automatically redirect to the IdP when visiting `/login`. Append `?autoLaunch=0` to bypass.
 - **Auto-register** - automatically create local accounts on first OIDC login.

Any field can also be pinned via an environment variable (see the table above). Pinned fields are shown read-only in the admin UI.

### Notes

- First-run setup always uses username + password. The OIDC button only appears after the IdP is fully configured.
- Logging out via the in-app menu suppresses the next auto-launch (so you don't bounce straight back to the IdP).
- The login button text is configurable per deployment (e.g. "Sign in with Acme SSO").

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

OPDS access is per-user. Each user generates their own opaque feed URL in **Settings → Account → OPDS Feed**. The URL contains a long random token - no username or password is needed by the OPDS client.

Guest accounts are campaign-scoped and do not get an OPDS feed: OPDS reports as unavailable for them, they cannot generate a token, and the feed rejects any token belonging to a guest.

- **Enable** - generates a unique feed URL
- **Copy** - copies the URL to the clipboard
- **Regenerate** - issues a new token; the old URL stops working immediately
- **Disable** - revokes the token; the feed URL stops working immediately

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
| `http://localhost:9481/api/docs` | Swagger UI - interactive docs |
| `http://localhost:9481/api/redoc` | ReDoc - readable reference |
| `http://localhost:9481/api/openapi.json` | Raw OpenAPI schema |

For contributors, [docs/architecture.md](docs/architecture.md) is a developer-facing architecture reference - module map, request lifecycle, auth/OIDC flow, and startup migrations. For the database schema - an ER diagram and a table-by-table reference of the models and their foreign keys - see [docs/data-model.md](docs/data-model.md).

---

## FAQ

Common questions and troubleshooting tips are in [docs/faq.md](docs/faq.md).

---

## Contributing

Grimoire is open source and contributions are welcome - bug reports, feature ideas, docs, and code.

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for full details on reporting issues, submitting pull requests, and setting up a local development environment.

To report a security vulnerability privately, see [SECURITY.md](.github/SECURITY.md).

---

## License

GNU General Public License v3.0 - see [LICENSE](LICENSE) for details.
