"""Choosing a scanned book's OCR languages from its own metadata (issue #728)."""
import logging
from unittest.mock import patch

import fitz
import pytest

from backend import config, ocr
from backend.indexer import ocr_language
from backend.indexer.ocr_language import book_languages, tesseract_codes
from backend.models import Book

_OPF = """<?xml version='1.0' encoding='utf-8'?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
        <dc:title>T</dc:title>
        <dc:language>{language}</dc:language>
    </metadata>
</package>
"""


class TestTesseractCodes:
    @pytest.mark.parametrize(
        "value, expected",
        [
            ("en", ["eng"]),
            ("de-DE", ["deu"]),
            ("pt_BR", ["por"]),
            ("FR", ["fra"]),
            ("deu", ["deu"]),
            ("ger", ["deu"]),  # ISO 639-2/B, as Calibre writes it
            ("eng", ["eng"]),
            ("German", ["deu"]),
            ("Deutsch", ["deu"]),
            ("français", ["fra"]),
            ("zh", ["chi_sim"]),
            ("zh-Hans-CN", ["chi_sim"]),
            ("zh-Hant", ["chi_tra"]),
            ("zh-TW", ["chi_tra"]),
            ("chi_tra", ["chi_tra"]),
            ("sr", ["srp"]),
            ("sr-Latn", ["srp_latn"]),
            ("iw", ["heb"]),  # withdrawn code still found in old files
            ("English, German", ["eng", "deu"]),
            ("eng+deu+eng", ["eng", "deu"]),
            ("  ", []),
            ("", []),
            ("Klingon", []),
            ("xx", []),
            ("xyz", []),
        ],
    )
    def test_maps_to_tesseract(self, value, expected):
        assert tesseract_codes(value) == expected


def _book(tmp_path, filename="scan.pdf", language=""):
    return Book(
        title="Scan",
        filename=filename,
        filepath=str(tmp_path / filename),
        language=language,
    )


def _pdf(path, lang=None):
    doc = fitz.open()
    doc.new_page()
    if lang:
        doc.xref_set_key(doc.pdf_catalog(), "Lang", f"({lang})")
    doc.save(str(path))
    doc.close()


@pytest.fixture
def tesseract():
    """``eng`` configured; ``eng``, ``deu`` and ``fra`` installed."""
    with patch.object(config, "OCR_LANGUAGES", "eng"), patch.object(
        ocr, "installed_languages", return_value=frozenset({"eng", "deu", "fra", "osd"})
    ):
        yield


@pytest.mark.usefixtures("tesseract")
class TestBookLanguages:
    def test_no_language_anywhere_uses_the_configured_languages(self, tmp_path):
        _pdf(tmp_path / "scan.pdf")
        assert book_languages(_book(tmp_path)) == "eng"

    def test_the_book_field_goes_first(self, tmp_path):
        assert book_languages(_book(tmp_path, language="de")) == "deu+eng"

    def test_an_english_book_reads_as_before(self, tmp_path):
        assert book_languages(_book(tmp_path, language="en-US")) == "eng"

    def test_configured_languages_are_kept_once_in_their_order(self, tmp_path):
        with patch.object(config, "OCR_LANGUAGES", "eng+deu+fra"):
            assert book_languages(_book(tmp_path, language="fr")) == "fra+eng+deu"

    def test_the_field_outranks_the_sidecar_and_the_pdf(self, tmp_path):
        _pdf(tmp_path / "scan.pdf", lang="fr")
        (tmp_path / "scan.opf").write_text(_OPF.format(language="fr"), encoding="utf-8")
        assert book_languages(_book(tmp_path, language="Deutsch")) == "deu+eng"

    def test_the_sidecar_is_read_when_the_field_is_empty(self, tmp_path):
        _pdf(tmp_path / "scan.pdf", lang="fr")
        (tmp_path / "scan.opf").write_text(_OPF.format(language="ger"), encoding="utf-8")
        assert book_languages(_book(tmp_path)) == "deu+eng"

    def test_calibre_metadata_opf_counts_as_a_sidecar(self, tmp_path):
        (tmp_path / "metadata.opf").write_text(_OPF.format(language="fra"), encoding="utf-8")
        assert book_languages(_book(tmp_path)) == "fra+eng"

    def test_a_field_naming_no_known_language_falls_through(self, tmp_path):
        (tmp_path / "scan.opf").write_text(_OPF.format(language="de"), encoding="utf-8")
        assert book_languages(_book(tmp_path, language="Klingon")) == "deu+eng"

    def test_the_pdf_lang_is_read_last(self, tmp_path):
        _pdf(tmp_path / "scan.pdf", lang="de-AT")
        assert book_languages(_book(tmp_path)) == "deu+eng"

    def test_only_a_pdf_is_opened_for_its_lang(self, tmp_path):
        with patch("backend.render.pool.document_metadata") as read:
            assert book_languages(_book(tmp_path, filename="scan.djvu")) == "eng"
        read.assert_not_called()

    def test_the_pdf_is_not_opened_when_the_field_names_a_language(self, tmp_path):
        with patch.object(ocr_language, "_pdf_language") as read:
            book_languages(_book(tmp_path, language="de"))
        read.assert_not_called()

    def test_an_unreadable_source_is_skipped(self, tmp_path):
        with patch.object(ocr_language, "_sidecar_language", side_effect=OSError("gone")):
            _pdf(tmp_path / "scan.pdf", lang="fr")
            assert book_languages(_book(tmp_path)) == "fra+eng"

    def test_a_missing_file_gives_the_configured_languages(self, tmp_path):
        assert book_languages(_book(tmp_path)) == "eng"

    def test_an_uninstalled_language_is_logged_and_skipped(self, tmp_path, caplog):
        with caplog.at_level(logging.INFO, logger="grimoire.ocr"):
            assert book_languages(_book(tmp_path, language="ja")) == "eng"
        assert "jpn" in caplog.text
        assert "its language field" in caplog.text

    def test_installed_languages_of_several_are_kept(self, tmp_path):
        assert book_languages(_book(tmp_path, language="ja, de")) == "deu+eng"

    def test_a_configured_language_that_is_missing_is_not_reported(self, tmp_path, caplog):
        with patch.object(config, "OCR_LANGUAGES", "eng+jpn"), caplog.at_level(
            logging.INFO, logger="grimoire.ocr"
        ):
            assert book_languages(_book(tmp_path, language="ja")) == "eng+jpn"
        assert "language data" not in caplog.text
