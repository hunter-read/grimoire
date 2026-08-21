"""Tests for DB initialisation and the tag-normalization migration.

Exercises models/db.py against throwaway SQLite files so the runtime migrations
and tag normalization run end-to-end (including the audio tables).
"""
import json
import os
import tempfile

from sqlalchemy import create_engine, inspect, text

from backend.models.base import Base
from backend.models.db import _alembic_config, init_db, _normalize_tags_in_db


def _alembic_head(path):
    """The current head revision, read from a fresh Alembic config."""
    from alembic.script import ScriptDirectory

    engine = create_engine(f"sqlite:///{path}")
    with engine.connect() as conn:
        cfg = _alembic_config(conn)
    return ScriptDirectory.from_config(cfg).get_current_head()


def _stamped_revision(path):
    engine = create_engine(f"sqlite:///{path}")
    with engine.connect() as conn:
        return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()


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
    # Item tables no longer carry a JSON ``tags`` column (issue #235 moved item
    # tags to the shared-tag tables), so normalization now only runs on the
    # folder tables — these tests exercise that via ``audio_folders``.

    def test_normalizes_folder_table_tags(self):
        path = _fresh_db()
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            conn.execute(
                text(
                    "INSERT INTO audio_folders (id, path, tags) VALUES ('n1', 'Sfx', :tags)"
                ),
                {"tags": json.dumps(["Ambient", "AMBIENT", "  Tavern  "])},
            )
            conn.commit()
            _normalize_tags_in_db(conn)
            raw = conn.execute(text("SELECT tags FROM audio_folders WHERE id='n1'")).scalar()
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
                text("INSERT INTO audio_folders (id, path, tags) VALUES ('n2', 'A2', :tags)"),
                {"tags": json.dumps({"not": "a list"})},
            )
            conn.commit()
            _normalize_tags_in_db(conn)  # must not raise
            raw = conn.execute(text("SELECT tags FROM audio_folders WHERE id='n2'")).scalar()
        assert json.loads(raw) == {"not": "a list"}

    def test_already_normalized_tags_unchanged(self):
        path = _fresh_db()
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            conn.execute(
                text("INSERT INTO audio_folders (id, path, tags) VALUES ('n3', 'A3', :tags)"),
                {"tags": json.dumps(["already", "clean"])},
            )
            conn.commit()
            _normalize_tags_in_db(conn)
            raw = conn.execute(text("SELECT tags FROM audio_folders WHERE id='n3'")).scalar()
        assert json.loads(raw) == ["already", "clean"]

    def test_malformed_json_tags_are_skipped(self, caplog):
        # A tags value that isn't valid JSON triggers the inner except branch,
        # which now logs a warning and leaves the row untouched (rather than
        # silently swallowing the error).
        path = _fresh_db()
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            conn.execute(
                text("INSERT INTO audio_folders (id, path, tags) VALUES ('n4', 'A4', 'not-json{')")
            )
            conn.commit()
            with caplog.at_level("WARNING", logger="grimoire.db"):
                _normalize_tags_in_db(conn)  # must not raise
            raw = conn.execute(text("SELECT tags FROM audio_folders WHERE id='n4'")).scalar()
        assert raw == "not-json{"
        assert any(
            "skipping tag normalization" in r.message.lower() for r in caplog.records
        )


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


