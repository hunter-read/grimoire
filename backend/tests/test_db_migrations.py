"""Tests for DB initialisation and the tag-normalization migration.

Exercises models/db.py against throwaway SQLite files so the runtime migrations
and tag normalization run end-to-end (including the audio tables).
"""
import json
import os
import tempfile

from sqlalchemy import create_engine, text

from backend.models.db import init_db, _normalize_tags_in_db


def _fresh_db():
    path = os.path.join(tempfile.mkdtemp(), "t.db")
    init_db(path)
    return path


class TestInitDb:
    def test_init_db_creates_audio_tables(self):
        path = _fresh_db()
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            names = {
                r[0]
                for r in conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table'")
                ).fetchall()
            }
        assert "audio" in names
        assert "audio_folders" in names

    def test_init_db_is_idempotent(self):
        # Running init_db twice on the same file must not raise — the runtime
        # migrations all swallow "already exists" errors.
        path = _fresh_db()
        init_db(path)  # second run
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            cnt = conn.execute(text("SELECT COUNT(*) FROM audio")).scalar()
        assert cnt == 0


class TestNormalizeTags:
    def test_normalizes_audio_table_tags(self):
        path = _fresh_db()
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            conn.execute(
                text(
                    "INSERT INTO audio (id, filename, filepath, relative_path, tags) "
                    "VALUES ('a1', 'x.mp3', '/x.mp3', 'audio/x.mp3', :tags)"
                ),
                {"tags": json.dumps(["Ambient", "AMBIENT", "  Tavern  "])},
            )
            conn.commit()
            _normalize_tags_in_db(conn)
            raw = conn.execute(text("SELECT tags FROM audio WHERE id='a1'")).scalar()
        assert json.loads(raw) == ["ambient", "tavern"]

    def test_normalizes_audio_folder_tags(self):
        path = _fresh_db()
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            conn.execute(
                text(
                    "INSERT INTO audio_folders (id, path, tags) VALUES ('f1', 'Ambient', :tags)"
                ),
                {"tags": json.dumps(["Soundscape", "soundscape"])},
            )
            conn.commit()
            _normalize_tags_in_db(conn)
            raw = conn.execute(text("SELECT tags FROM audio_folders WHERE id='f1'")).scalar()
        assert json.loads(raw) == ["soundscape"]

    def test_skips_non_list_tags_without_raising(self):
        # A row whose tags column is not a JSON list is skipped silently
        # (covers the `not isinstance(tags, list)` continue branch).
        path = _fresh_db()
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            conn.execute(
                text(
                    "INSERT INTO audio (id, filename, filepath, relative_path, tags) "
                    "VALUES ('a2', 'y.mp3', '/y.mp3', 'audio/y.mp3', :tags)"
                ),
                {"tags": json.dumps({"not": "a list"})},
            )
            conn.commit()
            _normalize_tags_in_db(conn)  # must not raise
            raw = conn.execute(text("SELECT tags FROM audio WHERE id='a2'")).scalar()
        assert json.loads(raw) == {"not": "a list"}

    def test_already_normalized_tags_unchanged(self):
        path = _fresh_db()
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            conn.execute(
                text(
                    "INSERT INTO audio (id, filename, filepath, relative_path, tags) "
                    "VALUES ('a3', 'z.mp3', '/z.mp3', 'audio/z.mp3', :tags)"
                ),
                {"tags": json.dumps(["already", "clean"])},
            )
            conn.commit()
            _normalize_tags_in_db(conn)
            raw = conn.execute(text("SELECT tags FROM audio WHERE id='a3'")).scalar()
        assert json.loads(raw) == ["already", "clean"]

    def test_malformed_json_tags_are_skipped(self):
        # A tags value that isn't valid JSON triggers the inner except branch,
        # which swallows the error and leaves the row untouched.
        path = _fresh_db()
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            conn.execute(
                text(
                    "INSERT INTO audio (id, filename, filepath, relative_path, tags) "
                    "VALUES ('a4', 'b.mp3', '/b.mp3', 'audio/b.mp3', 'not-json{')"
                )
            )
            conn.commit()
            _normalize_tags_in_db(conn)  # must not raise
            raw = conn.execute(text("SELECT tags FROM audio WHERE id='a4'")).scalar()
        assert raw == "not-json{"


class TestLegacyUserMigration:
    def test_rebuilds_users_table_with_nullable_password(self):
        """A pre-existing users table with NOT NULL hashed_password is rebuilt so
        the column becomes nullable (needed for OIDC-only accounts)."""
        path = os.path.join(tempfile.mkdtemp(), "legacy.db")
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE users (
                        id VARCHAR(36) PRIMARY KEY,
                        username VARCHAR(100) NOT NULL UNIQUE,
                        display_name VARCHAR(100),
                        email VARCHAR(254),
                        hashed_password VARCHAR(255) NOT NULL,
                        role VARCHAR(20),
                        allow_explicit BOOLEAN,
                        opds_token VARCHAR(64),
                        oidc_subject VARCHAR(255),
                        created_at DATETIME
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "INSERT INTO users (id, username, hashed_password, role) "
                    "VALUES ('u1', 'admin', 'hash', 'admin')"
                )
            )
            conn.commit()
        engine.dispose()

        # init_db detects the NOT NULL column and rebuilds the table.
        init_db(path)

        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            cols = conn.execute(text("PRAGMA table_info(users)")).fetchall()
            hp = next(c for c in cols if c[1] == "hashed_password")
            assert hp[3] == 0  # notnull is now 0 (nullable)
            # The existing row survived the rebuild.
            assert conn.execute(text("SELECT username FROM users WHERE id='u1'")).scalar() == "admin"
