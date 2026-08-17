# Metadata sidecars

Grimoire's curated metadata — hand-edited titles and descriptions, authors,
tags, scraped add-on results — normally lives only in the app database. Sidecar
export writes it back out as files next to the content, so the library folder
describes itself: copy it to another machine, or rebuild the container with a
fresh `DATA_PATH`, and the metadata travels with the files.

This is the write half of a loop Grimoire already had. The scanner has always
*read* `.opf` files and `tags.json`; this exports the same data back out.

> **Off by default.** Grimoire is otherwise a read-only viewer of your library,
> and writing into it is a deliberate change in posture. Nothing is written
> until an admin enables at least one format.

## Formats

Enable any combination — the tools downstream disagree, so more than one may be
useful at once.

| Format | File | Read by |
|--------|------|---------|
| OPF | `<book>.opf` | Calibre — and Grimoire itself, so it round-trips |
| NFO | `<book>.nfo` | Jellyfin, Kodi, Emby |
| JSON | `<book>.grimoire.json` | Grimoire-native; the only lossless format |

OPF and NFO are best-effort mappings: neither has a slot for most of what
Grimoire tracks, and fields without a home are dropped. **Only the JSON format
is lossless** — enable it if the point is a metadata backup rather than feeding
another application.

## Field mapping

| Grimoire field | OPF | NFO | JSON |
|---|---|---|---|
| `title` | `dc:title` | `<title>` | ✅ |
| `description` | `dc:description` | `<plot>` | ✅ |
| `authors` | `dc:creator opf:role="aut"` | `<author>` (repeated) | ✅ |
| `artists` | — | `<artist>` (repeated) | ✅ |
| `publisher` | `dc:publisher` | `<publisher>` | ✅ |
| `year` / `month` / `day` | `dc:date` | `<year>`, `<premiered>` | ✅ |
| `isbn` | `dc:identifier opf:scheme="ISBN"` | `<isbn>` | ✅ |
| `language` | `dc:language` | `<language>` | ✅ |
| `tags` | `dc:subject` (repeated) | `<tag>` (repeated) | ✅ |
| `genres` | — | `<genre>` (repeated) | ✅ |
| `version` | — | — | ✅ |
| `license` | — | — | ✅ |
| `category` | — | — | ✅ |
| `urls` | — | — | ✅ |
| cover filename | `<guide>` reference | `<thumb>` | ✅ |

Dates keep the precision they have: a book with only a year exports `2014`, not
`2014-01-01`. Inventing a precision the data does not carry would be a lie the
importer would then read back as fact.

## Covers

Optionally writes the book's cached thumbnail beside it as `<book>.jpg`, which
is what makes the folder render nicely in file managers and other apps.

The bytes are copied, not transcoded: Grimoire caches thumbnails as WebP, and
the `.jpg` name is the convention other tools expect. Consumers that sniff
content handle this; those that trust the extension are why the setting is
optional. **An existing cover is never replaced** — cover files carry no marker
identifying who wrote them, so Grimoire cannot tell yours from its own.

## When sidecars are written

Two triggers, with deliberately different behaviour:

**The backfill** (`POST /api/maintenance/sidecars/export`) **creates**. It walks
every indexed book and writes the enabled formats, creating files that do not
exist yet. This is the one-shot run for an existing library.

**Editing metadata refreshes what already exists.** After a book's metadata is
saved — single edit, bulk edit, or bulk tagging — Grimoire rewrites the sidecars
that book *already has*, and creates none. So a `.nfo` that exists stays in step
with the database automatically, while a library you have never backfilled never
grows new files because you renamed a book.

Refresh happens after the save is committed, and a sidecar failure never fails
the edit: your metadata change is saved either way, and the problem is logged.

## Never destructive

**Grimoire only overwrites files it wrote.** Every exported sidecar carries a
generator marker, and a file without one is left alone and counted as
`skipped_foreign`. A `.opf` you maintain in Calibre is yours.

To take those files over, enable `overwrite_foreign` — an explicit choice, off by
default. A sidecar Grimoire cannot read is also treated as foreign: being unable
to prove authorship is not grounds for overwriting.

Writes are atomic. Each file is written to a temporary file in the same
directory and renamed into place, so a crash mid-write cannot leave a truncated
sidecar for the next rescan to read.

## Read-only library mounts

A read-only library is a supported way to run Grimoire, and it is the default in
`docker-compose.dev.yml`:

```yaml
volumes:
  - ./library:/library:ro
```

Sidecar export needs the mount to be read-write. Drop the `:ro` suffix to enable
it. If you do not, export degrades gracefully rather than crashing: the run
reports `read_only: true` with an actionable message and stops early instead of
producing one identical error per book. Metadata edits keep working normally —
only the sidecar refresh is skipped.

## Interaction with sidecar import

Export and import have to agree, or a scan will fight the exporter: export
writes a file, the next rescan reads it back, and any mismatch causes drift.

Grimoire's OPF exporter is the exact inverse of its OPF importer — every element
written is one the importer reads — so an export followed by a rescan reproduces
the same values. This is enforced by a round-trip test.

Precedence is set by the **metadata refresh mode** used when scanning:

| Mode | On rescan | Use with export |
|------|-----------|-----------------|
| `new` | Sidecars apply only to newly indexed books | Safe |
| `missing` | Fills only fields the database has empty | **Recommended** — the database wins, so re-import is a no-op |
| `replace` | Sidecar values overwrite the database | Only if the sidecars are your source of truth |

With `missing`, the database is authoritative and exported sidecars are a
one-way mirror. With `replace`, edit the sidecars in another tool and let
Grimoire pick them up — but note the two triggers then compete, and a UI edit
followed by a rescan will lose to whatever the sidecar says.

`.nfo` and `.grimoire.json` are export-only today; the scanner does not read
them back, so they cannot drift regardless of mode.

## Settings

Configure via `PUT /api/maintenance/sidecars/settings` (admin only):

```json
{
  "formats": ["opf", "json"],
  "covers": true,
  "overwrite_foreign": false
}
```

An empty `formats` list disables export entirely. See
[`api.md`](api.md#maintenance-admin-only) for the endpoint reference.
