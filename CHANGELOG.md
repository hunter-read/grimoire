# Changelog

All notable changes to Grimoire are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Release candidates are omitted; their contents are rolled into the stable release that followed.

## [Unreleased]

### Added

- **Join pages** in spread view draws the two pages as one image, with no gap, inner corners or shadow between them, so a map or illustration printed across a spread reads as one picture. It is under Spread in the reader's menu and a button in the PDF map viewer, and is remembered per book and per map
- The reader zooms up to 800%, from 200%. Past about 200% Grimoire renders just the part of the page you are looking at in full detail and lays it over the page, so small print stays sharp without rendering a huge image of the whole page
- Zoom now stays when you turn the page, landing at the top of the next page in the same column. A new book, switching between Page and Spread, or reset returns to 100%
- When linking resources to a campaign, tick a folder to select everything in it, subfolders included. A partly selected folder shows a dash, and ticking it again clears it

### Changed

- Grimoire uses much less memory: about 250 MB once your library is scanned, down from about 550 MB, and about half as much at peak while several people read
- The image runs one worker by default (`WORKERS=1`), and one worker now serves several readers at once faster than two did before. If your compose file sets `WORKERS=2` from an older example, change it to `1` to get the saving; the performance docs explain when two is worth it
- After a reading session, Grimoire closes the books it had open and gives back the memory used to render their pages once nobody has read anything for 5 minutes. `PAGE_IDLE_RELEASE` sets how long it waits; `0` turns this off
- Faster first start for a new or updated container: the image now ships the compiled Python it needs instead of building it on first start
- Updated FastAPI, Pydantic and Uvicorn. API keys keep exactly the access they had
- The image builds its frontend with Node 22, the version CI tests with; Node 20 is end of life. Running from source now needs Node 22 or newer
- The MCP server now runs on the official MCP Python SDK instead of Grimoire's own protocol code, and also accepts the older `2024-11-05` protocol revision. Tools, resources, prompts and API-key permissions are unchanged

### Fixed

- Exporting a spread as one joined image could leave a faint light line down the middle at some page sizes and resolutions
- The campaign resource picker's Models tab showed `campaignEditor.resources.type_model` instead of its name
- The campaign resource picker offered tabs for maps, tokens, audio or models even when those sections were hidden in Settings, and adding by tag could add them
- Reading more than ten books at once, or replacing a book's file while someone was reading it, could close the book under a page that was still loading and fail that page

## [1.9.0] - 2026-10-15

### Added

