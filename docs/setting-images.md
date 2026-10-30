# Setting images

Campaign banners, game system covers, book covers, and audio track covers all use the same picker.

---

Four things in Grimoire carry an image you choose yourself: a **campaign banner**, a
**game system cover**, a **book cover**, and an **audio track cover**. All four use the
same dialog, and it offers three ways to set one:

- **Upload** a file from your device (PNG, JPEG, WebP, or GIF).
- **Paste** an image straight from your clipboard with `Ctrl`/`Cmd`+`V` while the dialog is
  open - handy for a screenshot or something copied from a browser. You can also drag a
  file onto the dialog.
- **Browse** what Grimoire already has: your maps, tokens, book covers, and audio artwork.
  For a campaign banner, the campaign's own uploaded images come first, since that is
  usually where the art you want already lives.

Picking an existing image **copies** it into place rather than pointing at the original, so
the banner or cover keeps working if you later delete the source or reorganise your library.
Browsing only ever shows you images you can already open, and setting a campaign banner
stays a GM/owner action; system, book and audio covers need the GM or admin role.

**Banner positioning.** A banner fills a wide 2:1 hero, and most images aren't that shape,
so the interesting part can end up cropped out. When the chosen image is taller than the
frame, the dialog lets you **drag the preview** (or use the slider) to pick which slice
stays in view. The position is saved with the campaign, and you can come back and nudge it
later without re-uploading. Removing the banner resets it.

Audio covers are worth calling out: a track's artwork previously came only from a `cover.*`
image sitting next to it in your library or from the file's own embedded tags, neither of
which you could change from inside Grimoire. A cover you set here takes precedence over
both, and removing it hands control back to them.

## Book covers

A book's cover is normally made from its first page when the library is scanned. For most
books that is the cover, but not always: a fixed-layout EPUB can render as a blank page,
and a PDF may open on a wraparound dust jacket or a cover scanned on its side.

To replace it, open the book's **Edit Metadata** panel on its system page and use
**Upload cover** under **Cover**. The picker takes a file, a pasted image, or one Grimoire
already has. The change applies straight away - it does not wait for **Save** - and the
image is stored as a WebP at most 900 pixels wide.

The custom cover is used everywhere the book's cover appears: the library grids, the
OPDS feed, the image picker, an exported `.cover.jpg` sidecar, and the cover sent to
[Grimoire Codex DB](codex.md). Rescanning the library or the book never replaces it.
**Remove custom cover** brings back the one made from the first page. Custom covers are
kept in `book_covers/` in your data folder, which [backups](backups.md) include.

## See also

- [Campaigns](campaigns.md) - where banners appear
- [Library structure](library-structure.md) - `cover.*` / `folder.*` artwork in your library folders
