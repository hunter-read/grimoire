"""Unit tests for the shared-tag service and its Alembic backfill (issue #235)."""
import importlib.util
import json
import os
import tempfile

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from backend.models.base import Base
from backend.models.db import init_db
from backend.services import tag_service


def _load_migration():
    """Import the numeric-prefixed 0008 migration module by path."""
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(here, "migrations", "versions", "0008_shared_tags.py")
    spec = importlib.util.spec_from_file_location("mig_0008_shared_tags", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _session():
    """A fresh in-memory DB session with the full schema (tags tables included)."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


class TestNormalization:
    def test_internal_is_lowercased_and_stripped(self):
        assert tag_service.normalize_internal("  Draw Steel  ") == "draw steel"

    def test_display_keeps_entered_casing(self):
        assert tag_service.default_display("  GM Screen ") == "GM Screen"


class TestGetOrCreate:
    def test_creates_tag_with_entered_display(self):
        db = _session()
        tag = tag_service.get_or_create_tag(db, "Draw Steel")
        assert tag.internal == "draw steel"
        assert tag.display == "Draw Steel"

    def test_matches_existing_by_internal_and_keeps_first_display(self):
        db = _session()
        first = tag_service.get_or_create_tag(db, "GM Screen")
        # A differently-cased later entry resolves to the same tag, unchanged.
        again = tag_service.get_or_create_tag(db, "gm screen")
        assert again.id == first.id
        assert again.display == "GM Screen"

    def test_blank_input_returns_none(self):
        db = _session()
        assert tag_service.get_or_create_tag(db, "   ") is None


class TestSetAndReadResourceTags:
    def test_set_then_read_roundtrip(self):
        db = _session()
        result = tag_service.set_resource_tags(db, "map", "m1", ["Forest", "Dungeon"])
        assert [t["display"] for t in result] == ["Forest", "Dungeon"]
        read = tag_service.tags_for_resource(db, "map", "m1")
        # Read is sorted by display, case-insensitive.
        assert [t["internal"] for t in read] == ["dungeon", "forest"]

    def test_set_dedupes_by_internal(self):
        db = _session()
        result = tag_service.set_resource_tags(db, "map", "m1", ["Forest", "forest", "FOREST"])
        assert len(result) == 1
        assert result[0]["internal"] == "forest"

    def test_set_replaces_previous_tags(self):
        db = _session()
        tag_service.set_resource_tags(db, "map", "m1", ["Forest", "Cave"])
        tag_service.set_resource_tags(db, "map", "m1", ["Cave"])
        read = tag_service.tags_for_resource(db, "map", "m1")
        assert [t["internal"] for t in read] == ["cave"]

    def test_tags_shared_across_resource_types(self):
        db = _session()
        tag_service.set_resource_tags(db, "map", "m1", ["Strahd"])
        tag_service.set_resource_tags(db, "book", "b1", ["strahd"])
        # Same internal key → same underlying tag row.
        rows = db.execute(text("SELECT COUNT(*) FROM tags")).scalar()
        assert rows == 1

    def test_unknown_resource_type_raises(self):
        db = _session()
        try:
            tag_service.set_resource_tags(db, "widget", "x", ["a"])
        except ValueError as e:
            assert "widget" in str(e)
        else:
            raise AssertionError("expected ValueError")


class TestCategory:
    def _cat(self, db, internal):
        from backend.models import Tag

        return db.query(Tag).filter(Tag.internal == internal).first().category

    def test_new_tag_takes_its_first_category(self):
        db = _session()
        tag_service.set_resource_tags(db, "map", "m1", ["Forest"])
        assert self._cat(db, "forest") == "map"

    def test_reuse_in_same_category_stays_single(self):
        db = _session()
        tag_service.set_resource_tags(db, "map", "m1", ["Forest"])
        tag_service.set_resource_tags(db, "map", "m2", ["forest"])
        assert self._cat(db, "forest") == "map"

    def test_second_category_promotes_to_shared(self):
        db = _session()
        tag_service.set_resource_tags(db, "map", "m1", ["Strahd"])
        tag_service.set_resource_tags(db, "book", "b1", ["strahd"])
        assert self._cat(db, "strahd") == "shared"

    def test_shared_stays_shared(self):
        db = _session()
        tag_service.set_resource_tags(db, "map", "m1", ["Strahd"])
        tag_service.set_resource_tags(db, "book", "b1", ["strahd"])
        tag_service.set_resource_tags(db, "map", "m2", ["strahd"])  # back to map
        assert self._cat(db, "strahd") == "shared"

    def test_get_or_create_default_category_is_shared(self):
        db = _session()
        tag = tag_service.get_or_create_tag(db, "Programmatic")
        assert tag.category == "shared"


class TestBatchAndLookups:
    def test_tags_for_resources_batch(self):
        db = _session()
        tag_service.set_resource_tags(db, "map", "m1", ["Forest"])
        tag_service.set_resource_tags(db, "map", "m2", ["Cave"])
        batch = tag_service.tags_for_resources(db, "map", ["m1", "m2", "m3"])
        assert batch["m1"][0]["internal"] == "forest"
        assert batch["m2"][0]["internal"] == "cave"
        assert "m3" not in batch  # no tags → omitted

    def test_resources_for_tag(self):
        db = _session()
        tag_service.set_resource_tags(db, "map", "m1", ["Strahd"])
        tag_service.set_resource_tags(db, "book", "b1", ["Strahd"])
        res = tag_service.resources_for_tag(db, "STRAHD")
        pairs = {(r["resource_type"], r["resource_id"]) for r in res}
        assert pairs == {("map", "m1"), ("book", "b1")}

    def test_resources_for_tag_filtered_by_type(self):
        db = _session()
        tag_service.set_resource_tags(db, "map", "m1", ["Strahd"])
        tag_service.set_resource_tags(db, "book", "b1", ["Strahd"])
        res = tag_service.resources_for_tag(db, "strahd", resource_type="book")
        assert res == [{"resource_type": "book", "resource_id": "b1"}]

    def test_resources_for_unknown_tag_is_empty(self):
        db = _session()
        assert tag_service.resources_for_tag(db, "nope") == []

    def test_tags_in_use_scoped_to_type_with_counts(self):
        db = _session()
        tag_service.set_resource_tags(db, "map", "m1", ["Forest"])
        tag_service.set_resource_tags(db, "map", "m2", ["Forest"])
        tag_service.set_resource_tags(db, "book", "b1", ["Lore"])
        # Scoped to maps: only Forest, count 2. "Lore" (book-only) excluded.
        in_use = tag_service.tags_in_use(db, "map")
        assert in_use == [
            {"internal": "forest", "display": "Forest", "category": "map", "count": 2}
        ]

    def test_tags_in_use_unscoped(self):
        db = _session()
        tag_service.set_resource_tags(db, "map", "m1", ["Forest"])
        tag_service.set_resource_tags(db, "book", "b1", ["Lore"])
        internals = {t["internal"] for t in tag_service.tags_in_use(db)}
        assert internals == {"forest", "lore"}

    def test_prune_orphan_tags(self):
        db = _session()
        tag_service.set_resource_tags(db, "map", "m1", ["Forest"])
        tag_service.set_resource_tags(db, "map", "m1", [])  # unlink → orphan
        removed = tag_service.prune_orphan_tags(db)
        assert removed == 1
        assert db.execute(text("SELECT COUNT(*) FROM tags")).scalar() == 0


class TestFolderTags:
    def _map_in_folder(self, db, folder, rel_name):
        from backend.models import GenericMap

        mid = f"m-{rel_name}"
        db.add(
            GenericMap(
                id=mid,
                filename=f"{rel_name}.png",
                filepath=f"/x/{rel_name}.png",
                relative_path=f"maps/{folder}/{rel_name}.png",
            )
        )
        db.commit()
        return mid

    def test_resolves_folder_tags_to_contained_items(self):
        from backend.models import MapFolder

        db = _session()
        mid = self._map_in_folder(db, "Swamps", "bog")
        db.add(MapFolder(path="Swamps", tags=["Wetland", "Outdoor"]))
        db.commit()

        ft = tag_service.folder_tags_in_use(db, "map")
        assert set(ft) == {"wetland", "outdoor"}
        assert ft["wetland"]["display"] == "Wetland"
        assert ft["wetland"]["refs"] == [{"resource_type": "map", "resource_id": mid}]

    def test_scoped_to_resource_type(self):
        from backend.models import MapFolder

        db = _session()
        self._map_in_folder(db, "Swamps", "bog")
        db.add(MapFolder(path="Swamps", tags=["Wetland"]))
        db.commit()
        # Scoping to a different type yields nothing.
        assert tag_service.folder_tags_in_use(db, "token") == {}

    def test_remove_tag_from_folders(self):
        from backend.models import MapFolder

        db = _session()
        db.add(MapFolder(path="Swamps", tags=["Wetland", "Outdoor"]))
        db.add(MapFolder(path="Caves", tags=["Wetland"]))
        db.add(MapFolder(path="Peaks", tags=["Snowy"]))
        db.commit()
        # Case-insensitive match; strips from every folder that carries it.
        changed = tag_service.remove_tag_from_folders(db, "WETLAND")
        db.commit()
        assert changed == 2
        remaining = {p: f.tags for p, f in ((r.path, r) for r in db.query(MapFolder).all())}
        assert remaining["Swamps"] == ["Outdoor"]
        assert remaining["Caves"] == []
        assert remaining["Peaks"] == ["Snowy"]  # untouched folder unchanged

    def test_nested_items_included(self):
        from backend.models import MapFolder

        db = _session()
        nested = self._map_in_folder(db, "Swamps/Deep", "mire")
        db.add(MapFolder(path="Swamps", tags=["Wetland"]))
        db.commit()
        refs = tag_service.folder_tags_in_use(db, "map")["wetland"]["refs"]
        assert {r["resource_id"] for r in refs} == {nested}


class TestFolderTagCatalog:
    """Folder tags register catalog rows; display comes from the catalog so a
    rename sticks and tags.json can't overwrite it (read-only library)."""

    def _map_in_folder(self, db, folder, rel_name):
        from backend.models import GenericMap

        mid = f"m-{rel_name}"
        db.add(
            GenericMap(
                id=mid,
                filename=f"{rel_name}.png",
                filepath=f"/x/{rel_name}.png",
                relative_path=f"maps/{folder}/{rel_name}.png",
            )
        )
        db.commit()
        return mid

    def test_register_folder_tags_creates_rows_and_returns_internals(self):
        from backend.models import Tag

        db = _session()
        internals = tag_service.register_folder_tags(db, ["Wetland", "Outdoor"], category="map")
        db.commit()
        assert internals == ["wetland", "outdoor"]
        rows = {t.internal: t for t in db.query(Tag).all()}
        assert rows["wetland"].display == "Wetland"  # entered casing → default display
        assert rows["wetland"].category == "map"

    def test_folder_display_comes_from_catalog(self):
        from backend.models import MapFolder

        db = _session()
        mid = self._map_in_folder(db, "Swamps", "bog")
        # Catalog row has nicer casing; folder stores the internal key.
        tag_service.get_or_create_tag(db, "Wetland", category="map")
        db.add(MapFolder(path="Swamps", tags=["wetland"]))
        db.commit()
        ft = tag_service.folder_tags_in_use(db, "map")
        assert ft["wetland"]["display"] == "Wetland"
        assert ft["wetland"]["refs"] == [{"resource_type": "map", "resource_id": mid}]
        # folder_display_tags resolves the stored internal to the catalog display.
        assert tag_service.folder_display_tags(db, ["wetland"]) == ["Wetland"]

    def test_folder_display_falls_back_to_key_without_catalog_row(self):
        db = _session()
        assert tag_service.folder_display_tags(db, ["orphan"]) == ["orphan"]

    def test_rename_materializes_folder_only_tag(self):
        from backend.models import MapFolder, Tag

        db = _session()
        # A folder-only tag: exists in JSON, no Tag row yet.
        db.add(MapFolder(path="Swamps", tags=["wetland"]))
        db.commit()
        assert db.query(Tag).filter_by(internal="wetland").first() is None
        # Rename must not fail; it creates the catalog row so the display persists.
        tag = tag_service.rename_tag(db, "wetland", "Wetlands")
        db.commit()
        assert tag is not None
        assert tag.display == "Wetlands"
        # Renamed to a new key → folder JSON is re-keyed too.
        folder = db.query(MapFolder).filter_by(path="Swamps").first()
        assert folder.tags == ["wetlands"]

    def test_add_resource_tags_is_additive(self):
        db = _session()
        tag_service.set_resource_tags(db, "map", "m1", ["Forest"])
        db.commit()
        # Adding does not remove the existing tag.
        added = tag_service.add_resource_tags(db, "map", "m1", ["Cave", "Forest"])
        db.commit()
        assert [t["internal"] for t in added] == ["cave"]  # Forest already present, skipped
        read = tag_service.tags_for_resource(db, "map", "m1")
        assert {t["internal"] for t in read} == {"forest", "cave"}


class TestBookFolderTags:
    def _book(self, db, system_id, category, sub, name):
        from backend.models import Book

        bid = f"b-{name}"
        # relative_path: books/{SystemName}/{categoryDir}/{sub…}/{file}
        sub_part = f"{sub}/" if sub else ""
        db.add(
            Book(
                id=bid,
                title=name,
                filename=f"{name}.pdf",
                filepath=f"/x/{name}.pdf",
                relative_path=f"books/Sys/{category}/{sub_part}{name}.pdf",
                game_system_id=system_id,
                category=category,
            )
        )
        db.commit()
        return bid

    def test_book_folder_tags_resolve_to_books(self):
        from backend.models import BookFolder

        db = _session()
        bid = self._book(db, "sys1", "adventures", "curse", "strahd")
        db.add(BookFolder(path="sys1/adventures/curse", tags=["Gothic"]))
        db.commit()

        ft = tag_service.folder_tags_in_use(db, "book")
        assert set(ft) == {"gothic"}
        assert ft["gothic"]["refs"] == [{"resource_type": "book", "resource_id": bid}]

    def test_book_folders_scoped_out_for_other_types(self):
        from backend.models import BookFolder

        db = _session()
        self._book(db, "sys1", "adventures", "curse", "strahd")
        db.add(BookFolder(path="sys1/adventures/curse", tags=["Gothic"]))
        db.commit()
        assert tag_service.folder_tags_in_use(db, "map") == {}

    def test_folders_for_tag_shows_subfolder_path_only(self):
        from backend.models import BookFolder

        db = _session()
        bid = self._book(db, "sys1", "adventures", "curse/strahd", "book1")
        db.add(BookFolder(path="sys1/adventures/curse", tags=["Gothic"]))
        db.commit()
        groups = tag_service.folders_for_tag(db, "gothic")
        assert len(groups) == 1
        # The system_id/category prefix is dropped from the displayed path.
        assert groups[0] == {
            "resource_type": "book",
            "path": "curse",
            "items": [{"resource_type": "book", "resource_id": bid}],
        }

    def test_book_folder_type_in_folder_types_for_tag(self):
        from backend.models import BookFolder

        db = _session()
        db.add(BookFolder(path="sys1/adventures/curse", tags=["Gothic"]))
        db.commit()
        assert tag_service.folder_types_for_tag(db, "gothic") == {"book"}

    def test_remove_and_rekey_cover_book_folders(self):
        from backend.models import BookFolder

        db = _session()
        # Folders store internal keys; display lives in the catalog.
        db.add(BookFolder(path="sys1/adventures/curse", tags=["gothic", "old"]))
        db.commit()
        # Rename re-keys the JSON entry in book folders too (to the new internal).
        tag_service.get_or_create_tag(db, "Old", category="book")
        db.commit()
        tag_service.rename_tag(db, "old", "Ancient")
        db.commit()
        folder = db.query(BookFolder).first()
        assert "ancient" in folder.tags and "old" not in folder.tags
        # And removal strips it.
        tag_service.remove_tag_from_folders(db, "gothic")
        db.commit()
        assert "gothic" not in db.query(BookFolder).first().tags


class TestEffectiveCategory:
    def test_single_type_is_that_type(self):
        assert tag_service.effective_category("map", {"map"}) == "map"

    def test_stored_shared_stays_shared(self):
        assert tag_service.effective_category("shared", {"map"}) == "shared"

    def test_direct_and_folder_across_types_is_shared(self):
        # Stored as book (direct), also used on a map folder → shared.
        assert tag_service.effective_category("book", {"map"}) == "shared"

    def test_folder_only_single_type(self):
        assert tag_service.effective_category(None, {"book"}) == "book"

    def test_folder_only_multiple_types_shared(self):
        assert tag_service.effective_category(None, {"book", "map"}) == "shared"


class TestMigrationBackfill:
    def test_init_db_creates_tag_tables(self):
        path = os.path.join(tempfile.mkdtemp(), "t.db")
        init_db(path)
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            names = {
                r[0]
                for r in conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table'")
                ).fetchall()
            }
        assert {"tags", "resource_tags"} <= names

    def _pre_migration_db(self):
        """A minimal pre-0009 schema: item tables still carrying a JSON ``tags``
        column, plus the empty shared-tag tables 0008 creates. Lets the 0008
        backfill be exercised in isolation now that a live DB has dropped the
        item ``tags`` columns (0009)."""
        path = os.path.join(tempfile.mkdtemp(), "t.db")
        engine = create_engine(f"sqlite:///{path}")
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, filename TEXT, "
                    "filepath TEXT, relative_path TEXT, tags JSON)"
                )
            )
            conn.execute(
                text(
                    "CREATE TABLE generic_maps (id TEXT PRIMARY KEY, filename TEXT, "
                    "filepath TEXT, relative_path TEXT, tags JSON)"
                )
            )
            conn.execute(
                text(
                    "CREATE TABLE tokens (id TEXT PRIMARY KEY, filename TEXT, "
                    "filepath TEXT, relative_path TEXT, tags JSON)"
                )
            )
            conn.execute(
                text(
                    "CREATE TABLE tags (id TEXT PRIMARY KEY, internal TEXT UNIQUE, "
                    "display TEXT, created_at DATETIME)"
                )
            )
            conn.execute(
                text(
                    "CREATE TABLE resource_tags (id TEXT PRIMARY KEY, tag_id TEXT, "
                    "resource_type TEXT, resource_id TEXT, created_at DATETIME)"
                )
            )
        return engine

    def test_backfill_migrates_json_tags(self):
        mig = _load_migration()
        engine = self._pre_migration_db()
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO books (id, title, filename, filepath, relative_path, tags) "
                    "VALUES ('b1', 'B', 'b.pdf', '/b.pdf', 'books/S/b.pdf', :tags)"
                ),
                {"tags": json.dumps(["Strahd", "Undead"])},
            )
            conn.execute(
                text(
                    "INSERT INTO generic_maps (id, filename, filepath, relative_path, tags) "
                    "VALUES ('m1', 'm.png', '/m.png', 'maps/m.png', :tags)"
                ),
                {"tags": json.dumps(["strahd"])},
            )
        with engine.begin() as conn:
            mig._backfill(conn)
        with engine.connect() as conn:
            # "Strahd" and "strahd" collapse to one tag.
            tag_count = conn.execute(text("SELECT COUNT(*) FROM tags")).scalar()
            assert tag_count == 2  # strahd, undead
            links = conn.execute(
                text(
                    "SELECT resource_type, resource_id FROM resource_tags "
                    "JOIN tags ON tags.id = resource_tags.tag_id WHERE tags.internal='strahd'"
                )
            ).fetchall()
            assert {(r[0], r[1]) for r in links} == {("book", "b1"), ("map", "m1")}
            display = conn.execute(
                text("SELECT display FROM tags WHERE internal='strahd'")
            ).scalar()
            assert display == "Strahd"

    def test_backfill_is_idempotent(self):
        mig = _load_migration()
        engine = self._pre_migration_db()
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO tokens (id, filename, filepath, relative_path, tags) "
                    "VALUES ('t1', 't.png', '/t.png', 'tokens/t.png', :tags)"
                ),
                {"tags": json.dumps(["Goblin"])},
            )
        with engine.begin() as conn:
            mig._backfill(conn)
        with engine.begin() as conn:
            mig._backfill(conn)  # second run must not duplicate links
        with engine.connect() as conn:
            links = conn.execute(text("SELECT COUNT(*) FROM resource_tags")).scalar()
            assert links == 1


