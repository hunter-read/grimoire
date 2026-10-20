# Filename rules

If you name your files carefully, Grimoire can use that. Filename rules teach it what your naming
scheme means, in two places:

- **Folder naming patterns** describe how the books in a folder are named. Grimoire reads each new
  book's title (and publisher, version, year, ...) out of its filename, and can rename existing
  files to match the pattern - or move them from an old scheme onto a new one.
- **Variant filename rules** are your library's own markers for variants - `GL_` for a gridless
  map, `-pf` for a printer-friendly PDF - so duplicate review pre-fills them the way it already
  does for `nogrid` or `printer friendly`.

Both live under **Settings → Metadata** and are admin only. Your files are never renamed unless
you ask for it.

---

## Folder naming patterns

Say your adventures are named like this:

```text
D&D5e - [Loot Tavern] - adventure L2,7,12 - Crystallica (v0.99, 2026).pdf
```

Without a pattern, that whole name becomes the book's title. With this pattern on the folder:

```text
{system} - [{publisher}] - {*} - {title}< (v{version}, {year})>
```

the book shows as **Crystallica**, published by **Loot Tavern**, version **0.99**, from **2026**.
The filename stays as it is.

### Writing a pattern

A pattern is ordinary text with **fields** in braces. The text has to appear in the filename as
written (ignoring upper/lower case, and any run of spaces matches any other); each field matches
the part of the name in its place.

| Field | Reads | Writes |
| --- | --- | --- |
| `{title}` | The book's title - every pattern needs one | ✓ |
| `{publisher}` | Publisher | ✓ |
| `{authors}` | Authors, split on `,`, `&` and `and` | ✓ (joined with `, `) |
| `{year}` | A four-digit year | ✓ |
| `{version}` | Version | ✓ |
| `{isbn}` | ISBN | ✓ |
| `{product_code}` | The publisher's product code / SKU | ✓ |
| `{system}` | Matched, but not kept - a book's system comes from its folder | ✓ |
| `{category}` | Matched, but not kept - likewise | ✓ (`Adventures`, `Core`, ...) |
| `{date}` | Matched, but not kept - use `{year}` to read it | ✓ (`2024`, `2024-05` or `2024-05-01`) |
| `{language}` | Matched, but not kept | ✓ |
| `{*}` | Anything at all, thrown away | ✗ |

Two more pieces of syntax:

- **`{*}` matches anything you do not care about.** It is what lets a pattern pick out the title
  without describing every other part of the name. A pattern containing `{*}` can read titles but
  never rename files, since there is nothing to write in its place.
- **`< ... >` marks an optional part.** `{title}< (v{version})>` matches both `Crystallica.pdf`
  and `Crystallica (v2).pdf`. When renaming, an optional part is left out if any field in it is
  empty, so a book without a version is named `Crystallica.pdf` rather than `Crystallica (v).pdf`.

Two fields need some text between them (`{title}{year}` is refused - there is no telling where one
ends), and each field may appear only once. The editor tells you what is wrong as you type.

### Reading titles from filenames

Once a folder has a pattern, every **new** book Grimoire finds beneath it takes its title from the
filename, as long as the name fits the pattern. It also fills publisher, authors, year, version,
ISBN and product code when the pattern names them. A file whose name does not fit is titled from
its filename as before, and a [sidecar `.opf`](sidecars.md) still takes precedence over the
pattern.

Books that were already in the library are left alone until you say otherwise. Open the folder's
pattern, check the preview, and choose **Update titles**. That overwrites each selected book's
title with the one in its filename, and fills the other fields only where the book has none - so
a publisher you typed in by hand is kept.

