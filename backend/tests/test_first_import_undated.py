"""The library's first import is left undated (issue #199).

A fresh install brings the whole library in with one scan; dating those rows
would badge everything as "new" for a week. These run the real scanner against
a throwaway database, since the shared test DB already holds dated rows - which
is exactly the signal that the first import is over.
"""
import datetime
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import Null

from backend.indexer import scan_library
from backend.indexer.added_dates import (
    FIRST_IMPORT_DONE_KEY,
    added_at_for_insert,
    first_import_done,
    mark_first_import_done,
)
from backend.models import AppSetting, Book, Token
from backend.models.db import init_db


@pytest.fixture
def db():
    path = os.path.join(tempfile.mkdtemp(), "fresh.db")
    init_db(path)
    engine = create_engine(f"sqlite:///{path}")
    session = Session(bind=engine)
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def lib():
    root = Path(tempfile.mkdtemp())
    (root / "library" / "tokens").mkdir(parents=True)
    return root


def _add_token(lib: Path, name: str) -> None:
    Image.new("RGB", (4, 4), "red").save(lib / "library" / "tokens" / name)


def _scan(lib: Path, db: Session, **kwargs) -> dict:
    with patch("backend.indexer.generate_thumbnail", return_value=False):
        return scan_library(str(lib / "library"), str(lib), db, **kwargs)


def _dates(db: Session) -> dict:
    db.expire_all()
    return {t.filename: t.added_at for t in db.query(Token).all()}


def _flag(db: Session):
    row = db.query(AppSetting).filter_by(key=FIRST_IMPORT_DONE_KEY).first()
    return row.value if row else None


class TestFirstImportScan:
    def test_first_import_is_undated_and_later_additions_are_dated(self, db, lib):
        _add_token(lib, "goblin.png")
        _add_token(lib, "orc.png")
        _scan(lib, db)

        assert _dates(db) == {"goblin.png": None, "orc.png": None}
        assert _flag(db) == "1"

        _add_token(lib, "dragon.png")
        _scan(lib, db)

        dates = _dates(db)
        assert dates["goblin.png"] is None
        assert dates["orc.png"] is None
        assert dates["dragon.png"] is not None

    def test_an_empty_first_scan_does_not_end_the_first_import(self, db, lib):
        _scan(lib, db)
        assert _flag(db) is None

        _add_token(lib, "goblin.png")
        _scan(lib, db)
        assert _dates(db) == {"goblin.png": None}
        assert _flag(db) == "1"

    def test_a_scoped_scan_stays_undated_and_leaves_the_import_open(self, db, lib):
        _add_token(lib, "goblin.png")
        _scan(lib, db, scope_path="tokens")

        assert _dates(db) == {"goblin.png": None}
        assert _flag(db) is None
        # The full scan that follows is still part of the first import.
        _add_token(lib, "orc.png")
        _scan(lib, db)
        assert _dates(db) == {"goblin.png": None, "orc.png": None}
        assert _flag(db) == "1"

    def test_an_upgraded_library_with_dated_rows_dates_new_items(self, db, lib):
        # Migration 0040 backfilled this row from created_at: the library was
        # imported long ago, so a new file is a genuine addition.
        db.add(
            Book(
                title="Old",
                filename="old.pdf",
                filepath="/elsewhere/old.pdf",
                relative_path="old.pdf",
                added_at=datetime.datetime(2024, 1, 1),
            )
        )
        db.commit()
        _add_token(lib, "goblin.png")
        _scan(lib, db)

        assert _dates(db)["goblin.png"] is not None
        assert _flag(db) == "1"


class TestHelpers:
    def test_insert_date_is_now_or_none(self):
        before = datetime.datetime.now(datetime.timezone.utc)
        stamped = added_at_for_insert(True)
        assert stamped is not None and stamped >= before
        # SQL NULL, so the column default cannot fill it back in.
        assert isinstance(added_at_for_insert(False), Null)

    def test_the_setting_alone_ends_the_first_import(self, db):
        assert first_import_done(db) is False
        db.add(AppSetting(key=FIRST_IMPORT_DONE_KEY, value="1"))
        db.commit()
        assert first_import_done(db) is True

    def test_marking_repairs_a_cleared_setting(self, db):
        db.add(AppSetting(key=FIRST_IMPORT_DONE_KEY, value=""))
        db.add(Token(filename="t.png", filepath="/x/t.png", relative_path="t.png", added_at=None))
        db.commit()
        mark_first_import_done(db)
        assert _flag(db) == "1"
        # Already set: a second call changes nothing.
        mark_first_import_done(db)
        assert _flag(db) == "1"

    def test_marking_an_empty_library_is_a_no_op(self, db):
        mark_first_import_done(db)
        assert _flag(db) is None
