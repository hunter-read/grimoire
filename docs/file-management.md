# Adding Files to Your Library

Grimoire is a **read-only viewer** - it never modifies the files in your library folder. This keeps your source files safe and lets you use whatever file manager you prefer to add, organize, and remove content.

Two tools integrate especially well with Grimoire:

| Tool | Best for |
|---|---|
| [Filebrowser Quantum](#filebrowser-quantum) | Simple drag-and-drop file uploads from any browser |
| [Calibre](#calibre-web) | Rich book management, metadata editing, and OPF export |

Both run as Docker containers sharing the same library volume as Grimoire. After adding files with either tool, trigger a **Rescan** in Grimoire (sidebar or Settings → Maintenance) to pick up the new content.

---

## Filebrowser Quantum

[Filebrowser Quantum](https://github.com/gtsteffaniak/filebrowser) is a lightweight, browser-based file manager. Use it to upload PDFs, create folders, rename or move files, and delete content - all from a web UI with no software to install on your local machine.

### How it works with Grimoire

Filebrowser Quantum mounts your library folder with **read-write** access. Grimoire continues to mount the same folder **read-only**. Anything you upload or reorganize through Filebrowser immediately shows up to Grimoire after a rescan.

### Docker Compose example

Use the ready-made example file:

```bash
cp docs/docker/docker-compose.filebrowser.yml docker-compose.yml
# Edit SECRET_KEY and the two /path/to/your/library volume paths, then:
docker compose up -d
```

See [`docs/docker/docker-compose.filebrowser.yml`](./docker/docker-compose.filebrowser.yml) for the full file with inline comments.

Access Filebrowser at `http://localhost:8080`. Default credentials are `admin` / `admin` - change these immediately in the settings.

### Recommended folder layout

Filebrowser Quantum shows your library root as its home directory. Create folders matching Grimoire's expected structure:

```
/srv/                               ← library root
├── books/
│   └── Dungeons and Dragons 5e/
│       ├── core/
│       │   └── Players Handbook.pdf
│       └── supplements/
├── maps/
└── tokens/
```

See [Library Structure](../README.md#library-structure) for the full folder conventions.

---

## Calibre

[Calibre](https://calibre-ebook.com/) is a full-featured ebook management application. Its [Content Server](https://manual.calibre-ebook.com/server.html) exposes a web UI for browsing and uploading books. Beyond uploads, Calibre's main value here is its metadata editing - it can write `.opf` sidecar files that Grimoire reads automatically on the next scan to populate titles, authors, publishers, descriptions, and tags.

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

Regardless of which tool you use, trigger a rescan in Grimoire to index new content:

1. Click **Rescan** in the sidebar, or go to **Settings → Maintenance → Rescan Library**.
2. Wait for the scan to complete - new books, maps, and tokens will appear.

To automate this, configure a scheduled rescan in **Settings → Maintenance → Scheduled Rescan**.
