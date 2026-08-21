# Adding Files to Your Library

Grimoire manages library files itself. Admins can upload, move, rename, and
delete content from **Settings → Maintenance → Open file manager**, or from the
**⋮** menu on any book, and the metadata attached to a file follows it wherever
it goes. See [In-app file management](../nightly.md#in-app-file-management) for
what the file manager does.

This needs the library mounted **writable**, which is the default - it is simply
the absence of a `:ro` suffix on the volume. See [Read-only or
writable?](../nightly.md#read-only-or-writable) for what each mount allows.

This page covers the other route: adding and organizing files from outside
Grimoire. That is how you work if you keep the library mounted read-only, and it
is what [Calibre](#calibre) is for even when you don't.

After adding files with an external tool, trigger a **Rescan** in Grimoire
(sidebar or **Settings → Maintenance**) to pick up the new content. Changes made
in the built-in file manager apply immediately and need no rescan.

---

## Calibre

[Calibre](https://calibre-ebook.com/) is a full-featured ebook management application. Its value alongside Grimoire is what Grimoire deliberately does not do: format conversion, and bulk metadata editing across a large collection. It writes `.opf` sidecar files that Grimoire reads automatically on the next scan to populate titles, authors, publishers, descriptions, and tags.

Grimoire can send metadata the other way too - see [sidecar export](../nightly.md#writing-metadata-back-out-sidecar-export).

### How it works with Grimoire

Calibre manages books in its own library folder structure. When Calibre is configured to export books into a folder that Grimoire watches (or when you point Grimoire at Calibre's own library root), Grimoire picks up the metadata from the `.opf` files Calibre writes alongside each book.

See [Book metadata from OPF files](../README.md#book-metadata-from-opf-files) for the fields Grimoire reads.

### Docker Compose example

This example uses the [LinuxServer.io Calibre image](https://docs.linuxserver.io/images/docker-calibre/), which runs the full Calibre desktop via a web-accessible noVNC interface.

```bash
cp docs/docker/docker-compose.calibre.yml docker-compose.yml
# Edit SECRET_KEY, volume paths, and TZ (timezone), then:
docker compose up -d
```

See [`docs/docker/docker-compose.calibre.yml`](./docker/docker-compose.calibre.yml) for the full file with inline comments.

Access the Calibre desktop at `http://localhost:8080`. The Content Server runs at `http://localhost:8081`.

### Calibre library setup

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

### Calibre-Web (alternative)

If you prefer a lighter web-only interface instead of the full Calibre desktop, [Calibre-Web](https://github.com/janeczku/calibre-web) provides a clean book browser and uploader that works with an existing Calibre library.

```bash
cp docs/docker/docker-compose.calibre-web.yml docker-compose.yml
# Edit SECRET_KEY, volume paths, and TZ (timezone), then:
docker compose up -d
```

See [`docs/docker/docker-compose.calibre-web.yml`](./docker/docker-compose.calibre-web.yml) for the full file with inline comments.

Point Calibre-Web at `/library/books` as its library path on first setup.

---

## After adding files

After using any external tool, trigger a rescan in Grimoire to index new content:

1. Click **Rescan** in the sidebar, or go to **Settings → Maintenance → Rescan Library**.
2. Wait for the scan to complete - new books, maps, and tokens will appear.

To automate this, configure a scheduled rescan in **Settings → Maintenance → Scheduled Rescan**.