class TestDropColumnsMigration:
    def test_0009_self_heals_past_leftover_temp_table(self):
        """A ``_alembic_tmp_*`` table left by a prior interrupted run must not
        block the 0009 column drop (regression for the multi-worker batch-alter
        collision seen in production)."""
        from alembic import command

        from backend.models.db import _alembic_config

        path = os.path.join(tempfile.mkdtemp(), "t.db")
        init_db(path)  # fully migrated (item tags already dropped)
        engine = create_engine(f"sqlite:///{path}")
        with engine.begin() as conn:
            # Re-add a tags column and rewind so 0009 runs again over it, and
            # plant the leftover temp table that used to make the retry crash.
            conn.execute(text("ALTER TABLE game_systems ADD COLUMN tags JSON"))
            conn.execute(text("CREATE TABLE _alembic_tmp_game_systems (id TEXT)"))
        with engine.connect() as conn:
            cfg = _alembic_config(conn)
            command.stamp(cfg, "c7a9e1f2b8d4")  # back to pre-0009
            command.upgrade(cfg, "head")  # must not raise
        from sqlalchemy import inspect

        insp = inspect(engine)
        assert "tags" not in {c["name"] for c in insp.get_columns("game_systems")}
        assert not insp.has_table("_alembic_tmp_game_systems")


