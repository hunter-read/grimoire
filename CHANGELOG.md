# Changelog

All notable changes to Grimoire are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Release candidates are omitted; their contents are rolled into the stable release that followed.

## [Unreleased]

### Added

- The users list shows when each person was **last active**, fading as it ages so the ones who have drifted away stand out; expand a user for when they last signed in. Log lines now carry the user whose request produced them, sign-ins are logged, and Settings → Logs can be narrowed to one user from a picker, a name on a log line, or **View in logs** on the user. See the users and permissions docs

- Add-on sources can be private repositories. Give a source an access token under Settings → Add-ons (the key beside it) and its add-ons, character sheets, content packs, themes and note templates browse, install and update like a public catalogue's. The token is sent only to files inside that source, never to other sites, and is stored encrypted and never shown again. `ADDON_INDEX_CREDENTIALS` pins tokens on the server. See the add-ons docs for GitHub and Gitea setups
- **Join pages** in spread view draws the two pages as one image, with no gap, inner corners or shadow between them, so a map or illustration printed across a spread reads as one picture. It is under Spread in the reader's menu and a button in the PDF map viewer, and is remembered per book and per map
- The reader zooms up to 800%, from 200%. Past about 200% Grimoire renders just the part of the page you are looking at in full detail and lays it over the page, so small print stays sharp without rendering a huge image of the whole page
- Zoom now stays when you turn the page, landing at the top of the next page in the same column. A new book, switching between Page and Spread, or reset returns to 100%
- When linking resources to a campaign, tick a folder to select everything in it, subfolders included. A partly selected folder shows a dash, and ticking it again clears it
- Password rules: new account passwords need at least 12 characters and new share-link passwords at least 8, and commonly used passwords are refused (checked against a list that ships with Grimoire, nothing leaves your server). Set `PASSWORD_MIN_LENGTH` and `SHARE_LINK_PASSWORD_MIN_LENGTH` to change the minimums. Passwords you already have keep working. Scripts that create users through the API are held to the same rules
- Failed sign-ins are also counted per account, and wrong share-link passwords per link, whatever address they come from (`ACCOUNT_RATE_LIMIT`, default `20/hour`). A browser you have signed in from before keeps its own count
- `TRUSTED_PROXIES` lists the reverse proxies whose `X-Forwarded-For` Grimoire reads. The default covers proxies and tunnels on the same host, Docker network or LAN, so most installs need no change. If a proxy reaches Grimoire from a public address - a VPS, or Cloudflare's proxy without Cloudflare Tunnel - add its addresses; see the security docs
- Book pages are now rendered in a separate process, so a damaged PDF that crashes the PDF library fails that one page instead of stopping Grimoire. The same goes for a book's table of contents and for exporting pages and cut-outs. `RENDER_WORKERS` sets how many render processes run (default `1`); more render different books in parallel on multi-core hosts, and `0` keeps rendering inside Grimoire. Render processes stop when nobody is reading. See the performance docs
- Character sheets can hold pictures besides the portrait - a knight's coat of arms, a ship. A sheet declares an `image` field and places it like any other; you add, replace or remove the picture right on the sheet. Sheets can also place the character's art itself with `<g-portrait>`, and the D&D 5e (2024) sheet now shows it large on its Spells & Details page
- Click a character's art to see it large. On your own character you can choose its framing there - click or drag to pick the part that stays in view, and zoom in - and the header, the Characters list and the sheet all keep that part showing, so tall art no longer loses its head
- Character exports carry the character's art, its framing and any other pictures on the sheet, and importing restores them
- Players can let their campaign's GM edit their character. Tick **Let the GM edit** in the sheet's header and the GM can change the sheet's values, the character's name and its pictures, whatever sheet it is built on. It is off by default, other players at the table still only read the sheet, and moving the character to another campaign turns it off again
- Folder naming patterns, under Settings → Metadata: describe how the books in a folder are named - `{system} - [{publisher}] - {*} - {title}< (v{version}, {year})>`, say - and new books there take their title, publisher, version and year from the filename instead of showing the whole name. A preview lets you re-title the books already there, and a pattern without `{*}` can also rename files to match, or move a folder onto a new naming scheme. Renamed books keep their tags, progress and sidecars, and nothing is renamed unless you choose to. See the filename rules docs
- A campaign's page lists the characters played in it, grouped under each player, with the GM's own first - so a GM can keep NPCs, or a solo game's party, with the campaign. Each player's current character shows; their retired and fallen ones fold away behind a "past characters" toggle. **Add character** brings one of your own characters to the table from there
- Variant filename rules, under Settings → Metadata: teach duplicate detection your own markers - `GL_` for gridless, `-pf` for printer friendly, `night` for a label - and it pre-fills them ahead of the built-in ones
- The reader shows the book's game system before its title, as a link to that system's page. A book opened from a link shared elsewhere, with nothing to go back to, is now one click from the rest of its system
- `STARTUP_SCAN=false` skips the library scan Grimoire runs every time it starts, for very large libraries where a restart for an image update or a setting change shouldn't mean a long scan. New files are then found by a manual or scheduled rescan. See the configuration docs

