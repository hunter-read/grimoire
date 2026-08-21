# Metadata sidecars

Grimoire's curated metadata - hand-edited titles and descriptions, authors,
tags, scraped add-on results - normally lives only in the app database. Sidecar
export writes it back out as files next to the content, so the library folder
describes itself: copy it to another machine, or rebuild the container with a
fresh `DATA_PATH`, and the metadata travels with the files.

This is the write half of a loop Grimoire already had. The scanner has always
*read* `.opf` files and `tags.json`; this exports the same data back out.

> **Off by default.** Grimoire is otherwise a read-only viewer of your library,
> and writing into it is a deliberate change in posture. Nothing is written
> until an admin enables at least one format.

## Formats

Enable any combination - the tools downstream disagree, so more than one may be
useful at once.

| Format | File | Read by |
|--------|------|---------|
| OPF | `<book>.opf` | Calibre - and Grimoire itself, so it round-trips |
| NFO | `<book>.nfo` | Jellyfin, Kodi, Emby |
| JSON | `<book>.grimoire.json` | Grimoire-native; lossless |
| YAML | `<book>.grimoire.yaml` | Grimoire-native; lossless, and the easiest to read or edit by hand |
| Cover | `<book>.cover.jpg` | Optional image, see [Covers](#covers) |

OPF and NFO are best-effort mappings: neither has a slot for most of what
Grimoire tracks, and fields without a home are dropped. **Only the two
Grimoire-native formats are lossless** - enable one of them if the point is a
metadata backup rather than feeding another application.

JSON and YAML carry exactly the same fields and differ only in syntax, so
enabling both is redundant unless something downstream wants each. Pick YAML if
a human will read or edit the file, JSON if a program will parse it.

## Field mapping

| Grimoire field | OPF | NFO | JSON / YAML |
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

Optionally writes the book's cached thumbnail beside it as `<book>.cover.jpg`,
which is what makes the folder render nicely in file managers and other apps.

The compound `.cover.jpg` is deliberate. It makes an exported cover
self-identifying, so Grimoire's own file manager can hide it without risking a
plain `<book>.jpg` that is genuine library content.

The bytes are copied, not transcoded: Grimoire caches thumbnails as WebP, and
the `.jpg` name is the convention other tools expect. Consumers that sniff
content handle this; those that trust the extension are why the setting is
optional. **An existing cover is never replaced** - cover files carry no marker
identifying who wrote them, so Grimoire cannot tell yours from its own.

## In the file manager

Sidecars are metadata *about* your content, not content, so Grimoire's file
manager (**Settings → Maintenance → File Manager**) hides them. A book that
exports in four formats plus a cover would otherwise turn one row into six, none
of which you can usefully act on.

They are still **moved and renamed with the file they describe**. Move a book to
another folder and its sidecars go with it; rename it and they are re-stemmed to
match, since the pairing is by filename and would otherwise break the next scan.

Hiding requires the pairing: a sidecar is only hidden when a content file with
the same stem sits beside it. An orphaned `.opf` whose book you deleted stays
visible, so nothing disappears from the file manager with no way to reach it.

## When sidecars are written

Three triggers, with deliberately different behaviour:

**The backfill** (`POST /api/maintenance/sidecars/export`) **fills the gaps**. It
walks every indexed book and writes only the enabled formats that are *missing*,
leaving every file already on disk untouched. That makes it additive and safe to
re-run: it will not rewrite a sidecar you have since edited by hand, and enabling
a new format later backfills just that one. (`skip_existing=False` forces a full
rewrite from the database, for when the database is the source of truth.)

**A scan creates them for new books.** When export is enabled, books newly picked
up by a library scan get their sidecars written automatically, so the library
stays complete as files arrive rather than only when someone remembers to run the
backfill. Only *newly indexed* books are considered - a rescan that finds nothing
new writes nothing - and an existing file is never overwritten.

**Editing metadata refreshes what already exists.** After a book's metadata is
saved - single edit, bulk edit, or bulk tagging - Grimoire rewrites the sidecars
that book *already has*, and creates none. So a `.nfo` that exists stays in step
with the database automatically, while a library you have never backfilled never
grows new files because you renamed a book.

Refresh happens after the save is committed, and a sidecar failure never fails
the edit: your metadata change is saved either way, and the problem is logged.
The same is true of a scan: a sidecar problem is logged, never fatal to the scan.

## Never destructive

**Grimoire only overwrites files it wrote.** Every exported sidecar carries a
generator marker, and a file without one is left alone and counted as
`skipped_foreign`. A `.opf` you maintain in Calibre is yours.

To take those files over, enable `overwrite_foreign` - an explicit choice, off by
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
producing one identical error per book. Metadata edits keep working normally -
only the sidecar refresh is skipped.

## Interaction with sidecar import

Export and import have to agree, or a scan will fight the exporter: export
writes a file, the next rescan reads it back, and any mismatch causes drift.

Grimoire's OPF exporter is the exact inverse of its OPF importer - every element
written is one the importer reads - so an export followed by a rescan reproduces
the same values. This is enforced by a round-trip test.

`dc:identifier` is the one element read conditionally: the importer takes it
**only** when it carries `opf:scheme="ISBN"`, which is the scheme the exporter
writes. Unscoped identifiers stay ignored, so Calibre's internal UUID never
lands in the ISBN field. The value is normalised (hyphens and spaces stripped)
and its check digit validated; an ISBN that fails the check is dropped rather
than imported.

Precedence is set by the **metadata refresh mode** used when scanning:

| Mode | On rescan | Use with export |
|------|-----------|-----------------|
| `new` | Sidecars apply only to newly indexed books | Safe |
| `missing` | Fills only fields the database has empty | **Recommended** - the database wins, so re-import is a no-op |
| `replace` | Sidecar values overwrite the database | Only if the sidecars are your source of truth |

With `missing`, the database is authoritative and exported sidecars are a
one-way mirror. With `replace`, edit the sidecars in another tool and let
Grimoire pick them up - but note the two triggers then compete, and a UI edit
followed by a rescan will lose to whatever the sidecar says.

`.nfo`, `.grimoire.json`, and `.grimoire.yaml` are export-only today; the
scanner does not read them back, so they cannot drift regardless of mode.

## Settings

In the app, go to **Settings → Maintenance → Metadata Sidecars**: tick the
formats you want, save, then use **Export Metadata To Library** for the one-shot
backfill. The export button stays disabled until at least one format has been
saved, since the backfill writes what the server has stored rather than what is
on screen.

Or configure via `PUT /api/maintenance/sidecars/settings` (admin only):

```json
{
  "formats": ["opf", "yaml"],
  "covers": true,
  "overwrite_foreign": false
}
```

An empty `formats` list disables export entirely. See
[`api.md`](api.md#maintenance-admin-only) for the endpoint reference.
