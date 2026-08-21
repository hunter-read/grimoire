"""Tests for OPF metadata parsing in the library indexer."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from textwrap import dedent


from backend.config import SessionLocal
from backend.indexer import parse_opf_metadata, scan_library
from backend.indexer.metadata import _apply_opf_to_book
from backend.models import Book
from backend.services import tag_service


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_opf(directory: str, name: str, content: str) -> str:
    path = os.path.join(directory, name)
    Path(path).write_text(content, encoding="utf-8")
    return path


MARVEL_OPF = dedent("""\
    <?xml version='1.0' encoding='utf-8'?>
    <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
            <dc:title>Marvel Multiverse: Core Rulebook</dc:title>
            <dc:creator opf:role="aut">Matt Forbeck</dc:creator>
            <dc:date>2023-05-15T04:00:00+00:00</dc:date>
            <dc:description>&lt;div&gt;&lt;p&gt;Take on the roles of Marvel's heroes.&lt;/p&gt;&lt;/div&gt;</dc:description>
            <dc:publisher>Marvel Universe</dc:publisher>
            <dc:subject>Comics &amp; Graphic Novels</dc:subject>
            <dc:subject>Role Playing &amp; Fantasy</dc:subject>
        </metadata>
        <guide>
            <reference type="cover" title="Cover" href="Marvel Multiverse_ Core Rulebook.jpg"/>
        </guide>
    </package>
""")

MINIMAL_OPF = dedent("""\
    <?xml version='1.0' encoding='utf-8'?>
    <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
            <dc:title>Minimal Book</dc:title>
        </metadata>
    </package>
""")

MULTI_AUTHOR_OPF = dedent("""\
    <?xml version='1.0' encoding='utf-8'?>
    <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
            <dc:title>Collaborative Work</dc:title>
            <dc:creator opf:role="aut">Alice Smith</dc:creator>
            <dc:creator opf:role="aut">Bob Jones</dc:creator>
        </metadata>
    </package>
""")

# Calibre writes "Unknown" as the creator when no author is set.
UNKNOWN_AUTHOR_OPF = dedent("""\
    <?xml version='1.0' encoding='utf-8'?>
    <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
            <dc:title>Authorless Book</dc:title>
            <dc:creator opf:role="aut">Unknown</dc:creator>
        </metadata>
    </package>
""")

# A real author alongside Calibre's "Unknown" placeholder.
MIXED_UNKNOWN_AUTHOR_OPF = dedent("""\
    <?xml version='1.0' encoding='utf-8'?>
    <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
            <dc:title>Partly Known</dc:title>
            <dc:creator opf:role="aut">unknown</dc:creator>
            <dc:creator opf:role="aut">Alice Smith</dc:creator>
        </metadata>
    </package>
