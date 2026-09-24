# Library structure

Grimoire reads your folder layout as the library's organization: the top level of
`books/` is your game systems, the folders inside them are categories, and the
same idea carries through `maps/`, `tokens/`, `audio/`, and `models/`. Nothing
here needs configuring - name the folders sensibly and Grimoire follows.

This page is the full reference. For the shape at a glance, see the
[Quick Start](../README.md#quick-start).

## Contents

- [Books - one folder per game system](#books---one-folder-per-game-system)
- [Book formats](#book-formats) and [archive files](#archive-files)
- [Special collections](#special-collections-system-agnostic--one-page) and [system containers](#system-containers-parent-systems--sub-libraries)
- [Book metadata from OPF files](#book-metadata-from-opf-files)
- [Maps](#maps---organize-by-creator-or-collection), [tokens](#tokens---organize-by-type), [audio](#audio---organize-by-category-or-creator), [3D models](#3d-models---organize-by-creature-set-or-creator)
- [Tagging with tags.json](#tagging-with-tagsjson)
- [Ignoring files with .grimoireignore](#ignoring-files-with-grimoireignore)

---


## Books - one folder per game system

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

### Subfolders within a category

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

### Book formats

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

### Archive files

Archive files placed anywhere under `books/` are shown alongside your books in their category - handy for bundling a set of related files (a maps pack, a COMP/CON export, loose handouts) next to the book they belong to. Recognized extensions:

| Type | Extensions |
|---|---|
| Zip | `.zip`, `.cbz` |
| RAR | `.rar`, `.cbr` |
| 7-Zip | `.7z`, `.cb7` |
| Tar | `.tar`, `.cbt`, `.tar.gz`, `.tgz`, `.tar.bz2`, `.tbz2` |

Ordinary archives are treated as opaque downloads - Grimoire does not extract or read their contents, so clicking one downloads the file rather than opening the reader. They're also included when you download a whole system, category, or subfolder as an archive.

Comic-book archives (`.cbz`, `.cbr`, `.cb7`, `.cbt`) are the exception: they open in the reader and page through the images inside them, and they get a cover thumbnail from the first page. Pages are ordered by filename, which is the convention comic archives are built on (`page01.jpg`, `page02.jpg`, ...); macOS resource-fork entries and hidden files are skipped. Only the page you are looking at is decompressed, so a large collection doesn't have to be unpacked to read one issue.

Archives are also recognized under `maps/`, `tokens/`, `audio/`, and `models/`, where they appear in the gallery next to your images and tracks marked with an **Archive** badge. Map packs and art collections are often distributed zipped alongside supplementary files (PSDs, STLs, source files), so bundling them keeps the extras with the maps they belong to without cluttering the gallery. Opening one offers a download instead of a preview - there is no thumbnail, no image viewer, and no audio player, since the contents are never extracted. The comic-book extensions (`.cbz`, `.cbr`, `.cb7`, `.cbt`) are books-only and are skipped in these collections.

### Special collections (system-agnostic & one-page)

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

### System containers (parent systems & sub-libraries)

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

Or set one from the container's page (**Cover image**, GM/admin only) - upload a file, paste an image from your clipboard, or pick one Grimoire already has (see [Setting images](setting-images.md)). A `cover.*`/`folder.*` file in the library folder takes precedence over an upload, and both beat the book thumbnail an ordinary system falls back to. This works for any system, not just containers. A `cover.*`/`folder.*` image at a system's folder root is artwork only - it is not also indexed as a book.

**Grouping toggle.** Containers are a way to organize the grid, not a cage. The **Group collections** switch beside the "Your Collection" heading (shown only when you actually have a container) flattens them: the container cards drop out and their child systems take their place, so you get a plain A-Z list of every real system with the usual sorting and filters applied. Switch it back on to return to the drill-down view. Your choice is remembered across sessions.

One-page collections are the deliberate exception - they stay grouped either way. Keeping a pile of tiny one-book games out of the main grid is the whole reason that collection exists, so flattening leaves its chip in the Special Collections strip and its games reachable by drilling in.

> **Note:** systems nested inside a container count toward your library's game-system total. If you already used a `One-Page RPGs` folder, expect that number to rise after the first rescan as each game inside it becomes its own system.

### Marking a system as explicit

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

### Sort-order prefixes

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

## Book metadata from OPF files

Grimoire reads [OPF](https://idpf.org/epub/20/spec/OPF_2.0.1_draft.htm) sidecar files to populate book metadata automatically on first scan. OPF files are the format used by [Calibre](https://calibre-ebook.com/) and many other library managers.

### Supported fields

| OPF element | Book field |
|---|---|
| `dc:title` | Title |
| `dc:creator` (role=aut) | Authors |
| `dc:publisher` | Publisher |
| `dc:date` | Year (4-digit year extracted) |
| `dc:description` | Description (HTML tags stripped) |
| `dc:subject` | Tags (lowercased) |
| `dc:identifier` with `opf:scheme="ISBN"` | ISBN (hyphens stripped, check digit validated) |
| `dc:identifier` with `opf:scheme="PRODUCT_CODE"` or `"SKU"` | Product code (the publisher's catalogue number) |
| `guide/reference[@type='cover']` | Cover image (file is excluded from the book list) |

`dc:contributor` entries (e.g. Calibre's own tool credit) are intentionally ignored, as are `dc:identifier` elements without one of those schemes — that filter is what keeps Calibre's internal UUIDs out of the ISBN field while letting a real ISBN (including one Grimoire's own [sidecar export](sidecars.md) wrote) come back in. An ISBN whose check digit does not validate is dropped rather than stored. `dc:language` is parsed but not stored (no matching field).

### OPF file discovery

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

## Writing metadata back out

The reverse of the above: Grimoire can write its metadata *out* as sidecar files next to
your content, so the library folder describes itself. Copy the library to another machine,
or rebuild the container with a fresh `DATA_PATH`, and the metadata travels with the files
instead of living only in the app database. Other tools can read it too - Calibre,
Jellyfin, Kodi, or a plain file manager.

**This is off by default**, and writing needs the library mounted writable. Four formats
are available (`.opf`, `.nfo`, `.grimoire.json`, `.grimoire.yaml`), enabled in
**Settings → Maintenance → Metadata Sidecars**. Grimoire only ever overwrites sidecars it
wrote itself, so a `.opf` you maintain in Calibre is left alone.

See [Metadata sidecars](sidecars.md) for the full field mapping per format, when writes
happen, and how it behaves on a read-only mount.

## Maps - organize by creator or collection

```
maps/
└── Creator Name/
    └── map-file.png
```

The folder name is shown as a group header in the map gallery. Both image maps and PDF maps (including multi-page PDFs) are supported and viewable in-app.

Animated maps (`.webm`, `.mp4`) and Universal VTT exports (`.uvtt`, `.dd2vtt`) sit alongside the stills they belong to - publishers commonly ship a looping video and a VTT data file next to each still variant - and both are viewable in-app. Animated maps play in the detail view on a muted loop with normal playback controls. Universal VTT files show the battlemap held inside them, and their detail panel lists the grid resolution plus the wall, door, and light counts the file carries for a virtual tabletop (see the [format reference](https://arkenforge.com/universal-vtt-files/)). Both get a gallery thumbnail like any other map: a Universal VTT because the image is right there in the file, and an animated map from a frame decoded a moment into the clip. Grimoire bundles a purpose-built, decode-only build of ffmpeg for this, trimmed to just the codecs a battlemap uses, so the feature costs about 5 MB of image size rather than the several hundred a stock ffmpeg would add. Existing libraries pick these up on the next rescan - any animated map still missing a thumbnail is retried, so you do not need to re-add anything.

Any image map can also be **exported as a Universal VTT file**, from the Download menu on its detail page. The `.uvtt` carries the map image and its grid, so it drops into Foundry, Roll20, or any VTT that reads the format with the grid already lined up, instead of you scaling the image by hand. Maps that already have a real `.uvtt` linked to them do not offer the option, since the file you already have carries walls and lighting of its own.

### Walls, doors, and lights

The export can carry more than the image and the grid. **Edit VTT** on a map's detail
page opens a full-screen editor for the vision-blocking walls, doors, windows, and lights
a virtual tabletop uses for dynamic lighting, with a player-view preview for checking what
a token can actually see. Nothing it saves touches your library. See
[Universal VTT editor](uvtt-editor.md).

### Grid detection

Grimoire works the grid out on its own, from a `(30x40)` in the filename, the image's DPI, or the pixel dimensions. When it gets that wrong, the **Grid** panel on the map's detail page is editable: set the width and height in cells, and optionally the pixels per cell. Fractional values are accepted, because plenty of maps bleed a partial cell past the grid - a 33x24 map with a quarter-cell margin at each edge is really 33.25x24.25. If the numbers you enter imply cells that are not square, Grimoire says so and shows what the image suggests instead, but it still saves what you typed: unusual maps exist, and you are the one who can tell. Reset puts the map back to automatic detection.

## Tokens - organize by type

```
tokens/
├── Category/
│   └── token-file.png
└── Fantasy Frames/          # a token-editor frame folder
    ├── .frames-container    # the marker that declares it one
    └── my-ring.svg
```

A folder holding a `.frames-container` marker file offers its images as frames in the
[token editor](token-editor.md) - the same convention `books/` uses for
`.parent-system-container` and friends, so the folder keeps whatever name reads best.
Frames are ordinary library files and are still indexed as tokens; the marker adds a use
for them rather than hiding them.

## Audio - organize by category or creator

```
audio/
└── Category or Creator/
    ├── cover.jpg        # optional folder artwork (cover.* or folder.*)
    └── track.mp3
```

The folder name is shown as a group header in the audio library. Supported formats: `.mp3`, `.ogg`, `.opus`, `.flac`, `.wav`, `.m4a`, `.aac`. Duration and embedded title/artist/album tags are read on scan. For artwork, Grimoire uses a `cover.*` or `folder.*` image in the track's folder if present, otherwise falls back to embedded album art.

## 3D Models - organize by creature, set, or creator

```
models/
└── Goblins/
    ├── Presupported/
    │   └── goblin-archer.stl
    └── Unsupported/
        └── goblin-archer.stl
```

The folder name is shown as a group header in the model library. Printable
miniatures and terrain live here and behave like any other collection - search,
filter, tag, favorite, bulk-edit, add to a campaign, and group as versions.

**Formats.** `.stl` (binary and ASCII), `.obj`, `.ply`, `.3mf`, `.glb`, `.gltf`,
and the sliced resin formats `.lys`, `.ctb`, `.cbddlp`, `.pwmx`, `.photon`.
Everything listed is indexed, searchable, and downloadable. Sliced files are a
stack of per-layer images built for one specific printer rather than geometry,
so they are stored and served but never previewed.

**Thumbnails.** `.stl` files get a rendered preview: Grimoire rasterises the mesh
itself, with no GPU and no extra dependencies, so a model grid looks like a model
grid rather than a wall of identical icons. Other formats show a placeholder, the
same as an animated map or an archive.

Rendering happens in software, so its cost tracks the triangle count - a couple
of seconds for a typical miniature, longer for a photogrammetry scan. The mesh is
streamed rather than loaded into memory, so even a 14-million-triangle figure
renders in a flat few dozen megabytes; models up to 20 million triangles get a
preview. Only the heaviest meshes are **queued rather than rendered during the
scan**, exactly as scanned PDFs are queued for text recognition: the library walk
finishes at full speed, and those previews are drawn afterwards in a **Rendering
model previews** phase you can watch in Maintenance. Each queued model gets up to
five minutes - generous on purpose, since the renderer is single-threaded and a
NAS or mini-PC takes several times longer than a desktop for the same mesh. A
model that runs out of time during the scan itself is handed to the same queue
rather than left without a preview, and a stop or a restart leaves the rest
queued so they resume next time.

Previews are drawn in the model's print orientation - Z up, the way it sits on
the build plate - so a miniature stands on its base rather than lying on its
side.

**Viewing a model.** Opening one renders it in an interactive 3D viewer - drag to
orbit, scroll to zoom, with a wireframe toggle and a reset-view button. `.stl`,
`.3mf`, `.glb`, and `.ply` are displayed; sliced files and the multi-file formats
(`.obj`, non-binary `.gltf`) offer a download instead. A mesh over 256 MB is not
loaded automatically, since that is past what a browser tab renders comfortably -
Grimoire warns you that it may be slow or unresponsive and lets you load it
anyway if you want it, or download it instead. The viewer is loaded on demand, so
it costs nothing until you open a model.

**Presupported vs unsupported.** Resin miniatures usually ship twice - once with
printing supports attached and once without. Grimoire reads this from the file
name or the folder above it (`Presupported/`, `goblin_unsupported.stl`,
`no supports/`, `_sup`, `_unsup`, and similar spellings) and badges each model
accordingly. A model it cannot classify is left unmarked rather than guessed at,
and you can always set it yourself from the model's detail page - the
**Supports** row there cycles presupported → unsupported → unknown. Pair the two
copies with the **presupported** / **unsupported** version kinds to collapse them
into one entry - see [Duplicates and versions](file-management.md#duplicates-and-multiple-versions).

---


---

## Tagging with tags.json

Drop a `tags.json` file into any `maps/`, `tokens/`, `audio/`, or `models/` folder (or subfolder) to automatically apply tags when the library is scanned. You can also place one inside a game system folder under `books/` to tag the system itself.

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

A tag's name cannot contain `/` or `\`. Grimoire has no notion of subtags, so a
name like `Storage/Box1` would be a flat tag that merely looks nested - and the
slash broke the address the app uses to reach it, leaving a tag that could be
created but never renamed or deleted. Those characters are now refused when you
add a tag, with a note suggesting a separate tag instead. A tag already carrying
a slash - from an older version, or from a `tags.json`, which is yours and is
still applied as written - is reachable again, so you can rename, merge, or
delete it from the Tags page.

---

## Ignoring Files with .grimoireignore

Add a `.grimoireignore` file to keep files on disk but out of Grimoire. It uses the same syntax as `.gitignore` / `.dockerignore`, so anything matched by a rule is skipped during scanning and never appears in the UI - useful when a book ships extra print variants (black-and-white single pages, zine-sized layouts) you want kept next to the book but hidden.

Place it at your **library root** to apply everywhere, or in any subfolder to add rules for just that subtree. Rules are cumulative and nested, like git.

Folders whose name starts with a dot are skipped automatically and need no rule.

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

The full gitignore dialect is supported (`!` negation, `**` for arbitrary depth, anchoring with `/`), and rules apply to every collection: `books/`, `maps/`, `tokens/`, `audio/`, and `models/`. Changes take effect on the next scan. Adding a rule that matches an already-indexed file hides it (marked missing) on the next rescan; remove the rule and rescan to bring it back.

---
