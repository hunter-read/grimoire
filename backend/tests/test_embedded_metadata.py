"""The built-in "File metadata" source: what a PDF or EPUB carries inside itself."""
import uuid
import zipfile
from datetime import date

import fitz  # type: ignore[import-untyped]
import pytest

from backend import config
from backend.metadata import embedded
from backend.render import ops, pool
from backend.tests.conftest import make_book, make_game_system

CONTAINER = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""

OPF = """<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Sailors on the Starless Sea</dc:title>
    <dc:creator>Harley Stroh</dc:creator>
    <dc:creator>Unknown</dc:creator>
    <dc:description>&lt;p&gt;A funnel adventure.&lt;/p&gt;</dc:description>
    <dc:publisher>Goodman Games</dc:publisher>
    <dc:date>2012-06-15</dc:date>
    <dc:language>en</dc:language>
    <dc:identifier>urn:uuid:0b3f3a9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b</dc:identifier>
    <dc:identifier>urn:isbn:978-0-306-40615-7</dc:identifier>
    <dc:subject>Adventure</dc:subject>
    <dc:subject>Funnel</dc:subject>
  </metadata>
</package>"""


def _make_epub(path, opf=OPF, container=CONTAINER):
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip")
        if container is not None:
            archive.writestr("META-INF/container.xml", container)
        if opf is not None:
            archive.writestr("OEBPS/content.opf", opf)
    return str(path)


def _make_pdf(path, metadata=None, language=None, xmp=None, custom=None):
    doc = fitz.open()
    doc.new_page()
    if metadata or custom:
        doc.set_metadata(metadata or {"title": ""})
    if language:
        doc.xref_set_key(doc.pdf_catalog(), "Lang", f"({language})")
    for key, value in (custom or {}).items():
        info = int(doc.xref_get_key(-1, "Info")[1].split()[0])
        doc.xref_set_key(info, key, f"({value})")
    if xmp:
        doc.set_xml_metadata(xmp)
    doc.save(str(path))
    doc.close()
    return str(path)


def _xmp(body):
    """An XMP packet whose rdf:Description holds ``body``."""
    return (
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/" '
        + body
        + "</rdf:Description></rdf:RDF></x:xmpmeta>"
    )


COMIC_INFO = """<?xml version="1.0"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>Chapter One</Title>
  <Series>Saga</Series>
  <Number>1</Number>
  <Summary>When two soldiers from opposite sides fall in love.</Summary>
  <Year>2012</Year>
  <Month>3</Month>
  <Day>14</Day>
  <Writer>Brian K. Vaughan</Writer>
  <Penciller>Fiona Staples</Penciller>
  <Inker>Fiona Staples</Inker>
  <Letterer>Fonografiks</Letterer>
  <CoverArtist></CoverArtist>
  <Publisher>Image</Publisher>
  <Genre>Science Fiction, Fantasy, science fiction</Genre>
  <Tags>Space Opera; Romance</Tags>
  <Web>https://www.imagecomics.com/comics/series/saga ftp://nope https://imagecomics.com/x</Web>
  <LanguageISO>en</LanguageISO>
  <GTIN>978-0-306-40615-7</GTIN>
</ComicInfo>"""


def _make_cbz(path, comic_info=COMIC_INFO, name="ComicInfo.xml"):
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("001.jpg", b"not really a jpeg")
        if comic_info is not None:
            archive.writestr(name, comic_info)
    return str(path)


@pytest.fixture
def in_process(monkeypatch):
    """Read PDFs in this process; the worker path is covered in test_render_pool."""
    pool.shutdown()
    monkeypatch.setattr(config, "RENDER_WORKERS", 0)
    yield
    pool.shutdown()