- An MCP server, so AI assistants such as Claude Code can work with your library: search it, read and look at book pages, browse your systems and books, and read your campaigns' wiki and session notes - citing the book and page they found an answer on. Off by default: set `MCP_ENABLED=true`, then connect with an API key, which decides what the assistant can reach
- Assistants can also add to your library when you ask: bookmark a page, tag books, or write a new campaign wiki page (private unless you say to share it). They never change or delete what's there
- Two ready-made assistant prompts: prep your next session from a campaign's notes and wiki, and answer rules questions from your own books with the page they're on
- With MCP on, the dialog that shows a new API key also gives the command to connect Claude Code with it
- Share links: a public link to a book, map, token, audio track or 3D model that anyone can open without an account, until it expires or you revoke it
- A share link can expire after 1 day up to a year, or never, can require a password, and has a direct file address for VTTs and Discord
- See, copy and revoke your share links under Settings → Account → Sharing
- Admins choose who may create share links: GMs by default, players once allowed, and any user can be allowed or denied individually from the Users page, where their links are listed and can be revoked
- `SHARE_LINKS_ENABLED=false` turns share links off for the whole server
- Set a map up for OTFBM, the battle map renderer behind Avrae's `!map` on Discord: Grimoire resizes the map to OTFBM's grid, serves it through a share link, and gives you the command to paste
- Import characters from other tools - a Forge Steel hero, a Pathbuilder 2e export, a D&D Beyond or DiceCloud link - through character importers: community add-ons an admin installs under Settings → Add-ons → Character importers. Characters → Import a character recognises the file by itself, builds it on the right sheet (installing the sheet if needed), and matches picks against your installed content, keeping anything it lacks as a custom entry (thanks @ianfhunter)
- Anyone can install an importer that only reads uploaded files - Forge Steel and Pathbuilder included - for their own account, from the import dialog. Importers that fetch links or run scripts still need an admin, and the dialog says so: admins get an Install for everyone button, everyone else is told to ask
- An importer can ask for something per import, such as an API key for a private character. The dialog shows the field, asks again when an import turns out to need it, and never stores what you type
- Audiobooks: `.m4b` files are picked up by the scan and play in the audio player like any other track, with their duration, tags and cover art
- The audio player lists an audiobook's chapters and shows the one playing; pick a chapter to jump to it. Works for `.m4b`/`.m4a` and chaptered MP3 files
- The audio list names each track by its tags - `03 · Die Sümpfe Harodiens`, with artist, album and duration beneath - and falls back to the filename, without its extension, for untagged files
- Audio opens in album order: within a folder, tracks play by disc and track number whatever their files are called. Pick Track in the sort menu to get it back after choosing another order. Existing tracks pick up their numbers on the next scan
- Admins can style the OIDC sign-in button to match their provider: background, text and border colours, corner radius, and an uploaded logo, under Settings → Authentication, or pinned with `OIDC_BUTTON_*` environment variables
- Magazines & Zines is a built-in book category: folders named `Magazines`, `Zines`, `Periodicals`, `Dragon Magazine` and the like are filed there on the next scan, and Create standard category folders adds a `Magazines` folder
- Export from the reader (⋮ → Export pages & cut-outs, or press `e`): save a page range as a PDF - a character sheet, a chapter, the whole section the page is in - or as PNG, JPEG or WebP images, with facing pages joined into one picture for maps printed across a spread
- Cut out maps, tables, cards and tokens: draw rectangles, squares or circles on a page, or across both halves of a spread, and each one downloads as its own file - round tokens with transparent corners. Find shapes picks out every token or picture on a page for you
- The PDF map viewer has the same Export button
- Admins on a writable library can save an export straight into a library folder - beside the book, or into Tokens or Maps - instead of downloading it, and Grimoire indexes the new files right away
- Grimoire Codex DB, the community catalogue of TTRPG systems and books, is built in as a metadata source. Set `GRIMOIRE_CODEX_DB_API_TOKEN` to turn it on: it is listed first in Fetch metadata, and applying a result links the book or system to its Grimoire Codex DB record
- GMs and admins can add a book or system to Grimoire Codex DB, or send chosen fields as a correction to the linked record
- Book lookups can include file hashes so Grimoire Codex DB finds the exact file - off by default, under Settings → Add-ons → Grimoire Codex DB
- Fetch metadata from the reader's details panel, without leaving for the system page
- Name the main version of a family instead of "Main version": a map pack whose main copy is the gridless cut can say Gridless. Admins rename any version - the main one included - from the version picker on a map, token, audio or 3D model page, or from a book's Versions section
- Reviewing duplicates pre-fills what each copy is from its filename, for the copy you keep as well as the other - a `Tavern_nogrid` / `Tavern_grid` pair arrives as Gridless main, Gridded variant
- A character sheet can let you type your own class, species or background when nothing in the catalogue fits, for homebrew picks (thanks @ianfhunter)

### Changed

- Map, token, audio and model pages keep Favorite, Add to campaign and Share in a ⋮ menu, as the book reader does, so the toolbar has room for the title
- The Campaigns list on the Users page stays collapsed until opened

### Fixed

- Titles, artists and albums tagged inside WAV and AIFF files are now read, and show in the audio list and on the track's page
- Admins see Move, Rename and Delete in the reader's ⋮ menu, and a book's details show its file path - the book's library path was being dropped from the reader's data
- A folder or file whose name isn't valid UTF-8, often one named on Windows and copied to a Linux share, no longer stops the whole library scan. The scan skips it and logs which one to rename
- The file manager no longer fails with "Internal Server Error" on such a name. It shows the entry greyed out with a placeholder character, and a ? icon explains why it can't be changed from Grimoire
- A game system's description keeps the paragraph breaks entered in its editor instead of running together as one block. Long descriptions show their first few lines with a Read more button