class TestBookFolderDepth:
    """Book folder paths for systems inside container folders (issue #357).

    ``books/{Container}/{System}/{categoryDir}/…`` puts the category one segment
    deeper than a top-level system, so a fixed ``parts[3:-1]`` counted the
    category dir itself as a subfolder — the folder tag the UI writes resolved to
    no books, and the padded path that resolved was invisible to the UI.
    """

    def _system(self, db, sid, parent_id=None, container_kind=""):
        from backend.models import GameSystem

        db.add(
            GameSystem(
                id=sid,
                name=sid,
                slug=sid,
                parent_id=parent_id,
                container_kind=container_kind,
            )
        )
        db.commit()
        return sid

    def _book(self, db, system_id, category, relative_path, name):
        from backend.models import Book

        bid = f"b-{name}"
        db.add(
            Book(
                id=bid,
                title=name,
                filename=f"{name}.pdf",
                filepath=f"/x/{name}.pdf",
                relative_path=relative_path,
                game_system_id=system_id,
                category=category,
            )
        )
        db.commit()
        return bid

    def test_depth_two_for_top_level_system(self):
        db = _session()
        self._system(db, "top")
        assert tag_service.system_category_depth(db, "top") == 2

    def test_depth_three_for_container_child(self):
        db = _session()
        self._system(db, "cont", container_kind="family")
        self._system(db, "child", parent_id="cont")
        assert tag_service.system_category_depth(db, "child") == 3

    def test_depth_four_for_nested_container_child(self):
        db = _session()
        self._system(db, "outer", container_kind="family")
        self._system(db, "inner", parent_id="outer", container_kind="parent")
        self._system(db, "deep", parent_id="inner")
        assert tag_service.system_category_depth(db, "deep") == 4

    def test_depths_map_matches_per_system_walk(self):
        db = _session()
        self._system(db, "outer", container_kind="family")
        self._system(db, "inner", parent_id="outer", container_kind="parent")
        self._system(db, "deep", parent_id="inner")
        assert tag_service.system_category_depths(db) == {
            "outer": 2,
            "inner": 3,
            "deep": 4,
        }

    def test_cycle_does_not_hang(self):
        db = _session()
        self._system(db, "a")
        self._system(db, "b", parent_id="a")
        from backend.models import GameSystem

        db.query(GameSystem).filter_by(id="a").update({"parent_id": "b"})
        db.commit()
        assert tag_service.system_category_depth(db, "a") >= 2
        assert set(tag_service.system_category_depths(db)) == {"a", "b"}

    def test_container_child_folder_tag_resolves_to_books(self):
        """The path the UI writes now matches the books behind it."""
        from backend.models import BookFolder

        db = _session()
        self._system(db, "cont", container_kind="family")
        self._system(db, "child", parent_id="cont")
        bid = self._book(
            db,
            "child",
            "adventure",
            "books/Shadowrun/4 DE/adventures/Flusternetze/Maps/x.pdf",
            "x",
        )
        # What the frontend writes: category dir is not a subfolder segment.
        db.add(BookFolder(path="child/adventure/Flusternetze/Maps", tags=["Gothic"]))
        db.commit()

        ft = tag_service.folder_tags_in_use(db, "book")
        assert ft["gothic"]["refs"] == [{"resource_type": "book", "resource_id": bid}]

        groups = tag_service.folders_for_tag(db, "gothic")
        assert groups[0]["items"] == [{"resource_type": "book", "resource_id": bid}]

    def test_container_child_padded_path_no_longer_matches(self):
        """The old workaround path (category dir doubled) resolves to nothing."""
        from backend.models import BookFolder

        db = _session()
        self._system(db, "cont", container_kind="family")
        self._system(db, "child", parent_id="cont")
        self._book(
            db,
            "child",
            "adventure",
            "books/Shadowrun/4 DE/adventures/Flusternetze/Maps/x.pdf",
            "x",
        )
        db.add(
            BookFolder(
                path="child/adventure/adventures/Flusternetze/Maps", tags=["Gothic"]
            )
        )
        db.commit()
        assert tag_service.folder_tags_in_use(db, "book") == {}

    def test_container_child_book_in_category_dir_has_no_folder(self):
        """A book directly in the category dir belongs to no folder, not a
        phantom one named after the category dir."""
        db = _session()
        self._system(db, "cont", container_kind="family")
        self._system(db, "child", parent_id="cont")
        assert (
            tag_service._book_folder_ancestor_paths(
                "child",
                "adventure",
                "books/Shadowrun/4 DE/adventures/SR4 Kampfhandbuch.pdf",
                3,
            )
            == set()
        )

    def test_top_level_system_unchanged(self):
        """Depth 2 keeps the previous behaviour exactly."""
        from backend.models import BookFolder

        db = _session()
        self._system(db, "top")
        bid = self._book(
            db, "top", "adventures", "books/Sys/adventures/curse/strahd.pdf", "strahd"
        )
        db.add(BookFolder(path="top/adventures/curse", tags=["Gothic"]))
        db.commit()
        ft = tag_service.folder_tags_in_use(db, "book")
        assert ft["gothic"]["refs"] == [{"resource_type": "book", "resource_id": bid}]