class TestDocumentMetadataOp:
    def test_reads_the_info_dictionary_and_language(self, tmp_path):
        path = _make_pdf(
            tmp_path / "a.pdf", {"title": "Mothership", "author": "Sean McCoy"}, "en-US"
        )
        doc = fitz.open(path)
        info = ops.document_metadata(doc)
        doc.close()
        assert info["title"] == "Mothership"
        assert info["author"] == "Sean McCoy"
        assert info["language"] == "en-US"
        assert info["isbn"] == "" and info["xmp"] == ""

    def test_reads_a_custom_isbn_key_and_the_xmp_packet(self, tmp_path):
        xmp = _xmp('prism:isbn="9780306406157">')
        path = _make_pdf(
            tmp_path / "a.pdf", xmp=xmp, custom={"Notes": "x", "ISBN": "0-306-40615-2"}
        )
        doc = fitz.open(path)
        info = ops.document_metadata(doc)
        doc.close()
        assert info["isbn"] == "0-306-40615-2"
        assert "prism:isbn" in info["xmp"]

    def test_an_oversized_xmp_packet_is_dropped(self, tmp_path, monkeypatch):
        path = _make_pdf(tmp_path / "a.pdf", xmp=_xmp(">" + "x" * 200))
        monkeypatch.setattr(ops, "MAX_XMP_CHARS", 100)
        doc = fitz.open(path)
        assert ops.document_metadata(doc)["xmp"] == ""
        doc.close()

    def test_a_document_without_a_catalog_has_nothing_extra(self):
        class NotAPdf:
            metadata = {"title": "An EPUB", "encryption": None}
            is_pdf = False

        info = ops.document_metadata(NotAPdf())
        assert info == {"title": "An EPUB", "language": "", "isbn": "", "xmp": ""}

    def test_a_damaged_document_has_nothing_extra(self):
        class Damaged:
            metadata = None
            is_pdf = True

            def pdf_catalog(self):
                raise RuntimeError("no catalog")

            def xref_get_key(self, xref, key):
                raise RuntimeError("no trailer")

            def get_xml_metadata(self):
                raise RuntimeError("bad stream")

        assert ops.document_metadata(Damaged()) == {"language": "", "isbn": "", "xmp": ""}

    def test_an_info_dictionary_that_is_not_a_reference(self):
        class Inline:
            def xref_get_key(self, xref, key):
                return ("dict", "<< /Title (x) >>")

        assert ops._custom_isbn(Inline()) == ""

    def test_a_non_string_isbn_key_is_skipped(self):
        class NumericIsbn:
            def xref_get_key(self, xref, key):
                return ("xref", "7 0 R") if key == "Info" else ("int", "9780306406157")

            def xref_get_keys(self, xref):
                return ("ISBN",)

        assert ops._custom_isbn(NumericIsbn()) == ""


class TestPdfFields:
    def test_maps_every_field_it_knows(self):
        fields = embedded.pdf_fields(
            {
                "title": "  Mork   Borg ",
                "author": "Pelle Nilsson; Johan Nohr & Ockult Örtmästare",
                "subject": "A doom metal art-punk RPG",
                "keywords": "OSR, Doom; osr, ",
                "creationDate": "D:20190715120000+02'00'",
                "language": "sv",
            }
        )
        assert fields == {
            "title": "Mork Borg",
            "authors": ["Pelle Nilsson", "Johan Nohr", "Ockult Örtmästare"],
            "description": "A doom metal art-punk RPG",
            "tags": ["osr", "doom"],
            "language": "sv",
            "year": 2019,
            "month": 7,
            "day": 15,
        }

    @pytest.mark.parametrize(
        "title", ["Microsoft Word - draft3.docx", "core_v2.indd", "Untitled", "", "\x00"]
    )
    def test_exporter_noise_is_not_a_title(self, title):
        assert "title" not in embedded.pdf_fields({"title": title})

    def test_placeholder_authors_are_dropped(self):
        assert "authors" not in embedded.pdf_fields({"author": "Administrator, Unknown"})

    def test_duplicate_authors_collapse(self):
        fields = embedded.pdf_fields({"author": "Kevin Crawford and kevin crawford"})
        assert fields["authors"] == ["Kevin Crawford"]

    def test_tags_are_bounded(self):
        keywords = ", ".join(f"tag{i}" for i in range(40)) + ", " + "x" * 51
        tags = embedded.pdf_fields({"keywords": keywords})["tags"]
        assert len(tags) == 25 and all(len(t) <= 50 for t in tags)

    def test_an_overlong_language_is_not_a_language(self):
        assert "language" not in embedded.pdf_fields({"language": "x" * 21})

    def test_an_empty_dictionary_offers_nothing(self):
        assert embedded.pdf_fields({}) == {}