class TestAlembicCutover:
    def test_ancient_prealembic_db_migrates_data_and_schema(self):
        """A minimal early-schema DB (pre-dozens-of-ALTERs) cuts over correctly.

        Verifies the end-to-end upgrade path for a user on a very old version:
        existing rows survive, every later column is added (including is_guest,
        which the users-table rebuild must not drop), missing tables are created,
        the FTS table exists, and the legacy data backfills run. Re-running is a
        no-op (idempotent).
        """
        path = os.path.join(tempfile.mkdtemp(), "ancient.db")
        engine = create_engine(f"sqlite:///{path}")
        with engine.begin() as conn:
            # Early users table: NOT NULL password, before opds/email/oidc/
            # campaign_access/is_guest were added.
            conn.execute(
                text(
                    """
                    CREATE TABLE users (
                        id VARCHAR(36) PRIMARY KEY,
                        username VARCHAR(100) NOT NULL UNIQUE,
                        display_name VARCHAR(100),
                        hashed_password VARCHAR(255) NOT NULL,
                        role VARCHAR(20), allow_explicit BOOLEAN, created_at DATETIME
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "INSERT INTO users (id, username, hashed_password, role, allow_explicit) "
                    "VALUES ('u1', 'admin', 'h', 'admin', 1)"
                )
            )
            # Early campaign_resources with the legacy `shared` flag but no
            # `visibility` column yet.
            conn.execute(
                text(
                    """
                    CREATE TABLE campaign_resources (
                        id VARCHAR(36) PRIMARY KEY,
                        campaign_id VARCHAR(36) NOT NULL,
                        resource_type VARCHAR(20) NOT NULL,
                        resource_id VARCHAR(36) NOT NULL,
                        shared BOOLEAN DEFAULT 0
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "INSERT INTO campaign_resources "
                    "(id, campaign_id, resource_type, resource_id, shared) "
                    "VALUES ('r1', 'c1', 'book', 'b1', 1)"
                )
            )
        engine.dispose()

        init_db(path)
        init_db(path)  # second boot must be a no-op

        engine = create_engine(f"sqlite:///{path}")
        insp = inspect(engine)
        ucols = {c["name"]: c for c in insp.get_columns("users")}
        rcols = {c["name"] for c in insp.get_columns("campaign_resources")}
        tables = set(insp.get_table_names())

        # Existing data survived.
        with engine.connect() as conn:
            assert conn.execute(
                text("SELECT username FROM users WHERE id='u1'")
            ).scalar() == "admin"
            # Legacy shared=1 backfilled to visibility='public'.
            assert conn.execute(
                text("SELECT visibility FROM campaign_resources WHERE id='r1'")
            ).scalar() == "public"

        # Schema is fully current.
        assert ucols["hashed_password"]["nullable"] is True
        assert {"opds_token", "email", "oidc_subject", "campaign_access", "is_guest"} <= set(
            ucols
        )
        assert {"visibility", "category_id", "sort_order", "gm_only"} <= rcols
        # Tables absent from the old DB were created; FTS table exists.
        assert {"game_systems", "campaigns", "wiki_pages", "book_search"} <= tables
        assert _stamped_revision(path) == _alembic_head(path)

    def test_fresh_db_upgrades_to_head(self):
        """A brand-new DB runs migrations from the baseline and lands at head."""
        path = _fresh_db()
        engine = create_engine(f"sqlite:///{path}")
        names = set(inspect(engine).get_table_names())
        assert "alembic_version" in names
        assert "campaigns" in names and "wiki_pages" in names
        assert _stamped_revision(path) == _alembic_head(path)

    def test_fresh_db_matches_metadata_schema(self):
        """The Alembic-built schema matches Base.metadata (no drift)."""
        path = _fresh_db()
        other = os.path.join(tempfile.mkdtemp(), "meta.db")
        meta_engine = create_engine(f"sqlite:///{other}")
        Base.metadata.create_all(meta_engine)

        def app_tables(p):
            insp = inspect(create_engine(f"sqlite:///{p}"))
            return {
                t
                for t in insp.get_table_names()
                if t != "alembic_version" and not t.startswith("book_search")
            }

        assert app_tables(path) == app_tables(other)

    def test_pre_alembic_db_is_stamped_not_replayed(self):
        """An existing DB with tables but no alembic_version is stamped at head.

        The baseline migration is NOT re-run (which would try to CREATE existing
        tables and fail); existing data survives and the version table appears.
        """
        # Build a "current-schema" DB, then strip the alembic_version table to
        # simulate a database produced by the old imperative system.
        path = _fresh_db()
        engine = create_engine(f"sqlite:///{path}")
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO game_systems (id, name, slug) "
                    "VALUES ('gs1', 'Sys', 'sys')"
                )
            )
            conn.execute(text("DROP TABLE alembic_version"))
        engine.dispose()

        assert "alembic_version" not in set(inspect(engine).get_table_names())

        # Re-init: detects the pre-Alembic DB, replays legacy migrations, stamps.
        init_db(path)

        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            assert conn.execute(
                text("SELECT name FROM game_systems WHERE id='gs1'")
            ).scalar() == "Sys"
        assert _stamped_revision(path) == _alembic_head(path)

    def test_baseline_upgrade_and_downgrade(self):
        """The baseline revision upgrades to head and downgrades back to base.

        Downgrading drops every table, proving the revision is reversible.
        """
        from alembic import command

        path = os.path.join(tempfile.mkdtemp(), "reversible.db")
        engine = create_engine(f"sqlite:///{path}")

        with engine.connect() as conn:
            cfg = _alembic_config(conn)
            command.upgrade(cfg, "head")
        assert "campaigns" in set(inspect(engine).get_table_names())

        with engine.connect() as conn:
            cfg = _alembic_config(conn)
            command.downgrade(cfg, "base")
        remaining = {
            t
            for t in inspect(engine).get_table_names()
            if t != "alembic_version"
        }
        assert remaining == set()


