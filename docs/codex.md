# Grimoire Codex DB

[Grimoire Codex DB](https://db.grimoirecodex.org) is a community catalogue of TTRPG
systems and books, in the spirit of MusicBrainz or TMDB: anyone can add or correct
a record, and edits from newer contributors wait for review. Grimoire has it built
in as a metadata source, so there is nothing to install.

It is **off until you set `GRIMOIRE_CODEX_DB_API_TOKEN`**. Without a token, Grimoire Codex DB does
not appear anywhere in Grimoire: not in **Fetch metadata**, not in the editors, and
not in settings. See [Turning it on](#turning-it-on).

Grimoire uses Grimoire Codex DB in three ways:

- **Look up metadata.** Grimoire Codex DB is the first source in **Fetch metadata** on every book
  and game system. You review a field-by-field diff before anything is written, the
  same as with [community add-ons](addons.md).
- **Link records.** Applying a Grimoire Codex DB result also stores the Grimoire Codex DB record's id on the
  book or system (`codex_id`). A linked record shows a link to its Grimoire Codex DB page in its
  editor.
- **Send records back.** A GM or admin can add a book or system to Grimoire Codex DB,
  or send chosen fields as a correction to the linked record.

## Turning it on

1. Sign in on [Grimoire Codex DB](https://db.grimoirecodex.org) and create a token under
   **Account → API tokens**. It starts with `cdx_` and is shown only once.
2. Set it as `GRIMOIRE_CODEX_DB_API_TOKEN` in Grimoire's environment (for example in
   `docker-compose.yml`) and restart Grimoire.
3. **Settings → Add-ons → Grimoire Codex DB** now appears. Use **Test connection** to
   check that the token works.
4. **Recommended:** turn on **Send file hashes when looking up books** there (or set
   `GRIMOIRE_CODEX_DB_SEND_HASHES=true`). It is off by default; see
   [What is sent](#what-is-sent-and-when) for the trade-off.

The token is read only from the environment. Grimoire never stores it in its
database or backups, and never shows it in the UI or the API. To turn
Grimoire Codex DB off, remove the variable and restart.

## What is sent, and when

Grimoire only contacts Grimoire Codex DB when someone asks it to: opening **Fetch metadata**
with Grimoire Codex DB selected, sending a record, or testing the connection in settings.
Nothing runs in the background or on a schedule.

- **Book lookups** send what Grimoire already knows about the book to Grimoire Codex DB's
  `/match` endpoint: title, file name, ISBN, product code, authors, publisher, the
  game system's name, year and page count. Grimoire Codex DB weighs these together, so a book
  with an ISBN or a distinctive title is usually found on the first try. If you type
  your own search, only that text and the system's name are sent.
- **File hashes** (the SHA-256 Grimoire already keeps for each file) identify a book
  exactly, even with an unhelpful file name, and the hashes on books you send let
  other libraries with the same file find it the same way. **We recommend turning
  them on.** They are off by default because they also tell Grimoire Codex DB which
  exact files this library holds. Turn on **Send file hashes** in settings to
  include them in lookups and in books you send.
- **System lookups** send the system's name, or your search text.
- **Sending a record** sends the fields listed under
  [Sending records](#sending-records). Paths, access levels and cover choices stay
  local.

Every request carries the API token, so Grimoire Codex DB sees lookups as coming from
the token's account. That also means the account's own Grimoire Codex DB settings,
such as showing explicit records, apply to lookups.

## Settings

**Settings → Add-ons → Grimoire Codex DB** (admins only, shown once `GRIMOIRE_CODEX_DB_API_TOKEN`
is set):

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| Grimoire Codex DB address | `https://db.grimoirecodex.org` | Change only to use a self-hosted Grimoire Codex DB. Plain `http://` is accepted for a server on your network. |
| Send file hashes when looking up books | off | Recommended on. See [What is sent](#what-is-sent-and-when). |

Each setting can be pinned with an environment variable, which makes it read-only in
the UI: `GRIMOIRE_CODEX_DB_URL` and `GRIMOIRE_CODEX_DB_SEND_HASHES`. See
[Configuration](configuration.md#environment-variables).

## Finding and linking a record

1. Open a book's or system's editor and choose **Fetch metadata**. In the reader, it is
   also at the top of the details panel's editor.
2. Pick **Grimoire Codex DB** as the source. For a book, the first search uses
   everything Grimoire knows about it; each result shows why it matched (for example
   "Same ISBN, Same author"). For a system, it searches by name.
3. Choose a result, or paste a Grimoire Codex DB link (`https://db.grimoirecodex.org/books/…`) or
   id directly.
4. Review the diff. The **Grimoire Codex DB link** row is pre-selected when the record
   is not linked yet. Untick it to copy fields without linking.

Some fields are never offered from Grimoire Codex DB because they describe your file rather
than the book: category, page count and file size.

To unlink, choose **Unlink** in the editor's Grimoire Codex DB section. That only clears
the local `codex_id`; nothing changes in Grimoire Codex DB.

## Sending records

Sending is available to GMs and admins. Edits are
credited to the Grimoire Codex DB account that owns the token, so on a shared server everyone
who can edit metadata sends as that account.

- **Add to Grimoire Codex DB** (unlinked records) creates a new Grimoire Codex DB record and asks where the
  information comes from, because reviewers need it. A book can only be added once
  its game system is linked, since Grimoire Codex DB needs to know which system it belongs to.
- **Send corrections** (linked records) sends only the fields you tick. Grimoire Codex DB
  updates just those fields and leaves the rest of its record alone. Authors and
  artists replace only those credits, so editors, designers and other roles on Grimoire Codex DB
  are kept. A correction never changes which systems a Grimoire Codex DB book belongs to: a
  Grimoire Codex DB book can belong to several systems, and Grimoire knows only one.

Whether an edit applies at once or waits for review is up to Grimoire Codex DB, based on the
account's trust and the fields involved. A new record that waits for review is
**not** linked yet, because it may be rejected. Look it up again once it is approved.

Fields that can be sent:

- **Books:** title, description, category, authors, artists, publisher, publisher
  link, links, genres, ISBN, product code, version, language, license, year, month,
  day, page count, tags, explicit.
- **Systems:** name, description, publishers, links, character builders, genres,
  dice/materials, system family, parent system, edition, license, year, tags,
  explicit, system-agnostic, one-page.

## API

The endpoints are listed in the [API reference](api.md#grimoire-codex-db-issue-35).
Lookups go through the normal `metadata-sources` / `metadata-search` /
`metadata-fetch` endpoints with `source_id: "grimoire-codex"`.
