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
  or send what differs as a correction to the linked record, with its cover and
  the source its data came from.

## Turning it on

1. Sign in on [Grimoire Codex DB](https://db.grimoirecodex.org) and create a token under
   **Account → API tokens**. It starts with `cdx_` and is shown only once.
2. Set it as `GRIMOIRE_CODEX_DB_API_TOKEN` in Grimoire's environment (for example in
   `docker-compose.yml`) and restart Grimoire.
3. **Settings → Metadata → Grimoire Codex DB** now appears. Use **Test connection** to
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
With [collection sync](#keeping-your-collection-in-sync) on, linking, unlinking and
**Sync collection now** contact it too. Nothing runs in the background or on a schedule.

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
- **Collection sync** (off by default) sends the Grimoire Codex DB ids of the books and
  systems this library is linked to, and nothing else about them. Like file hashes, it
  tells Grimoire Codex DB what this library holds, which is why it is opt-in.
- **Sending a record** sends the fields you choose from those listed under
  [Sending records](#sending-records), the cover when you tick it, and the source
  link you pick. Paths and access levels stay local.

Every request carries the API token, so Grimoire Codex DB sees lookups as coming from
the token's account. That also means the account's own Grimoire Codex DB settings,
such as showing explicit records, apply to lookups.

## Settings

**Settings → Metadata → Grimoire Codex DB** (admins only, shown once `GRIMOIRE_CODEX_DB_API_TOKEN`
is set):

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| Grimoire Codex DB address | `https://db.grimoirecodex.org` | Change only to use a self-hosted Grimoire Codex DB. Plain `http://` is accepted for a server on your network. |
| Send file hashes when looking up books | off | Recommended on. See [What is sent](#what-is-sent-and-when). |
| Keep my Grimoire Codex DB collection in sync | off | Marks the linked books and systems as owned in the token account's collection. See [Keeping your collection in sync](#keeping-your-collection-in-sync). |

Each setting can be pinned with an environment variable, which makes it read-only in
the UI: `GRIMOIRE_CODEX_DB_URL`, `GRIMOIRE_CODEX_DB_SEND_HASHES` and
`GRIMOIRE_CODEX_DB_SYNC_COLLECTION`. See
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
the local `codex_id`; the record itself does not change in Grimoire Codex DB. With
collection sync on, it also takes back the record's "owned" mark (see below).

## Keeping your collection in sync

Grimoire Codex DB lets a signed-in person mark the books and systems they own, then
filter its lists by **Owned** and **Not owned**. A system counts as owned when you own
any of its books, or when it is marked itself. Grimoire can keep those marks for you:

1. In **Settings → Metadata → Grimoire Codex DB**, turn on **Keep my Grimoire Codex DB
   collection in sync** (or set `GRIMOIRE_CODEX_DB_SYNC_COLLECTION=true`).
2. Grimoire runs a first sync straight away. It marks every book and system linked to a
   Grimoire Codex DB record, and leaves out books whose file is missing.
3. From then on, linking a book or system marks it, and unlinking it takes the mark back,
   unless another book or system here is still linked to the same record.

The marks go to the collection of the account that owns `GRIMOIRE_CODEX_DB_API_TOKEN`,
so create the token on your own account if you want them on it. Grimoire's marks are
tagged as coming from Grimoire, and Grimoire only ever changes those: marks you make
yourself on the site stay, even if you unlink the book here.

Books deleted from the library are caught by **Sync collection now**, which replaces
every mark Grimoire made with what is linked at that moment. It reports how many records
were marked, and how many linked ids Grimoire Codex DB no longer knows (a record deleted
there). Relink or unlink those to tidy them up.

A mark that fails to send, for example while Grimoire Codex DB is down, never stops the
link or unlink. The next **Sync collection now** puts it right. Turning the setting off
stops sending but leaves the existing marks; remove them on Grimoire Codex DB.

## Sending records

Sending is available to GMs and admins. Edits are
credited to the Grimoire Codex DB account that owns the token, so on a shared server everyone
who can edit metadata sends as that account.

Both buttons open the same form. It first compares the saved record with Grimoire
Codex DB (every field is new for a record that is not linked yet) and ticks the
fields worth sending: the ones Grimoire Codex DB has nothing for, and the ones where
the two disagree, shown side by side. Fields that already match are folded away,
and a field this library has left empty is never offered, because sending it would
clear Grimoire Codex DB's value. It compares what is saved, so save your edits first.

- **Cover.** A book sends its first page, rendered sharper than the library
  thumbnail; comics, images and other formats send the thumbnail. A system sends
  the cover it shows in the library. The cover is ticked when Grimoire Codex DB has
  none; when it has a different one it is offered but left unticked, because theirs
  may be the better scan. Grimoire Codex DB keeps one copy of each image, so a cover
  it already has is recognised and never listed.
- **Source.** Pick the scraper add-on the data came from, or **Another link**. A
  scraper is pre-picked when the record links to its site, with that page filled
  in. The link goes to reviewers as evidence. For a scraper, the description and
  tags (whichever are being sent, or already match) are also credited to it:
  text from another site is not CC0, so Grimoire Codex DB names the source wherever
  it shows it. A later credit to the same source replaces the earlier one.
- **Note.** Optional. A new record needs a source link or a note only when Grimoire
  Codex DB does not trust the account yet, and it says so if one is missing.
- **A new book's game system.** When the system is not linked, the form lists the
  Grimoire Codex DB systems with a similar name (an exact match is chosen for you)
  and offers to add the system as a new record instead. Joining an existing one
  links the local system once the book is sent. Adding one sends the system first,
  with its cover and the same source; if it waits for review, the book is held back
  until it is approved, because a book cannot belong to a system that does not
  exist yet.

A correction updates just the fields sent and leaves the rest of the Grimoire Codex
DB record alone. Links are added, never removed. Authors and artists replace only
those credits, so editors, designers and other roles on Grimoire Codex DB are kept.
A correction never changes which systems a Grimoire Codex DB book belongs to: a
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