### Security

- SSO sign-in only returns you to a page on your own Grimoire. A crafted sign-in link could send you, and your new session, to another site once you'd signed in with your identity provider

## [1.8.0] - 2026-10-08

### Added

- Rescan and File manager buttons on every Settings tab, with scan progress and a stop button
- Upload with `on_conflict=replace` to swap in a corrected file for a book and keep its tags, metadata, bookmarks, and favorites
- Character sheets: install a sheet for your game from the community catalogue, or paste your own, and build characters on it
- Ten sheets in the catalogue: D&D 5e (2024), Draw Steel, Pathfinder 2e and 1e, Call of Cthulhu 7e, Traveller, Cosmere RPG, Dungeon Crawler Carl, Cairn, and Basic Fantasy
- Sheets work out modifiers, saves and totals as you type, and any calculated value can be overridden
- Picking a class, background or species fills in what it grants, and changing the pick takes it back off
- Content packs add a searchable catalogue of spells, classes and feats; packs for the D&D 5e SRD, Draw Steel, and Pathfinder Player Core are available
- Rulesets give each campaign its own content and house rules, edited by its GM
- Put a character in a campaign you run, a personal campaign, or one you've joined, so the table can read the sheet
- Keep several characters in one campaign, and mark one retired or dead instead of deleting it
- Character art, and export or import of a character as a self-contained file
- A guide and full reference for writing your own sheets and content packs, in the community add-ons repository
- Items added in the last week carry a "New" badge, and books can be sorted by date added or filtered to recent additions
- More category folder names: `Players`, `GMs` and `Game Masters` hold core rulebooks, `Sheets` holds character sheets, `Sources` holds supplements, and `Unofficial` holds homebrew

### Changed

- Groups with more than 25 items open collapsed; your own open/close choices are kept
- Large libraries load as you scroll: a system's books, the map, token, audio and model galleries, and tag pages fetch one page at a time from the server

### Fixed

- A fully zoomed-out book page fits above the phone's bottom navigation bar
- Game system headers show up to three links, with the rest in a "More" menu
- A rescan shows as running on every rescan button at once
- Expanding a folder in the map, token or audio galleries keeps your place instead of jumping to the top of the page
- Clicking a tag in a system's book list opens the Tags page instead of the book
- Guests see only what their campaign shares with them
- Guest invite codes are visible only to the campaign's GM
- Copying a blank character sheet is limited to sheets the member can open
- A scan stuck at "running" after a restart or crash can be cleared with **Stop**
- A PDF's table of contents still shows when one bookmark points past the last page
- A book whose file got shorter opens on its last page instead of a page that no longer exists
- Links and formatting inside a `||GM secret||` in campaign notes render correctly, and paragraphs in notes keep their spacing

## [1.7.3] - 2026-10-01

### Added

- Personal API keys with per-area access levels, for scripts and tools like Homepage or grimoire-cli
- Admins control who may use API keys, can revoke any key, and can turn keys off with `API_KEYS_ENABLED=false`
- `MAX_IMAGE_PIXELS` raises the size limit so very large images get thumbnails
- Right-click a book to open its actions menu
- Add or remove a book from favorites in its actions menu
- `CORS_ALLOWED_ORIGINS` lets listed origins call the API from the browser

### Changed

- The stats API key moved to Settings → Account → API Keys

### Fixed

- Rescanning a replaced book records the new file size
- The back button in a nested container returns to its parent container
- Collections like One Page RPGs get search, sort, filters, presets, and multi-select
- Moved books stay in full-text search

### Security

- API keys are shown once, stored hashed, can expire, and record last use
- Repeated wrong API keys are rate limited

## [1.7.2] - 2026-09-24

### Added

