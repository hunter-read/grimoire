# Grimoire - Nightly Documentation

> **This documents the `nightly` image, not a release.**
>
> It describes what is on `main` right now, including features and configuration
> that are not in any published version yet. If you are running a release tag
> (`latest`, `1.5.6`, …), read [README.md](README.md)
> instead - anything here may not exist in your build.
>
> Running `nightly` and puzzled by a new setting? This is the page that explains it.

<!--
  MAINTAINER NOTE - how this file works
  ------------------------------------
  This is a full mirror of README.md, kept one step ahead of it.

  * When a change lands that needs user-facing docs, edit THIS file in the same
    PR, while the detail is fresh. Do not edit README.md.
  * README.md stays frozen at the last release, so the repo front page never
    documents something users cannot pull yet.
  * At release: copy everything below the marker line over README.md and restore
    README's centered header block (logo + badges). This file lives beside
    README.md at the repo root, so relative links carry over untouched. It then
    stays as-is and becomes the working copy for the next cycle. See
    docs/pipelines.md for the full release checklist.
-->

<!-- BEGIN MIRRORED CONTENT -->

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
- **Community Add-ons** - Install metadata scrapers contributed by the community to fill in game system and book details from external sources (TTRPG Wiki for systems, DriveThruRPG for books). Open a system or book, hit **Fetch metadata**, pick a match, and review a field-by-field diff before anything is written - values you have already set are never pre-selected. Definitions live in the separate [community-add-ons](https://github.com/grimoire-codex/community-add-ons) repo, so a source that changes can be fixed without waiting for a Grimoire release. Manage and update them in **Settings → Add-ons**, where each add-on shows a "by <author>" credit for whoever wrote it; see [`docs/addons.md`](docs/addons.md)
- **Themes & Light Mode** - Choose light, dark, or system (which follows your OS) in **Settings → Account → Appearance**. Beyond the built-in palettes you can install colour themes: browse the community catalogue, or paste a theme's JSON to install it directly. Themes are **per user** - one is installed into your own account and changes nothing for anyone else, so no admin approval is involved. A theme can pair a light and a dark palette, so it shows as one entry and **System** switches between them with your OS. The catalogue ships **High Contrast**, which does exactly that with every text-on-background pairing at WCAG AAA; it raises luminance contrast only and does not address colourblindness. See [`docs/themes.md`](docs/themes.md)
- **Wiki Note Templates** - Start a campaign wiki page from a template instead of a blank note. Browse a community catalogue as a folder tree (Generic, Draw Steel, Dungeons & Dragons 5e, …) and download copies into your campaign, write your own, or upload a Markdown file or template `.zip`. Templates belong to the campaign, so you can edit a downloaded one freely; any template exports as a ready-to-contribute folder that uploads straight back in. Downloading can be turned off with `DISABLE_EXTERNAL_ADD_ON_INSTALL` while authoring and upload keep working; see [`docs/wiki-templates.md`](docs/wiki-templates.md)
- **Sort & Filter** - Sort systems by name, book count, total page count, or year, and books by title, page count, or year. A shared filter modal covers genre, system family, parent system, edition, dice/materials, tags, favourites, and explicit content. Named filter presets are saved to your account (server-side, so they follow you across devices), and one preset per view can be set as the default you land on. The default applies every time you arrive at a view fresh - from anywhere else in the app, or on a reload. The one exception is the in-app back button: if you change the filters, open an item, and come back, you land on what you were looking at rather than having the default reapplied over it. Sort, filters, saved presets, multi-select, and the view switcher share a single toolbar row that stays pinned to the top of the page as you scroll, so bulk-selecting entries near the bottom of a long library no longer means scrolling back up
- **Bulk Actions** - Multi-select books, maps, tokens, and audio (click, shift-click for a range, ⌘/Ctrl-click to toggle) then bulk tag, add to a campaign, or edit metadata via a carousel. An "apply to all" button opens a checklist of fields to copy from the item you are on to the whole selection - tick Category and every selected book moves at once - and books and systems can pull metadata from an installed add-on without leaving the carousel. A single book can be added to a campaign without multi-select from its actions menu (**⋮**)
- **Duplicate Detection & Versions** - Find files that are copies of one another, then decide what happens to them. An admin-triggered scan on its own full page (**Settings → Maintenance → Open duplicate detection**) matches byte-identical files, near-identical titles, overlapping page text (so a book scanned twice is caught even though its bytes differ), and gridded/gridless map pairs, labelling each group with why it was flagged and how confident it is. Nothing is ever deleted automatically. Results are reviewed two copies at a time, side by side, so one odd file in a cluster of five can be separated out on its own: per pair you can collapse them into one entry and say what kind of variant the other copy is, copy metadata from the better record onto the one you are keeping, delete a copy, or mark the pair as "not duplicates" - which sticks across every future scan
- **Campaigns** - Track GM-run and personal campaigns; a markdown notes wiki with deep linking, Markdown/JSON/LegendKeeper import & export, character art and sheets, linked resources, and scheduling
- **Book Restrictions** - Keep the adventure module your players are inside out of their hands. Restrict a single book, a whole system, or an entire category to *GMs and admins* or *admins only*, set by admins in the book/system editors, in bulk edit, or in **Settings → Application**. Restricted content is hidden outright - from the library, search, downloads, favourites, and OPDS - rather than shown behind a padlock, since the title and cover are the spoiler. Settings cascade book → system → category, so one free player's guide can stay visible inside an otherwise restricted line, and individual GMs can be granted access to just their own campaign's material. See [Restricting books](#restricting-books)
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

Copy the default compose file, set your volume paths, then start:

```bash
cp docs/docker/docker-compose.yml docker-compose.yml
# Edit docker-compose.yml and set the volume paths
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
    volumes:
 - /path/to/your/library:/app/library   # add ":ro" to keep it read-only (see Volumes)
 - /path/to/grimoire/data:/app/data
```

### 5. Example compose files

Ready-to-use compose files for common setups are in [`docs/docker/`](docs/docker/):

| File | What it runs |
|---|---|
| [`docs/docker/docker-compose.yml`](docs/docker/docker-compose.yml) | Grimoire (default, no extras) |
| [`docs/docker/docker-compose.valkey.yml`](docs/docker/docker-compose.valkey.yml) | Grimoire + Valkey page cache (recommended for large libraries) |
| [`docs/docker/docker-compose.calibre.yml`](docs/docker/docker-compose.calibre.yml) | Grimoire + Calibre full desktop (metadata editing, OPF export) |
| [`docs/docker/docker-compose.calibre-web.yml`](docs/docker/docker-compose.calibre-web.yml) | Grimoire + Calibre-Web (lightweight Calibre browser UI) |

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
> **Prefer to organize categories yourself?** Turn folder-name inference off in **Settings → Application → Folder Category Inference** (or pin it with the `DISABLE_FOLDER_CATEGORY_INFERENCE` env var); books then fall back to the `uncategorized` category. To disable inference for a single system only, drop an empty `.no-auto-category` file at that system's folder root.
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

#### Book formats

Grimoire indexes more than PDFs. Every format below appears in the library, gets a cover thumbnail where one can be produced, and has its text added to the full-text search index:

| Format | Extensions | Reader | Full-text search | Thumbnail |
|---|---|---|---|---|
| PDF | `.pdf` | Rendered pages | Yes (text layer or OCR) | Yes |
| E-book | `.epub` | Rendered pages | Yes | Yes |
| Scanned document | `.djvu` | Rendered pages | Yes | Yes |
| Comic archive | `.cbz`, `.cbr`, `.cb7`, `.cbt` | Page images from the archive | No (images only) | Yes |
| Plain text | `.txt`, `.md`, `.rtf` | Formatted text | Yes | No |
| Image | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.tiff`, `.svg` | Single image | No | Yes |

A few notes:

- **EPUB is reflowable**, so it has no fixed page count of its own. Grimoire lays every EPUB out at one fixed page size, which keeps page numbers stable: a search result for page 12 always opens the same page 12 you would see while reading.
- **Text files are paginated** into fixed-size pages, split at paragraph boundaries so a page break never lands mid-sentence. Markdown keeps its source markers (`#`, `*`) rather than being rendered as HTML, so searching for a heading finds what you typed.
- **`.rtf` files are unwrapped to plain text**; formatting is not preserved. Older files saved in a legacy Windows encoding are decoded correctly.
- **Comic archives have no text layer**, so they are readable but not searchable.

If you have EPUB or DjVu books that were added by an earlier version, a rescan backfills their thumbnails, page counts, and search index - you do not need to re-add them.

#### Archive files

Archive files placed anywhere under `books/` are shown alongside your books in their category - handy for bundling a set of related files (a maps pack, a COMP/CON export, loose handouts) next to the book they belong to. Recognized extensions:

| Type | Extensions |
|---|---|
| Zip | `.zip`, `.cbz` |
| RAR | `.rar`, `.cbr` |
| 7-Zip | `.7z`, `.cb7` |
| Tar | `.tar`, `.cbt`, `.tar.gz`, `.tgz`, `.tar.bz2`, `.tbz2` |

Ordinary archives are treated as opaque downloads - Grimoire does not extract or read their contents, so clicking one downloads the file rather than opening the reader. They're also included when you download a whole system, category, or subfolder as an archive.

Comic-book archives (`.cbz`, `.cbr`, `.cb7`, `.cbt`) are the exception: they open in the reader and page through the images inside them, and they get a cover thumbnail from the first page. Pages are ordered by filename, which is the convention comic archives are built on (`page01.jpg`, `page02.jpg`, ...); macOS resource-fork entries and hidden files are skipped. Only the page you are looking at is decompressed, so a large collection doesn't have to be unpacked to read one issue.

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

If you'd rather not use one of the recognized names, drop a `.system-agnostic-container` marker file in any folder and it becomes the system-agnostic collection instead. The marker only changes *which* folder is the collection - the shape stays the same, so its subfolders are still category headings rather than systems, and the library counts the books inside it. There can only be one system-agnostic collection, so Grimoire refuses a second folder claiming it.

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

The system-agnostic marker (`.system-agnostic-container`, or a `(system-agnostic)` suffix) is listed with these for consistency, but it is not a shelf of systems: it names the special collection described above, whose subfolders stay categories.

If a folder somehow carries more than one declaration, the most specific kind wins, in this order: **parent system → one-page → system agnostic → system family → publisher → generic**. Every recognized suffix is stripped from the stored name either way, so a stray `(publisher)` never shows up in the UI.

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

Or set one from the container's page (**Cover image**, GM/admin only) - upload a file, paste an image from your clipboard, or pick one Grimoire already has (see [Setting images](#setting-images)). A `cover.*`/`folder.*` file in the library folder takes precedence over an upload, and both beat the book thumbnail an ordinary system falls back to. This works for any system, not just containers. A `cover.*`/`folder.*` image at a system's folder root is artwork only - it is not also indexed as a book.

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
those characters when deriving the system name (only the leading run - internal
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
| `dc:identifier` with `opf:scheme="ISBN"` | ISBN (hyphens stripped, check digit validated) |
| `guide/reference[@type='cover']` | Cover image (file is excluded from the book list) |

`dc:contributor` entries (e.g. Calibre's own tool credit) are intentionally ignored, as are `dc:identifier` elements without `opf:scheme="ISBN"` — that filter is what keeps Calibre's internal UUIDs out of the ISBN field while letting a real ISBN (including one Grimoire's own [sidecar export](docs/sidecars.md) wrote) come back in. An ISBN whose check digit does not validate is dropped rather than stored. `dc:language` is parsed but not stored (no matching field).

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

### Writing metadata back out (sidecar export)

The reverse of the above: Grimoire can write its metadata *out* as sidecar files next to your content, so the library folder describes itself. Copy the library to another machine, or rebuild the container with a fresh `DATA_PATH`, and the metadata travels with the files instead of living only in the app database. Other tools can read it too - Calibre, Jellyfin, Kodi, or a plain file manager.

**This is off by default.** Grimoire is otherwise a read-only viewer of your library, so writing into it is a deliberate opt-in.

Four formats, and you can enable any combination:

| Format | File written | Read by |
|--------|--------------|---------|
| OPF | `<book>.opf` | Calibre - and Grimoire itself, so it round-trips |
| NFO | `<book>.nfo` | Jellyfin, Kodi, Emby |
| JSON | `<book>.grimoire.json` | Grimoire-native; **lossless** |
| YAML | `<book>.grimoire.yaml` | Grimoire-native; **lossless**, and the easiest to read or edit by hand |

OPF and NFO can only hold the fields their formats define, so anything without a slot is dropped. Enable JSON or YAML if you want a complete metadata backup rather than a feed for another app. Those two hold exactly the same fields and differ only in syntax, so there is little reason to enable both: pick YAML if you will read or edit the file yourself, JSON if a script will parse it. Optionally a cover image is written alongside as `<book>.cover.jpg`.

Turn it on in **Settings → Maintenance → Metadata Sidecars**: tick the formats you want and save.

Three things trigger a write. The **Export Metadata To Library** button in that same section backfills the library, writing only the sidecars that are **missing** - so it is safe to re-run and will not overwrite one you have edited by hand. After that, any new book a library scan picks up gets its sidecars written automatically, and editing a book's metadata in the UI **updates the sidecars it already has** - creating none, so a library you have never backfilled never sprouts new files just because you renamed something.

Grimoire only overwrites files it wrote: every exported sidecar carries a marker, and a `.opf` you maintain in Calibre is left alone and reported as skipped unless you explicitly allow overwriting.

Sidecars are hidden in the **File Manager** - they describe your content rather than being content, and a book with four sidecars and a cover would otherwise show as six rows. They still travel with the file they belong to: move a book and its sidecars move too, rename it and they are renamed to match. A sidecar whose book no longer exists stays visible, so nothing vanishes with no way to reach it.

> Sidecar export writes into your library folder, so it needs the library mounted **writable** - the default. If you have mounted it `:ro`, export reports that clearly and your metadata edits keep working; only the sidecar write is skipped. See [Read-only or writable?](#read-only-or-writable).

Exported sidecars and covers are created with the container's `UMASK` applied, exactly like an uploaded file - with the default `022` that means `rw-r--r--`, readable by other users and other tools sharing the volume. Set `UMASK` on the container if your setup needs something different (Unraid users typically want `000` to get `rw-rw-rw-`).

See [`docs/sidecars.md`](docs/sidecars.md) for the full field mapping per format and how export precedence pairs with the refresh modes above.

### Maps - organize by creator or collection

```
maps/
└── Creator Name/
    └── map-file.png
```

The folder name is shown as a group header in the map gallery. Both image maps and PDF maps (including multi-page PDFs) are supported and viewable in-app.

Animated maps (`.webm`, `.mp4`) and Universal VTT exports (`.uvtt`, `.dd2vtt`) are also registered so they stay visible and downloadable alongside the stills they belong to - publishers commonly ship a looping video and a VTT data file next to each still variant. Like archives, they are opaque: no thumbnail is generated, since there is no still frame to render without a video decoder.

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
tags it lists - it never removes tags you set (or removed) in the web UI, and it
never overwrites a tag's display name once the tag exists. A new tag is created
using the casing in the file; renaming a tag later in the web UI sticks, because
the display name lives in the app's tag catalog rather than in `tags.json` (which
the app treats as read-only and never rewrites). Tags are matched
case-insensitively, so `"dungeon"` and `"Dungeon"` are the same tag.

---

## Ignoring Files with .grimoireignore

Add a `.grimoireignore` file to keep files on disk but out of Grimoire. It uses the same syntax as `.gitignore` / `.dockerignore`, so anything matched by a rule is skipped during scanning and never appears in the UI - useful when a book ships extra print variants (black-and-white single pages, zine-sized layouts) you want kept next to the book but hidden.

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

### In-app file management

Admins can reorganize the library from inside Grimoire - **Settings → Maintenance
→ Open file manager**. It is a folder tree (think Finder or Explorer, but aware
of Grimoire's own concepts) built for bulk reorganization:

- **Expand folders in place** to see a file and its destination at once, instead
  of navigating away from one to reach the other.
- **Move** files and folders by dragging them onto any folder. Collapsed folders
  spring open when you hold a drag over them, and the list auto-scrolls near its
  edges. Ctrl/Cmd-click to select several at once.
- **Pin a second pane** to the right, left, above, or below when the two ends of a
  move are far apart. Either pane can be closed to go back to one.
- **Rename** a file or folder on disk. This is distinct from editing an item's
  display title, which only changes the name shown in Grimoire. The file
  extension is held aside and reattached on save - Grimoire infers a file's type
  from its suffix, so a mistyped `.pdf` would quietly drop a book out of the
  library.
- **Remove** a file or folder, in one of two ways chosen in the same dialog.
  - **Remove from library** (the default) takes the item out of Grimoire but
    **leaves the file on disk**. Its tags, favorites, bookmarks, reading
    progress, and campaign links go, but a rescan puts the item back unless it is
    gone from disk or newly excluded. That makes it the tidy-up for two everyday
    cases: clearing something you have just excluded with a
    [`.grimoireignore`](#ignoring-files-with-grimoireignore) rule, and dropping a
    single stale entry whose file you deleted outside Grimoire - neither of which
    should require a full database cleanup. It also works on a read-only library,
    where nothing can be deleted anyway.
  - **Also delete the files from disk** - tick the box in the dialog - makes it
    permanent. The file is removed from disk, not moved to a trash folder, and
    cannot be recovered. The dialog changes with the box: the wording and the
    button switch to the permanent version, so the red **Delete permanently**
    button always means the same thing.

  The box is unticked when the dialog opens, so the destructive option is always
  one you chose rather than one you defaulted into. When it *is* ticked the
  confirmation matches the stakes - a file, or a folder holding nothing but empty
  folders, deletes after a plain confirm, while **a folder that still holds files
  makes you type its name** first. The name is shown ready to copy, since the
  point is to make you look at *which* folder you are about to lose, not to test
  your typing. Removing from the library needs no typed name: a rescan undoes it.
- **Upload files and folders** by dragging them in from your desktop, or via
  right-click → **Upload files… / Upload a folder…**. A panel tracks each file's
  progress, names any that fail and why, and lets you retry them individually or
  all at once - a failure part-way through a large import never costs you the
  files that already succeeded.
- **Preview an item** without leaving the tree - right-click → **Preview…** opens
  a book's rendered pages (arrow keys or the pager move between them), a map or
  token image, or an audio player. It answers "which file is this?" in place,
  rather than sending you to the reader and losing your spot in the tree.
- **Download a folder** - right-click any folder → **Download folder…** and pick
  ZIP, TAR, TAR.GZ, or TAR.BZ2, the same picker the library and gallery pages
  use. Unlike those, this archives the folder *as it sits on disk*: every file
  underneath it, in its existing subfolder structure, including loose files
  Grimoire never indexed. That is usually the point of asking from here - you are
  looking at the real folder, so you get the real folder. Very large folders are
  refused rather than started and stalled; download a subfolder instead.
- **Edit an item's metadata** with the same editor the library views use.
- **Create folders**, including system, category, and container folders. Choosing
  a container type writes the right marker file for you, so you no longer have to
  remember `.parent-system-container` and create it by hand. Use the **New folder**
  button beside *Up* to create one in the folder you are currently viewing - handy
  in an empty folder, where there is no row to right-click.
- **Set up a system in one step** with **Create standard category folders** -
  Core, Supplements, Adventures, Character Sheets, Maps, Handouts, Homebrew, and
  Starter Sets, named so the scanner classifies them correctly.
- **Mark a folder NSFW or SFW**, or change its container type, without recreating
  it. The *One-page RPGs* and *System-agnostic* collections are one-of-a-kind:
  once a folder claims one, it is not offered on any other folder.
- **Rescan** from here too: the **Rescan** button beside *Refresh* re-indexes the
  whole library, and right-click → **Rescan this…** re-indexes just that folder or
  file. *Refresh* only re-reads the folder listing; a rescan updates what Grimoire
  has indexed, which is what you want after editing files with another tool.

Moves and renames **keep your metadata**. Grimoire relinks the existing record
rather than treating the file as new, so tags, favorites, reading progress,
bookmarks, campaign links, and the search index all follow the file to its new
home - and a book moved to a different system or category is re-filed
automatically.

> **This requires a writable library mount** - the default. If you have appended
> `:ro` to your library volume, drop it to use the file manager. With a read-only
> mount, Grimoire tells you the library is read-only instead of failing oddly, and
> everything else keeps working exactly as before. See
> [Read-only or writable?](#read-only-or-writable).

The file manager is admin-only, and all destinations are confined to the library
root.

#### File actions from anywhere

Move, rename, and delete are also on the **⋮ menu of a book itself** - in the
library views and in the reader - so a single file does not need a trip to the
file manager. They sit at the bottom of the menu behind a divider, apart from the
everyday items, and behave exactly as they do in the file manager: the same
metadata-preserving move, the same typed-name guard on a folder with content.

Moving from here opens a small folder picker rather than asking you to drag - the
file manager can show both ends of a move at once, and a book's own page cannot.

These actions appear only for **admins on a writable library**. On a read-only
mount they are not shown at all, rather than being offered and then failing.

#### Changing a category moves the book

Editing a book's **category** now moves the file into the matching folder -
change a book from *Core* to *Character Sheets* and it moves into that folder,
which is created if it does not exist yet. Grimoire re-reads your folders on every
rescan, so a category recorded without moving the file would be silently undone
by the next scan.

An existing folder wins over a new one: if your core books live in a folder called
*Rulebooks*, a book re-categorised as *core* joins them instead of a second *Core*
folder appearing beside it.

On a read-only library the category is saved and nothing moves - no error, no
failed edit.

### Adding files from outside Grimoire

Nothing stops you adding or reorganizing files by other means - your OS file
manager, `scp`, a network share, or a companion container. This is also how you
work if you keep the library mounted read-only.

**[Calibre](docs/file-management.md#calibre)** remains a genuine companion for
ebook conversion and bulk metadata editing across a large collection, and
Grimoire reads the `.opf` sidecar files it writes ([see OPF
support](#book-metadata-from-opf-files)). See
[docs/file-management.md](docs/file-management.md) for a Docker Compose example.

After adding files with an external tool, trigger a **Rescan** in Grimoire
(sidebar or Settings → Maintenance) to index the new content. Changes made in the
built-in file manager apply immediately and need no rescan.

### Replacing and moving files

A rescan compares each file's modification time and size against what it recorded last time, and only re-reads a file when one of them changed. Unchanged files cost nothing, so a scheduled rescan of a large library stays fast.

- **Replacing a book in place** (same filename, e.g. swapping in a higher-quality scan) is detected on the next rescan. The page count, cover, and search text are rebuilt, and everything cached from the old file is discarded. Tags, favorites, bookmarks, and reading progress are kept.
- **Moving or renaming a file** is recognised as the same book rather than a deletion plus a new addition, so it keeps its tags, favorites, bookmarks, and reading progress. Grimoire matches on file contents. Byte-for-byte identical copies are handled conservatively: moving one of them is still recognised, but if several identical files move at once there is no way to tell which became which, so they are reported as missing entries plus new ones rather than being paired off by guesswork.
- **A move across systems re-derives the metadata the folders imply.** Dragging a book from `Dungeons & Dragons/3e/unsorted/` to `Dungeons & Dragons/5e/adventures/Curse of Strahd/` updates its system, edition, and category to match where it now lives - while still keeping everything attached to the book. Attribution that came from a container (a publisher or family shelf) is dropped when the book moves out from under it, and picked up when it moves in.

### Duplicates and multiple versions

Libraries accumulate copies: the same book bought in a bundle and standalone, `Book.pdf` beside `Book (1).pdf`, a PDF and a CBZ of one scan. They also accumulate *deliberate* near-copies, which are not the same problem: a printer-friendly cut next to the screen edition, a form-fillable character sheet, a gridless battle map, a v1.0.0 superseded by a v1.0.1 with errata.

**Finding them.** **Settings → Maintenance → Open duplicate detection** opens a full page (like the file manager - reviewing copies wants the whole width, and it keeps the delete and merge actions off the settings tab) where a scan runs on demand - never as part of a normal rescan, since hashing a large library is expensive - with live progress and a stop button.

**Search accuracy** picks how hard to look, from **Exact** to **Low**. Exact compares file contents only: it is the fastest option and never reports a false positive, but it misses a book scanned twice. The looser levels progressively widen the net to similar titles and overlapping text, take longer, and return matches you will need to judge. **Medium** is the usual choice.

Files in *different game systems* are treated with suspicion: a shared title there is discounted rather than trusted, and ignored entirely when either file is under 10 pages. `Character Sheet.pdf` exists once per system and those are not copies of each other. Files with no system set - most maps and tokens - are unaffected, and byte-identical files still match wherever they are filed, because the same bytes are the same file.

It uses several signals, and each match tells you which one fired and how confident it is:

| Reason | What it means |
|--------|---------------|
| `identical files` | Byte-for-byte the same. Certain. |
| `similar title` | Titles and authors line up after ignoring version and format markers - catches `book.pdf` beside `book_v2.pdf`. |
| `similar contents` | The extracted page text overlaps heavily. This is what catches the same book scanned twice, where the bytes and even the filenames differ. |
| `gridded / gridless pair` | Two maps whose names differ only by a grid marker, at comparable file sizes. |

**Nothing is ever deleted automatically, and there is no setting that changes that.** These are irreplaceable purchased files, and a false positive is unrecoverable. The scan only ever surfaces candidates.

**Reviewing in pairs.** Results are listed two copies at a time, not as one card per cluster. Five look-alikes on a single card is more than anyone can judge at once, and a single verdict over five files cannot say "these four match but that fifth is a different book". Each pair carries its own verdict, so rejecting one leaves the rest standing.

The pairs shown are the comparisons that actually matched, not every combination. That matters when one file resembles several others: if D looks like A, B, and C while the real duplicate is A and B, all four end up in one cluster - but you are shown A-B and D-C, rather than D measured against everything in turn.

**Comparing them.** **Compare** opens the two copies side by side at full size: pages, sizes, counts, and a field-by-field diff with the differences sorted to the top. For books the **‹ ›** buttons between the two pages flip both at once, bounded by the shorter of the two - page 40 next to page 40 is what reveals a reprint's shifted pagination. Alongside sits the part that usually decides it: how much of *your* work is attached to each copy - bookmarks, favourites, tags, and campaign links. Then you can:

- **Copy metadata** - move individual fields from the copy you are discarding onto the one you are keeping, before it goes. Keeping the better *file* should not mean keeping the worse *record*: a pristine scan often arrives with nothing but a filename while the copy you are about to delete has the title, publisher, and tags you curated. Only fields that actually differ are offered, and you tick them individually rather than copying wholesale.

- **Link as versions** - collapse the two into one library entry. A radio button on each copy picks the main version, and a dropdown says what the other one *is*: a version, printer friendly, form fillable, black and white, spreads, single pages, gridded, gridless, or other - plus an optional free-text label like `v1.0.1`. The variant stops appearing separately in browsing, search, and counts.
- **Delete a copy** - asks for confirmation in a dialog, and removes the file from disk by default. That default is the opposite of elsewhere in Grimoire, deliberately: you have just decided this copy is redundant, and leaving the bytes in the library folder means the next scan proposes the same pair all over again. Untick the box to drop only the library record.
- **Not duplicates** - dismisses that pair. It disappears from the list straight away rather than lingering until the next scan, and it stays gone: the rejection is remembered per pair and survives every future rescan, including when a third copy of the same book turns up later and would otherwise drag the rejected pair back into a cluster with it. Dismissals are not final, though - **Show dismissed** at the foot of the duplicates page lists everything you have rejected, with a **Restore** button on each. Restoring one lets it be proposed again by the next scan (the list on screen was built while the dismissal still applied, so it does not reappear until you rescan).

**Changing your mind about the main version.** Say you file the printable cut under the form-fillable one, then meet a lined edition you consider the real original. Choosing the lined copy as the main version moves the *whole family* across in one step - the form-fillable becomes a variant of it, and anything already filed under the form-fillable re-homes onto the new main version rather than being stranded. The page says how many versions will move before you commit.

**Living with versions.** An entry that has other versions carries a badge. Books get a **Switch version** entry in the ⋮ menu, both in the library and while reading - switching in the reader keeps your page, so moving between a spreads cut and a single-page cut lands you in the same place. Maps, tokens, and audio get a dropdown on their detail page.

Versions are only ever one level deep: a version cannot itself have versions. Deleting the main entry asks which version should replace it, or promotes them all - a version is a real file you own, so it is never left hidden behind a record that no longer exists.

Two things worth knowing. Bulk downloads and the OPDS feed deliberately include every version, because an archive or a catalogue should be complete. And text that exists *only* in a hidden version - errata added in a v1.0.1 - will not turn up in global search; searching inside that specific version still works.

### Systems whose folder disappears

When a system's folder is deleted - or newly excluded by a [`.grimoireignore`](#ignoring-files-with-grimoireignore) rule - the system itself is now removed on the next rescan, instead of lingering in the library with nothing behind it. This is what cleans up a stray `@eaDir` entry after you add a rule for it on a Synology NAS.

Removal is deliberately cautious. A system is kept if it still holds any book that is present on disk, if it is the parent of a system that does, or if you have adapted it yourself by renaming it or giving it a description or cover. Scoped rescans (a single folder) never remove systems, since they only look at one corner of the library.

### Interrupted scans

Cancelling a scan (or restarting the server mid-scan) no longer leaves a partly-populated shelf. Every system folder is registered before any book is indexed, so a container's editions all appear as soon as the folder is walked, however early the scan stops - you may be missing *books* until the next full rescan, but never whole systems. Nothing is removed by an interrupted scan either.

---

## Configuration

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | auto-generated | JWT signing secret. Leave unset and Grimoire generates a random key on first boot and persists it at `DATA_PATH/secret_key`, reusing it across restarts. Set it explicitly (`openssl rand -hex 32`) if you run multiple replicas that don't share `DATA_PATH`. Grimoire refuses to start if it's set to a placeholder published in these docs (`change-me`, `replace-this-with-a-long-random-string`, `grimoire-dev-secret-change-in-production`) - see the [FAQ](docs/faq.md#grimoire-wont-start-and-the-log-mentions-secret_key). |
| `WORKERS` | `2` | Number of uvicorn worker processes |
| `LIBRARY_PATH` | `/app/library` | Optional path to your library directory inside the container if not mounted at /app/library |
| `DATA_PATH` | `/app/data` | Optional path for the database, thumbnails, and search cache inside the container if not mounted at /app/data |
| `BASE_URL` | `http://localhost:9481` | Public base URL of this instance. Set this to the URL you use to access Grimoire (e.g. `https://grimoire.example.com`) when running behind a reverse proxy - used to build absolute links in OPDS feeds, campaign calendar subscription links, and other places that need a fully-qualified URL. |
| `VALKEY_URL` | - | Optional Redis-compatible cache URL for rendered page images (e.g. `redis://valkey:6379/0`) |
| `PAGE_CACHE_TTL` | `604800` | Optional. Seconds a rendered page stays in the Valkey cache (default 7 days). `0` means no expiry. Ignored when `VALKEY_URL` is unset. |
| `PAGE_CACHE_MAX_MB` | `2048` | Optional. Size ceiling for the on-disk rendered-page cache at `DATA_PATH/page_cache`. Trimmed oldest-first at startup and after each library scan. `0` disables the trim and lets it grow without bound. |
| `OCR_ENABLED` | `true` | Optional. Set to `false` to disable OCR of image-only PDFs even on the OCR-capable image. See [OCR](#ocr) below. |
| `OCR_LANGUAGES` | `eng` | Optional. Tesseract language codes for OCR, e.g. `eng` or `eng+deu+fra`. Extra languages require their tessdata files to be present (see [OCR](#ocr)). |
| `OCR_CONCURRENCY` | `1` | Optional. Number of scanned books OCR'd in parallel by the background OCR worker. Raise on multi-core hosts with spare CPU; keep at `1` on small boxes. Set to `0` to turn OCR off (same as `OCR_ENABLED=false`). See [OCR performance](#ocr-performance--resource-tuning). |
| `OCR_DPI` | `150` | Optional. Resolution scanned pages are rasterized at before OCR (clamped 72–600). Higher = more accurate but slower and more memory per page. See [OCR performance](#ocr-performance--resource-tuning). |
| `OPDS_ENABLED` | `false` | Optional, Set to `true` to enable the OPDS catalog. See [OPDS](#opds) below. |
| `BACKUP_DIR` | `DATA_PATH/backups` | Optional. Where backup archives are written. Point this at another mounted volume to keep backups off the main disk. When set, the field is read-only in Settings → Maintenance. See [Backups](#backups) below. |
| `BACKUP_SCHEDULE` | `off` | Optional. `off`, `hourly`, `daily`, or `weekly`. When set, pins the backup schedule and the control is shown read-only in the UI. See [Backups](#backups) below. |
| `BACKUP_RETENTION_COUNT` | `0` | Optional. Keep at most this many backups, deleting oldest-first. `0` means unlimited. When set, the field is read-only in the UI. See [Backups](#backups) below. |
| `BACKUP_RETENTION_GB` | `0` | Optional. Keep at most this many gigabytes of backups in total, deleting oldest-first. `0` means unlimited. When set, the field is read-only in the UI. See [Backups](#backups) below. |
| `LOG_LEVEL` | `info` | Optional Console/Docker log verbosity: `debug`, `info`, `warning`, `error`, or `critical`. The in-app Logs tab (Settings → Logs) always captures `debug`-level entries regardless of this setting. |
| `TZ` | `UTC` | Optional. Timezone for all log timestamps - both console/Docker output and the in-app Logs tab. Use an IANA zone name such as `America/Toronto` or `Europe/Berlin`. Defaults to UTC when unset; an unknown zone name logs a warning and uses UTC. |
| `ALLOW_PASSWORD_AUTHENTICATION` | - | Optional, `true` or `false`. When set, pins password authentication on or off and overrides the toggle in Settings → Authentication (the toggle is shown read-only). When unset, the in-app setting is used. First-run admin setup always requires a username and password regardless of this value. |
| `GUEST_ACCESS_ENABLED` | - | Optional, `true` or `false`. When set, pins guest invite codes on or off and overrides the toggle in Settings → Authentication (the toggle is shown read-only). When unset, the in-app setting is used. See [Guest invites](#guest-invites) below. |
| `DISABLE_FOLDER_CATEGORY_INFERENCE` | - | Optional, `true` or `false`. When set, pins folder-name category inference on or off and overrides the toggle in Settings → Application (shown read-only). When `true`, books are not auto-assigned a category from their folder names and fall back to `uncategorized`. A per-system `.no-auto-category` marker file disables inference for just that system. |
| `DISABLE_EXTERNAL_ADD_ON_INSTALL` | `false` | Optional, `true` or `false`. When `true`, Grimoire never fetches anything from a community repository: wiki note templates, metadata add-ons, and themes alike. The **Browse** tabs disappear and the catalogue endpoints refuse. Writing templates in the app, uploading a `.md`, and pasting a theme still work, so a locked-down or air-gapped server keeps every feature - it just stops fetching. **Replaces `WIKI_TEMPLATES_DOWNLOAD_DISABLED`**, which is no longer read. See [Themes](docs/themes.md) and [Wiki note templates](docs/wiki-templates.md). |
| `OIDC_*` env vars | - | Optional. Each OIDC setting (`OIDC_ENABLED`, `OIDC_ISSUER_URL`, `OIDC_TOKEN_ISSUER`, `OIDC_AUTHORIZATION_ENDPOINT`, `OIDC_TOKEN_ENDPOINT`, `OIDC_USERINFO_ENDPOINT`, `OIDC_JWKS_URI`, `OIDC_END_SESSION_ENDPOINT`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SIGNING_ALG`, `OIDC_BUTTON_TEXT`, `OIDC_GROUPS_CLAIM`, `OIDC_PERMISSIONS_CLAIM`, `OIDC_MATCH_BY`, `OIDC_AUTO_LAUNCH`, `OIDC_AUTO_REGISTER`) can be pinned via env. When set, the field is read-only in Settings → Authentication. When unset, the in-app value is used. See [OpenID Connect](#openid-connect) below. |
| `AUTH_RATE_LIMIT` | `10/minute` | Per-IP throttle applied to the credential-checking endpoints (`/api/auth/login`, `/api/auth/setup`, `/api/auth/guest-login`, and the API-key-guarded `/api/stats`). Exceeding it returns `429`. Uses a [`limits`](https://limits.readthedocs.io/en/stable/quickstart.html#rate-limit-string-notation) string like `20/minute` or `100/hour`. See [Security hardening](#security-hardening) below. |
| `RATE_LIMIT_ENABLED` | `true` | Optional. Set to `false` to disable auth rate limiting entirely. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | Optional. How long an access token stays valid. This is also the longest a revoked session can keep working, so lowering it tightens revocation at the cost of more background refreshes. See [Sessions and token revocation](#sessions-and-token-revocation) below. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` | Optional. How long a session survives without use before you must log in again. The clock resets on every refresh, so an actively-used session stays alive indefinitely. |
| `TRUST_FORWARDED_FOR` | `true` | Optional. When `true`, the rate limiter keys on the left-most `X-Forwarded-For` address so each client gets its own bucket behind a reverse proxy. Set to `false` only if Grimoire is exposed directly (no trusted proxy), so a spoofed header can't sidestep the limit. |

### Volumes

```yaml
volumes:
  # Your library - writable, so you can manage files from inside Grimoire.
  # Append ":ro" if you would rather Grimoire could not modify it (see below).
 - /path/to/your/library:/app/library

  # Persistent data (database, thumbnails, page cache)
 - grimoire_data:/app/data
```

#### Read-only or writable?

Grimoire only writes to your library when you ask it to. Browsing, searching,
reading, and metadata editing never touch the files, and no background job
rewrites your library. Two features do write, and both are opt-in and admin-only:

| Feature | Needs | What it writes |
|---|---|---|
| [File management](#in-app-file-management) - upload, move, rename, delete, new folders | Writable mount | The files and folders you act on |
| [Sidecar export](#writing-metadata-back-out-sidecar-export) - `.opf` / `.nfo` / `.json` | Writable mount | Sidecar files next to your content |
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

Cache entries are keyed by a hash of the source file's **contents**, so replacing a book with a different file at the same path automatically supersedes everything cached from the old one - pages, cover, and search text. The next rescan notices the change, and the reader picks up the new pages without a restart or a manual cache purge.

The on-disk cache is trimmed oldest-first back under `PAGE_CACHE_MAX_MB` (default 2 GiB) at startup and after each library scan.

---

## Backups

Grimoire can take a snapshot of its own database and the files you have uploaded through
it, on demand or on a schedule. Backups live under **Settings → Maintenance → Backups**.

Each backup is a single timestamped `.zip`:

```
grimoire-backup-20260821T140355Z.zip
├── details.json        manifest: app version, timestamp, what is inside
├── grimoire.db         the SQLite database
├── campaign_uploads/   banners, character art, sheets, campaign files
├── system_covers/      custom game-system cover images
└── audio_covers/       custom audio cover art
```

The database is copied with SQLite's online backup API rather than a file copy, so the
snapshot is consistent even while Grimoire is running. Database writes are paused for the
duration of the snapshot - brief for a typical library, but not instant.

### Your library is not backed up

**Backups do not include your PDFs, maps, tokens, or audio files.** The library is
yours, is mounted read-only, and is usually far too large to copy on a schedule - so
Grimoire never touches it. **Back your library up separately.**

Thumbnails and rendered pages are also excluded, because both regenerate on demand. After
a restore, the first view of a book or map is a little slower while they rebuild.

### Please do not rely on these alone

Backups are written to the same machine Grimoire runs on. A failed disk takes the
backups with the original. They protect against *application-level* accidents - a bad
rescan, a cleanup that removed more than you meant - which is worth having, but they are
not disaster recovery.

Follow **3-2-1**: three copies, on two kinds of storage, with one off-site. In practice:
point `BACKUP_DIR` at a volume on a different disk, and sync that directory somewhere
off-site (`rclone`, `restic`, `Syncthing`, or your NAS's own backup job). Do the same for
your library directory.

### Scheduling and retention

The schedule is `off`, `hourly`, `daily`, or `weekly` - set in the UI, in your local
timezone, or pinned with `BACKUP_SCHEDULE`.

Two independent retention limits keep the directory bounded, and a backup is removed once
*either* is passed:

- **`BACKUP_RETENTION_COUNT`** - keep at most N backups
- **`BACKUP_RETENTION_GB`** - keep at most N GB in total

`0` means unlimited (the default for both). Old backups are deleted oldest-first, and
**at least one backup is always kept**, even if it is larger than the size limit on its
own. Pruning happens *after* a new backup is written, so the limit can be briefly
exceeded while a backup runs - leave headroom for one extra archive.

Any of the four settings can be pinned with an environment variable, in which case the
value wins and the field is read-only in the UI.

### Restoring

Restoring is deliberately **not** something Grimoire does for you: it means replacing the
live database underneath a running app, which is safe when done by hand with the server
stopped and dangerous when a web request can trigger it.

The full procedure - stop the server, unpack, integrity-check, restart, rescan - is in
[restore-from-backup.md](restore-from-backup.md). It takes about five minutes.

### From the API

The endpoints are admin-only. `GET /api/backups` lists every backup newest-first with its
`created_at`, `size_bytes`, and `version`; `POST /api/backups` takes one now. Together
these support a check-before-destructive-operation flow - see how stale the newest backup
is, and take a fresh one before a risky rescan or cleanup. `GET /api/backups/{id}/download`
retrieves an archive and `DELETE /api/backups/{id}` removes one. There is no restore
endpoint, by design.

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

### Sessions and token revocation

Logging in issues a **short-lived access token** (30 minutes by default) plus a long-lived **refresh token** stored in an `HttpOnly` cookie. The browser refreshes in the background, so this is invisible in normal use - you stay logged in as before.

What it buys you is a kill switch. Previously a token was valid for 30 days and there was no way to revoke it short of rotating `SECRET_KEY`, which logged **everyone** out. Now every login is a session you can end individually.

**Managing your sessions.** Settings → User → *Active Sessions* lists every device signed in to your account, with its browser, IP, and when it was last used. Revoke any one of them, or use **Sign out all other devices** to end every session but the one you're on - the thing to do if you've lost a device or think someone else has your password.

Sessions are also revoked automatically when an admin changes your role or resets your password, when you change your own password (all *other* devices), when a guest's invite code is regenerated, and when an account is deleted. This works the same for OIDC/SSO logins as for local ones.

**One caveat worth understanding:** revoking a session kills its refresh token immediately, but an access token already issued stays valid until it expires - up to `ACCESS_TOKEN_EXPIRE_MINUTES` (30 by default). This is the trade for not hitting the database on every single request. If you want revocation to bite faster, lower `ACCESS_TOKEN_EXPIRE_MINUTES`; the cost is more frequent background refreshes.

Refresh tokens are single-use and rotate on every refresh, and only a hash of each is stored in the database. If a refresh token is ever presented twice - the signature of a stolen token being replayed - Grimoire revokes that entire session rather than just refusing the request.

Dead sessions are cleared out automatically: a background job runs at startup and then daily, deleting sessions that expired or were revoked more than **7 days** ago. The delay is deliberate - a refresh token replayed shortly after logout is still recognised as a reuse rather than looking like an unknown token. Nothing to configure, and it runs in only one worker regardless of `WORKERS`.

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
| `gm` | Read everything except admin-only content, edit metadata, create GM campaigns |
| `player` | Read-only access, personal campaigns, session notes |
| `guest` | Code-only account scoped to a single campaign. No access to the library, maps, tokens, audio, or search. See [Guest invites](#guest-invites). |

Create additional accounts in **Settings → Users** after logging in as admin.

---

## Restricting books

By default every user can see every book. If you would rather keep the adventure
module your players are currently inside out of their hands, books, systems, and
whole categories can be restricted to a minimum role.

There are two restriction levels:

| Level | Who can see it |
|---|---|
| **Everyone** | No restriction. The default. |
| **GMs and admins only** | Hidden from players and guests. |
| **Admins only** | Hidden from GMs as well. |

Restricted content is **hidden**, not locked - it disappears from the library,
search, system pages, downloads, favourites, and the OPDS feed. A title and cover
are themselves the spoiler, so a padlock nobody can open would defeat the point.

### Where restrictions can be set

Restrictions resolve most-specific-first, so a narrower setting always wins:

```
book  →  system  →  category default  →  everyone
```

- **A single book** - in the book editor, or for many at once through bulk edit.
  A book set to *Inherit* takes its system's or category's setting; a book set
  explicitly to *Everyone* stays visible even inside a restricted system, which is
  how a free player's guide can sit in an otherwise admin-only adventure line.
- **A whole system** - in the system editor. Restricting a system hides the system
  itself along with every book in it that has no setting of its own.
- **A whole category** - in **Settings → Application → Category Restrictions**.
  This is the library-wide default for that category. Core rulebooks and character
  sheets cannot be restricted: everyone at the table needs those by definition.

Only admins can change any of these, including in bulk edit.

### Granting one GM access

A locked-down library still needs the GM running the campaign to reach their own
material. In **Settings → Users**, expand a GM's row and use **Library access
grants** to give that person access to a specific system or book without lowering
the restriction for anyone else.

Grants are only available for GMs. Admins already see everything, and players and
guests are exactly who the restrictions exist to exclude, so they cannot be
granted past one. A grant is removed automatically if the user stops being a GM.

### Restricted books in campaigns

A restricted book can still be linked into a campaign - the GM needs it - but it is
always forced to **GM-only** visibility there, and cannot be made public or private
to the players. If you restrict a book that was already shared, its existing shares
are demoted to GM-only for you.

---

## Setting images

Three things in Grimoire carry an image you choose yourself: a **campaign banner**, a
**game system cover**, and an **audio track cover**. All three use the same dialog, and it
offers three ways to set one:

- **Upload** a file from your device (PNG, JPEG, WebP, or GIF).
- **Paste** an image straight from your clipboard with `Ctrl`/`Cmd`+`V` while the dialog is
  open - handy for a screenshot or something copied from a browser. You can also drag a
  file onto the dialog.
- **Browse** what Grimoire already has: your maps, tokens, book covers, and audio artwork.
  For a campaign banner, the campaign's own uploaded images come first, since that is
  usually where the art you want already lives.

Picking an existing image **copies** it into place rather than pointing at the original, so
the banner or cover keeps working if you later delete the source or reorganise your library.
Browsing only ever shows you images you can already open, and setting a campaign banner
stays a GM/owner action; system and audio covers need the GM or admin role.

**Banner positioning.** A banner fills a wide 2:1 hero, and most images aren't that shape,
so the interesting part can end up cropped out. When the chosen image is taller than the
frame, the dialog lets you **drag the preview** (or use the slider) to pick which slice
stays in view. The position is saved with the campaign, and you can come back and nudge it
later without re-uploading. Removing the banner resets it.

Audio covers are worth calling out: a track's artwork previously came only from a `cover.*`
image sitting next to it in your library or from the file's own embedded tags, neither of
which you could change from inside Grimoire. A cover you set here takes precedence over
both, and removing it hands control back to them.

## Campaigns

Grimoire has a built-in campaign tracker with two modes:

- **GM Campaigns** - Created by GMs or admins. Supports player invitations, a banner image (see [Setting images](#setting-images)), character art and character sheets per member (uploaded file or an external link), resource linking with per-resource visibility, a markdown wiki for notes, and scheduling.
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
- **Export the wiki** (**Export** in the wiki sidebar, then pick a format: Markdown zip, a single Markdown file, or JSON) - so anyone can take their own copy of a campaign with them, including when moving to another platform. Everyone's export contains exactly what they can see in the app: pages they can't read are left out, and `||GM secrets||` are stripped from a player's copy. The page filter applies to the GM too - a player's self-only note isn't in the GM's export any more than it's on their screen - while secrets remain GM-only wherever they sit. Importing writes pages, so it stays GM-only and is unavailable while archived.

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
- **Merge duplicate guests** - someone invited to several campaigns gets a separate guest account for each, with a separate code. Tick the accounts that belong to the same person, choose which one to keep, and **Merge** folds the rest into it: every campaign membership, session note, and character moves across, and the person ends up with one login covering all their campaigns. The merged-away codes stop working; the surviving account's code (or password) is the one they use. The **Account to keep** picker lists both the selected guest accounts and every existing user, so a guest can be folded into the real account that person already signs in with - ticking a single guest is enough to do that.
- **Delete a guest** - remove any guest account outright from the same list, including one left orphaned by its campaign being deleted (it shows with no campaign and no inviter).

### Notes wiki

Each campaign has a full-page markdown **wiki** (opened from the campaign overview) for building out the world - a place for session recaps, lore, NPCs, and plans:

- **Markdown** with tables, images, and the usual formatting, edited side-by-side with a live preview.
- **Visibility per page, for everyone** - every member writes notes at any of three levels, and each level means the same thing relative to whoever wrote the page:
  - *GM only* / *Self only* - visible to its author and nobody else. It reads *GM only* on the GM's pages and *Self only* on a player's, but it's one rule: a player's private note is as closed to their GM as the GM's is to them.
  - *Public* - everyone in the campaign can read **and edit** it, so the party can build a shared knowledge base together rather than only the GM writing into it.
  - *Private* - only the people you pick. A small table lists everyone else in the campaign with a **Can read** and a **Can edit** checkbox each, so you can see at a glance who has what. Ticking *Can edit* ticks *Can read* and locks it, since editing implies reading. A player can share a note with just their GM this way.

  Change it straight from the visibility badge on the page: the badge is a dropdown, and for *Private* pages it lists members so you can grant or revoke access without opening the editor. Only a page's author can change its level or its share list - a public page stays everyone's to edit but its author's to classify. In the sidebar tree, restricted pages carry a small lock-style glyph at the end of their row and read slightly dimmer; *Public* pages show their glyph on hover, and it's clickable to change the level without leaving the list. Visibility is never conveyed by colour alone.

  **Personal campaigns skip all of this.** Nobody else can see them, so there is no level worth choosing: the dropdowns, badges, and row glyphs are simply absent, and every note is private to you. The **My notes** and **Hidden** filters and the **Hide** button go too - they exist to sort your notes from other people's, and alone in a campaign there are none. Convert the campaign to a group one later and those notes stay private until you open them up.
- **Deleting is the author's** - you can only delete a note you wrote, so a player can't delete the GM's notes and the GM can't delete a player's, no matter who can edit it. Anything else you want out of the way, you hide (below).
- **Hide notes you don't need** - hide any note from **your own** view; it changes nothing for anyone else. If the GM keeps fifty pages and you only care about six, put the rest away. Hiding a parent hides its subpages too. The **Hidden** filter under the search box brings them back so you can un-hide them, and **My notes** narrows the tree to the ones you wrote.
- **Multi-select** - Ctrl/Cmd-click notes in the sidebar to select several at once. The note you already have open counts as selected, so ctrl-clicking a second one gives you both; ctrl-click a selected row again to drop it. With a selection active a **Delete selected** button appears; because deleting is author-only, the confirmation spells out exactly what will happen to a mixed selection - "delete 5 notes you created, hide 5 notes you cannot delete" - including how many subpages a hide will sweep along.
- **Custom icons per entry** - give any page (or resource category) its own icon so a long sidebar is easy to scan. The picker is searchable - search by concept, not just name ("tree" finds the pine, "disguise" finds the mask) - and offers a **built-in** set of 200+ icons plus an **emoji** tab. Tint any icon with a preset colour or a custom hex value.
- **GM secrets inline** - wrap text in `||double pipes||` (or use the **GM secret** button) to hide just that span inside an otherwise shared page. This one stays **GM-only**, unlike the visibility levels above: it's a tool for hiding text from players, so it's the GM's on every page, including one a player wrote - annotate a player's session log with notes they'll never see. The GM sees secrets highlighted; players never receive them, stripped on the server before the page is sent. Because a *Public* page is editable by the whole party, a player editing a GM's page can't wipe out secrets they were never shown - they're woven back in where the GM put them when the page is saved. Players don't get the button, and if one happens to type `||` it's kept as ordinary text rather than turning into a secret they'd then be unable to see. (Personal campaigns keep everything, since only you can read them.)
- **Nested pages** - organize the sidebar as a tree: any page can hold subpages, to any depth (a "category" is just a page with children). Drag pages to re-nest them, add a subpage from the parent row, and collapse/expand branches. Deleting a page lifts its subpages up to the parent rather than removing them.
- **Page links** - write `[[Page Title]]` to link pages; missing targets are auto-created as stubs, and each page shows what links back to it. Type `[[` and a **suggestion list** appears, matching page titles as you type (on any word, so `[[gob` finds *Boblin the Goblin*) - pick with the arrow keys and Enter. Links follow their target: **renaming** a page updates the links pointing at it instead of leaving them dangling, and where two pages share a title the suggestions show each one's parent page in brackets - *Ancient Ruins (Northlands)* vs *Ancient Ruins (Southmarch)* - and add a hidden id (`[[Page Title:id-…]]`) so you always link the one you picked.
- **Link to a heading** - suggestions include the headings inside each page, so you can point at a specific section: `[[Bestiary:#Goblins]]` opens *Bestiary* scrolled to its *Goblins* heading. Titles containing a colon (`[[Ancient Ruins: The Depths]]`) and headings starting with `#` (`[[Prices:## of coin]]` for a `# # of coin` heading) work without escaping.
- **Grimoire embeds** - drop a book (optionally at a page), map, token, audio track (plays in the global player; a note with several can be played as a playlist via "Play all"), or campaign file straight into a page. The embed picker lists the campaign's **linked resources** (link new library content in the Resources panel first). You can also **upload an image** right from the picker - it's embedded inline and added to your linked resources, filed under an existing category or a new one you name on the spot (e.g. *NPC art*).
- **Import & export** - the **Export** button offers three formats: a Markdown `.zip` (one file per page with YAML frontmatter - an Obsidian-style vault), a single Markdown file (every page in one document, page titles nested as headings - for reading, printing, or pasting elsewhere), or a JSON bundle. The zip and the bundle re-import; the single file is a read-only snapshot. Importing is GM only, and takes pages from Markdown, a Grimoire JSON bundle, or a **LegendKeeper** export (`.json`, `.lk`, or `.zip` - both the per-page export and the current `{version, resources}` bundle). LegendKeeper HTML and ProseMirror page bodies are converted to Markdown and the page hierarchy is preserved; LegendKeeper-only block types (e.g. secrets, embeds) are dropped, matching LegendKeeper's own export caveats. Imports are non-destructive - pages are always added, never overwritten.

- **Note templates** (GM only) - **Templates** in the wiki sidebar starts a page from a template instead of a blank one. Templates belong to the campaign and arrive three ways: **downloaded** from a community catalogue (browsed as a collapsible folder tree - Generic first, then a folder per game system, with the campaign's own system opened for you), **written** in the app, or **uploaded** as a `.md` file or a `.zip`. Each is a working copy, so editing a downloaded template never touches another campaign's. Any template **exports** as a `.zip` in the community repo's folder layout, ready to contribute back or keep in your own fork - and that same `.zip` uploads straight back in, so export/upload doubles as copying a template between campaigns. Downloading obeys `DISABLE_EXTERNAL_ADD_ON_INSTALL` - with it set, browsing is off but authoring and upload still work, so you can hand-copy a `.md` from the repo. Picking a template opens an unsaved page editor rather than creating the page, so a mis-click costs a cancel instead of a delete; like every other wiki import it is non-destructive. See [`docs/wiki-templates.md`](docs/wiki-templates.md)

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

### Calendar export

Sessions can go straight into whatever calendar app you already use. The **Calendar** button on a campaign's availability card opens a menu with two options:

- **Download .ics** saves the upcoming sessions as a standard iCalendar file you can import once.
- **Subscription link** gives you a live feed URL. Paste it into Google Calendar ("From URL"), Apple Calendar ("New Calendar Subscription"), or Outlook, and it re-polls on its own - so reschedules and cancellations show up without re-importing. You get two links: one for the campaign you're looking at, and one merging **all** the campaigns you belong to.

The same **Calendar** button sits at the top of the campaigns list, offering just the all-campaigns subscription link.

The subscription link is **personal to you**. It carries its own revocable token - not your password and not your login session - and each event reflects *your* availability: an event reads "Curse of Strahd - Tentative" once you've marked yourself tentative, and a cancelled session shows as cancelled rather than vanishing. Treat the link like a password: anyone holding it can read your session schedule. **Regenerate link** rotates it (instantly breaking the old one, so you'll need to re-subscribe), and **Revoke link** turns the feed off entirely.

> **Accepting or declining in your calendar app won't reach Grimoire.** Subscribed calendars are read-only by design - the calendar standard gives them no way to send anything back - so RSVP buttons on these events either don't appear or do nothing. Every event links back to the campaign's schedule tab, where one click sets your availability.

Subscription links require the `BASE_URL` environment variable to point at the address your server is reachable on, since Grimoire has to hand the calendar app a URL it can actually fetch. Until that's set, the buttons explain what's missing and the one-off **Download .ics** still works.

> **If the link works in Apple Calendar or Outlook but not Google Calendar,** the difference is *who does the fetching*. Apple and Outlook poll from your own computer, so a link that only works on your home network still works for you. Google fetches from its own servers, which means the URL has to be reachable from the public internet over `https://` - a LAN address (`192.168.x.x`), a `.local` name, a Tailscale/VPN-only hostname, or anything sitting behind a login-protected reverse proxy will silently fail there. Paste the `https://` link exactly as shown; Google doesn't understand the `webcal://` form.

Sessions land in your calendar on the day and time you actually picked, in the timezone you picked it in - a Sunday 7:30pm game shows up Sunday at 7:30pm, and stays correct when daylight saving shifts.

> **Evening games used to arrive a day early, and this release fixes it.** Session times were stored in UTC while the weekday stayed local, and the conversion dropped the day it rolled into - a 7:30pm Pacific game became "02:30 UTC" on the same weekday, which is really the *previous* evening. Sunday-night games therefore published as Saturday. Grimoire now stores the day and time together in your own timezone, and existing schedules are repaired automatically on upgrade; nothing to re-enter. Your calendar app picks the fix up on its next refresh, or immediately if you remove and re-add the subscription.

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
- **Multiple replicas:** when `VALKEY_URL` is set, the short-lived login state and the cached IdP signing keys (JWKS) are shared through Valkey, so a callback can be handled by any worker or replica. Without it both are kept in process memory - fine for a single instance, but if you scale out without Valkey a login can land on a worker that never saw the flow start and fail with "invalid or expired login state".

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
