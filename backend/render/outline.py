"""Table-of-contents (PDF outline) reading that survives a broken bookmark.

PyMuPDF's ``get_toc`` loads the outline through MuPDF in one go, and MuPDF
abandons the *whole* outline when any single entry's destination can't be
resolved - e.g. a bookmark pointing at page index 257 in a 257-page book.
PyMuPDF swallows that error and returns ``[]``, so the reader showed no table of
contents at all for a book Acrobat lists bookmarks for (it just skips the bad
one).

``read_toc`` uses ``get_toc`` when it works and otherwise walks the outline
dictionaries itself, resolving each entry's destination independently so one
bad entry costs only its own link.
"""
import logging
import re
from typing import Any, Optional

import fitz  # PyMuPDF

logger = logging.getLogger("grimoire.indexer")

# Ceiling on entries read by the manual walk, so a malformed (or hostile) outline
# can't make a TOC request run away. Real books stay far below this.
_MAX_OUTLINE_ENTRIES = 10_000

# A destination array starting with a page reference: ``[12 0 R /FitH 600]``.
_DEST_PAGE_REF = re.compile(r"^\s*\[\s*(\d+)\s+\d+\s+R\b")
# One starting with a bare page index instead: ``[256 /FitH 600]``. The spec
# reserves that form for remote GoTo actions, but scanning tools write it for
# local ones too, and Acrobat honours it.
_DEST_PAGE_INDEX = re.compile(r"^\s*\[\s*(-?\d+)\b")


def read_toc(doc: fitz.Document) -> list[list[Any]]:
    """The document's TOC as ``get_toc(simple=True)`` shapes it.

    Each entry is ``[level, title, page]`` with a 1-based page, or ``-1`` when
    the entry's destination can't be resolved.
    """
    try:
        toc: list[list[Any]] = doc.get_toc(simple=True)
    except Exception:
        toc = []
    if toc or not doc.is_pdf:
        return toc
    try:
        return _walk_outline(doc)
    except Exception:
        logger.warning("Could not read the PDF outline of %s", doc.name, exc_info=True)
        return []


def _ref(value: tuple[str, str]) -> int:
    """The object number of an ``xref_get_key`` result, or 0 if not a reference."""
    kind, text = value
    if kind != "xref":
        return 0
    try:
        return int(text.split()[0])
    except (IndexError, ValueError):
        return 0


def _walk_outline(doc: fitz.Document) -> list[list[Any]]:
    """Read the outline tree straight from the PDF objects, depth first."""
    root = _ref(doc.xref_get_key(doc.pdf_catalog(), "Outlines"))
    if not root:
        return []
    resolver = _DestResolver(doc)
    entries: list[list[Any]] = []
    seen: set[int] = set()
    # Siblings still to visit after a subtree, so the walk needs no recursion
    # (outlines can nest deeply) and emits entries in reading order.
    pending: list[tuple[int, int]] = [(_ref(doc.xref_get_key(root, "First")), 1)]
    while pending and len(entries) < _MAX_OUTLINE_ENTRIES:
        xref, level = pending.pop()
        # `seen` stops a /Next or /First loop in a corrupt outline.
        while xref and xref not in seen and len(entries) < _MAX_OUTLINE_ENTRIES:
            seen.add(xref)
            kind, title = doc.xref_get_key(xref, "Title")
            entries.append([level, title.strip() if kind == "string" else "", resolver.page(xref)])
            child = _ref(doc.xref_get_key(xref, "First"))
            sibling = _ref(doc.xref_get_key(xref, "Next"))
            if child:
                pending.append((sibling, level))
                xref, level = child, level + 1
            else:
                xref = sibling
    return entries


class _DestResolver:
    """Maps one outline item's destination to a 1-based page number."""

    def __init__(self, doc: fitz.Document) -> None:
        self._doc = doc
        self._page_count: int = doc.page_count
        self._page_by_xref = {doc.page_xref(i): i for i in range(doc.page_count)}
        self._names: Optional[dict[str, Any]] = None

    def page(self, item: int) -> int:
        doc = self._doc
        dest = doc.xref_get_key(item, "Dest")
        if dest[0] == "null":
            if doc.xref_get_key(item, "A/S")[1] != "/GoTo":
                return -1
            dest = doc.xref_get_key(item, "A/D")
        kind, text = dest
        if kind == "xref":
            # An indirect destination: the array itself, or a dict holding it in /D.
            source = doc.xref_object(_ref(dest), compressed=True)
            text = source[source.find("[") :] if "[" in source else ""
            kind = "array"
        if kind == "array":
            return self._from_array(text)
        if kind in ("name", "string"):
            return self._from_name(text.lstrip("/") if kind == "name" else text)
        return -1

    def _from_array(self, text: str) -> int:
        match = _DEST_PAGE_REF.match(text)
        if match:
            index = self._page_by_xref.get(int(match.group(1)))
            return index + 1 if index is not None else -1
        match = _DEST_PAGE_INDEX.match(text)
        if not match:
            return -1
        index = int(match.group(1))
        if index < 0:
            return -1
        # Past the end is almost always a 1-based page number written where a
        # 0-based index belongs, so the target is the last page.
        return min(index + 1, self._page_count)

    def _from_name(self, name: str) -> int:
        if self._names is None:
            try:
                self._names = self._doc.resolve_names()
            except Exception:
                self._names = {}
        target = self._names.get(name)
        if not isinstance(target, dict):
            return -1
        index = target.get("page", -1)
        return index + 1 if isinstance(index, int) and index >= 0 else -1