""")


# ---------------------------------------------------------------------------
# parse_opf_metadata — full metadata
# ---------------------------------------------------------------------------

class TestParseOpfMetadataFull:
    def setup_method(self):
        self.tmp = tempfile.mkdtemp()

    def test_title_extracted(self):
        path = _write_opf(self.tmp, "marvel.opf", MARVEL_OPF)
        assert parse_opf_metadata(path)["title"] == "Marvel Multiverse: Core Rulebook"

    def test_author_extracted(self):
        path = _write_opf(self.tmp, "marvel.opf", MARVEL_OPF)
        assert parse_opf_metadata(path)["authors"] == ["Matt Forbeck"]

    def test_publisher_extracted(self):
        path = _write_opf(self.tmp, "marvel.opf", MARVEL_OPF)
        assert parse_opf_metadata(path)["publisher"] == "Marvel Universe"

    def test_year_extracted(self):
        path = _write_opf(self.tmp, "marvel.opf", MARVEL_OPF)
        assert parse_opf_metadata(path)["year"] == 2023

    def test_description_extracted_and_html_stripped(self):
        path = _write_opf(self.tmp, "marvel.opf", MARVEL_OPF)
        desc = parse_opf_metadata(path)["description"]
        assert "<" not in desc
        assert "Marvel's heroes" in desc

    def test_subjects_become_tags(self):
        path = _write_opf(self.tmp, "marvel.opf", MARVEL_OPF)
        tags = parse_opf_metadata(path)["tags"]
        assert "comics & graphic novels" in tags
        assert "role playing & fantasy" in tags

    def test_cover_image_filename_extracted(self):
        path = _write_opf(self.tmp, "marvel.opf", MARVEL_OPF)
        assert parse_opf_metadata(path)["cover_image_filename"] == "Marvel Multiverse_ Core Rulebook.jpg"


# ---------------------------------------------------------------------------
# parse_opf_metadata — minimal / missing fields
# ---------------------------------------------------------------------------

class TestParseOpfMetadataMinimal:
    def setup_method(self):
        self.tmp = tempfile.mkdtemp()

    def test_only_title_present(self):
        path = _write_opf(self.tmp, "minimal.opf", MINIMAL_OPF)
        meta = parse_opf_metadata(path)
        assert meta["title"] == "Minimal Book"
        assert "authors" not in meta
        assert "publisher" not in meta
        assert "year" not in meta
        assert "tags" not in meta
        assert "description" not in meta
        assert "cover_image_filename" not in meta

    def test_multiple_authors(self):
        path = _write_opf(self.tmp, "multi.opf", MULTI_AUTHOR_OPF)
        assert parse_opf_metadata(path)["authors"] == ["Alice Smith", "Bob Jones"]

    def test_calibre_unknown_author_omitted(self):
        path = _write_opf(self.tmp, "unknown.opf", UNKNOWN_AUTHOR_OPF)
        assert "authors" not in parse_opf_metadata(path)

    def test_calibre_unknown_author_filtered_from_real_authors(self):
        path = _write_opf(self.tmp, "mixed.opf", MIXED_UNKNOWN_AUTHOR_OPF)
        assert parse_opf_metadata(path)["authors"] == ["Alice Smith"]

    def test_nonexistent_file_returns_empty_dict(self):
        result = parse_opf_metadata(os.path.join(self.tmp, "nonexistent.opf"))
        assert result == {}

    def test_malformed_xml_returns_empty_dict(self):
        path = _write_opf(self.tmp, "bad.opf", "<not valid xml <<>>")
        assert parse_opf_metadata(path) == {}

    def test_empty_file_returns_empty_dict(self):
        path = _write_opf(self.tmp, "empty.opf", "")
        assert parse_opf_metadata(path) == {}


# ---------------------------------------------------------------------------
# parse_opf_metadata — edge cases
# ---------------------------------------------------------------------------

class TestParseOpfMetadataEdgeCases:
    def setup_method(self):
        self.tmp = tempfile.mkdtemp()

    def test_date_year_only(self):
        opf = dedent("""\
            <?xml version='1.0' encoding='utf-8'?>
            <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
                <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
                    <dc:title>Test</dc:title>
                    <dc:date>2019</dc:date>
                </metadata>
            </package>
        """)
        path = _write_opf(self.tmp, "test.opf", opf)
        assert parse_opf_metadata(path)["year"] == 2019

    def test_invalid_date_omitted(self):
        opf = dedent("""\
            <?xml version='1.0' encoding='utf-8'?>
            <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
                <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
                    <dc:title>Test</dc:title>
                    <dc:date>not-a-date</dc:date>
                </metadata>
            </package>
        """)
        path = _write_opf(self.tmp, "test.opf", opf)
        assert "year" not in parse_opf_metadata(path)

    def test_calibre_no_date_sentinel_omitted(self):
        # Calibre writes 0101-01-01T00:00:00+00:00 when no date is set
        opf = dedent("""\
            <?xml version='1.0' encoding='utf-8'?>
            <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
                <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
                    <dc:title>Test</dc:title>
                    <dc:date>0101-01-01T00:00:00+00:00</dc:date>
                </metadata>
            </package>
        """)
        path = _write_opf(self.tmp, "test.opf", opf)
        assert "year" not in parse_opf_metadata(path)

    def test_description_html_only_becomes_empty_omitted(self):
        opf = dedent("""\
            <?xml version='1.0' encoding='utf-8'?>
            <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
                <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
                    <dc:title>Test</dc:title>
                    <dc:description>&lt;div&gt;&lt;/div&gt;</dc:description>
                </metadata>
            </package>
        """)
        path = _write_opf(self.tmp, "test.opf", opf)
        assert "description" not in parse_opf_metadata(path)

    def test_cover_href_path_stripped_to_filename(self):
        opf = dedent("""\
            <?xml version='1.0' encoding='utf-8'?>
            <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
                <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
                    <dc:title>Test</dc:title>
                </metadata>
                <guide>
                    <reference type="cover" title="Cover" href="subdir/cover.jpg"/>
                </guide>
            </package>
        """)
        path = _write_opf(self.tmp, "test.opf", opf)
        assert parse_opf_metadata(path)["cover_image_filename"] == "cover.jpg"

    def test_subjects_lowercased(self):
        opf = dedent("""\
            <?xml version='1.0' encoding='utf-8'?>
            <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
                <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
                    <dc:title>Test</dc:title>
                    <dc:subject>Science Fiction</dc:subject>
                    <dc:subject>HORROR</dc:subject>
                </metadata>
            </package>
        """)
        path = _write_opf(self.tmp, "test.opf", opf)
        assert parse_opf_metadata(path)["tags"] == ["science fiction", "horror"]


# ---------------------------------------------------------------------------
# dc:identifier — ISBN scoped by opf:scheme (issue #376)
# ---------------------------------------------------------------------------

def _isbn_opf(*identifiers: str) -> str:
    """Build an OPF whose only interesting content is its dc:identifier list."""
    body = "\n".join(f"            {ident}" for ident in identifiers)
    return dedent("""\
        <?xml version='1.0' encoding='utf-8'?>
        <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
            <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
                <dc:title>Test</dc:title>
        %s
            </metadata>
        </package>
    """) % body


class TestParseOpfIsbn:
    def setup_method(self):
        self.tmp = tempfile.mkdtemp()

    def _parse(self, *identifiers: str) -> dict:
        path = _write_opf(self.tmp, "test.opf", _isbn_opf(*identifiers))
        return parse_opf_metadata(path)

    def test_isbn13_scheme_read(self):
        meta = self._parse('<dc:identifier opf:scheme="ISBN">9780786965502</dc:identifier>')
        assert meta["isbn"] == "9780786965502"

    def test_isbn10_scheme_read(self):
        meta = self._parse('<dc:identifier opf:scheme="ISBN">0786965509</dc:identifier>')
        assert meta["isbn"] == "0786965509"

    def test_isbn10_check_digit_x_accepted(self):
        meta = self._parse('<dc:identifier opf:scheme="ISBN">043942089X</dc:identifier>')
        assert meta["isbn"] == "043942089X"

    def test_hyphens_and_spaces_stripped(self):
        meta = self._parse('<dc:identifier opf:scheme="ISBN">978-0-7869-6550-2</dc:identifier>')
        assert meta["isbn"] == "9780786965502"

    def test_scheme_matched_case_insensitively(self):
        meta = self._parse('<dc:identifier opf:scheme="isbn">9780786965502</dc:identifier>')
        assert meta["isbn"] == "9780786965502"

    def test_unscoped_identifier_ignored(self):
        # Calibre's UUID has no scheme — the whole reason identifiers were
        # ignored wholesale before.
        meta = self._parse(
            "<dc:identifier>urn:uuid:1c2f8f0e-6b0e-4f2d-9a1b-8c7d6e5f4a3b</dc:identifier>"
        )
        assert "isbn" not in meta

    def test_uuid_scheme_identifier_ignored(self):
        meta = self._parse(
            '<dc:identifier opf:scheme="uuid" id="uuid_id">'
            "1c2f8f0e-6b0e-4f2d-9a1b-8c7d6e5f4a3b</dc:identifier>"
        )
        assert "isbn" not in meta

    def test_non_isbn_scheme_ignored(self):
        meta = self._parse('<dc:identifier opf:scheme="DOI">10.1000/182</dc:identifier>')
        assert "isbn" not in meta

    def test_bad_check_digit_rejected(self):
        meta = self._parse('<dc:identifier opf:scheme="ISBN">9780786965509</dc:identifier>')
        assert "isbn" not in meta

    def test_wrong_length_rejected(self):
        meta = self._parse('<dc:identifier opf:scheme="ISBN">12345</dc:identifier>')
        assert "isbn" not in meta

    def test_non_numeric_isbn13_rejected(self):
        meta = self._parse('<dc:identifier opf:scheme="ISBN">97807869655AB</dc:identifier>')
        assert "isbn" not in meta

    def test_isbn10_with_letter_in_body_rejected(self):
        meta = self._parse('<dc:identifier opf:scheme="ISBN">07869A5509</dc:identifier>')
        assert "isbn" not in meta

    def test_empty_identifier_ignored(self):
        meta = self._parse('<dc:identifier opf:scheme="ISBN"></dc:identifier>')
        assert "isbn" not in meta

    def test_first_valid_isbn_wins_over_earlier_invalid(self):
        meta = self._parse(
            "<dc:identifier>urn:uuid:abc</dc:identifier>",
            '<dc:identifier opf:scheme="ISBN">nonsense</dc:identifier>',
            '<dc:identifier opf:scheme="ISBN">9780786965502</dc:identifier>',
        )
        assert meta["isbn"] == "9780786965502"

    def test_absent_identifier_leaves_isbn_unset(self):
        meta = self._parse()
        assert "isbn" not in meta


class TestIsbnRefreshModes:
    """The recovery case from issue #376: rebuilding a database from sidecars.

    ``isbn`` joins the OPF-sourced fields, so the refresh modes have to treat it
    exactly like the fields that were already there.
    """

    def test_missing_fills_an_empty_isbn(self):
        book = Book(title="T", isbn="")
        assert _apply_opf_to_book(book, {"isbn": "9780786965502"}, "missing") is True
        assert book.isbn == "9780786965502"

    def test_missing_protects_a_user_entered_isbn(self):
        book = Book(title="T", isbn="9780786965601")
        assert _apply_opf_to_book(book, {"isbn": "9780786965502"}, "missing") is False
        assert book.isbn == "9780786965601"

    def test_replace_overwrites_an_existing_isbn(self):
        book = Book(title="T", isbn="9780786965601")
        assert _apply_opf_to_book(book, {"isbn": "9780786965502"}, "replace") is True
        assert book.isbn == "9780786965502"

    def test_an_opf_without_an_isbn_never_clears_one(self):
        book = Book(title="T", isbn="9780786965601")
        assert _apply_opf_to_book(book, {"title": "T"}, "replace") is False
        assert book.isbn == "9780786965601"


# ---------------------------------------------------------------------------
# Calibre per-book-folder structure — scan_library integration
# ---------------------------------------------------------------------------

CALIBRE_BOOK_OPF = dedent("""\
    <?xml version='1.0' encoding='utf-8'?>
    <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
            <dc:title>Player's Handbook</dc:title>
            <dc:creator opf:role="aut">Wizards of the Coast</dc:creator>
            <dc:date>2014-08-19T00:00:00+00:00</dc:date>
            <dc:publisher>Wizards of the Coast</dc:publisher>
            <dc:identifier opf:scheme="ISBN">978-0-7869-6560-1</dc:identifier>
            <dc:identifier opf:scheme="uuid" id="uuid_id">1c2f8f0e-6b0e-4f2d-9a1b-8c7d6e5f4a3b</dc:identifier>
            <dc:subject>tabletop rpg</dc:subject>
        </metadata>
        <guide>
            <reference type="cover" title="Cover" href="cover.jpg"/>
        </guide>
    </package>
