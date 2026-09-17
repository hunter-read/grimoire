# Changelog

All notable changes to Grimoire are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Release candidates are omitted; their contents are rolled into the stable release that followed.

## [Unreleased]

### Added

- Italian (it-IT) localization
- Link to the documentation site from the About dialog

### Fixed

- Non-Docker installs report their real version instead of `1.0.0` in the About dialog
- Return keyboard focus to the file list after a dialog closes

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
- Added changelog to the about dialog

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

- Duplicate manager: better defaults for scans, clearer version labels, and a way out when a duplicate is already marked as a variant
- Thumbnails for animated maps no longer inflate the base image
- Map and token galleries load noticeably faster on large libraries

### Fixed

- Touch gestures and accessibility in the file manager on mobile; menus reachable from empty space
- File manager menu now respects page location, and category scaffolding is scoped to system folders (file manager opens at the library root)
- Map version handling no longer blocks thumbnail generation
- A duplicate scan stuck at 0% after a crash or restart now recovers
- Special collections left stranded after their folder was deleted are cleared
- Every category folder is scaffolded for a system nested in a container, and system/category are preserved when renaming inside one
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
- The read-only library recommendation no longer applies. Library management features require write access to the library volume. Read-only mounts are still supported, with those features disabled.

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

- FAQ section on configuring OIDC with Google (thanks @DRebd, #375)

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
- Middle click opens cards and chips in a new tab (thanks @strass, #323)
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

- Category keywords match on whole tokens rather than substrings (#188)
- Docker entrypoint respects the `WORKERS` env var for the uvicorn worker count (thanks @fesxj, #142)

## [1.4.0] - 2026-06-18

Campaigns reworked: expanded notes and a single consolidated campaign overview page.

> **Note:** this release includes an irreversible database migration. Back up your data directory before upgrading.

### Added

- Card, compact, and list views for Library, System, Maps, and Token views, with per-user preferences that also apply to Favorites
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

- Configured groups and permissions claim names are requested as OIDC scopes (#92)

## [1.3.1] - 2026-05-20

### Fixed

- `users.hashed_password` migrated to nullable so OIDC user creation works (#91)

## [1.3.0] - 2026-05-18

### Added

- OpenID Connect authentication and an email field on users (#72)
- System Agnostic parent folder support (#55)
- Scheduled database cleanup as part of scheduled rescan (#69)
- Tag export under Settings → Maintenance (#63)
- Search filters, grouped results, and a favorites-only filter (#87)
- Tag autocomplete, keyboard shortcut overlay, and reading improvements (thanks @KrapfalAT, #49)

### Fixed

- Tags normalized to lowercase across all write paths and existing data (#58)
- Admin user deletion blocked by foreign key constraints (#60)
- Ungrouped items displayed above grouped folder sections (#68)
- Cleanup guarded against hung mounts, blocked during active scans, with cascading bookmark deletion (#70)
- Thumbnail 404 after a book rename (#85)
- Image files within books are viewable (#86)
- Image-only PDFs are no longer marked as index failed (#89)
- Env table rendering in the README (thanks @joshgamache, #76)

## [1.2.1] - 2026-04-16

### Added

- German localisation with a dynamic language switcher in settings (thanks @KrapfalAT, #36)
- French localisation (#37)
- Version update notifications and an About modal (#45)

### Fixed

- Region added to localization (#38)
- `navigator.language` used as a fallback, plus a dropdown for language selection (#47)
- `no-store` cache header on `index.html`; enhanced PWA manifest (#44)

### Documentation

- Updated Docker documentation in the README (#41, #48)

## [1.2.0] - 2026-04-15

### Added

- i18n localization support (#31)
- OPDS catalog support
- Books can be grouped into collapsible subfolders within any category (#34)

### Changed

- Scroll position and folder expand/collapse state persist across navigation (#32)

### Fixed

- Reader back button returns to the last read page before a ToC or bookmark jump (#33)

## [1.1.2] - 2026-04-14

### Added

- Reading progress and recently opened books (thanks @KrapfalAT, #19)
- Tag support for library books (thanks @KrapfalAT, #18)
- Archive download with a format picker modal for systems, maps, and tokens (#25)
- Book sorting, reader keyboard shortcuts, and a favorite indicator (thanks @KrapfalAT, #28)
- Admins can set a new password for any other user in user management settings (#27)

### Fixed

- Infinite scan loop caused by problematic files hanging the worker during thumbnail generation (#21)
- `is_missing` flag tracks library items whose files no longer exist on disk (#29)

## [1.1.1] - 2026-04-12

### Added

- Filter and collapse/expand toolbar in the library view (thanks @rauchmo, #10)
- arm64/v8 builds in the GitHub Actions release pipeline (#15)

### Fixed

- Improved logging and indexer locking behaviour (#15)
- GMs can set player status in schedules (#15)
- Search bar and toolbar buttons on mobile
- Bulk tag toolbar on both mobile and desktop

## [1.1.0] - 2026-04-10

### Added

- Scan cancellation (#8)
- Log viewer in the settings page (#8)

### Fixed

- Roles in sync endpoints correctly reflect the UI (#8)

## [1.0.1] - 2026-04-10

### Fixed

- Library scan/index progress could stall permanently; added timeouts to scanning and indexing so a hung file no longer blocks the rest of the library, plus visibility into books that fail to scan or index

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

[Unreleased]: https://github.com/hunter-read/grimoire/compare/v1.7.1...HEAD
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