### Changed

- Book pages open faster from campaign notes and search. While a note is open, the book pages it links to start rendering in the background, a few at a time and at most eight per note. In search, resting the pointer on a page result for a moment, or pressing it, starts that page loading before the click lands. A page that two requests ask for at once now renders once instead of twice
- Grimoire uses much less memory: about 250 MB once your library is scanned, down from about 550 MB, and about half as much at peak while several people read
- The image runs one worker by default (`WORKERS=1`), and one worker now serves several readers at once faster than two did before. If your compose file sets `WORKERS=2` from an older example, change it to `1` to get the saving; the performance docs explain when two is worth it
- After a reading session, Grimoire closes the books it had open and gives back the memory used to render their pages once nobody has read anything for 5 minutes. `PAGE_IDLE_RELEASE` sets how long it waits; `0` turns this off
- Faster first start for a new or updated container: the image now ships the compiled Python it needs instead of building it on first start
- Updated FastAPI, Pydantic and Uvicorn. API keys keep exactly the access they had
- The image builds its frontend with Node 22, the version CI tests with; Node 20 is end of life. Running from source now needs Node 22 or newer
- The MCP server now runs on the official MCP Python SDK instead of Grimoire's own protocol code, and also accepts the older `2024-11-05` protocol revision. Tools, resources, prompts and API-key permissions are unchanged
- The MCP server also speaks the `2026-07-28` protocol revision, the stateless one with no `initialize` step, so newer assistants connect on it. Older revisions still work, and tools, resources, prompts and API-key permissions are unchanged
- Updated the frontend to React 19, along with its build, test and lint tooling
- For contributors: the frontend is moving to TypeScript. Its API client is now typed from the backend's OpenAPI schema, so a change to a request or response shows up as a type error in the same pull request, and new or changed frontend files are written in TypeScript. See the TypeScript docs
- Replacing books' files by upload one after another no longer fails while the previous replace is being re-indexed. Each replace queues its book for one background re-index that reads every replaced book in turn, so a script or `grimoire-cli files upload --on-conflict replace` can send a whole batch back to back. Re-indexing a single book from its page uses the same queue, so it no longer blocks replaces either, and is no longer skipped while one runs. A replace still waits out a library scan or OCR run, and a book the re-index is reading at that moment
- For contributors: importing a backend module no longer starts Grimoire. `backend.config` only reads settings; creating the data folders, migrating the database and connecting to Valkey happen in `config.startup()`, which the app runs as it starts. Scripts and workers can import settings without touching the database. See the architecture docs
- For contributors: the database models are declared with SQLAlchemy 2.0's typed `Mapped[...]` columns, and mypy now runs with all of its error checks on. The schema itself is unchanged
- `X-Forwarded-For` is read only from a trusted proxy, right to left, so each client behind your proxy gets its own address in rate limiting and Active Sessions. A working API key is never refused because its address is over the failed-key limit
- Requests from GM and admin accounts check the account's current role every time, so a role change, a deleted account or signing a device out applies straight away. A guest's session ends once guest access is turned off or the guest is removed, and deleting a campaign removes its guest accounts
- Single sign-on's **Match Existing Users By** now links only accounts that aren't linked to a provider yet, and while it matches by email only an admin can change a user's email. See the OIDC docs for the details
- **Check your `SECRET_KEY` before upgrading.** Grimoire refuses to start with a `SECRET_KEY` copied from its old install guide or development compose file, and logs a warning for one shorter than 32 characters. If yours was copied, replace it with the output of `openssl rand -hex 32`, or remove it so Grimoire generates and keeps its own. Changing the key signs everyone out and ends existing OPDS and calendar feed URLs and share links, which then need making again. The install guide no longer shows an example key
- At start-up the container only changes the owner of the data folder and a `BACKUP_DIR` set in its environment; a backup folder chosen in Settings is checked and reported in the log instead
- For contributors: GitHub Actions are pinned to commit SHAs, and the release workflow publishes the GitHub release from its own job
- Campaign wiki pages an assistant writes are always private to you, as are any pages its links create; share them from the wiki when you want your table to see them. The `create_wiki_page` tool no longer takes a `visibility` argument. New wiki pages can't be added to a campaign while its GM's campaign access is turned off, in the app or by an assistant
- Campaign files download with a type based on their file extension
- Passwords, email addresses, the admin role, sign-in settings, add-on sources and script approval, and guest invite codes are changed only from a signed-in session, not with an API key; a key's other access is unchanged. A share link made with a key also needs the key to have Read on that item's area (Books, Maps, Tokens, Audio or Models). See the API docs
- Signing in with single sign-on no longer puts an access token in the page address. Grimoire sets the session cookies and sends you back where you were, and the app picks the session up from them, as it does when you return to Grimoire later. Sign-in errors from your provider show a standard message for its error code
- Requests that change something need the `Authorization` header the app sends, or an API key. The session cookie and the deprecated `?token=` parameter now count only for viewing and downloading. Scripts that relied on the cookie for changes need to send the header
- Turning explicit content off for a user is now a restriction they can't lift: when an admin, the `denyExplicit` seed setting or the OIDC `viewNSFW` permission turns it off, the user's own setting can no longer turn it back on (it shows why). Users can still turn it off for themselves at any time. Users who already have explicit content off start out restricted this way, since Grimoire can't tell who turned it off; an admin can turn it on for anyone who chose it themselves
- With explicit content off, search no longer shows explicit books, tokens or models, and an explicit book's details answer "not found", the same as for books you can't open. The same applies to an assistant using the MCP server
- Sign-in cookies are marked HTTPS-only whenever the request arrived over HTTPS - directly or through a trusted proxy - not only when `BASE_URL` starts with `https://`. The install guide now explains `BASE_URL`
- The example Docker Compose files now give Valkey a password. If you run Valkey from one of them, add `--requirepass` to the Valkey service and the password to `VALKEY_URL` (`redis://:<password>@valkey:6379/0`); see the configuration docs
- The OIDC client secret entered in Settings is stored encrypted under `SECRET_KEY`, so a backup doesn't carry it, and an existing one is converted on upgrade. If `SECRET_KEY` changes, single sign-on stops until the secret is entered again. Setting `OIDC_CLIENT_SECRET` instead is recommended
- Users seeded from `users.json` follow the password rules, and an entry with a short or common password is skipped. Afterwards the file is kept as `users.json.imported` with password hashes in place of plaintext. The passwords in `users.json.example` must now be replaced before it imports anything
- Links on books, game systems and publishers, and campaign members' character sheet links, must be `http://` or `https://`. Wiki links and images keep `http(s)`, `mailto:` and relative links, and wiki embeds with a malformed id are ignored
- The admin-only lists of every user's share links can't be read with an API key
- A map's grid can't claim cells smaller than 4 pixels, and OTFBM backgrounds are capped at 16383 pixels per side and 100 megapixels
- A wiki imported as a `.zip` is held to the import limits once unpacked (25 MB and 2000 files), not only as uploaded
- Single sign-on reads the provider's userinfo only when it describes the same user as the ID token, and takes an email address and whether it is verified from the same one of the two
- Calibre `.opf` sidecars are read with a parser that refuses entity declarations
- Access tokens are no longer accepted in the page address (`?token=`); the app had stopped using it, and images and downloads authenticate with the session cookie. The app now keeps its access token in memory rather than browser storage, and tabs take turns refreshing it
- The interactive API docs and the OpenAPI schema need a signed-in account by default. `API_DOCS=public` serves them to anyone, as before, and `API_DOCS=off` turns them off
- The MCP endpoint only answers under loopback, the host in `BASE_URL`, and hosts listed in the new `MCP_ALLOWED_HOSTS`. If an assistant connects to Grimoire at another address, such as a LAN IP, set `BASE_URL` or add it there
- Usernames are unique regardless of case, matching how sign-in already compared them. If two existing accounts differ only in case, the log names them; rename one
- Add-on index URLs must use `https://`, except on `localhost` or a private network address
- Add-on scripts no longer see Grimoire's credentials in their environment
- Changing your own explicit-content setting needs a signed-in session rather than an API key
- Pinned the remaining floating Python dependencies, and updated the bundled FFmpeg to 7.0.3
- For contributors: the development compose file tags its build `grimoire:dev`, so it no longer replaces a pulled image, and an image built from a working tree leaves out local databases, keys and seed files. A container started with `PGID=0` logs a warning
- For contributors: routes serve files through one helper that always applies the content policy, and tests now check that routers reading books or systems apply the access rules and that deleting a user handles every table that refers to one
- With an OIDC permissions claim configured, a newly registered account whose claim has no `viewNSFW` now starts with explicit content off and locked, instead of allowed. Send `"viewNSFW": true` to grant it. Existing accounts keep their current setting when the key is missing
- Passwords are hashed with bcrypt directly instead of through the unmaintained passlib library, in the same format, so every existing password and share-link password keeps working. The FAQ's password-reset command and the command for pre-hashing a password in a users file have changed to match

