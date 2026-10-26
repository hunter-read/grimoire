# Changelog

All notable changes to Grimoire are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Release candidates are omitted; their contents are rolled into the stable release that followed.

## [Unreleased]

### Added

- `OCR_MIN_TEXT_COVERAGE` sets how much of a PDF its own text must cover before it counts as a text book (default `0.5`); `0` only reads books with no text at all with OCR, as before

### Fixed

- A scanned book carrying a few pages of real text, such as a digitally-set cover or a bundled web enhancement, is read with OCR instead of being left mostly unsearchable
- A book that is mostly full-page art, such as a map pack, isn't read with OCR just because its pictures carry no text: a few of its pages are sampled first, and it keeps its own text if they read like artwork
- Re-OCR appears in the actions menu of a scanned book with only a few pages of text, so books already in the library can be read in full
- A book asked to be re-read with OCR while another book is being read is no longer left waiting until a restart or the next scan

- Renaming, moving or uploading into a library folder Grimoire doesn't have permission to write to no longer says the library is mounted read-only. It names the folder and the user Grimoire runs as, and points to `PUID`/`PGID`; a library that really is mounted read-only still says so
- Grimoire stays root at start-up when the user it would switch to can't write to folders inside the library, not just the library folder itself, so moving and renaming keep working after updating from a version that ran as root
- On NAS filesystems that refuse writes a permission check allows, Grimoire no longer switches to a user that can't write to the data folder and then fails to start; it tests the data folder with a real write and stays root if that fails

## [1.9.2] - 2026-10-23

### Added

- Sending a book or system to Grimoire Codex DB compares it with Grimoire Codex DB first and ticks the fields that differ, showing both values, so a correction is one click
- The cover can be sent along: a book's first page, rendered sharper than its library thumbnail, or a system's cover art. It is ticked when Grimoire Codex DB has none
- Pick the scraper a record's data came from as its source. Grimoire fills in the record's page on that site and credits the description and tags to it on Grimoire Codex DB
- A v2 OPDS feed lists each game system as its own category, next to All Books. Choose v1 or v2 from the Feed version dropdown under Settings → Connections → OPDS Feed; the original v1 URL keeps working unchanged for apps already using it
- Search Settings from any page of it: press `/` or Ctrl/⌘K, type what you're after ("SSO", "dark mode", "backups") and go straight to it
- Every setting has its own link, such as `/settings/backups#backup-schedule`, that opens its group, scrolls to it and highlights it
- Admins land on an Overview of the server: scanning and watching, the last backup, how people sign in, users and guests, and add-on updates, each linked to its settings
- Settings asks before you leave a page with changes you haven't saved
- Fetch metadata can read a book's own file: **File metadata** offers the title, authors, description, tags, language, date and ISBN written into a PDF, an EPUB, or a comic's `ComicInfo.xml`, with no add-on or internet connection needed

### Changed

- Settings is reorganised into areas listed down the side: **You** (Account, Preferences, Connections) for everyone, and **Server** (Overview, People, Access & sharing, Sign-in, Library, Metadata, Add-ons, Sidebar, Backups, Logs) for admins. Each setting now has one home, and old links such as `/settings/maintenance` still land in the right place
- Long lists such as genres and licences start closed, single sign-on's detailed fields appear once it is turned on, and the area list becomes a dropdown on phones so the current page is always visible
- Database Cleanup shows how many records it would remove and asks before removing them. It refuses, and the cleanup after a scheduled rescan skips, when the library folder is missing or empty, as an unmounted network share would be
- Password sign-in can't be turned off until single sign-on is set up, and single sign-on can't be turned off while password sign-in is off, so no one can be locked out

### Fixed

- A sign-in or sidebar setting that fails to save goes back to its previous value instead of showing a change that never happened
- Script add-ons that need an API token from the server's environment, such as `BGG_API_TOKEN` for the RPGGeek scrapers, receive it. An add-on names the variables it needs, and Grimoire's own credentials are still withheld
- A book whose game system is not in Grimoire Codex DB yet can be sent: choose the matching Grimoire Codex DB system, or send the system along with it
- New books and systems no longer need a note before they can be sent; a source link does the job, and Grimoire Codex DB asks only accounts it does not trust yet
- Collapse All and Expand All on a system's page reach its subfolders too, and Collapse All stays available while any subfolder is open
- A replaced character portrait shows the new picture straight away instead of the cached old one