""")


def _mk_lib():
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    lib.mkdir()
    return tmp, lib


class TestCalibrePerBookFolderStructure:
    """Calibre exports each book as its own subfolder containing the PDF,
    metadata.opf, and cover.jpg.  The scanner must pick up metadata.opf
    and skip cover.jpg."""

    def setup_method(self):
        self.tmp, self.lib = _mk_lib()

    def _scan(self):
        db = SessionLocal()
        try:
            scan_library(str(self.lib), self.tmp, db)
        finally:
            db.close()

    def _get_book(self, title: str):
        db = SessionLocal()
        try:
            return db.query(Book).filter(Book.title == title).first()
        finally:
            db.close()

    def _book_folder(self, system: str, category: str, book_name: str) -> Path:
        d = self.lib / "books" / system / category / book_name
        d.mkdir(parents=True, exist_ok=True)
        return d

    def test_metadata_opf_applied_when_no_stem_opf(self):
        folder = self._book_folder("D&D 5e", "core", "Players Handbook")
        (folder / "players_handbook.pdf").write_bytes(b"%PDF-1.4")
        (folder / "metadata.opf").write_text(CALIBRE_BOOK_OPF, encoding="utf-8")

        self._scan()

        book = self._get_book("Player's Handbook")
        assert book is not None
        assert book.authors == ["Wizards of the Coast"]
        assert book.publisher == "Wizards of the Coast"
        assert book.year == 2014
        # Scoped ISBN round-trips in normalised form; the UUID stays ignored.
        assert book.isbn == "9780786965601"
        # OPF subjects become shared tags; match on the internal (lowercased) key.
        db = SessionLocal()
        try:
            internals = {t["internal"] for t in tag_service.tags_for_resource(db, "book", book.id)}
        finally:
            db.close()
        assert "tabletop rpg" in internals

    def test_stem_opf_takes_priority_over_metadata_opf(self):
        stem_opf = dedent("""\
            <?xml version='1.0' encoding='utf-8'?>
            <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
                <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
                    <dc:title>Stem Title Wins</dc:title>
                </metadata>
            </package>
        """)
        folder = self._book_folder("D&D 5e", "core", "Stem Priority Test")
        (folder / "book.pdf").write_bytes(b"%PDF-1.4")
        (folder / "book.opf").write_text(stem_opf, encoding="utf-8")
        (folder / "metadata.opf").write_text(CALIBRE_BOOK_OPF, encoding="utf-8")

        self._scan()

        book = self._get_book("Stem Title Wins")
        assert book is not None

    def test_cover_jpg_not_indexed_as_book(self):
        folder = self._book_folder("D&D 5e", "core", "Cover Skip Test")
        (folder / "players_handbook.pdf").write_bytes(b"%PDF-1.4")
        (folder / "metadata.opf").write_text(CALIBRE_BOOK_OPF, encoding="utf-8")
        (folder / "cover.jpg").write_bytes(b"\xff\xd8\xff")  # minimal JPEG header

        self._scan()

        db = SessionLocal()
        try:
            cover_book = db.query(Book).filter(Book.filename == "cover.jpg").first()
        finally:
            db.close()
        assert cover_book is None

    def test_book_without_opf_uses_filename_as_title(self):
        folder = self._book_folder("D&D 5e", "core", "No Metadata")
        (folder / "dungeon_masters_guide.pdf").write_bytes(b"%PDF-1.4")

        self._scan()

        db = SessionLocal()
        try:
            book = db.query(Book).filter(Book.filename == "dungeon_masters_guide.pdf").first()
        finally:
            db.close()
        assert book is not None
        assert book.title == "dungeon masters guide"