### Fixed

- **Stop** now stops the startup library scan when Grimoire runs more than one worker without Valkey. The request could reach a worker other than the one scanning, which ignored it and kept rescans of a single folder refused until the scan finished
- With `OCR_CONCURRENCY` above `1`, **Stop** now ends text recognition after the books already in progress, rather than starting every queued book after it
- Renaming a file to change only its capitalisation (`crystallica.pdf` to `Crystallica.pdf`) was refused as "already exists" on macOS and Windows
- Search results in the reader's search sidebar showed apostrophes, quotes and ampersands as `&#x27;`, `&quot;` and `&amp;`
- OPDS book covers didn't load in e-readers; they are now served under the feed's own token
- Deleting a user, or merging a guest into an account, could fail when they had saved audio sets, installed themes or character importers, hidden wiki pages, or had made a wiki template
- Merging a guest into an account failed when both had favourited the same item, saved a filter under the same name, answered availability for the same session date or written a note on the same session. The account you merge into now keeps its own copy, and keeps its default filter if both had one for the same view
- Deleting a user or a campaign, removing a guest, or merging guests could be left half done if it failed partway: the user's sign-ins were already ended, a campaign was deleted without its guests, or the first accounts of a merge were folded in and the rest were not. Each now completes or changes nothing. Ending sign-ins after a password or role change, or a new guest code, also now saves together with that change
- Signing in with single sign-on fetched the provider's discovery document on every sign-in when only the issuer was configured; it is now kept for an hour
- With `VALKEY_URL` pointing at a cache that can't be reached, Grimoire could take about two minutes to start before falling back to the disk cache. It now gives up after a couple of seconds
- Two people reading the same book at once no longer render its pages in the same PDF document simultaneously, which the PDF library does not support and which could crash the server. Opening a large PDF or EPUB also no longer holds up page loads for other books
- Exporting a spread as one joined image could leave a faint light line down the middle at some page sizes and resolutions
- The campaign resource picker's Models tab showed `campaignEditor.resources.type_model` instead of its name
- The campaign resource picker offered tabs for maps, tokens, audio or models even when those sections were hidden in Settings, and adding by tag could add them
- Reading more than ten books at once, or replacing a book's file while someone was reading it, could close the book under a page that was still loading and fail that page
- The sidebar could flash the "Update available" banner on load for a version you had already dismissed
- In the map, token, audio and model galleries, the Filters dialog closed after every change, so only one filter could be set at a time, and typing quickly in the search box could lose the end of what you typed while results reloaded. The gallery now stays on screen while new results load
- On a GM-run campaign's Schedule tab, setting a player's availability failed instead of saving
- A character sheet formula that was very long or deeply nested, produced a very large number, or read a field set to something like `1e999` could fail the sheet, or the schema install, with a server error, and a computed value that kept multiplying itself through a long chain could stall the server. Such a formula now gives its default value straight away
- Downloads named after a campaign, book or file could fail when the name held an emoji or other non-Latin characters, or a quote
- A tag containing both a `'` and a `"` broke the whole OPDS feed
- Bookmarking a book that doesn't exist returned a server error; it now answers "not found", as does bookmarking a book you can't open
- The custom login message is cleaned with a real HTML parser, so a quote inside a link can no longer change the link's other attributes, and the settings editor cleans a stored message again before showing it
- Signing in with a username that doesn't exist takes as long as a wrong password
- Backups now include character portraits, which they had left out
- Deleting a character, or an account with characters, now deletes their art too, rather than leaving the files behind

### Security

- Grimoire no longer runs as root inside the container. It switches to an ordinary user before starting - by default whoever owns your library folder - so a flaw in a PDF or archive parser or a third-party add-on would not have root access. Existing installs need no changes: the first start hands your data folder to that user, and if that user couldn't reach something root could, Grimoire stays root and the log explains how to fix it. Set `PUID` and `PGID` to choose the user, or start the container with `--user`. Rootless Podman and Docker are unaffected
- The image build now checks the `ffmpeg` source against a pinned checksum, pins its base images by digest, and no longer hides a failed Python dependency install
- OPDS feed, calendar feed and share-link tokens are no longer stored in plaintext. The database holds a keyed hash to match requests on and an encrypted copy so you can still copy your links, both tied to `SECRET_KEY`, which backups do not contain - so a leaked backup no longer hands out working feeds or share links. Every URL already handed out keeps working: the upgrade converts them in place, then compacts the database once so the old values do not linger in it
- Backups now contain only live data. The database used to be copied page by page, which carried deleted and overwritten rows along in the file's free space
- The Valkey password no longer appears in the log when `VALKEY_URL` includes one
- Changing `SECRET_KEY` now also ends every feed URL and share link, as it already did every session. Share links made under the old key show as **Lost**

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