- Italian (it-IT) localization
- Swedish (sv-SE) localization
- Link to the documentation site from the About dialog
- Open a book's details in one click from its row
- Choose whether folders sort before books or among them by name
- Product code (SKU) field, searchable, sortable, and filterable

### Changed

- Importing campaign notes from a folder or zip keeps the folder structure
- Bulk metadata matching steps through each item in one dialog

### Fixed

- Non-Docker installs report their real version in the About dialog
- Keyboard focus returns to the file list after a dialog closes
- File manager hides upload and new folder at the library root
- Large media galleries use far less memory and scroll smoothly
- Ungrouped galleries load in display order
- Renamed maps and tokens keep their thumbnails; missing ones are rebuilt on the next scan
- Quoted searches match the exact phrase
- The reader's zoom controls no longer shift under the cursor
- Folders in book lists sort consistently at every level
- Row action menus stay inside the window
- Reader panel controls are back on phones; better mobile header bar
- Faster OCR for scanned books, with no pages dropped from search
- A trackpad swipe in the reader turns one page
- The Token Editor's active tab has readable text
- Editor button labels stay inside their buttons in the media galleries

## [1.7.1] - 2026-09-16

### Added

- Per-page OCR timeout is configurable, and pages skipped by it are surfaced

### Fixed

- Upgrades from a pre-Alembic install no longer skip every post-baseline migration
- Universal VTT downloads keep their filename

## [1.7.0] - 2026-09-15

### Added

- Release changelog is browsable in the About dialog, one expandable section per version
- Token editor for making VTT tokens from any image, including Grimoire library assets
- Universal VTT map editor for adding walls, doors, and lights to an image
- Process umask can be set from a `UMASK` environment variable

### Changed

- Token, audio, and model detail views step through their folder
- Maps, tokens, audio tracks, and models can be favorited from their detail view
- Redesign add-on install dialog to surface changelogs and source code
- Filter tags with AND/OR/NOT groups, and align genre and dice filters
- Allow plugin/theme/note installs from multiple sources

### Fixed

- Tags containing a slash can be edited and deleted
- A book stays on its own system when renamed inside a container
- Offer folder markers only where the scanner reads them

## [1.6.2] - 2026-09-10

3D model support: create a `models` folder in your library and Grimoire indexes your STLs alongside books, maps, tokens, and audio.

### Added

- Soundboard manager for one-shot sounds played over the audio queue
- 3D model support as a first-class library category
- Named playlists and soundboards can be saved and reloaded
- Whole-library size statistic
- Image map export to Universal VTT
- Download from the tag browser at every level
- Keyboard navigation for the library file manager

### Changed

- Duplicate manager has better scan defaults and clearer version labels
- Thumbnails for animated maps no longer inflate the base image
- Map and token galleries load noticeably faster on large libraries

### Fixed

- File manager touch gestures and accessibility on mobile
- File manager menu matches the current page and opens at the library root
- Map version handling no longer blocks thumbnail generation
- A duplicate scan stuck at 0% after a crash or restart now recovers
- Special collections left stranded after their folder was deleted are cleared
- Systems nested in a container get every category folder and keep their system on rename
- A book keeps its cover when the title was edited before a move

## [1.6.1] - 2026-09-03

### Added

- Book and map versions are surfaced and manageable throughout the UI
- Search by book title and field-scoped search

### Changed

- Duplicate-manager version kinds are now scoped per collection

### Fixed

- Non-authors could not save wiki pages they had permission to edit
- 500 error when deleting or moving maps with thumbnails
- Thumbnails are preserved when a book, map, or token is moved
- Category moves stay inside the system folder under a container
- Faster map viewing, plus thumbnail support for video, UVTT, and VTT files

### Security

- Sidecar files are no longer written owner-only and now respect `UMASK`
- Dismissed duplicates are viewable again

## [1.6.0] - 2026-08-27

Library management is the headline: an in-app file manager for creating folders, uploading, moving, and renaming files, sidecar metadata, and duplicate detection. Plus per-user themes, including light mode and community-authored themes.

### ⚠ Breaking