class TestOcrQueueMigration:
    """Revision a1f4c2e9b7d0 (ocr_pending/ocr_pages_done) must be recoverable.

    An earlier version of this migration used batch_alter_table, which rebuilds
    the books table through a temporary _alembic_tmp_books table. When a deploy
    was interrupted mid-rebuild, that temp table was left behind and every
    restart crashed with "table _alembic_tmp_books already exists" (the
    migration never committed, so it re-ran forever). These tests pin the
    recovery behaviour.
    """

    def _stuck_at_down_revision(self, path):
        """Build a real DB, then roll it back to the state just before the OCR
        migration: at the down_revision, without the OCR columns."""
        init_db(path)
        engine = create_engine(f"sqlite:///{path}")
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE alembic_version SET version_num='96c733b7c205'")
            )
            conn.execute(text("DROP INDEX IF EXISTS ix_books_ocr_pending"))
            conn.execute(text("ALTER TABLE books DROP COLUMN ocr_pages_done"))
            conn.execute(text("ALTER TABLE books DROP COLUMN ocr_pending"))
        engine.dispose()

    def test_recovers_from_leftover_temp_table(self):
        """A stale _alembic_tmp_books (from an interrupted batch run) must not
        block the migration; the columns and index still land at head."""
        path = os.path.join(tempfile.mkdtemp(), "stuck.db")
        self._stuck_at_down_revision(path)

        engine = create_engine(f"sqlite:///{path}")
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE _alembic_tmp_books (id VARCHAR(36))"))
        engine.dispose()

        # This previously crashed with "table _alembic_tmp_books already exists".
        init_db(path)

        engine = create_engine(f"sqlite:///{path}")
        insp = inspect(engine)
        cols = {c["name"] for c in insp.get_columns("books")}
        idx = {i["name"] for i in insp.get_indexes("books")}
        tables = set(insp.get_table_names())
        assert {"ocr_pending", "ocr_pages_done"} <= cols
        assert "ix_books_ocr_pending" in idx
        assert "_alembic_tmp_books" not in tables
        assert _stamped_revision(path) == _alembic_head(path)

    def test_upgrade_is_reentrant_after_partial_apply(self):
        """If the columns already exist but the version wasn't stamped (a partial
        apply), re-running must not raise on duplicate columns/index."""
        path = os.path.join(tempfile.mkdtemp(), "partial.db")
        init_db(path)  # fully applies, columns present
        engine = create_engine(f"sqlite:///{path}")
        with engine.begin() as conn:
            # Simulate the version not having been committed while the columns
            # from a prior run are already there.
            conn.execute(
                text("UPDATE alembic_version SET version_num='96c733b7c205'")
            )
        engine.dispose()

        init_db(path)  # must be a clean no-op, not "duplicate column" error

        assert _stamped_revision(path) == _alembic_head(path)