class TestPdfIsbn:
    def test_a_custom_info_key_comes_first(self):
        fields = embedded.pdf_fields(
            {"isbn": "ISBN: 0-306-40615-2", "xmp": _xmp('prism:isbn="9781566199094">')}
        )
        assert fields["isbn"] == "0306406152"

    @pytest.mark.parametrize(
        "body",
        [
            'prism:isbn="978-0-306-40615-7">',
            "><prism:eIsbn>9780306406157</prism:eIsbn>",
            '><dc:identifier><rdf:Bag xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
            "<rdf:li>uuid:1234</rdf:li><rdf:li>urn:isbn:9780306406157</rdf:li>"
            "</rdf:Bag></dc:identifier>",
        ],
    )
    def test_read_from_the_xmp_packet(self, body):
        assert embedded.pdf_fields({"xmp": _xmp(body)})["isbn"] == "9780306406157"

    def test_an_unlabelled_identifier_is_not_an_isbn(self):
        xmp = _xmp("><dc:identifier>9780306406157</dc:identifier>")
        assert "isbn" not in embedded.pdf_fields({"xmp": xmp})

    def test_an_invalid_xmp_isbn_is_skipped(self):
        xmp = _xmp('prism:isbn="9780306406158"><prism:isbn>9780306406157</prism:isbn>')
        assert embedded.pdf_fields({"xmp": xmp})["isbn"] == "9780306406157"

    def test_a_broken_xmp_packet_offers_nothing(self):
        assert "isbn" not in embedded.pdf_fields({"xmp": "<x:xmpmeta"})

    def test_a_labelled_isbn_in_the_subject_or_keywords(self):
        assert embedded.pdf_fields({"subject": "Core rules. ISBN 978-0-306-40615-7"})[
            "isbn"
        ] == "9780306406157"
        fields = embedded.pdf_fields({"keywords": "rpg, isbn-10: 0306406152"})
        assert fields["isbn"] == "0306406152"

    def test_a_barcode_that_is_not_a_book_number(self):
        # A valid EAN-13 for a non-book product.
        assert embedded._isbn("4006381333931") == ""

    def test_an_unlabelled_number_in_free_text_is_ignored(self):
        assert "isbn" not in embedded.pdf_fields({"subject": "Stock 9780306406157"})


class TestDates:
    @pytest.mark.parametrize(
        "value, expected",
        [
            ("2019", {"year": 2019}),
            ("2019-05", {"year": 2019, "month": 5}),
            ("2019-13-01", {"year": 2019}),
            ("2019-04-31", {"year": 2019, "month": 4}),
            ("0101-01-01", {}),
            (f"{date.today().year + 5}-01-01", {}),
            ("sometime", {}),
            (None, {}),
        ],
    )
    def test_parses_what_it_can(self, value, expected):
        assert embedded._date_fields(value) == expected


class TestEpubFields:
    def test_reads_the_package_the_container_names(self, tmp_path):
        fields = embedded.epub_fields(_make_epub(tmp_path / "a.epub"))
        assert fields == {
            "title": "Sailors on the Starless Sea",
            "authors": ["Harley Stroh"],
            "description": "A funnel adventure.",
            "publisher": "Goodman Games",
            "isbn": "9780306406157",
            "tags": ["adventure", "funnel"],
            "language": "en",
            "year": 2012,
            "month": 6,
            "day": 15,
        }

    def test_a_scheme_isbn_wins_over_the_urn(self, tmp_path):
        opf = OPF.replace(
            '<package xmlns="http://www.idpf.org/2007/opf" version="3.0">',
            '<package xmlns="http://www.idpf.org/2007/opf" '
            'xmlns:opf="http://www.idpf.org/2007/opf" version="2.0">',
        ).replace(
            "<dc:subject>Adventure",
            '<dc:identifier opf:scheme="ISBN">0-306-40615-2</dc:identifier>'
            "<dc:subject>Adventure",
        )
        fields = embedded.epub_fields(_make_epub(tmp_path / "a.epub", opf=opf))
        assert fields["isbn"] == "0306406152"

    def test_an_invalid_urn_isbn_is_ignored(self, tmp_path):
        opf = OPF.replace("978-0-306-40615-7", "978-0-306-40615-8")
        assert "isbn" not in embedded.epub_fields(_make_epub(tmp_path / "a.epub", opf=opf))

    def test_only_placeholder_authors_means_no_authors(self, tmp_path):
        opf = OPF.replace("<dc:creator>Harley Stroh</dc:creator>", "")
        assert "authors" not in embedded.epub_fields(_make_epub(tmp_path / "a.epub", opf=opf))

    def test_overlong_subjects_mean_no_tags(self, tmp_path):
        opf = OPF.replace("Adventure", "a" * 60).replace("Funnel", "b" * 60)
        assert "tags" not in embedded.epub_fields(_make_epub(tmp_path / "a.epub", opf=opf))

    def test_a_year_only_date_keeps_the_year(self, tmp_path):
        opf = OPF.replace("2012-06-15", "2012")
        fields = embedded.epub_fields(_make_epub(tmp_path / "a.epub", opf=opf))
        assert fields["year"] == 2012 and "month" not in fields

    def test_not_a_zip(self, tmp_path):
        path = tmp_path / "a.epub"
        path.write_bytes(b"not a zip")
        assert embedded.epub_fields(str(path)) == {}

    def test_no_container(self, tmp_path):
        assert embedded.epub_fields(_make_epub(tmp_path / "a.epub", container=None)) == {}

    def test_a_container_naming_no_package(self, tmp_path):
        container = CONTAINER.replace(
            '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>',
            "",
        )
        assert embedded.epub_fields(_make_epub(tmp_path / "a.epub", container=container)) == {}

    def test_a_missing_package(self, tmp_path):
        assert embedded.epub_fields(_make_epub(tmp_path / "a.epub", opf=None)) == {}

    def test_an_oversized_package_is_refused(self, tmp_path, monkeypatch):
        monkeypatch.setattr(embedded, "_MAX_XML_BYTES", 100)
        assert embedded.epub_fields(_make_epub(tmp_path / "a.epub")) == {}

    def test_a_lying_size_header_is_still_caught(self, tmp_path, monkeypatch):
        path = _make_epub(tmp_path / "a.epub")
        monkeypatch.setattr(embedded, "_MAX_XML_BYTES", 400)
        real_getinfo = zipfile.ZipFile.getinfo

        def small(self, name):
            info = real_getinfo(self, name)
            info.file_size = 1
            return info

        monkeypatch.setattr(zipfile.ZipFile, "getinfo", small)
        assert embedded.epub_fields(path) == {}

    def test_entity_declarations_are_refused(self, tmp_path):
        opf = OPF.replace(
            '<?xml version="1.0"?>',
            '<?xml version="1.0"?><!DOCTYPE p [<!ENTITY x "boom">]>',
        ).replace("Goodman Games", "&x;")
        assert embedded.epub_fields(_make_epub(tmp_path / "a.epub", opf=opf)) == {}