- Grimoire now fails closed on a missing `SECRET_KEY`. Set it or the application will not start.
- Library management needs write access to the library; read-only mounts still work with it disabled.

### Added

- Library file manager and duplicate file detection pages
- Per-user colour themes, including light mode and downloadable community themes
- Metadata export as OPF, NFO, and JSON sidecars
- Role-based access restrictions on books
- Campaign schedule export to ICS or calendar subscription
- Support for EPUB, DjVu, text, and comic book formats
- Images can be set from existing assets, the clipboard, or an upload

### Changed

- Filters support "any" and "none" matching
- Decluttered the book reader toolbar
- Campaign note export formats consolidated behind a single button
- Replaced and moved library files are detected by content hash
- OIDC state store and JWKS cache backed by Valkey
- OpenAPI response models added to every endpoint

### Fixed

- Bulk edit no longer refetches metadata; cover picker layout shift resolved
- Book covers render correctly on the details view
- `.grimoireignore` is applied when enumerating system folders
- A note template can be applied to an already-open page editor
- Permission behaviour for campaign notes
- Cancelled or failed scans no longer leave systems unregistered
- Campaigns page mobile layout; campaign invite list overflowing the members card
- Guests can open public campaign resources
- Script-backed add-ons can declare search without ranking fields
- ISBN import from OPF sidecars is properly scoped

### Security

- Refresh tokens and revocable sessions

### Documentation

- FAQ section on configuring OIDC with Google (thanks @DRebd)

## [1.5.6] - 2026-08-10

### Added

