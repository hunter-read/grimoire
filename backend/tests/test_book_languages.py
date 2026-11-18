"""A book's language is one of a fixed list, stored lowercase and shown capitalised."""
import os
import re
import tempfile
import time
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from backend.codex.compare import field_status
from backend.migrations._frozen import book_languages as frozen
from backend.models import Book
from backend.models import languages
from backend.models.db import init_db
from backend.models.languages import LANGUAGES, find_language, language_label, stored_language
from backend.routers.books._schemas import MAX_LANGUAGE_INPUT
from backend.services.filename_rules.renames import _book_values
from backend.tests.conftest import make_book, make_game_system

_FRONTEND_LIST = Path(__file__).resolve().parents[2] / "frontend" / "src" / "utils" / "languages.ts"

# Real languages (ISO 639 English names) that are not on the list, several of
# them one or two letters from a listed one: Bulgarian/Hungarian,
# Kurdish/Turkish, Javanese/Japanese, Romani/Romanian, Aramaic/Arabic.
_UNLISTED = [
    "Bulgarian", "Kurdish", "Javanese", "Romani", "Aramaic", "Latin", "Thai",
    "Serbian", "Croatian", "Bosnian", "Slovenian", "Slovene", "Macedonian",
    "Albanian", "Estonian", "Latvian", "Lithuanian", "Icelandic", "Faroese",
    "Irish", "Welsh", "Scottish Gaelic", "Breton", "Cornish", "Manx", "Basque",
    "Galician", "Occitan", "Corsican", "Sardinian", "Romansh", "Sorbian",
    "Frisian", "Luxembourgish", "Maltese", "Afrikaans", "Yiddish", "Ladino",
    "Esperanto", "Persian", "Farsi", "Dari", "Pashto", "Urdu", "Hindi",
    "Bengali", "Punjabi", "Sindhi", "Tamil", "Telugu", "Marathi", "Gujarati",
    "Kannada", "Malayalam", "Sinhala", "Nepali", "Sanskrit", "Tibetan",
    "Vietnamese", "Malay", "Tagalog", "Filipino", "Khmer", "Lao", "Burmese",
    "Mongolian", "Kazakh", "Uzbek", "Turkmen", "Kyrgyz", "Tajik", "Tatar",
    "Uyghur", "Azerbaijani", "Armenian", "Georgian", "Belarusian", "Chechen",
    "Swahili", "Amharic", "Tigrinya", "Somali", "Oromo", "Yoruba", "Igbo",
    "Hausa", "Zulu", "Xhosa", "Shona", "Wolof", "Malagasy", "Maori", "Samoan",
    "Hawaiian", "Tongan", "Quechua", "Guarani", "Aymara", "Inuktitut",
    "Cherokee", "Navajo", "Syriac", "Coptic", "Akkadian", "Sumerian", "Gothic",
    "Old Norse", "Old English", "Ancient Greek", "Interlingua", "Klingon",
]

_BOTH = pytest.mark.parametrize("module", [languages, frozen], ids=["live", "frozen"])


class TestTheList:
    @pytest.mark.parametrize(
        "value", ["English", "english", " ENGLISH ", "en", "eng", "en-US", "en_GB"]
    )
    def test_every_spelling_of_a_language_is_one_value(self, value):
        assert find_language(value) == "english"

    def test_codes_and_native_names(self):
        assert find_language("pt-BR") == "portuguese"
        assert find_language("Deutsch") == "german"
        assert find_language("Français") == "french"
        assert find_language("日本語") == "japanese"

    @_BOTH
    @pytest.mark.parametrize("name", _UNLISTED)
    def test_an_unlisted_language_is_never_read_as_another(self, module, name):
        assert module.find_language(name) is None
        assert module.find_language(name.lower()) is None
        assert module.stored_language(name) == ""

    @_BOTH
    def test_a_misspelling_is_not_guessed_at(self, module):
        for typo in ("italan", "Engish", "germen", "Japaneese", "czek", "xyz"):
            assert module.find_language(typo) is None

    @_BOTH
    def test_a_long_value_is_answered_at_once(self, module):
        start = time.perf_counter()
        assert module.find_language("x" * 1_000_000) is None
        assert module.find_language("en-" + "x" * 1_000_000) is None
        assert time.perf_counter() - start < 0.05

    def test_unlisted_and_blank_values_name_nothing(self):
        assert find_language("Klingon") is None
        assert find_language("  ") is None
        assert find_language(None) is None
        assert stored_language("Klingon") == ""

    def test_stored_lowercase_and_shown_with_a_capital(self):
        assert all(lang == lang.lower() for lang in LANGUAGES)
        assert language_label("english") == "English"
        assert language_label("") == ""
        assert language_label(None) == ""

    def test_the_frontend_offers_the_same_list(self):
        source = _FRONTEND_LIST.read_text(encoding="utf-8")
        block = source.split("export const LANGUAGES = [", 1)[1].split("] as const", 1)[0]
        assert tuple(re.findall(r"'([^']+)'", block)) == LANGUAGES

    def test_the_migration_froze_todays_list(self):
        # 0071 normalises with this copy; it matched the live list when written.
        assert frozen.LANGUAGES == languages.LANGUAGES
        assert frozen._ALIASES == languages._ALIASES