class TestRead:
    def test_dispatches_on_the_extension(self, tmp_path, in_process):
        pdf = _make_pdf(tmp_path / "a.PDF", {"title": "Troika!"})
        assert embedded.read(pdf)["title"] == "Troika!"
        assert embedded.read(_make_epub(tmp_path / "a.epub"))["publisher"] == "Goodman Games"

    def test_reads_a_comic_archive(self, tmp_path):
        assert embedded.file_format("/x/comic.CBZ") == embedded.COMIC
        assert embedded.read(_make_cbz(tmp_path / "a.cbz"))["title"] == "Chapter One"

    def test_a_comic_without_comic_info_offers_nothing(self, tmp_path):
        assert embedded.read(_make_cbz(tmp_path / "a.cbz", comic_info=None)) == {}

    def test_a_missing_comic_is_an_os_error(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            embedded.read(str(tmp_path / "gone.cbz"))

    def test_other_formats_are_refused(self):
        assert embedded.file_format("/x/notes.md") is None
        with pytest.raises(ValueError):
            embedded.read("/x/notes.md")


class TestComicFields:
    def test_maps_every_field_it_knows(self):
        assert embedded.comic_fields(COMIC_INFO.encode()) == {
            "title": "Chapter One",
            "authors": ["Brian K. Vaughan"],
            "artists": ["Fiona Staples", "Fonografiks"],
            "description": "When two soldiers from opposite sides fall in love.",
            "publisher": "Image",
            "genres": ["Science Fiction", "Fantasy"],
            "tags": ["space opera", "romance"],
            "urls": [
                {"label": "imagecomics.com", "url": "https://www.imagecomics.com/comics/series/saga"},
                {"label": "imagecomics.com", "url": "https://imagecomics.com/x"},
            ],
            "language": "en",
            "isbn": "9780306406157",
            "year": 2012,
            "month": 3,
            "day": 14,
        }

    def test_a_series_names_an_untitled_issue(self):
        xml = b"<ComicInfo><Series>Saga</Series><Number>7</Number></ComicInfo>"
        assert embedded.comic_fields(xml) == {"title": "Saga #7"}
        xml = b"<ComicInfo><Series>Saga</Series><Imprint>Image</Imprint></ComicInfo>"
        assert embedded.comic_fields(xml) == {"title": "Saga", "publisher": "Image"}

    def test_unset_numbers_are_not_dates(self):
        xml = b"<ComicInfo><Year>-1</Year><Month>4</Month></ComicInfo>"
        assert embedded.comic_fields(xml) == {}
        xml = b"<ComicInfo><Year>2020</Year><Month>-1</Month></ComicInfo>"
        assert embedded.comic_fields(xml) == {"year": 2020}

    def test_a_non_book_barcode_is_not_an_isbn(self):
        xml = b"<ComicInfo><GTIN>4006381333931</GTIN></ComicInfo>"
        assert embedded.comic_fields(xml) == {}

    def test_unreadable_xml_offers_nothing(self):
        assert embedded.comic_fields(b"<ComicInfo>") == {}
        bomb = b'<!DOCTYPE c [<!ENTITY x "boom">]><ComicInfo><Title>&x;</Title></ComicInfo>'
        assert embedded.comic_fields(bomb) == {}


@pytest.fixture
def system():
    return make_game_system(name=f"System-{uuid.uuid4().hex[:6]}")


def _search(client, headers, book, **body):
    return client.post(
        f"/api/books/{book.id}/metadata-search",
        json={"source_id": "file-metadata", "query": "", **body},
        headers=headers,
    )


def _fetch(client, headers, book, **body):
    return client.post(
        f"/api/books/{book.id}/metadata-fetch",
        json={"source_id": "file-metadata", "identity": "file", **body},
        headers=headers,
    )


@pytest.mark.usefixtures("in_process")
class TestApi:
    def test_listed_for_books_but_not_systems(self, client, gm_headers, system, monkeypatch):
        monkeypatch.setattr(config, "CODEX_DB_API_TOKEN", "")
        book = make_book(system.id)
        sources = client.get(f"/api/books/{book.id}/metadata-sources", headers=gm_headers)
        entry = sources.json()["sources"][-1]
        assert entry["id"] == "file-metadata" and entry["supports_paste"] is False
        sources = client.get(f"/api/systems/{system.id}/metadata-sources", headers=gm_headers)
        assert all(s["id"] != "file-metadata" for s in sources.json()["sources"])

    def test_search_offers_the_file_and_fetch_diffs_it(
        self, client, gm_headers, system, tmp_path
    ):
        path = _make_pdf(
            tmp_path / "doc.pdf",
            {"title": "Into the Odd", "author": "Chris McDowall", "creationDate": "D:2014"},
        )
        book = make_book(system.id, title="into-the-odd", filepath=path)

        found = _search(client, gm_headers, book)
        assert found.status_code == 200
        assert found.json()["results"] == [
            {"identity": "file", "label": "Into the Odd (PDF metadata)", "score": 1.0, "url": ""}
        ]

        fetched = _fetch(client, gm_headers, book)
        assert fetched.status_code == 200
        diff = {f["field"]: f for f in fetched.json()["fields"]}
        assert diff["title"]["status"] == "differs"
        assert diff["authors"]["incoming"] == ["Chris McDowall"]
        assert diff["year"]["status"] == "only_incoming"

    def test_a_file_with_nothing_embedded_has_no_candidate(
        self, client, gm_headers, system, tmp_path
    ):
        book = make_book(system.id, filepath=_make_pdf(tmp_path / "bare.pdf"))
        assert _search(client, gm_headers, book).json()["results"] == []

    def test_an_unreadable_format_is_400(self, client, gm_headers, system):
        book = make_book(system.id, filepath=f"/tmp/{uuid.uuid4().hex}.md")
        response = _search(client, gm_headers, book)
        assert response.status_code == 400
        assert "only PDF, EPUB and comic" in response.json()["detail"]

    def test_a_comic_is_labelled_by_its_format(self, client, gm_headers, system, tmp_path):
        book = make_book(system.id, filepath=_make_cbz(tmp_path / "saga.cbz"))
        results = _search(client, gm_headers, book).json()["results"]
        assert [r["label"] for r in results] == ["Chapter One (CBZ metadata)"]

    def test_a_missing_file_is_400(self, client, gm_headers, system, tmp_path):
        book = make_book(system.id, filepath=str(tmp_path / "gone.pdf"))
        response = _fetch(client, gm_headers, book)
        assert response.status_code == 400
        assert "Could not read" in response.json()["detail"]

    def test_pasting_is_refused(self, client, gm_headers, system, tmp_path):
        book = make_book(system.id, filepath=_make_pdf(tmp_path / "a.pdf"))
        assert _fetch(client, gm_headers, book, paste="https://x").status_code == 400

    def test_a_system_cannot_use_it(self, client, gm_headers, system):
        response = client.post(
            f"/api/systems/{system.id}/metadata-search",
            json={"source_id": "file-metadata", "query": ""},
            headers=gm_headers,
        )
        assert response.status_code == 400
