# File management

Grimoire manages library files itself: admins can upload, move, rename, and delete content
from **Settings → Maintenance → Open file manager**, or from the **⋮** menu on any book,
and the metadata attached to a file follows it wherever it goes.

This needs the library mounted **writable**, which is the default - it is simply the
absence of a `:ro` suffix on the volume. See
[Read-only or writable?](configuration.md#read-only-or-writable) for what each mount
allows. You can also add and organize files entirely from outside Grimoire, which is how
you work if you keep the mount read-only - see
[Adding files from outside Grimoire](#adding-files-from-outside-grimoire).

---

## In-app file management

Admins can reorganize the library from inside Grimoire - **Settings → Maintenance
→ Open file manager**. It is a folder tree (think Finder or Explorer, but aware
of Grimoire's own concepts) built for bulk reorganization:

- **It opens at the library root**, showing `books`, `maps`, `tokens`, and
  `audio`, and `models` side by side. Everything in the library is managed here, so the tree
  starts where all of it is visible rather than inside `books/`.
- **Expand folders in place** to see a file and its destination at once, instead
  of navigating away from one to reach the other.
- **Move** files and folders by dragging them onto any folder. Collapsed folders
  spring open when you hold a drag over them, and the list auto-scrolls near its
  edges. Ctrl/Cmd-click to select several at once.
- **Pin a second pane** to the right, left, above, or below when the two ends of a
  move are far apart. Either pane can be closed to go back to one.
- **Drive it from the keyboard**, Finder-style. Click a row to place the cursor,
  then arrow up and down the list; the right arrow expands a folder or steps into
  it, the left arrow collapses it or steps back out to its parent. `Space`
  previews the row, `Enter` renames it, and `Delete` opens the same removal
  dialog as the menu. `Shift` with an arrow extends the selection and
  Ctrl/Cmd-A selects everything in the pane. With two panes open, keys act on
  whichever one has focus - `Tab` moves between them. Press `?` (or the
  **Shortcuts** button) for the full list.
- **Rename** a file or folder on disk. This is distinct from editing an item's
  display title, which only changes the name shown in Grimoire. The file
  extension is held aside and reattached on save - Grimoire infers a file's type
  from its suffix, so a mistyped `.pdf` would quietly drop a book out of the
  library.
- **Remove** a file or folder, in one of two ways chosen in the same dialog.
  - **Remove from library** (the default) takes the item out of Grimoire but
    **leaves the file on disk**. Its tags, favorites, bookmarks, reading
    progress, and campaign links go, but a rescan puts the item back unless it is
    gone from disk or newly excluded. That makes it the tidy-up for two everyday
    cases: clearing something you have just excluded with a
    [`.grimoireignore`](library-structure.md#ignoring-files-with-grimoireignore) rule, and dropping a
    single stale entry whose file you deleted outside Grimoire - neither of which
    should require a full database cleanup. It also works on a read-only library,
    where nothing can be deleted anyway.
  - **Also delete the files from disk** - tick the box in the dialog - makes it
    permanent. The file is removed from disk, not moved to a trash folder, and
    cannot be recovered. The dialog changes with the box: the wording and the
    button switch to the permanent version, so the red **Delete permanently**
    button always means the same thing.

  The box is unticked when the dialog opens, so the destructive option is always
  one you chose rather than one you defaulted into. When it *is* ticked the
  confirmation matches the stakes - a file, or a folder holding nothing but empty
  folders, deletes after a plain confirm, while **a folder that still holds files
  makes you type its name** first. The name is shown ready to copy, since the
  point is to make you look at *which* folder you are about to lose, not to test
  your typing. Removing from the library needs no typed name: a rescan undoes it.
- **Upload files and folders** by dragging them in from your desktop, via the
  **Upload** button beside *Up* (which offers both files and a whole folder, and
  targets the folder you are currently viewing), or via right-click →
  **Upload files… / Upload a folder…** on any folder. A panel tracks each file's
  progress, names any that fail and why, and lets you retry them individually or
  all at once - a failure part-way through a large import never costs you the
  files that already succeeded.
- **Preview an item** without leaving the tree - right-click → **Preview…** opens
  a book's rendered pages (arrow keys or the pager move between them), a map or
  token image, or an audio player. It answers "which file is this?" in place,
  rather than sending you to the reader and losing your spot in the tree.
- **Download a folder** - right-click any folder → **Download folder…** and pick
  ZIP, TAR, TAR.GZ, or TAR.BZ2, the same picker the library and gallery pages
  use. Unlike those, this archives the folder *as it sits on disk*: every file
  underneath it, in its existing subfolder structure, including loose files
  Grimoire never indexed. That is usually the point of asking from here - you are
  looking at the real folder, so you get the real folder. Very large folders are
  refused rather than started and stalled; download a subfolder instead.
- **Edit an item's metadata** with the same editor the library views use.
- **Create folders**, including system, category, container, and frame folders.
  Choosing a container type writes the right marker file for you, so you no longer
  have to remember `.parent-system-container` and create it by hand - and the same
  goes for `.frames-container`, so a new folder of
  [token frames](token-editor.md) is one checkbox rather than a trip to another
  tool. Each option only appears where it means something: a container type where
  a game system belongs, the frame checkbox anywhere under `tokens/`. Use the
  **New folder** button beside *Up* to create one in the folder you are currently
  viewing - handy in an empty folder, where there is no row to right-click.
- **Set up a system in one step** with **Create standard category folders** -
  Core, Supplements, Adventures, Character Sheets, Maps, Handouts, Homebrew, and
  Starter Sets, named so the scanner classifies them correctly. Offered on system
  folders only. A container holds *systems*, not categories, so the option does
  not appear on one - it appears on the folders inside it, however deeply the
  containers nest. Reachable both from right-click on a system folder and from
  the **Categories** button beside *New folder*, which acts on the folder you are
  currently viewing - handy once you have navigated into the system, where there
  is no row to right-click.
- **On a phone or tablet, press and hold** a row instead of right-clicking it.
  Touch has no second mouse button, so a held finger opens the same menu.
  Sliding your finger cancels the hold, so scrolling the tree still scrolls it.
  Dragging rows to move them is a mouse gesture and is off on touch - the menu's
  **Move to…** does the same job.
- **Mark a folder NSFW or SFW**, change its container type, or mark it a **frame
  folder**, without recreating it. The *One-page RPGs* and *System-agnostic*
  collections are one-of-a-kind: once a folder claims one, it is not offered on
  any other folder.

  Each option is offered only where Grimoire actually reads it, so you cannot
  leave a marker somewhere it does nothing. **Container types** are a `books/`
  idea - they say "the folders inside me are game systems" - so they appear on a
  folder standing where a system belongs, and not on a category folder inside a
  system (marking *Adventures* a container would tell the next scan that
  *Adventures* is a game system) nor anywhere under `maps/`, `tokens/`, `audio/`,
  or `models/`. **Frame folders** are the mirror image: offered at any depth
  under `tokens/`, and nowhere else. A marker you created by hand in the wrong
  place can still be cleared from here.
- **Rescan** from here too: the **Rescan** button beside *Refresh* re-indexes the
  whole library, and right-click → **Rescan this…** re-indexes just that folder or
  file. *Refresh* only re-reads the folder listing; a rescan updates what Grimoire
  has indexed, which is what you want after editing files with another tool.

Moves and renames **keep your metadata**. Grimoire relinks the existing record
rather than treating the file as new, so tags, favorites, reading progress,
bookmarks, campaign links, and the search index all follow the file to its new
home - and a book moved to a different system or category is re-filed
automatically.

> **This requires a writable library mount** - the default. If you have appended
> `:ro` to your library volume, drop it to use the file manager. With a read-only
> mount, Grimoire tells you the library is read-only instead of failing oddly, and
> everything else keeps working exactly as before. See
> [Read-only or writable?](configuration.md#read-only-or-writable).

The file manager is admin-only, and all destinations are confined to the library
root.

### File actions from anywhere

Move, rename, and delete are also on the **⋮ menu of a book itself** - in the
library views and in the reader - so a single file does not need a trip to the
file manager. They sit at the bottom of the menu behind a divider, apart from the
everyday items, and behave exactly as they do in the file manager: the same
metadata-preserving move, the same typed-name guard on a folder with content.

In the library views, right-clicking anywhere on a book opens the same menu at
the cursor - a bigger target than the ⋮ button. Hold **Shift** while
right-clicking to get the browser's own menu (open in new tab, copy link) instead.

Moving from here opens a small folder picker rather than asking you to drag - the
file manager can show both ends of a move at once, and a book's own page cannot.

These actions appear only for **admins on a writable library**. On a read-only
mount they are not shown at all, rather than being offered and then failing.

### Changing a category moves the book

Editing a book's **category** now moves the file into the matching folder -
change a book from *Core* to *Character Sheets* and it moves into that folder,
which is created if it does not exist yet. Grimoire re-reads your folders on every
rescan, so a category recorded without moving the file would be silently undone
by the next scan.

An existing folder wins over a new one: if your core books live in a folder called
*Rulebooks*, a book re-categorised as *core* joins them instead of a second *Core*
folder appearing beside it.

On a read-only library the category is saved and nothing moves - no error, no
failed edit.

## Replacing and moving files

A rescan compares each file's modification time and size against what it recorded last time, and only re-reads a file when one of them changed. Unchanged files cost nothing, so a scheduled rescan of a large library stays fast.

- **Replacing a book in place** (same filename, e.g. swapping in a higher-quality scan) is detected on the next rescan. The page count, cover, and search text are rebuilt, and everything cached from the old file is discarded. Tags, favorites, bookmarks, and reading progress are kept.
- **Moving or renaming a file** is recognised as the same book rather than a deletion plus a new addition, so it keeps its tags, favorites, bookmarks, and reading progress. Grimoire matches on file contents. Byte-for-byte identical copies are handled conservatively: moving one of them is still recognised, but if several identical files move at once there is no way to tell which became which, so they are reported as missing entries plus new ones rather than being paired off by guesswork.
- **A move across systems re-derives the metadata the folders imply.** Dragging a book from `Dungeons & Dragons/3e/unsorted/` to `Dungeons & Dragons/5e/adventures/Curse of Strahd/` updates its system, edition, and category to match where it now lives - while still keeping everything attached to the book. Attribution that came from a container (a publisher or family shelf) is dropped when the book moves out from under it, and picked up when it moves in.

## Duplicates and multiple versions

Libraries accumulate copies: the same book bought in a bundle and standalone, `Book.pdf` beside `Book (1).pdf`, a PDF and a CBZ of one scan. They also accumulate *deliberate* near-copies, which are not the same problem: a printer-friendly cut next to the screen edition, a form-fillable character sheet, a gridless battle map, a v1.0.0 superseded by a v1.0.1 with errata.

**Finding them.** **Settings → Maintenance → Open duplicate detection** opens a full page (like the file manager - reviewing copies wants the whole width, and it keeps the delete and merge actions off the settings tab) where a scan runs on demand - never as part of a normal rescan, since hashing a large library is expensive - with live progress and a stop button.

**Stopping one.** **Stop scan** asks the running scan to wind down; it discards what it found so far, since a partial list reads as "nothing else was found" when the scan simply stopped early. If the server was restarted or killed while a scan was running, the page could previously be left showing a scan stuck at 0% that Stop appeared to ignore and that blocked every later scan. That state now clears itself when the server starts, and pressing **Stop** on a scan that is no longer really running clears it immediately too, so a new scan can be started.

**Search accuracy** picks how hard to look, from **Exact** to **Low**. Exact compares file contents only: it is the fastest option and never reports a false positive, but it misses a book scanned twice. The looser levels progressively widen the net to similar titles and overlapping text, take longer, and return matches you will need to judge. **High** is the default and the usual choice - it catches the renamed copy that Exact walks past, while keeping false positives rare enough to review quickly. Drop to **Medium** or **Low** when you are hunting for something the default did not find.

**Collections** limits the scan to the collections you tick - books, maps, tokens, audio, or 3D models. A map is never a duplicate of a book, so each collection is scanned separately anyway and skipping the ones you are not sorting out is time saved outright. Leave everything unticked to scan them all, which is what a scan does by default.

Files in *different game systems* are treated with suspicion: a shared title there is discounted rather than trusted, and ignored entirely when either file is under 10 pages. `Character Sheet.pdf` exists once per system and those are not copies of each other. Files with no system set - most maps and tokens - are unaffected, and byte-identical files still match wherever they are filed, because the same bytes are the same file.

It uses several signals, and each match tells you which one fired and how confident it is:

| Reason | What it means |
|--------|---------------|
| `identical files` | Byte-for-byte the same. Certain. |
| `similar title` | Titles and authors line up after ignoring version and format markers - catches `book.pdf` beside `book_v2.pdf`. |
| `similar contents` | The extracted page text overlaps heavily. This is what catches the same book scanned twice, where the bytes and even the filenames differ. |
| `gridded / gridless pair` | Two maps whose names differ only by a grid marker, at comparable file sizes. |

**Nothing is ever deleted automatically, and there is no setting that changes that.** These are irreplaceable purchased files, and a false positive is unrecoverable. The scan only ever surfaces candidates.

**Reviewing in pairs.** Results are listed two copies at a time, not as one card per cluster. Five look-alikes on a single card is more than anyone can judge at once, and a single verdict over five files cannot say "these four match but that fifth is a different book". Each pair carries its own verdict, so rejecting one leaves the rest standing.

The pairs shown are the comparisons that actually matched, not every combination. That matters when one file resembles several others: if D looks like A, B, and C while the real duplicate is A and B, all four end up in one cluster - but you are shown A-B and D-C, rather than D measured against everything in turn.

**Comparing them.** **Compare** opens the two copies side by side at full size: pages, sizes, counts, and a field-by-field diff with the differences sorted to the top. For books the **‹ ›** buttons between the two pages flip both at once, bounded by the shorter of the two - page 40 next to page 40 is what reveals a reprint's shifted pagination. Alongside sits the part that usually decides it: how much of *your* work is attached to each copy - bookmarks, favourites, tags, and campaign links. Then you can:

- **Copy metadata** - move individual fields from the copy you are discarding onto the one you are keeping, before it goes. Keeping the better *file* should not mean keeping the worse *record*: a pristine scan often arrives with nothing but a filename while the copy you are about to delete has the title, publisher, and tags you curated. Only fields that actually differ are offered, and you tick them individually rather than copying wholesale.

- **Link as versions** - collapse the two into one library entry. A radio button on each copy picks the main version, and a dropdown says what the other one *is* - plus an optional free-text label like `v1.0.1`. The variant stops appearing separately in browsing, search, and counts.

  The dropdown only offers the kinds that make sense for what you are reviewing, since most of them describe one kind of file: a gridless token or a form-fillable audio track is not a real distinction. Every collection offers **version** and **other**; on top of that:

  | Reviewing | Also offers |
  | --- | --- |
  | Books | Printer friendly, form fillable, black and white, two-page spreads, single pages |
  | Maps | Gridded, gridless, Universal VTT, video, image, printer friendly, black and white |
  | Tokens | Colour variation, black and white |
  | Audio | Remix, slowed, sped up |
  | 3D Models | Presupported, unsupported, split, merged |

  **Universal VTT** is a `.dd2vtt`/`.uvtt` export carrying walls and lights, and **video**/**image** are the animated and still cuts of the same map - a pair in the same way gridded and gridless are. **Presupported**/**unsupported** is the same idea for a resin miniature, and **split**/**merged** covers a mini cut into printable parts versus the same mini as one piece. The scan pre-fills its best guess from the filenames and extensions, and it only ever guesses something the collection actually offers.

- **Delete a copy** - asks for confirmation in a dialog, and removes the file from disk by default. That default is the opposite of elsewhere in Grimoire, deliberately: you have just decided this copy is redundant, and leaving the bytes in the library folder means the next scan proposes the same pair all over again. Untick the box to drop only the library record.
- **Not duplicates** - dismisses that pair. It disappears from the list straight away rather than lingering until the next scan, and it stays gone: the rejection is remembered per pair and survives every future rescan, including when a third copy of the same book turns up later and would otherwise drag the rejected pair back into a cluster with it. Dismissals are not final, though - **Show dismissed** at the foot of the duplicates page lists everything you have rejected, with a **Restore** button on each. Restoring one lets it be proposed again by the next scan (the list on screen was built while the dismissal still applied, so it does not reappear until you rescan).

**Changing your mind about the main version.** Say you file the printable cut under the form-fillable one, then meet a lined edition you consider the real original. Choosing the lined copy as the main version moves the *whole family* across in one step - the form-fillable becomes a variant of it, and anything already filed under the form-fillable re-homes onto the new main version rather than being stranded. The page says how many versions will move before you commit.

**When the copy you are demoting is already filed under something else.** Versions are only ever one level deep, so a copy that is already a variant of a third book cannot be filed under a fourth as well. Rather than just refusing, the page names the group that copy belongs to and offers two ways forward: **Move that group here** promotes in one step - the other group's main version, and everything under it including the copy on screen, moves under the copy you are keeping - or **Compare with the main version first** reopens the comparison against that main version, so you can look at the two files that the move actually concerns before committing to it.

**Living with versions.** An entry that has other versions carries a badge. Books get a **Switch version** entry in the ⋮ menu, both in the library and while reading - switching in the reader keeps your page, so moving between a spreads cut and a single-page cut lands you in the same place. Maps, tokens, audio, and models get a dropdown on their detail page. A book's **View details** panel lists every version it holds, with a download link for each.

**How a version is named in those pickers.** Each one reads as its kind and its label together - *Gridded · v1.2* - since two gridded cuts of one map often differ by nothing but the label you typed, and a bare *v1.2* does not say what kind of file it is. *Version* and *Other* are the exceptions: they describe nothing, so a version marked with either shows its label alone, or its filename when it has no label. Its filename sits underneath in smaller, dimmer text, so you can always see which file a choice points at - shown once, never doubled up with a label that repeats it.

**Downloading one version.** A single download asks which version you want, rather than silently handing you the main one: the download action on a map, token, audio, or model card, on a detail page, or in a book's ⋮ menu opens a short menu of the versions when there is more than one to choose from. With only one version it stays a one-click download. (Bulk downloads are unchanged - see below.)

**Fixing a mistake.** Everything about a family can be changed after the fact from the book's **View details** panel *or* its metadata editor, so a mis-click during review is not permanent. Admins get, per version: a dropdown to change what kind of version it is (picked *printer friendly* when you meant *black and white*), **Make main** to promote it to the main version, **Unlink** to pull it back out as its own library entry, and a delete button that asks whether to remove the file from disk or only drop Grimoire's record of it. Non-admins see the list and the download links, but none of the controls.

Versions are only ever one level deep: a version cannot itself have versions. Deleting the main entry asks which version should replace it, or promotes them all - a version is a real file you own, so it is never left hidden behind a record that no longer exists.

Two things worth knowing. Bulk downloads and the OPDS feed deliberately include every version, because an archive or a catalogue should be complete. And text that exists *only* in a hidden version - errata added in a v1.0.1 - will not turn up in global search; searching inside that specific version still works.

## Systems whose folder disappears

When a system's folder is deleted - or newly excluded by a [`.grimoireignore`](library-structure.md#ignoring-files-with-grimoireignore) rule - the system itself is now removed on the next rescan, instead of lingering in the library with nothing behind it. This is what cleans up a stray `@eaDir` entry after you add a rule for it on a Synology NAS.

Removal is deliberately cautious. A system is kept if it still holds any book that is present on disk, if it is the parent of a system that does, or if you have adapted it yourself by renaming it or giving it a description or cover. Scoped rescans (a single folder) never remove systems, since they only look at one corner of the library.

## Interrupted scans

Cancelling a scan (or restarting the server mid-scan) no longer leaves a partly-populated shelf. Every system folder is registered before any book is indexed, so a container's editions all appear as soon as the folder is walked, however early the scan stops - you may be missing *books* until the next full rescan, but never whole systems. Nothing is removed by an interrupted scan either.

---

---

## Adding files from outside Grimoire

Nothing stops you adding or reorganizing files by other means - your OS file manager,
`scp`, a network share, or a companion container. This is also how you work if you keep
the library mounted read-only.

After adding files with an external tool, trigger a **Rescan** in Grimoire (sidebar or
**Settings → Maintenance**) to index the new content. Changes made in the built-in file
manager apply immediately and need no rescan. To automate it, configure a scheduled rescan
in **Settings → Maintenance → Scheduled Rescan**.

### Calibre

[Calibre](https://calibre-ebook.com/) is a full-featured ebook management application. Its value alongside Grimoire is what Grimoire deliberately does not do: format conversion, and bulk metadata editing across a large collection. It writes `.opf` sidecar files that Grimoire reads automatically on the next scan to populate titles, authors, publishers, descriptions, and tags.

Grimoire can send metadata the other way too - see [sidecar export](sidecars.md).

#### How it works with Grimoire

Calibre manages books in its own library folder structure. When Calibre is configured to export books into a folder that Grimoire watches (or when you point Grimoire at Calibre's own library root), Grimoire picks up the metadata from the `.opf` files Calibre writes alongside each book.

See [Book metadata from OPF files](library-structure.md#book-metadata-from-opf-files) for the fields Grimoire reads.

#### Docker Compose example

This example uses the [LinuxServer.io Calibre image](https://docs.linuxserver.io/images/docker-calibre/), which runs the full Calibre desktop via a web-accessible noVNC interface.

```bash
cp docs/docker/docker-compose.calibre.yml docker-compose.yml
# Edit SECRET_KEY, volume paths, and TZ (timezone), then:
docker compose up -d
```

See [`docs/docker/docker-compose.calibre.yml`](./docker/docker-compose.calibre.yml) for the full file with inline comments.

Access the Calibre desktop at `http://localhost:8080`. The Content Server runs at `http://localhost:8081`.

#### Calibre library setup

When Calibre first runs, point its library at `/library/books/` (or a subfolder for a specific system). Calibre will manage its own `metadata.opf` and `cover.jpg` files per book in its own subfolder layout:

```
books/
└── Dungeons & Dragons/
    └── core/
        ├── Players Handbook/          ← Calibre creates this subfolder
        │   ├── players_handbook.pdf
        │   ├── metadata.opf           ← read by Grimoire
        │   └── cover.jpg              ← used as book cover by Grimoire
        └── Dungeon Masters Guide/
            ├── dungeon_masters_guide.pdf
            ├── metadata.opf
            └── cover.jpg
```

After editing metadata in Calibre and triggering a rescan in Grimoire, the updated metadata appears in the library. Note: Grimoire only applies OPF metadata on a book's **first index**. To re-apply updated OPF metadata to an already-indexed book, delete the book record in Grimoire (Settings → Maintenance) and rescan.

#### Calibre-Web (alternative)

If you prefer a lighter web-only interface instead of the full Calibre desktop, [Calibre-Web](https://github.com/janeczku/calibre-web) provides a clean book browser and uploader that works with an existing Calibre library.

```bash
cp docs/docker/docker-compose.calibre-web.yml docker-compose.yml
# Edit SECRET_KEY, volume paths, and TZ (timezone), then:
docker compose up -d
```

See [`docs/docker/docker-compose.calibre-web.yml`](./docker/docker-compose.calibre-web.yml) for the full file with inline comments.

Point Calibre-Web at `/library/books` as its library path on first setup.

---

## See also

- [Library structure](library-structure.md) - the folder conventions the scanner reads
- [Metadata sidecars](sidecars.md) - reading `.opf` in, and writing metadata back out
- [Configuration](configuration.md#read-only-or-writable) - read-only vs writable mounts