## [1.9.1] - 2026-10-22

### Added

- Grimoire watches the library and picks up added, renamed, moved or deleted files within seconds, without a rescan. Network shares are checked on a timer. Set under Settings → Maintenance → Watch for Changes
- Merge duplicates in one step: the copy you keep takes the others' metadata, tags, bookmarks, favourites, campaign links and share links, and the files stay on disk unless you delete them
- Admins can merge copies selected in any list, and the duplicates page reviews a group at a time, works from the keyboard, and merges every byte-identical group at once
- Folder naming patterns under Settings → Metadata read a book's title, publisher, version and year from its filename, and can re-title or rename existing books
- Variant filename rules teach duplicate detection your own markers, such as `GL_` for gridless
- The users list shows when each person was last active, and Settings → Logs can be filtered by user
- Private add-on sources, with an access token per source
- The reader zooms up to 800% and keeps your zoom when you turn the page
- **Join pages** shows a spread as one seamless image, for maps printed across two pages
- The reader shows the book's game system as a link to its page
- Character sheets can hold more pictures than the portrait, and a character's art can be viewed large and reframed
- Players can let their campaign's GM edit their character
- A campaign's page lists its characters by player, with **Add character** to bring one of yours
- Tick a folder when linking campaign resources to select everything in it
- Password rules for new passwords: at least 12 characters, or 8 for share links, and no common passwords. Existing passwords keep working
- Failed sign-ins are limited per account as well as per address (`ACCOUNT_RATE_LIMIT`)
- `TRUSTED_PROXIES` names the reverse proxies whose `X-Forwarded-For` is trusted; the default covers the same host, Docker network and LAN
- Book pages render in a separate process, so a damaged PDF fails one page instead of crashing Grimoire (`RENDER_WORKERS`)
- `STARTUP_SCAN=false` skips the scan on start-up, for very large libraries
- Docker images are also published to `ghcr.io/hunter-read/grimoire`

### Changed

- **Check your single sign-on group names before upgrading.** With a Groups Claim set, only groups named exactly `admin`, `gm` and `player` grant roles; set other names under Settings → Authentication or with `OIDC_ADMIN_GROUP`, `OIDC_GM_GROUP` and `OIDC_PLAYER_GROUP`
- **Check your `SECRET_KEY` before upgrading.** A key copied from the old docs or compose files, or the install guide's placeholder, stops Grimoire starting. Replace it with the output of `openssl rand -hex 32`, or remove it to have one generated
- **Scripts that change things must send the `Authorization` header or an API key.** The session cookie only counts for viewing and downloading, and `?token=` is no longer accepted
- **The example compose files give Valkey a password.** If you use one, add `--requirepass` to your Valkey service and the password to `VALKEY_URL`
- Grimoire uses about half the memory, around 250 MB once scanned. The image now runs one worker, so change `WORKERS=2` from an older compose file to `1`
- Book pages open faster from campaign notes and search results
- Replacing several books' files back to back no longer fails while one re-indexes
- New and updated containers start faster
- Single sign-on only links accounts not yet linked to a provider, never links an admin by username, and no longer offers HS256
- Passwords, emails, roles, sign-in settings, add-on sources and guest codes can't be changed with an API key
- Explicit content turned off by an admin or OIDC can't be turned back on by the user, and explicit items are hidden from search
- Role changes, deleted accounts and signed-out devices take effect straight away
- Usernames are unique regardless of case
- Users seeded from `users.json` follow the password rules, and the file is renamed `users.json.imported` afterwards
- The MCP server runs on the official MCP SDK, supports newer protocol revisions, and only answers on known hosts (`MCP_ALLOWED_HOSTS`). Wiki pages an assistant writes are always private
- The interactive API docs need a signed-in account unless `API_DOCS=public`
- Image exports are capped at 250 megapixels
- Add-on scripts no longer see Grimoire's credentials
- Updated to React 19, Pillow 13.0 and FFmpeg 8.1.3, along with FastAPI, Pydantic and Uvicorn. Passwords are hashed with bcrypt directly instead of passlib, and stored passwords keep working. Running from source needs Node 22
- For contributors: the frontend is moving to TypeScript, the models use typed `Mapped[...]` columns with full mypy checks, and CI checks the migrations against the models

### Fixed

