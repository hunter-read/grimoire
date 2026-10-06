"""PDF outline reading that survives a broken bookmark (``backend.indexer.outline``).

MuPDF abandons a PDF's whole outline when one entry's destination can't be
resolved, so ``get_toc`` returned ``[]`` for a book whose bookmarks Acrobat
showed fine - the trigger was a "Rear Cover" bookmark pointing at page index 257
in a 257-page scan. ``read_toc`` walks the outline itself in that case.
"""
import os

import fitz
import pytest

from backend.indexer import outline
from backend.indexer.outline import read_toc
from backend.routers.books._helpers import _invalidate_book_cache
from .conftest import make_book, make_game_system

TOC = [
    [1, "Front Cover", 1],
    [1, "Chapter 1", 2],
    [2, "Section 1.1", 3],
    [3, "Deep Dive", 3],
    [1, "Chapter 2", 4],
    [1, "Rear Cover", 5],
]


def _build(tmp_path, toc=TOC, pages=5, name="book.pdf"):
    """Save a ``pages``-page PDF with ``toc`` as its outline; return its path."""
    doc = fitz.open()
    for _ in range(pages):
        doc.new_page(width=200, height=300)
    doc.set_toc(toc)
    path = str(tmp_path / name)
    doc.save(path)
    doc.close()
    return path


def _item(doc, title):
    """The object number of the outline item with this title."""
    for xref in range(1, doc.xref_length()):
        if doc.xref_get_key(xref, "Title") == ("string", title):
            return xref
    raise AssertionError(f"no outline item titled {title!r}")


def _edit(path, edits):
    """Rewrite outline items' keys (``{title: {key: value}}``) and reopen the file."""
    doc = fitz.open(path)
    for title, keys in edits.items():
        xref = _item(doc, title)
        for key, value in keys.items():
            doc.xref_set_key(xref, key, value)
    out = path.replace(".pdf", "-edited.pdf")
    doc.save(out)
    doc.close()
    return fitz.open(out)


def _break_rear_cover(path, dest="[5 /FitH 600]"):
    """Point the last bookmark at a bare page index one past the end (the bug)."""
    return _edit(path, {"Rear Cover": {"Dest": "null", "A": f"<</S/GoTo/D{dest}>>"}})


class TestReadToc:
    def test_uses_get_toc_when_the_outline_loads(self, tmp_path):
        doc = fitz.open(_build(tmp_path))
        assert read_toc(doc) == doc.get_toc(simple=True) == TOC

    def test_recovers_every_entry_when_one_bookmark_is_out_of_range(self, tmp_path):
        doc = _break_rear_cover(_build(tmp_path))
        # The bug: MuPDF gives up on the whole outline.
        assert doc.get_toc(simple=True) == []
        # The fallback keeps every entry, nesting included; the past-the-end
        # index is read as a 1-based page and lands on the last page.
        assert read_toc(doc) == TOC

    def test_a_document_without_an_outline_has_no_toc(self, tmp_path):
        doc = fitz.open(_build(tmp_path, toc=[]))
        assert read_toc(doc) == []

    def test_non_pdf_documents_keep_get_toc_result(self):
        class FakeEpub:
            is_pdf = False

            def get_toc(self, simple=True):
                return []

        assert read_toc(FakeEpub()) == []

    def test_falls_back_when_get_toc_raises(self, tmp_path, monkeypatch):
        doc = fitz.open(_build(tmp_path))
        monkeypatch.setattr(doc, "get_toc", lambda simple=True: 1 / 0)
        assert read_toc(doc) == TOC

    def test_a_walk_that_blows_up_yields_an_empty_toc(self, tmp_path, monkeypatch):
        doc = _break_rear_cover(_build(tmp_path))

        def boom(_doc):
            raise RuntimeError("corrupt")

        monkeypatch.setattr(outline, "_walk_outline", boom)
        assert read_toc(doc) == []

    def test_the_walk_is_capped(self, tmp_path, monkeypatch):
        doc = _break_rear_cover(_build(tmp_path))
        monkeypatch.setattr(outline, "_MAX_OUTLINE_ENTRIES", 3)
        assert len(read_toc(doc)) == 3

    def test_a_next_loop_does_not_hang(self, tmp_path):
        path = _build(tmp_path)
        doc = fitz.open(path)
        first = _item(doc, "Front Cover")
        doc.close()
        doc = _break_rear_cover(path)
        # Close the sibling chain back on itself.
        doc.xref_set_key(_item(doc, "Rear Cover"), "Next", f"{first} 0 R")
        assert [e[1] for e in read_toc(doc)] == [e[1] for e in TOC]


