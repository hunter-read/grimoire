# Performance and indexing

How Grimoire indexes your library, what OCR costs, and the knobs worth turning on a small
device or a large collection.

---

## Indexing

On first startup Grimoire scans the library and indexes every PDF page for full-text search. This can take several minutes for large collections. The index is stored in the data volume and subsequent startups are fast.

New files are picked up by themselves while the library is [watched for changes](file-management.md#watching-for-changes), the default. Use the **Rescan** button in the sidebar to pick them up by hand, or configure a scheduled rescan in **Settings → Library → Scanning** - on a slow server you can turn watching off and scan at a quiet hour instead.

## OCR

Some PDFs contain only scanned page images with no embedded text layer (common with older, scanned game books). These can't be full-text searched from their text layer alone and show an **Image Only** badge.

The default Grimoire image bundles the [Tesseract](https://github.com/tesseract-ocr/tesseract) OCR engine (English), so scanned image-only PDFs are run through OCR and their recognised text is added to the search index. Books indexed this way show an **OCR** badge. No extra container or service is required.

OCR runs quietly in the background, so it never holds up the rest of your library. A scan indexes all your regular (text-based) books, maps, tokens, and audio first - those are searchable right away - and then works through the scanned books afterward. Even if you add 100+ scanned books at once, the rest of your library stays available while they're being processed.

### Scans with a few pages of text

Some scanned books carry a handful of real text pages - a digitally-set cover or appendix, or a web enhancement bundled into the back. Those pages used to make the whole book look like a text book, so the rest of it was never read. Now a book whose own text covers less than half of its pages is treated as a scan and read with OCR, keeping the text pages it already had. `OCR_MIN_TEXT_COVERAGE` sets that share: `0.5` by default, `0` to only OCR books with no text at all (the old behaviour), `1` to OCR anything short of complete.

A page counts toward that share only if it carries at least `OCR_MIN_PAGE_CHARS` characters (`100` by default). A scan with its chapter title stamped on every page has text on every page, but none of it counts, so it is read with OCR as well. Some scans have a partial text layer instead: the tables and sidebars come through but the prose does not, which can leave a few hundred characters a page. The default leaves those alone. Raising `OCR_MIN_PAGE_CHARS` (to `600`, say) catches them, but it also sends every sparse digital book, such as a book of tables or handouts, through OCR, so raise it only if your library needs it.

A digital book that is mostly full-page art - a map pack, an art book, a bundle of handouts - looks the same to that test. So before reading such a book in full, Grimoire reads a few of its picture-only pages as a sample. A scanned page gives a page of words; a map or an illustration gives a handful. If the sample reads like artwork, the book keeps its own text and isn't read with OCR, and the log says so. To read it anyway, use **Re-OCR…** from its actions menu, which reads the whole book without sampling it.

This applies when a book is indexed: added, replaced, or re-scanned. Books already in your library are left as they are. To fix one, open its actions menu (**⋮**) and choose **Re-OCR…**, which is offered for any PDF whose text covers less than `OCR_MIN_TEXT_COVERAGE` of it.

Scanned books are also processed **page by page**, and progress is saved as it goes. If the server restarts (or you stop and start a scan), OCR simply picks up where it left off instead of starting the book over - so even a very large scanned book will finish, however long it takes.

- **Progress:** the admin scan status shows an OCR phase with a progress bar and the book currently being processed.
- **Disable OCR:** set `OCR_ENABLED=false`. Scanned image-only PDFs are then left unindexed, the same as on the slim image.
- **Slim image:** the `-slim` tags (e.g. `hunterreadca/grimoire:v1.5.0-slim`, `:slim`) omit Tesseract for a smaller image. OCR is automatically disabled there.
- **Upgrading to OCR:** if you enable OCR later (or switch from a slim image), any books that were previously skipped as image-only are automatically queued for OCR on the next scan.
- **Additional languages:** set `OCR_LANGUAGES` to a `+`-joined list of Tesseract language codes (e.g. `eng+deu+fra`). The extra languages' data files must be present in the image - mount a directory of `.traineddata` files (or point `TESSDATA_PREFIX` at one) to add languages without rebuilding.
- **Each book's own language:** before a book is OCR'd, Grimoire looks up its language - the book's **Language** field first, then `dc:language` in its `.opf` sidecar, then the PDF's own language setting (`/Lang`). That language is read first, followed by `OCR_LANGUAGES`, so a German book in a library set to `eng` is read with `deu+eng`. This only works when the language's data file is installed; if it isn't, the book is read with `OCR_LANGUAGES` and the log names the language file that would have helped. To read a book again after correcting its language, use **Re-OCR…**.

### Speeding up OCR

Scanning a large book takes a while, and it happens quietly in the background - you can browse and search the rest of your library the whole time, and OCR picks up where it left off if the server restarts. If you have a big collection of scanned books and want it to finish faster, two optional settings help:

- **`OCR_CONCURRENCY`** - how many scanned books to work on at once. The default is `1`, which is gentle on small devices. If you're running on a machine with several CPU cores and plenty of memory to spare, raising this (e.g. `2`–`8`) processes books in parallel and gets through the queue faster. On a small device like a Raspberry Pi, leave it at `1`. Set it to `0` to turn OCR off entirely - handy if OCR keeps failing or running your machine out of memory and you just want it to stop, without switching to the slim image.
  - Each parallel worker uses roughly 50–250 MB of RAM depending on the pdf page image size, so make sure you have that much to spare per unit, and don't set it higher than the number of CPU cores (virtual/hyper-threaded cores count) or the workers just compete for the same processors without going any faster.
- **`OCR_DPI`** - how sharp the scanned pages are rendered before reading them (default `150`). Lowering it (e.g. `120`) makes OCR faster and lighter; raising it (e.g. `200`–`300`) can improve results on faint or low-quality scans at the cost of speed. Note: OCR scanned books can be individually rescaned at a higher DPI if needed from the application.
- **`OCR_PAGE_TIMEOUT`** - how long a single page may take before Grimoire gives up on it and moves to the next one (default `120` seconds). This exists so one pathological page can't stall a book forever, but how long a page takes depends on how *dense and noisy* the scan is far more than how big it is: on a low-power CPU an ordinary page might read in 13 seconds while a cramped, speckled one needs four minutes. When that happens the slow pages are skipped and their text never becomes searchable. If your logs mention pages being skipped, or a book is badged **OCR 14/206**, raise this (e.g. `600`) and re-read the book. Raising it costs nothing when pages finish quickly - it is a ceiling, not a delay. Set it to `0` for no limit at all, if you would rather wait indefinitely than lose text.

A rough guide: a small always-on device (like a Pi) is happiest at the defaults; a typical NAS can handle `OCR_CONCURRENCY=2`; a powerful desktop or server can go higher. It's safe to start low and raise it later - the queue just continues faster.

### When a book is only partly read

A scanned book that OCR'd cleanly is badged **OCR**. If some of its pages were skipped - they took longer than `OCR_PAGE_TIMEOUT`, or reading them failed - it is badged **OCR 14/206** instead: amber, and showing how many pages were actually read. Those pages are not in the search index, so searching the book will quietly miss that text.

The fix is to give the slow pages more time: raise `OCR_PAGE_TIMEOUT` (see [Speeding up OCR](performance.md#speeding-up-ocr)), restart, then re-read the book from its actions menu (**⋮** → **Re-OCR…**). Skipped pages are also logged as warnings when the book finishes, so `docker logs grimoire` will name them.

### Re-OCR a single book at a higher DPI

`OCR_DPI` sets the resolution for the whole library, and `150` is usually plenty. But the occasional faint or low-quality scan reads better at a higher resolution. Rather than raise the global default (and re-OCR everything), you can re-OCR just that one book: on an OCR-badged book, open the actions menu (**⋮**) and choose **Re-OCR…**, optionally enter a DPI (e.g. `300`), and run it. The book is re-read in the background at that resolution while the rest of the library is untouched; leave the DPI blank to re-OCR at the global default. It appears for scanned and OCR'd books, and for books whose own text covers less than `OCR_MIN_TEXT_COVERAGE` of their pages (see [Scans with a few pages of text](#scans-with-a-few-pages-of-text)), and requires GM or admin.

### Re-scan &amp; re-index a single book

Edited a PDF in place (embedded encounter notes, added errata)? Its search index goes stale until the next full library rescan. Instead, on that book open the actions menu (**⋮**) and choose **Re-scan &amp; re-index** to re-read just that file: its page count and thumbnail refresh, and its text is re-extracted and re-indexed in the background (an image-only PDF is re-queued for OCR). Works for any PDF and requires GM or admin.

## Page rendering

PDFs are rendered page-by-page server-side as WebP images rather than streamed as raw files. This keeps the viewer fast on mobile and avoids loading large files into the browser. Switch to the native PDF viewer anytime via the toolbar.

Pages are rendered in separate render worker processes, not in Grimoire itself, as are tables of contents and exports. If a damaged PDF crashes the PDF library, only that page (or export) fails: the worker is replaced and Grimoire keeps running. A worker starts when someone opens a page and stops once nobody has read anything for `PAGE_IDLE_RELEASE` seconds.

**`RENDER_WORKERS`** (default `1`) sets how many there are. Each book is always rendered by the same worker, so a second worker helps when several people read *different* books at once. Turning 12 pages in each of 8 illustrated books at once on a 10-core machine:

| `RENDER_WORKERS` | Pages per second |
|---|---|
| `0` (inside Grimoire, the old behaviour) | 10.8 |
| `1` | 12.3 |
| `2` | 19.1 |
| `4` | 23.4 |

Four workers fall short of four times one because books are shared out by a hash of their path, not by load: with 8 books, one worker got 4 of them and another none. More workers than CPU cores never helps. `RENDER_WORKERS` is cheaper than raising `WORKERS` for render speed: a render worker is about 50 MB plus what it is rendering, against 125-190 MB for a whole extra app worker.

Set `RENDER_WORKERS=0` on a host that is very short of memory: rendering then happens inside Grimoire as it used to, without the crash protection. See [Memory use](#memory-use) for the trade-off.

**`RENDER_QUEUE_LIMIT`** (default `16`) caps how many pages and zoom tiles may be rendering or waiting to render at once. Each one ties up a request thread until its render finishes, so without a cap a big book opened or a deep zoom could leave nothing to answer anyone else. Past the cap, a page that isn't rendered yet gets a "busy, try again" answer and the reader asks again a second or two later; pages already rendered are always served. Raise it alongside `RENDER_WORKERS`, but going far past `20` leaves little room for other requests during a burst.

## Memory use

Out of the box Grimoire runs a single worker process and settles at roughly 250 MB once your library is scanned. Reading adds to that temporarily: rendering an illustrated page decodes its images to full size, which can take a few hundred MB while someone is turning pages. Grimoire hands that memory back automatically - every `PAGE_RECLAIM_INTERVAL` renders, and again once nobody has read anything for `PAGE_IDLE_RELEASE` seconds - so it returns to its idle footprint after a reading session.

- **`WORKERS`** - see [Workers](#workers) below.
- **`RENDER_WORKERS`** - render workers exist only while someone is reading, but while they do, each costs about 50 MB on top of the memory its renders use, and its peak is higher than the same renders inside Grimoire would be (measured: about 415 MB in the worker against about 255 MB of growth in Grimoire, reading three illustrated books). Once reading stops the workers exit and Grimoire is back to its idle size - slightly below where in-process rendering settles, since none of the render memory was ever in Grimoire itself. `RENDER_WORKERS=0` trades the crash protection for the lower peak.
- **`PAGE_RECLAIM_INTERVAL`** - lower it (e.g. `3`) to keep peaks down when several people read at once; it costs a few percent of render speed.
- **`OCR_CONCURRENCY`** - each parallel OCR job adds 50-250 MB while it runs (see [Speeding up OCR](#speeding-up-ocr)).

### Workers

`WORKERS` defaults to `1`, which suits most servers: one worker serves many people at once on separate threads, and a single reader turns pages just as fast as with two. Each extra worker is a full copy of the app (roughly 125-190 MB).

A second worker pays off when several people turn pages nobody has viewed yet at the same moment: with four such readers on a 4-core host, one worker served 5.5 pages/s and two served 7.6 (1.9.0's two workers: 4.5). On 2 cores the gain was about 10%. Already-viewed pages come from the cache either way.

Raise it to `2` when all of these hold:

- Three or four people or more regularly read at the same time.
- Page turns feel slow when they do, and `docker stats` shows Grimoire at about 100% CPU (one full core) while other cores sit idle.
- The host has 4 or more CPU cores and ~200 MB of RAM to spare.

More workers than CPU cores never helps. With more than one worker, set `VALKEY_URL` too: otherwise each worker keeps its own page cache, sign-in rate limits and scan progress, and the scan status can look stuck while the other worker runs the scan. **Stop** still reaches the startup scan whichever worker runs it, but a rescan started from the app can be stopped only through the worker running it. Grimoire does not scale workers on its own - a new worker takes seconds and 125-190 MB to start, so it would arrive after a burst had passed.

## Caching

Rendered pages are cached to disk by default. Provide a `VALKEY_URL` to use an in-memory Redis-compatible cache instead for faster repeat loads.

Cache entries are keyed by a hash of the source file's **contents**, so replacing a book with a different file at the same path automatically supersedes everything cached from the old one - pages, cover, and search text. The next rescan notices the change, and the reader picks up the new pages without a restart or a manual cache purge.

The on-disk cache is trimmed oldest-first back under `PAGE_CACHE_MAX_MB` (default 2 GiB) at startup and after each library scan.

## Large libraries

The galleries (Maps, Tokens, Audio, Models), a game system's shelf, and the Tags
page are built for libraries of a few hundred thousand files:

- **Only what you look at is loaded.** Grimoire does the searching, sorting,
  filtering, and folder grouping on the server, and the browser fetches one
  folder at a time as you open it, a page at a time as you scroll. There is no
  "page 2" - the list keeps going as you reach the end. Opening a gallery of
  180,000 tokens costs a few small requests, not the whole library.
- **Folder counts are exact before anything opens.** Each folder shows how many
  items it holds (under the current filters), so you can see where things are
  without expanding everything.
- **Folders start collapsed**, and folders that a new search or filter brings
  into view start collapsed too - expand just the ones you need.
- **Search understands field prefixes.** The search box on a gallery or a
  system's page accepts the same `field:value` syntax as the main search page -
  `tag:dungeon`, `title:goblin` on a gallery; `author:gygax`, `year:1985`,
  `code:PZO` on a system - so you can narrow a large collection in one step. See
  [Field-scoped search](api.md#field-scoped-search).
- **Thumbnails are cached by the browser.** Thumbnails carry cache validators,
  so revisiting a gallery or scrolling back re-uses the images already
  downloaded rather than re-fetching every one.

The database work behind these views is indexed: on a test library of 187,000
tokens, 18,000 maps, and a single system holding 30,000 books, every browse
request answers in well under half a second. Upgrading to the release that
introduced this builds those indexes once on startup, which takes a few seconds
per hundred thousand files.

---

## See also

- [Configuration](configuration.md) - the full environment variable reference
- [Library structure](library-structure.md) - what gets indexed, per format
