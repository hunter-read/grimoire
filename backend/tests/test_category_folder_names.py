"""A book's category names one folder inside its system folder.

Changing a book's category moves the file into the matching folder, so the
category has to be something that can name a single folder there: the API
refuses anything else, and the move itself never leaves the system folder.
"""

import os
import shutil
import tempfile
import uuid
from pathlib import Path

import pytest

from backend.config import LIBRARY_PATH, SessionLocal
from backend.models import Book
from backend.services import library_fs as fs

from .conftest import make_book, make_game_system

LIB = LIBRARY_PATH


@pytest.fixture
def system_book():
    """A book at books/System-<stamp>/core/esc.pdf; yields (book id, file path)."""
    stamp = str(uuid.uuid4())[:8]
    system_dir = os.path.join(LIB, f"books/System-{stamp}")
    os.makedirs(os.path.join(system_dir, "core"))
    src = os.path.join(system_dir, "core", "esc.pdf")
    # Not PDF-shaped, so a background indexer from another test leaves it alone.
    with open(src, "wb") as fh:
        fh.write(b"grimoire-test-fixture")
    system = make_game_system(name=f"System-{stamp}")
    book = make_book(
        system.id,
        filename="esc.pdf",
        filepath=src,
        relative_path=f"books/System-{stamp}/core/esc.pdf",
        category="core",
    )
    yield book.id, src, system_dir
    shutil.rmtree(system_dir, ignore_errors=True)


def _filepath(book_id):
    db = SessionLocal()
    try:
        return db.query(Book).filter(Book.id == book_id).first().filepath
    finally:
        db.close()


@pytest.mark.parametrize("category", ["core", "adventure", "Setting Books", "player-options"])
def test_folder_names_are_categories(category):
    assert fs.is_category_name(category)


@pytest.mark.parametrize(
    "category", ["", "../../..", "..", "a/b", "a\\b", ".hidden", "core\x00", "x/../y"]
)
def test_paths_are_not_categories(category):
    assert not fs.is_category_name(category)


@pytest.mark.parametrize("category", ["../../..", "a/b", "a\\b", ".hidden"])
def test_patch_refuses_a_category_that_is_not_a_folder_name(
    client, gm_headers, system_book, category
):
    book_id, src, _system_dir = system_book
    resp = client.patch(f"/api/books/{book_id}", json={"category": category}, headers=gm_headers)
    assert resp.status_code == 422
    assert os.path.exists(src)
    assert _filepath(book_id) == src


def test_bulk_refuses_a_category_that_is_not_a_folder_name(client, gm_headers, system_book):
    book_id, src, _system_dir = system_book
    resp = client.post(
        "/api/books/bulk",
        json={"items": [{"id": book_id, "category": "../../.."}]},
        headers=gm_headers,
    )
    assert resp.status_code == 422
    assert os.path.exists(src)
    assert _filepath(book_id) == src


def test_patch_still_moves_into_a_new_category_folder(client, gm_headers, system_book):
    book_id, src, system_dir = system_book
    resp = client.patch(
        f"/api/books/{book_id}", json={"category": "setting-books"}, headers=gm_headers
    )
    assert resp.status_code == 200
    landed = os.path.join(system_dir, "Setting Books", "esc.pdf")
    assert os.path.exists(landed)
    assert _filepath(book_id) == landed


def test_relocation_ignores_a_path_category_without_creating_anything(system_book):
    """The service refuses on its own, for callers that skip the API's schema."""
    book_id, src, system_dir = system_book
    parent = os.path.dirname(LIB)
    before = set(os.listdir(parent))
    db = SessionLocal()
    try:
        book = db.query(Book).filter(Book.id == book_id).first()
        assert fs.relocate_book_for_category(db, book, "../../..") is None
        assert fs.relocate_book_for_category(db, book, "a/b") is None
    finally:
        db.close()
    assert os.path.exists(src)
    assert set(os.listdir(parent)) == before
    assert sorted(os.listdir(system_dir)) == ["core"]


def test_relocation_does_not_follow_a_category_folder_out_of_the_system(system_book):
    """A category folder that is a symlink to somewhere else is not used."""
    book_id, src, system_dir = system_book
    outside = tempfile.mkdtemp(prefix="grimoire-outside-")
    try:
        os.symlink(outside, os.path.join(system_dir, "Elsewhere"))
        db = SessionLocal()
        try:
            book = db.query(Book).filter(Book.id == book_id).first()
            assert fs.category_folder_for(db, Path(src), "elsewhere") is None
            assert fs.relocate_book_for_category(db, book, "elsewhere") is None
        finally:
            db.close()
        assert os.path.exists(src)
        assert os.listdir(outside) == []
    finally:
        shutil.rmtree(outside, ignore_errors=True)
