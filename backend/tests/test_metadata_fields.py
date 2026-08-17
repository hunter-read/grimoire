"""Tests for building the neutral field dict a sidecar renders (issue #300)."""
import os

import pytest

from backend.config import SessionLocal, THUMB_DIR
from backend.metadata.export import export_book
from backend.metadata.fields import _links, _list, book_fields
from backend.models import Book


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.query(Book).filter(Book.id.like("fields-%")).delete(
            synchronize_session=False
        )
        session.commit()
        session.close()


def _make_book(db, tmp_path, book_id="fields-1", **overrides):
    content = tmp_path / f"{book_id}.pdf"
    content.write_bytes(b"%PDF-1.4 fake")
    fields = {
        "id": book_id,
        "title": "A Book",
        "filename": content.name,
        "filepath": str(content),
        "relative_path": content.name,
        "indexed": True,
        **overrides,
    }
    book = Book(**fields)
    db.add(book)
    db.commit()
    return book


class TestListCoercion:
    """JSON columns hold whatever older versions and imports put there."""

    @pytest.mark.parametrize(
        "raw,expected",
        [
            (None, []),
            ([], []),
            (["a", "b"], ["a", "b"]),
            ("solo", ["solo"]),  # a scalar where a list was expected
            (["  padded  "], ["padded"]),
            (["keep", "", "  "], ["keep"]),
        ],
    )
    def test_values_are_normalised(self, raw, expected):
        assert _list(raw) == expected


class TestLinkCoercion:
    def test_entries_without_a_url_are_dropped(self):
        assert _links([{"label": "No URL"}]) == []

    def test_label_defaults_to_empty(self):
        assert _links([{"url": "https://x.test"}]) == [
            {"label": "", "url": "https://x.test"}
        ]

    @pytest.mark.parametrize("raw", [None, "not a list", [None], ["string"]])
    def test_malformed_input_yields_no_links(self, raw):
        assert _links(raw) == []


class TestBookFields:
    def test_reads_the_books_metadata(self, db, tmp_path):
        book = _make_book(
            db,
            tmp_path,
            title="Xanathar's Guide",
            authors=["Jeremy Crawford"],
            publisher="WotC",
            year=2017,
        )

        fields = book_fields(db, book)

        assert fields["title"] == "Xanathar's Guide"
        assert fields["authors"] == ["Jeremy Crawford"]
        assert fields["publisher"] == "WotC"
        assert fields["year"] == 2017

    def test_cover_filename_is_omitted_when_there_is_none(self, db, tmp_path):
        book = _make_book(db, tmp_path)
        assert "cover_filename" not in book_fields(db, book)

    def test_cover_filename_is_included_when_given(self, db, tmp_path):
        book = _make_book(db, tmp_path)
        assert book_fields(db, book, cover_filename="c.jpg")["cover_filename"] == "c.jpg"

    def test_the_legacy_url_column_fills_in_for_an_empty_list(self, db, tmp_path):
        """``publisher_url`` predates ``urls`` and is the backfill source."""
        book = _make_book(db, tmp_path, publisher_url="https://legacy.test", urls=[])

        assert book_fields(db, book)["publisher_url"] == "https://legacy.test"

    def test_the_legacy_url_is_hidden_once_the_list_is_populated(self, db, tmp_path):
        """Otherwise a sidecar shows a URL the UI has already replaced."""
        book = _make_book(
            db,
            tmp_path,
            publisher_url="https://stale.test",
            urls=[{"label": "Current", "url": "https://current.test"}],
        )

        fields = book_fields(db, book)
        assert "publisher_url" not in fields
        assert fields["urls"] == [{"label": "Current", "url": "https://current.test"}]


class TestCoverExport:
    def _write_thumbnail(self, book):
        """Put a cached thumbnail where the scanner would have keyed it."""
        import hashlib

        from backend.indexer.categories import slugify

        name = (
            f"{slugify(book.title)}_"
            f"{hashlib.md5(book.filepath.encode()).hexdigest()[:8]}.webp"
        )
        path = os.path.join(THUMB_DIR, "books", name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(b"fake-webp-bytes")
        return path

    def test_a_cover_is_written_beside_the_book(self, db, tmp_path):
        book = _make_book(db, tmp_path, book_id="fields-cover")
        thumb = self._write_thumbnail(book)
        try:
            result = export_book(db, book, ["json"], covers=True)

            assert result.covers == 1
            expected = os.path.splitext(book.filepath)[0] + ".jpg"
            assert os.path.isfile(expected)
        finally:
            os.unlink(thumb)

    def test_the_sidecar_names_the_cover_it_wrote(self, db, tmp_path):
        import json

        book = _make_book(db, tmp_path, book_id="fields-cover-named")
        thumb = self._write_thumbnail(book)
        try:
            export_book(db, book, ["json"], covers=True)

            from backend.metadata.formats import sidecar_path

            with open(sidecar_path(book.filepath, "json")) as fh:
                assert json.load(fh)["cover_filename"] == "fields-cover-named.jpg"
        finally:
            os.unlink(thumb)

    def test_no_cached_thumbnail_means_no_cover(self, db, tmp_path):
        book = _make_book(db, tmp_path, book_id="fields-no-thumb")

        result = export_book(db, book, ["json"], covers=True)

        assert result.covers == 0
        assert not os.path.exists(os.path.splitext(book.filepath)[0] + ".jpg")

    def test_an_existing_cover_is_not_replaced(self, db, tmp_path):
        """A cover carries no marker, so an existing one is always left alone."""
        book = _make_book(db, tmp_path, book_id="fields-cover-existing")
        thumb = self._write_thumbnail(book)
        dest = os.path.splitext(book.filepath)[0] + ".jpg"
        with open(dest, "wb") as fh:
            fh.write(b"the user's own cover")
        try:
            export_book(db, book, ["json"], covers=True)

            with open(dest, "rb") as fh:
                assert fh.read() == b"the user's own cover"
        finally:
            os.unlink(thumb)