class TestDestinations:
    """Each entry resolves on its own; only the unresolvable ones get -1."""

    def _pages(self, doc):
        return {title: page for _, title, page in read_toc(doc)}

    def test_dest_key_with_a_page_reference(self, tmp_path):
        path = _build(tmp_path)
        doc = fitz.open(path)
        page3 = doc.page_xref(2)
        doc.close()
        doc = _edit(path, {"Chapter 2": {"A": "null", "Dest": f"[{page3} 0 R /Fit]"}})
        doc.xref_set_key(_item(doc, "Rear Cover"), "A", "<</S/GoTo/D[9 /Fit]>>")
        pages = self._pages(doc)
        assert pages["Chapter 2"] == 3
        assert pages["Rear Cover"] == 5

    def test_indirect_destination_array_and_dict(self, tmp_path):
        path = _build(tmp_path)
        doc = _break_rear_cover(path)
        array = doc.get_new_xref()
        doc.update_object(array, f"[{doc.page_xref(1)} 0 R /Fit]")
        holder = doc.get_new_xref()
        doc.update_object(holder, f"<</D[{doc.page_xref(3)} 0 R /Fit]>>")
        empty = doc.get_new_xref()
        doc.update_object(empty, "<</Foo 1>>")
        doc.xref_set_key(_item(doc, "Chapter 1"), "A", "null")
        doc.xref_set_key(_item(doc, "Chapter 1"), "Dest", f"{array} 0 R")
        doc.xref_set_key(_item(doc, "Chapter 2"), "A", f"<</S/GoTo/D {holder} 0 R>>")
        doc.xref_set_key(_item(doc, "Front Cover"), "A", f"<</S/GoTo/D {empty} 0 R>>")
        pages = self._pages(doc)
        assert pages["Chapter 1"] == 2
        assert pages["Chapter 2"] == 4
        assert pages["Front Cover"] == -1

    def test_named_destinations(self, tmp_path, monkeypatch):
        doc = _break_rear_cover(_build(tmp_path))
        doc.xref_set_key(_item(doc, "Chapter 1"), "A", "<</S/GoTo/D(chap1)>>")
        doc.xref_set_key(_item(doc, "Chapter 2"), "A", "null")
        doc.xref_set_key(_item(doc, "Chapter 2"), "Dest", "/chap2")
        doc.xref_set_key(_item(doc, "Front Cover"), "A", "<</S/GoTo/D(missing)>>")
        doc.xref_set_key(_item(doc, "Section 1.1"), "A", "<</S/GoTo/D(nopage)>>")
        names = {"chap1": {"page": 1}, "chap2": {"page": 3}, "nopage": {"page": -1}}
        monkeypatch.setattr(doc, "resolve_names", lambda: names)
        pages = self._pages(doc)
        assert pages["Chapter 1"] == 2
        assert pages["Chapter 2"] == 4
        assert pages["Front Cover"] == -1
        assert pages["Section 1.1"] == -1

    def test_named_destination_lookup_failure(self, tmp_path, monkeypatch):
        doc = _break_rear_cover(_build(tmp_path))
        doc.xref_set_key(_item(doc, "Chapter 1"), "A", "<</S/GoTo/D(chap1)>>")

        def boom():
            raise RuntimeError("bad name tree")

        monkeypatch.setattr(doc, "resolve_names", boom)
        assert self._pages(doc)["Chapter 1"] == -1

    def test_unresolvable_destinations(self, tmp_path):
        doc = _break_rear_cover(_build(tmp_path))
        not_a_page = doc.pdf_catalog()
        doc.xref_set_key(_item(doc, "Front Cover"), "A", "<</S/URI/URI(https://x.test)>>")
        doc.xref_set_key(_item(doc, "Chapter 1"), "A", f"<</S/GoTo/D[{not_a_page} 0 R /Fit]>>")
        doc.xref_set_key(_item(doc, "Section 1.1"), "A", "<</S/GoTo/D[-2 /Fit]>>")
        doc.xref_set_key(_item(doc, "Deep Dive"), "A", "<</S/GoTo/D[/Fit]>>")
        doc.xref_set_key(_item(doc, "Chapter 2"), "A", "<</S/GoTo/D 7>>")
        pages = self._pages(doc)
        for title in ("Front Cover", "Chapter 1", "Section 1.1", "Deep Dive", "Chapter 2"):
            assert pages[title] == -1, title
        assert pages["Rear Cover"] == 5

    def test_a_non_string_title_reads_as_blank(self, tmp_path):
        doc = _break_rear_cover(_build(tmp_path))
        doc.xref_set_key(_item(doc, "Chapter 2"), "Title", "42")
        assert [1, "", 4] in read_toc(doc)


def test_ref_ignores_malformed_references():
    assert outline._ref(("xref", "")) == 0
    assert outline._ref(("xref", "x 0 R")) == 0
    assert outline._ref(("null", "null")) == 0


def test_toc_endpoint_survives_a_broken_bookmark(tmp_path, client, admin_headers):
    path = str(tmp_path / "broken.pdf")
    doc = _break_rear_cover(_build(tmp_path))
    doc.save(path)
    doc.close()
    book = make_book(
        system_id=make_game_system().id,
        filepath=path,
        filename=os.path.basename(path),
        relative_path=os.path.basename(path),
        mime_type="application/pdf",
        is_missing=False,
        page_count=5,
    )
    _invalidate_book_cache()

    r = client.get(f"/api/books/{book.id}/toc", headers=admin_headers)

    assert r.status_code == 200, r.text
    toc = r.json()["toc"]
    assert [n["title"] for n in toc] == ["Front Cover", "Chapter 1", "Chapter 2", "Rear Cover"]
    section = toc[1]["children"][0]
    assert (section["title"], section["page"]) == ("Section 1.1", 3)
    assert section["children"][0]["title"] == "Deep Dive"
    assert toc[-1]["page"] == 5


@pytest.fixture(autouse=True)
def _quiet_mupdf():
    """Keep MuPDF's complaints about the deliberately broken files out of stderr."""
    previous = fitz.TOOLS.mupdf_display_errors()
    fitz.TOOLS.mupdf_display_errors(False)
    yield
    fitz.TOOLS.mupdf_display_errors(previous)