class TestExpandMetadataMigration:
    """Migration 0004: new columns, lookup seeds, and legacy backfill (#202)."""

    def test_new_columns_present(self):
        path = _fresh_db()
        engine = create_engine(f"sqlite:///{path}")
        insp = inspect(engine)
        sys_cols = {c["name"] for c in insp.get_columns("game_systems")}
        book_cols = {c["name"] for c in insp.get_columns("books")}
        assert {
            "genres",
            "dice_materials",
            "system_family",
            "license",
            "year",
            "urls",
            "character_builder_urls",
            "is_one_page",
        } <= sys_cols
        assert {"artists", "genres", "isbn", "version", "language", "month", "day", "urls"} <= book_cols

    def test_lookup_tables_seeded(self):
        path = _fresh_db()
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            genre_count = conn.execute(text("SELECT count(*) FROM genres")).scalar()
            fam_count = conn.execute(text("SELECT count(*) FROM system_families")).scalar()
            cyber = conn.execute(
                text(
                    "SELECT p.name FROM genres g JOIN genres p ON g.parent_id=p.id "
                    "WHERE g.name='Cyberpunk'"
                )
            ).scalar()
        assert genre_count > 0
        assert fam_count > 0
        assert cyber == "Science Fiction"

    def test_legacy_backfill(self):
        """genre → genres, character_builder_url → list, publisher_url → book urls."""
        path = os.path.join(tempfile.mkdtemp(), "legacy.db")
        engine = create_engine(f"sqlite:///{path}")
        # Migrate up to the pre-0004 revision, insert legacy rows, then finish.
        with engine.connect() as conn:
            from alembic import command

            cfg = _alembic_config(conn)
            command.upgrade(cfg, "b2e5d3f0c8a1")
            conn.commit()
        with engine.connect() as conn:
            conn.execute(
                text(
                    "INSERT INTO game_systems (id, name, slug, genre, character_builder_url) "
                    "VALUES ('s1','S','s','Fantasy','http://b')"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO books (id, title, filename, filepath, relative_path, publisher_url) "
                    "VALUES ('b1','B','b.pdf','/b.pdf','b.pdf','http://p')"
                )
            )
            conn.commit()
        engine.dispose()

        init_db(path)  # runs 0004 including backfill

        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            g = conn.execute(
                text("SELECT genres, character_builder_urls FROM game_systems WHERE id='s1'")
            ).fetchone()
            b = conn.execute(text("SELECT urls FROM books WHERE id='b1'")).fetchone()
        assert json.loads(g[0]) == ["Fantasy"]
        assert json.loads(g[1])[0]["url"] == "http://b"
        assert json.loads(b[0])[0]["url"] == "http://p"


