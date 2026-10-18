"""Opening fitz-backed documents with the app-wide reflow layout.

EPUB is reflowable: ``len(doc)`` depends on the layout box passed to
``Document.layout()``. If the indexer and the reader laid out differently, a
search hit on "page 12" would point at different text than the reader shows on
page 12. ``EPUB_LAYOUT`` pins one layout app-wide so page numbers mean the same
thing everywhere; ``open_document`` applies it on every open.

A leaf module, importing only PyMuPDF, so a render worker can open documents
without loading the indexer package (and SQLAlchemy with it).
``backend.indexer.formats`` re-exports everything here.
"""
import fitz  # PyMuPDF

# --- EPUB / reflowable layout --------------------------------------------------
# A fixed A4-ish box at a fixed font size. The exact numbers matter far less than
# that they never change: page counts, FTS page anchors, cached page renders, and
# stored reading positions are all derived from this layout. Changing it
# re-paginates every reflowable book in the library and invalidates their search
# anchors, so treat it as a stored-data format constant, not a display tweak.
EPUB_LAYOUT_WIDTH = 600
EPUB_LAYOUT_HEIGHT = 800
EPUB_LAYOUT_FONTSIZE = 11


def apply_reflow_layout(doc: "fitz.Document") -> None:
    """Pin a reflowable document to the app-wide layout box.

    Safe to call on any document: fixed-layout formats ignore it. Keeping this
    in one function is what guarantees the indexer and the reader agree on what
    "page 12" means.
    """
    if getattr(doc, "is_reflowable", False):
        doc.layout(
            width=EPUB_LAYOUT_WIDTH,
            height=EPUB_LAYOUT_HEIGHT,
            fontsize=EPUB_LAYOUT_FONTSIZE,
        )


def open_document(filepath: str) -> "fitz.Document":
    """Open a fitz-backed document with the shared reflow layout applied.

    Every read path (page count, text extraction, thumbnail, page render) goes
    through here so no caller can accidentally paginate an EPUB differently.
    """
    doc = fitz.open(filepath)
    apply_reflow_layout(doc)
    return doc
