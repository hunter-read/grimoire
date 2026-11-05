"""The folders a book path drops when its system is hidden from the reader."""
from types import SimpleNamespace

import pytest

from backend.config import SessionLocal
from backend.services.systems import book_relative_path, path_without_hidden_system

from .conftest import make_book, make_game_system


@pytest.mark.parametrize(
    ("path", "depth", "expected"),
    [
        ("books/Secret/core/book.pdf", 2, "books/core/book.pdf"),
        ("books/Secret/core/Deep/More/book.pdf", 2, "books/core/Deep/More/book.pdf"),
        # Every container folder above the system goes too.
        ("books/Family/Secret/core/book.pdf", 3, "books/core/book.pdf"),
        ("books/Family/Parent/Secret/core/book.pdf", 4, "books/core/book.pdf"),
        # A loose one-page game sits straight in its container: keep the file.
        ("books/One Page/game.pdf", 3, "books/game.pdf"),
        ("books\\Secret\\core\\book.pdf", 2, "books/core/book.pdf"),
        # Too short to hold a system folder.
        ("books/book.pdf", 2, "books/book.pdf"),
        ("book.pdf", 2, "book.pdf"),
        ("", 2, ""),
    ],
)
def test_path_without_hidden_system(path, depth, expected):
    assert path_without_hidden_system(path, depth) == expected


class TestBookRelativePath:
    def test_a_visible_system_keeps_the_whole_path(self):
        book = SimpleNamespace(game_system_id="s1", relative_path="books/Shown/core/b.pdf")
        assert book_relative_path(None, book, object()) == "books/Shown/core/b.pdf"

    def test_a_book_in_no_system_keeps_its_path(self):
        book = SimpleNamespace(game_system_id=None, relative_path="books/Loose/b.pdf")
        assert book_relative_path(None, book, None) == "books/Loose/b.pdf"

    def test_a_hidden_system_inside_a_container_loses_both_folders(self):
        container = make_game_system(container_kind="family")
        system = make_game_system(parent_id=container.id)
        book = make_book(system.id, relative_path="books/Family/Secret/core/b.pdf")
        db = SessionLocal()
        try:
            assert book_relative_path(db, book, None) == "books/core/b.pdf"
            # A depth the caller already has is used as given.
            assert book_relative_path(db, book, None, depth=2) == "books/Secret/core/b.pdf"
        finally:
            db.close()
