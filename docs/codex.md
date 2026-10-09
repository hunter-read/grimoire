# Grimoire Codex

[Grimoire Codex](https://db.grimoirecodex.org) is a community catalogue of TTRPG
systems and books, in the spirit of MusicBrainz or TMDB: anyone can add or correct
a record, and edits from newer contributors wait for review. Grimoire has it built
in as a metadata source, so there is nothing to install.

Grimoire uses Codex in three ways:

- **Look up metadata.** Codex is the first source in **Fetch metadata** on every book
  and game system. You review a field-by-field diff before anything is written, the
  same as with [community add-ons](addons.md).
- **Link records.** Applying a Codex result also stores the Codex record's id on the
  book or system (`codex_id`). A linked record shows a link to its Codex page in its
  editor.
- **Send records back.** With an API token, a GM or admin can add a book or system to
  Codex, or send chosen fields as a correction to the linked record.

## What is sent, and when

Grimoire only contacts Codex when someone asks it to: opening **Fetch metadata**
with Codex selected, sending a record, or testing the connection in settings.
Nothing runs in the background or on a schedule.

- **Book lookups** send what Grimoire already knows about the book to Codex's
  `/match` endpoint: title, file name, ISBN, product code, authors, publisher, the
  game system's name, year and page count. Codex weighs these together, so a book
  with an ISBN or a distinctive title is usually found on the first try. If you type
  your own search, only that text and the system's name are sent.
- **File hashes** (the SHA-256 Grimoire already keeps for each file) identify a book
  exactly, even with an unhelpful file name. They also tell Codex which exact files
  this library holds, so they are **off by default**. Turn on **Send file hashes**
  in settings to include them in lookups and in books you send.
- **System lookups** send the system's name, or your search text.
- **Sending a record** sends the fields listed under
  [Sending records](#sending-records). Paths, access levels and cover choices stay
  local.

Lookups are anonymous. An API token is only used to send records, and to show which
account it belongs to in **Test connection**.

## Settings

**Settings → Add-ons → Grimoire Codex** (admins only):

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| Look up metadata in Grimoire Codex | on | Turn off to hide Codex from **Fetch metadata** and the editors, and to stop all Codex requests. |
| Codex address | `https://db.grimoirecodex.org` | Change only to use a self-hosted Codex. Plain `http://` is accepted for a server on your network. |
| Send file hashes when looking up books | off | See [What is sent](#what-is-sent-and-when). |
| API token | none | A `cdx_…` token from your Codex account (**Account → API tokens** on Codex). Needed only to send records. It is write-only: Grimoire never shows it again. |

Each setting can be pinned with an environment variable, which makes it read-only in
the UI: `CODEX_ENABLED`, `CODEX_URL`, `CODEX_SEND_HASHES` and `CODEX_API_TOKEN`. See
[Configuration](configuration.md#environment-variables). On an air-gapped server, set
`CODEX_ENABLED=false`.

## Finding and linking a record

1. Open a book's or system's editor and choose **Fetch metadata**.
2. Pick **Grimoire Codex** as the source. For a book, the first search uses
   everything Grimoire knows about it; each result shows why it matched (for example
   "Same ISBN, Same author"). For a system, it searches by name.
3. Choose a result, or paste a Codex link (`https://db.grimoirecodex.org/books/…`) or
   id directly.
4. Review the diff. The **Grimoire Codex link** row is pre-selected when the record
   is not linked yet. Untick it to copy fields without linking.

Some fields are never offered from Codex because they describe your file rather
than the book: category, page count and file size.

To unlink, choose **Unlink** in the editor's Grimoire Codex panel. That only clears
the local `codex_id`; nothing changes in Codex.

## Sending records

Sending needs an API token in settings and is available to GMs and admins. Edits are
credited to the Codex account that owns the token, so on a shared server everyone
who can edit metadata sends as that account.

- **Add to Codex** (unlinked records) creates a new Codex record and asks where the
  information comes from, because reviewers need it. A book can only be added once
  its game system is linked, since Codex needs to know which system it belongs to.
- **Send corrections** (linked records) sends only the fields you tick. Codex
  updates just those fields and leaves the rest of its record alone. Authors and
  artists replace only those credits, so editors, designers and other roles on Codex
  are kept. A correction never changes which systems a Codex book belongs to: a
  Codex book can belong to several systems, and Grimoire knows only one.

Whether an edit applies at once or waits for review is up to Codex, based on the
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

The endpoints are listed in the [API reference](api.md#grimoire-codex-issue-35).
Lookups go through the normal `metadata-sources` / `metadata-search` /
`metadata-fetch` endpoints with `source_id: "grimoire-codex"`.