class TestFolderCoverBookCleanup:
    """Migration b4d90c2e75af: drop books that were really shelf artwork (#372)."""

    def _seed(self):
        """A DB at the revision before the cleanup, holding one system whose
        folder artwork was double-registered as a book, plus two look-alikes
        that must survive: a cover image in a *different* folder, and a genuine
        book whose title happens to be "cover"."""
        path = os.path.join(tempfile.mkdtemp(), "covers.db")
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            from alembic import command

            cfg = _alembic_config(conn)
            command.upgrade(cfg, "c72e5b81a934")
            conn.commit()
        with engine.connect() as conn:
            conn.execute(
                text(
                    "INSERT INTO game_systems (id, name, slug, folder_cover_path) "
                    "VALUES ('s1','Test System','test-system','books/Test System/cover.jpg')"
                )
            )
            rows = [
                # The bogus row: exactly the file claimed as artwork.
                ("bogus", "cover", "cover.jpg", "/lib/books/Test System/cover.jpg"),
                # Same name, deeper in the tree — a real image book.
                ("deep", "cover", "cover.jpg", "/lib/books/Test System/handouts/cover.jpg"),
                # A real PDF that merely shares the title.
                ("pdf", "cover", "cover.pdf", "/lib/books/Test System/cover.pdf"),
            ]
            for bid, title, filename, filepath in rows:
                conn.execute(
                    text(
                        "INSERT INTO books (id, title, filename, filepath, relative_path, "
                        "game_system_id) VALUES (:id,:t,:f,:p,:r,'s1')"
                    ),
                    {"id": bid, "t": title, "f": filename, "p": filepath, "r": filepath[5:]},
                )
            # A one-page container: the artwork was registered as a book on a
            # *child* system invented for it, not on the row holding the cover.
            conn.execute(
                text(
                    "INSERT INTO game_systems (id, name, slug, folder_cover_path) VALUES "
                    "('s2','One-Page RPGs','one-page-rpgs','books/one-page-rpgs/cover.jpg')"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO game_systems (id, name, slug, parent_id) "
                    "VALUES ('s3','Cover','one-page-rpgs--cover','s2')"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO books (id, title, filename, filepath, relative_path, "
                    "game_system_id) VALUES ('onepage','cover','cover.jpg',"
                    "'/lib/books/one-page-rpgs/cover.jpg','books/one-page-rpgs/cover.jpg','s3')"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO users (id, username, role) VALUES ('u1','u','admin')"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO bookmarks (id, user_id, book_id, page_number) "
                    "VALUES ('bm1','u1','bogus',1)"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO favorites (id, user_id, item_type, item_id) "
                    "VALUES ('fv1','u1','book','bogus')"
                )
            )
            conn.commit()
        engine.dispose()
        return path

    def test_the_artwork_row_is_deleted_and_look_alikes_are_kept(self):
        path = self._seed()
        init_db(path)

        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            ids = {r[0] for r in conn.execute(text("SELECT id FROM books")).fetchall()}
        assert ids == {"deep", "pdf"}

    def test_a_one_page_containers_artwork_row_is_deleted_too(self):
        """It hangs off an invented child system, so it cannot be found by
        joining on the row that holds folder_cover_path."""
        path = self._seed()
        init_db(path)

        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            gone = conn.execute(
                text("SELECT count(*) FROM books WHERE id='onepage'")
            ).scalar()
        assert gone == 0

    def test_the_deleted_book_leaves_no_bookmarks_or_favorites_behind(self):
        path = self._seed()
        init_db(path)

        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            bookmarks = conn.execute(
                text("SELECT count(*) FROM bookmarks WHERE book_id='bogus'")
            ).scalar()
            favorites = conn.execute(
                text("SELECT count(*) FROM favorites WHERE item_id='bogus'")
            ).scalar()
        assert (bookmarks, favorites) == (0, 0)

    def test_the_system_keeps_its_folder_cover(self):
        """The artwork itself is untouched — only the duplicate book row goes."""
        path = self._seed()
        init_db(path)

        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            cover = conn.execute(
                text("SELECT folder_cover_path FROM game_systems WHERE id='s1'")
            ).scalar()
        assert cover == "books/Test System/cover.jpg"

    def test_a_library_with_no_folder_covers_is_untouched(self):
        path = _fresh_db()
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            conn.execute(
                text(
                    "INSERT INTO books (id, title, filename, filepath, relative_path) "
                    "VALUES ('b1','B','b.pdf','/b.pdf','b.pdf')"
                )
            )
            conn.commit()
        engine.dispose()

        init_db(path)  # re-running must leave the row alone

        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM books")).scalar() == 1