class TestStoring:
    def test_every_write_stores_the_listed_value(self):
        system = make_game_system(name="lang-store")
        assert make_book(system_id=system.id, language="English").language == "english"
        assert make_book(system_id=system.id, language="de-DE").language == "german"
        assert make_book(system_id=system.id, language="Klingon").language == ""
        assert make_book(system_id=system.id, language="Bulgarian").language == ""
        assert make_book(system_id=system.id, language=None).language == ""

    def test_api_takes_any_spelling_and_never_fails_over_a_language(self, client, admin_headers):
        system = make_game_system(name="lang-api")
        book = make_book(system_id=system.id)
        url = f"/api/books/{book.id}"

        assert client.patch(url, json={"language": "Italian"}, headers=admin_headers).status_code == 200
        assert client.get(url, headers=admin_headers).json()["language"] == "italian"

        assert client.patch(url, json={"language": "en"}, headers=admin_headers).status_code == 200
        assert client.get(url, headers=admin_headers).json()["language"] == "english"

        # A real language off the list is not saved as its listed neighbour.
        assert client.patch(url, json={"language": "Bulgarian"}, headers=admin_headers).status_code == 200
        assert client.get(url, headers=admin_headers).json()["language"] == ""

        # A value naming no language saves the rest of the edit and leaves the language unset.
        resp = client.patch(
            url, json={"language": "Klingon", "publisher": "Kept"}, headers=admin_headers
        )
        assert resp.status_code == 200
        got = client.get(url, headers=admin_headers).json()
        assert got["language"] == ""
        assert got["publisher"] == "Kept"

        assert client.patch(url, json={"language": ""}, headers=admin_headers).status_code == 200
        assert client.get(url, headers=admin_headers).json()["language"] == ""

    def test_an_oversized_language_is_refused(self, client, admin_headers):
        system = make_game_system(name="lang-long")
        book = make_book(system_id=system.id, language="English")
        url = f"/api/books/{book.id}"
        long = "x" * (MAX_LANGUAGE_INPUT + 1)

        assert client.patch(url, json={"language": long}, headers=admin_headers).status_code == 422
        resp = client.post(
            "/api/books/bulk", json={"items": [{"id": book.id, "language": long}]}, headers=admin_headers
        )
        assert resp.status_code == 422
        assert client.get(url, headers=admin_headers).json()["language"] == "english"

        # Up to the bound it still saves, with no language set.
        ok = "x" * MAX_LANGUAGE_INPUT
        assert client.patch(url, json={"language": ok}, headers=admin_headers).status_code == 200
        assert client.get(url, headers=admin_headers).json()["language"] == ""

    def test_a_filename_pattern_shows_the_language_capitalised(self):
        book = Book(title="t", filename="f.pdf", language="french")
        assert _book_values(book)["language"] == "French"


class TestCodexCompare:
    def test_spellings_of_one_language_are_the_same(self):
        assert field_status("language", "english", "English") == "same"
        assert field_status("language", "english", "en") == "same"
        assert field_status("language", "english", "italian") == "differs"


def _migrate(raw_values: list[str]) -> list[str]:
    """Store ``raw_values`` on a database at revision 0070, upgrade it, and read them back."""
    path = os.path.join(tempfile.mkdtemp(), "lang.db")
    init_db(path)
    engine = create_engine(f"sqlite:///{path}")
    with Session(engine) as db:
        ids = []
        for n in range(len(raw_values)):
            name = f"f{n}.pdf"
            book = Book(title="t", filename=name, filepath=f"/tmp/{name}", relative_path=name)
            db.add(book)
            db.flush()
            ids.append(book.id)
        db.commit()
    with engine.begin() as conn:
        # Written past the model's validator: the free text 0070 held.
        for book_id, raw in zip(ids, raw_values):
            conn.execute(text("UPDATE books SET language = :v WHERE id = :id"), {"v": raw, "id": book_id})
        conn.execute(text("UPDATE alembic_version SET version_num = '9b2f6d4e8c17'"))
    engine.dispose()

    init_db(path)

    engine = create_engine(f"sqlite:///{path}")
    with engine.connect() as conn:
        got = [
            conn.execute(text("SELECT language FROM books WHERE id = :id"), {"id": i}).scalar()
            for i in ids
        ]
    engine.dispose()
    return got


class TestMigration:
    def test_rewrites_each_spelling_and_clears_unlisted_values(self):
        got = _migrate(["English", "Italan", "en-US", "Klingon", "", "Deutsch", "x" * 500])
        assert got == ["english", "", "english", "", "", "german", ""]

    def test_an_unlisted_language_is_cleared_not_turned_into_another(self):
        got = _migrate(_UNLISTED)
        assert got == [""] * len(_UNLISTED)