- Renaming a system's folder keeps the system and its books instead of leaving an empty shelf, and deleting one removes it cleanly
- **Stop** reaches the startup scan with several workers, and stops OCR after the books in progress
- Renaming a file to change only its capitalisation failed on macOS and Windows
- Usernames such as `Émile` can sign in again
- Deleting users and campaigns and merging guests either finishes or changes nothing, and a guest in several campaigns is kept until none are left
- Deleting a campaign hands its characters back to their players
- Two people reading the same book could crash the server
- Grimoire took about two minutes to start when Valkey couldn't be reached
- **Copy metadata** on the duplicate comparison page never appeared
- Gallery filters closed after every change, and fast typing in search lost characters
- Setting a player's availability on a GM-run campaign failed
- OPDS covers didn't load in e-readers, and some tags broke the feed
- Reader search snippets showed HTML entities such as `&amp;`
- The campaign resource picker showed a translation key and offered sections hidden in Settings
- Downloads named with an emoji or non-Latin characters failed
- Backups now include character portraits, and deleting a character removes its art
- A joined spread export could show a faint line down the middle
- The "Update available" banner flashed for a dismissed version
- Single sign-on sessions show their sign-in address and finish only in the browser that started them
- Players no longer see a campaign's game system if they can't see that system
- Malformed or oversized input gets a clear error instead of a server error

### Security

- Grimoire no longer runs as root in the container; existing installs need no changes, and `PUID`/`PGID` choose the user
- Feed and share-link tokens are stored hashed and encrypted, so a leaked backup doesn't hand out working links
- Backups contain only live data, not deleted rows
- Image uploads are checked by content and limited to PNG, JPEG, WebP and GIF
- The custom login message is cleaned with a real HTML parser, and unknown usernames take as long to reject as wrong passwords
- Calibre `.opf` sidecars are parsed without entity declarations
- The Valkey password no longer appears in the log
- The image build verifies the FFmpeg source and pins its base images

## [1.9.0] - 2026-10-15

### Added

- An MCP server lets AI assistants such as Claude Code search your library, read pages and campaign notes, and cite the book and page, limited to what their API key allows. Off unless `MCP_ENABLED=true`
- Assistants can bookmark pages, tag books and write private wiki pages when asked, but never change or delete what's there
- Ready-made assistant prompts for session prep and rules questions
- Share links: a public, revocable link to a book, map, token, audio track or 3D model, with optional expiry and password and a direct file address for VTTs and Discord
- Manage your share links under Settings → Account → Sharing; admins choose who may create them, and `SHARE_LINKS_ENABLED=false` turns them off
- Set a map up for OTFBM, the battle map renderer behind Avrae's `!map` on Discord
- Character importers for Forge Steel, Pathbuilder 2e, D&D Beyond and DiceCloud build the character on the right sheet, installing it if needed (thanks @ianfhunter)
- `.m4b` audiobooks, with chapter navigation for `.m4b`, `.m4a` and chaptered MP3 files
- Audio tracks are named by their tags and play in album order
- Admins can style the OIDC sign-in button to match their provider
- Magazines & Zines is a built-in book category
- Export from the reader (`e`): a page range as PDF or images, or cut-outs of maps, cards and round tokens. Also in the PDF map viewer
- Admins can save an export straight into a library folder
- Grimoire Codex DB as a metadata source, behind `GRIMOIRE_CODEX_DB_API_TOKEN`, and GMs can submit books, systems and corrections to it
- Fetch metadata from the reader's details panel
- Name the main version of a family, such as Gridless, and duplicate review pre-fills version names from filenames
- Character sheets can let you type a homebrew class, species or background (thanks @ianfhunter)

### Changed

- Map, token, audio and model pages keep Favorite, Add to campaign and Share in a ⋮ menu
- The Campaigns list on the Users page starts collapsed

### Fixed

- Titles, artists and albums tagged in WAV and AIFF files are read
- Admins see Move, Rename and Delete in the reader's ⋮ menu
- A file or folder name that isn't valid UTF-8 is skipped instead of failing the whole scan, and shows greyed out in the file manager
- System descriptions keep their paragraph breaks, and long ones collapse behind Read more

### Security

- SSO sign-in only returns you to a page on your own Grimoire

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

[Unreleased]: https://github.com/hunter-read/grimoire/compare/v1.9.2...HEAD
[1.9.2]: https://github.com/hunter-read/grimoire/compare/v1.9.1...v1.9.2
[1.9.1]: https://github.com/hunter-read/grimoire/compare/v1.9.0...v1.9.1
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
