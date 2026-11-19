"""Migration 0076: compendium links, pack-declared types, server-wide sheets.

The risky part is ``character_schemas.user_id`` losing NOT NULL, which SQLite
does by copying the table: every installed sheet must come through it, and the
partial unique index must then keep server-wide rows to one per schema id.
"""
import os
import tempfile

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from backend.models.db import _alembic_config

pytestmark = pytest.mark.sqlite_only

_BEFORE = "796428a7f3eb"  # 0075
_REVISION = "4c7e2a9d1b63"  # 0076


def _engine(path):
    return create_engine(f"sqlite:///{path}")


def _at(revision, path=None):
    path = path or os.path.join(tempfile.mkdtemp(), "m0076.db")
    engine = _engine(path)
    with engine.connect() as conn:
        command.upgrade(_alembic_config(conn), revision)
    engine.dispose()
    return path


def _run(path, action, revision):
    engine = _engine(path)
    with engine.connect() as conn:
        action(_alembic_config(conn), revision)
    engine.dispose()


def _sql(path, sql, **params):
    engine = _engine(path)
    try:
        with engine.begin() as conn:
            result = conn.execute(text(sql), params)
            return result.fetchall() if result.returns_rows else None
    finally:
        engine.dispose()


def _insert_schema(path, row_id, user_id, schema_id="cairn"):
    _sql(
        path,
        "INSERT INTO character_schemas (id, user_id, schema_id, name, document) "
        "VALUES (:id, :user_id, :schema_id, 'Cairn', '{}')",
        id=row_id, user_id=user_id, schema_id=schema_id,
    )


def test_upgrade_keeps_every_sheet_and_allows_server_wide_ones():
    path = _at(_BEFORE)
    _insert_schema(path, "a", "user-1")
    _insert_schema(path, "b", "user-2")

    _run(path, command.upgrade, _REVISION)

    assert sorted(_sql(path, "SELECT id, user_id FROM character_schemas")) == [
        ("a", "user-1"), ("b", "user-2")
    ]
    engine = _engine(path)
    try:
        insp = inspect(engine)
        user_id = next(c for c in insp.get_columns("character_schemas") if c["name"] == "user_id")
        assert user_id["nullable"] is True
        assert "content_types" in {c["name"] for c in insp.get_columns("content_packs")}
        assert insp.has_table("system_content_packs")
        assert insp.has_table("system_character_sheets")
        assert "uq_character_schemas_server" in {
            index["name"] for index in insp.get_indexes("character_schemas")
        }
    finally:
        engine.dispose()

    _insert_schema(path, "s", None)
    with pytest.raises(IntegrityError):
        _insert_schema(path, "s2", None)
    # Server-wide rows for different sheets are fine, as are per-user ones.
    _insert_schema(path, "s3", None, schema_id="mothership")
    _insert_schema(path, "c", "user-3")


def test_upgrade_is_idempotent_and_downgrade_drops_server_sheets():
    path = _at(_REVISION)
    _insert_schema(path, "own", "user-1")
    _insert_schema(path, "server", None)

    _run(path, command.downgrade, _BEFORE)
    assert _sql(path, "SELECT id FROM character_schemas") == [("own",)]
    engine = _engine(path)
    try:
        insp = inspect(engine)
        assert not insp.has_table("system_content_packs")
        user_id = next(c for c in insp.get_columns("character_schemas") if c["name"] == "user_id")
        assert user_id["nullable"] is False
    finally:
        engine.dispose()

    # Up again from scratch, then the revision's own upgrade a second time.
    _run(path, command.upgrade, _REVISION)
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "_m0076",
        os.path.join(os.path.dirname(__file__), "..", "migrations", "versions",
                     "0076_system_compendium.py"),
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = _engine(path)
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()
    engine.dispose()
    assert _sql(path, "SELECT id FROM character_schemas") == [("own",)]