- Campaign note templates, with support for creating, downloading, and importing [community add-ons](https://github.com/grimoire-codex/community-add-ons)
- Campaigns can be archived or converted to GM campaigns

### Changed

- Campaign page linking: autocomplete, subpage references, and shared page name handling
- Wiki page list scrolls independently of the note and can be resized
- Group embed picker content is organised by category with a category toggle
- Smaller Docker image and faster multi-arch builds

### Fixed

- Wiki page editor fills the viewport height; book embeds show the book title rather than "Book"
- Post-rescan cleanup no longer deletes container systems
- PDF render memory reclaimed; reader and Valkey page caches are now bounded
- In-system search no longer persists across fresh navigations
- Filter/sort bar mobile behaviour; child-system grids use the system view mode
- Embed picker page input is focused when "at page" is clicked
- Now-playing indicator in the audio list view
- Middle click opens cards and chips in a new tab (thanks @strass)
- Parent-system cover on favorites; clearer container marking
- Selection is kept after bulk edits and tag applies
- Scroll position is restored when returning via in-app Back buttons

## [1.5.5] - 2026-08-07

### Added

- Metadata scraping from external sources via the add-on architecture
- One Page RPG supercategory and parent system directory support
- Zoom controls in the document reader

### Changed

- Improved campaign note icons

### Fixed

- List item indentation in campaigns
- Bulk edit modal category editing and apply-to-all; general bulk tagging improvements
- Duplicate cancel multi-select button replaced with a sticky filter/sort/select bar
- Campaign resource picker only showed a fraction of the library
- `FOREIGN KEY constraint failed` on campaign and user deletion
- `/api/openapi.json` returned 500 with `OPDS_ENABLED=true` on an empty library
- "Add to campaign" now appears correctly in the book actions menu

## [1.5.4] - 2026-07-30

Tags reworked: a single tag can now span books, maps, tokens, and audio, with a dedicated page to view them together.

### Added

- Dedicated tags page with cross-content-type linking
- Expanded metadata for books and systems
- Saved filters and default filtered views

### Changed

- Improved sorting and filtering across all content types

### Fixed

- Individual rescan and re-OCR now shown for all indexed books
- Special characters in campaign wiki links are preserved

## [1.5.3] - 2026-07-24

### Added

- Per-book re-scan and re-index action; row actions consolidated into a menu
- `.grimoireignore` file support
- `TZ` environment variable
- Option to disable default book categorization

### Fixed

- Case-insensitive top-level library folders
- GM secrets preserved when a player edits a shared wiki note
- Media images lazy-loaded, fixing the library thumbnail request storm
- Campaign resource linking
- PDF maps display using the same PDF viewer as books

### Security

- FTS5 search snippet source text is escaped, preventing stored HTML injection

## [1.5.2] - 2026-07-20

Recommended upgrade for anyone on 1.5.0–1.5.1 with guest access enabled.

### Fixed

- Usernames are case-insensitive at login
- OCR hardened against unexpected exceptions
- Stats endpoint no longer counts system-agnostic as a system
- Audio is cleaned up by the database cleanup operation and included in scan status
- Improved scan, index, and OCR logging

### Security

- Guest user permissions corrected
- Media is authenticated via an HttpOnly cookie instead of a `?token=` URL parameter

## [1.5.1] - 2026-07-14

### Added

- "Show password" button for username/password logins
- Play button on audio subfolders

### Fixed

- OCR deferred to a resumable background queue, configurable via environment variables

## [1.5.0] - 2026-07-13

Audio support: add audio to your library, play it in-app, and build playlists so you can keep your eyes on the table.

### Added

- Audio management and playback with playlists
- Guest access to campaigns
- Scoped rescan and sidecar metadata refresh
- Bulk actions and tag filtering for game systems
- In-process OCR for image-only PDFs
- Banner to accept or decline pending campaign invites
- Archive files are displayed and served
- Prev/next navigation between maps in a folder
- Container `HEALTHCHECK`; build toolchain moved out of the runtime image

### Changed

- Reworked character sheet creation from template
- Reworked Settings → Users page
- Book editor Category is now an editable combobox
- Improved performance and caching

### Fixed

- Calibre "Unknown" author is ignored in `.opf` files
- Better error handling in the indexer
- Raw PDF viewer works in Firefox
- A range of mobile improvements

## [1.4.1] - 2026-07-07

### Fixed

- Category keywords match on whole tokens rather than substrings
- Docker entrypoint respects the `WORKERS` env var for the uvicorn worker count (thanks @fesxj)

## [1.4.0] - 2026-06-18

Campaigns reworked: expanded notes and a single consolidated campaign overview page.

> **Note:** this release includes an irreversible database migration. Back up your data directory before upgrading.

### Added

- Card, compact, and list views, saved per user
- Multiselect mode: add tags, add to campaign, and bulk edit books
- Collapsible sidebar and collapsible Recently Opened Books section
- Spread offset toggle in the reader
- Calibre per-book-folder OPF metadata support

### Changed

- Campaigns significantly reworked, with expanded notes functionality and a single overview page
- Reader toolbar extracted into its own component

### Fixed

- Back button exits the reader in one click; search state restored on back navigation
- Recently read close button styling
- System-agnostic books sort to the top of the Library view

### Documentation

- File management guide and Docker Compose examples
- Documentation portal at https://grimoirecodex.org

## [1.3.2] - 2026-05-21

### Fixed

- Configured groups and permissions claim names are requested as OIDC scopes

## [1.3.1] - 2026-05-20

### Fixed

- `users.hashed_password` migrated to nullable so OIDC user creation works

## [1.3.0] - 2026-05-18

### Added

- OpenID Connect authentication and an email field on users
- System Agnostic parent folder support
- Scheduled database cleanup as part of scheduled rescan
- Tag export under Settings → Maintenance
- Search filters, grouped results, and a favorites-only filter
- Tag autocomplete, keyboard shortcut overlay, and reading improvements (thanks @KrapfalAT)

### Fixed

- Tags normalized to lowercase across all write paths and existing data
- Admin user deletion blocked by foreign key constraints
- Ungrouped items displayed above grouped folder sections
- Safer database cleanup during scans and on hung mounts
- Thumbnail 404 after a book rename
- Image files within books are viewable
- Image-only PDFs are no longer marked as index failed
- Env table rendering in the README (thanks @joshgamache)

## [1.2.1] - 2026-04-16

### Added

- German localisation with a dynamic language switcher in settings (thanks @KrapfalAT)
- French localisation
- Version update notifications and an About modal

### Fixed

- Region added to localization
- `navigator.language` used as a fallback, plus a dropdown for language selection
- `no-store` cache header on `index.html`; enhanced PWA manifest

### Documentation

- Updated Docker documentation in the README

## [1.2.0] - 2026-04-15

### Added

- i18n localization support
- OPDS catalog support
- Books can be grouped into collapsible subfolders within any category

### Changed

- Scroll position and folder expand/collapse state persist across navigation

### Fixed

- Reader back button returns to the last read page before a ToC or bookmark jump

## [1.1.2] - 2026-04-14

### Added

- Reading progress and recently opened books (thanks @KrapfalAT)
- Tag support for library books (thanks @KrapfalAT)
- Archive download with a format picker modal for systems, maps, and tokens
- Book sorting, reader keyboard shortcuts, and a favorite indicator (thanks @KrapfalAT)
- Admins can set a new password for any other user in user management settings

### Fixed

- Infinite scan loop when a file hung thumbnail generation
- `is_missing` flag tracks library items whose files no longer exist on disk

## [1.1.1] - 2026-04-12

### Added

- Filter and collapse/expand toolbar in the library view (thanks @rauchmo)
- arm64/v8 builds in the GitHub Actions release pipeline

### Fixed

- Improved logging and indexer locking behaviour
- GMs can set player status in schedules
- Search bar and toolbar buttons on mobile
- Bulk tag toolbar on both mobile and desktop

## [1.1.0] - 2026-04-10

### Added

- Scan cancellation
- Log viewer in the settings page

### Fixed

- Roles in sync endpoints correctly reflect the UI

## [1.0.1] - 2026-04-10

### Fixed

- A hung file no longer stalls the library scan; failed books are now listed

## [1.0.0] - 2026-04-06

Initial release. A self-hosted library manager for your TTRPG PDFs, battlemaps, and tokens.

### Added

- Self-hosted PDF library with sharing for your whole group
- Built-in mobile-friendly PDF reader with page-by-page rendering, available as a PWA
- Full-text search across every page of every book
- Automatic organization: drop files into folders and Grimoire infers game system and category
- Campaign tracker with session notes, player invitations, linked resources, and recurring schedules
- Map and token gallery with browsing and tagging, linkable to campaigns
- Per-user bookmarks and favorites
- Explicit content controls with per-user opt-in
- Docker-first deployment

[Unreleased]: https://github.com/hunter-read/grimoire/compare/v1.9.0...HEAD
[1.9.0]: https://github.com/hunter-read/grimoire/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/hunter-read/grimoire/compare/v1.7.3...v1.8.0
[1.7.3]: https://github.com/hunter-read/grimoire/compare/v1.7.2...v1.7.3
[1.7.2]: https://github.com/hunter-read/grimoire/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/hunter-read/grimoire/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/hunter-read/grimoire/compare/v1.6.2...v1.7.0
[1.6.2]: https://github.com/hunter-read/grimoire/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/hunter-read/grimoire/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/hunter-read/grimoire/compare/v1.5.6...v1.6.0
[1.5.6]: https://github.com/hunter-read/grimoire/compare/v1.5.5...v1.5.6
[1.5.5]: https://github.com/hunter-read/grimoire/compare/v1.5.4...v1.5.5
[1.5.4]: https://github.com/hunter-read/grimoire/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/hunter-read/grimoire/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/hunter-read/grimoire/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/hunter-read/grimoire/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/hunter-read/grimoire/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/hunter-read/grimoire/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/hunter-read/grimoire/compare/v1.3.2...v1.4.0
[1.3.2]: https://github.com/hunter-read/grimoire/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/hunter-read/grimoire/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/hunter-read/grimoire/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/hunter-read/grimoire/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/hunter-read/grimoire/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/hunter-read/grimoire/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/hunter-read/grimoire/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/hunter-read/grimoire/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/hunter-read/grimoire/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/hunter-read/grimoire/releases/tag/v1.0.0