This works on a [read-only library](configuration.md#read-only-or-writable): it only changes what
Grimoire shows, never the files.

### Renaming files to match

A pattern without `{*}` also works the other way round: Grimoire can write each book's filename
from its metadata. Use it to tidy a folder onto a scheme, or to switch to a new scheme later - set
the new pattern and rename everything onto it.

The preview shows the filename each book would get, and why some would not be renamed:

| In the preview | Meaning |
| --- | --- |
| **Already named** | The file already has that name |
| **Missing {publisher}** | A field outside any `< >` is empty for this book, so the name would have a hole in it. Fill in the field, or make that part optional |
| **Name too long** | Over 255 bytes, which most filesystems refuse |
| **Name already taken** | Another file in the folder has that name, or another book in the preview would get it |
| Longer than Windows allows | The full path would be over 259 characters. It is renamed anyway, but copying the library to Windows or some sync tools may fail |
| Won't read back to the same title | The title contains the pattern's own separator (a ` - ` in the title of a `{system} - {title}` pattern, say), so reading the new name would give a different title |

Characters a filename cannot hold are replaced: `Curse of Strahd: Reloaded` becomes
`Curse of Strahd - Reloaded`, a `/` becomes `-`, and `?`, `*`, `"`, `<`, `>`, `|` are dropped.

Tick the books you want and choose **Rename files**. Renaming works like a rename in the
[file manager](file-management.md): each book keeps its tags, favourites, reading progress and
campaign links, and its sidecars are renamed with it. A file that cannot be renamed is reported
and the rest go ahead. Renaming needs the library mounted writable.

Nothing is renamed automatically when a book is added or edited - renaming is always this
deliberate step.

### Which folder's pattern applies

A pattern covers its folder and everything beneath it. When folders inside each other both have a
pattern, the one nearest the book wins - put a pattern on the system folder for most of its books,
and another on the one shelf that came from elsewhere. Patterns can be set on `books/` itself, or
on any folder below it.

Renaming or moving a folder in the file manager takes its pattern with it, and deleting the folder
deletes the pattern. A folder renamed outside Grimoire leaves its pattern behind; the settings
page flags it as **Folder not found**.

---

## Variant filename rules

When [duplicate review](file-management.md#duplicates-and-multiple-versions) finds two copies of
the same thing, it guesses what kind of variant each one is from its filename: `grid`/`nogrid`,
`printer friendly`, `v2` and the like. Variant filename rules add your library's own markers.

| Match | Text | Kind | Label |
| --- | --- | --- | --- |
| Starts with | `GL_` | Gridless | |
| Whole word | `nogrid` | Gridless | |
| Whole word | `night` | | Night |
| Ends with | `-pf` | Printer friendly | |

- **Whole word** matches a complete word of the filename, split on spaces, `_`, `-`, `.`,
  brackets and parentheses - so a rule for `grid` does not match `Gridiron Tavern`. It can be
  several words (`no grid`). **Starts with** and **Ends with** test the name without its
  extension. None of them care about upper or lower case.
- A rule sets a **kind**, a **label**, or both. A label-only rule leaves the kind to the built-in
  markers, so `Tavern_nogrid_night.png` comes out as gridless, labelled *Night*.
- **Collection** limits a rule to books, maps, tokens, audio or models; the kinds offered follow
  it, just as they do when you describe a variant by hand.
- A rule only counts when **one copy's filename matches and the other's does not**. A marker both
  files carry - `GL_` on every map in a gridless pack - tells them apart no better than nothing.
- Rules are checked **top to bottom, before the built-in markers**, so your convention wins. The
  first rule that tells two copies apart supplies the kind, and the first with a label supplies the
  label.

The rules only pre-fill the form - linking variants is still always your decision. They apply to
the next duplicate scan and whenever you open a comparison; groups found by an earlier scan keep
the suggestions they had until you scan again.

---

## See also

- [Library structure](library-structure.md) - how folders become systems and categories
- [File management](file-management.md) - the file manager, and duplicates and versions
- [Metadata sidecars](sidecars.md) - reading `.opf` in, and writing metadata back out
- [API reference](api.md#filename-rules-admin-only) - the `/api/naming` endpoints
