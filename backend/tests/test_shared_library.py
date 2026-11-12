"""A container's shared shelf: ``books/<container>/shared-library/`` (issue #446).

Books that belong to a whole container rather than one of its systems - a
Forgotten Realms sourcebook beside the 5e and 5.5e editions - live in a reserved
``shared-library/`` folder. Its books sit on the container's own row, with the
same category folders as any system, and it is never a system of its own.
"""
import os
import shutil
import tempfile
import uuid
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.exc import OperationalError

from backend.config import LIBRARY_PATH, SessionLocal
from backend.indexer import scan_library
from backend.indexer.categories import (
    guess_category,
    holds_shared_library,
    is_shared_library_folder,
    slugify,
)
from backend.models import Book, FolderAccessRule, GameSystem, User, UserAccessGrant
from backend.models.access import SCOPE_SYSTEM
from backend.services import access_control as ac
from backend.services import library_fs as fs
from backend.services import tag_service

from .conftest import make_book, make_game_system


def _stamp() -> str:
    return uuid.uuid4().hex[:8]


def _touch(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"%PDF-1.4")


def _scan(lib: Path, tmp: str, **kw) -> None:
    db = SessionLocal()
    try:
        scan_library(str(lib), tmp, db, **kw)
    finally:
        db.close()


def _library(name: str, marker: str = ".parent-system-container") -> tuple[str, Path, Path]:
    """A temp library holding one container, ``name``, with two editions."""
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    root = lib / "books" / name
    root.mkdir(parents=True)
    (root / marker).write_text("")
    _touch(root / "5e" / "core" / "phb.pdf")
    _touch(root / "5.5e" / "core" / "phb24.pdf")
    return tmp, lib, root


def _slug(name: str) -> str:
    """The slug the scanner gives a top-level folder."""
    return slugify(name)


def _row(slug: str):
    db = SessionLocal()
    try:
        return db.query(GameSystem).filter_by(slug=slug).first()
    finally:
        db.close()


def _books_in(lib: Path) -> dict[str, Book]:
    db = SessionLocal()
    try:
        rows = db.query(Book).filter(Book.filepath.startswith(str(lib))).all()
        return {b.filename: b for b in rows}
    finally:
        db.close()


class TestHelpers:
    def test_the_name_is_reserved_in_shelves_of_systems(self):
        for kind in ("parent", "family", "publisher", "generic"):
            assert is_shared_library_folder("shared-library", kind)
            assert is_shared_library_folder("Shared-Library", kind)
            assert holds_shared_library(kind)

    def test_but_nowhere_else(self):
        assert not is_shared_library_folder("shared-library", "")
        assert not is_shared_library_folder("shared-library", None)
        assert not is_shared_library_folder("shared-library", "one-page")
        assert not is_shared_library_folder("shared-library", "agnostic")
        assert not is_shared_library_folder("shared", "parent")
        assert not holds_shared_library("one-page")
        assert not holds_shared_library("")


class TestScan:
    def test_shared_books_sit_on_the_container(self):
        name = f"Shared DnD {_stamp()}"
        tmp, lib, root = _library(name)
        _touch(root / "shared-library" / "core" / "realms.pdf")
        _touch(root / "shared-library" / "adventures" / "Sword Coast" / "mod.pdf")
        try:
            _scan(lib, tmp)
            container = _row(_slug(name))
            assert container is not None and container.container_kind == "parent"
            books = _books_in(lib)
            assert books["realms.pdf"].game_system_id == container.id
            assert books["realms.pdf"].category == "core"
            assert books["mod.pdf"].game_system_id == container.id
            assert books["mod.pdf"].category == guess_category(
                f"books/{name}/shared-library/adventures/Sword Coast/mod.pdf", system_depth=3
            )
            # The editions keep their own books.
            assert books["phb.pdf"].game_system_id != container.id
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_the_shelf_is_never_a_system(self):
        name = f"Shared NoSys {_stamp()}"
        tmp, lib, root = _library(name)
        _touch(root / "shared-library" / "core" / "realms.pdf")
        try:
            _scan(lib, tmp)
            slug = _slug(name)
            assert _row(f"{slug}--shared-library") is None
            assert _row(f"{slug}--5e") is not None
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_a_family_container_has_one_too(self):
        name = f"Shared Fam {_stamp()}"
        tmp, lib, root = _library(name, marker=".system-family-container")
        _touch(root / "shared-library" / "core" / "srd.pdf")
        try:
            _scan(lib, tmp)
            container = _row(_slug(name))
            assert _books_in(lib)["srd.pdf"].game_system_id == container.id
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_a_one_page_collection_keeps_it_as_a_game(self):
        name = f"Shared OnePage {_stamp()}"
        tmp, lib, root = _library(name, marker=".one-page-container")
        _touch(root / "shared-library" / "game.pdf")
        try:
            _scan(lib, tmp)
            assert _row(f"{_slug(name)}--shared-library") is not None
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_an_old_shared_library_system_is_folded_into_the_container(self):
        """Before the name was reserved, the folder scanned as a child system.

        Its books re-home onto the container and the empty row is pruned.
        """
        name = f"Shared Upgrade {_stamp()}"
        tmp, lib, root = _library(name)
        _touch(root / "shared-library" / "core" / "realms.pdf")
        slug = _slug(name)
        try:
            _scan(lib, tmp)
            container = _row(slug)
            book = _books_in(lib)["realms.pdf"]
            db = SessionLocal()
            try:
                old = GameSystem(
                    name=f"{name} shared-library",
                    slug=f"{slug}--shared-library",
                    parent_id=container.id,
                )
                db.add(old)
                db.commit()
                db.query(Book).filter_by(id=book.id).update({"game_system_id": old.id})
                db.commit()
            finally:
                db.close()
            _scan(lib, tmp)
            assert _books_in(lib)["realms.pdf"].game_system_id == container.id
            assert _row(f"{slug}--shared-library") is None
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def _old_shared_system(self, lib: Path, tmp: str, name: str, **fields) -> tuple[str, str]:
        """Scan, then put the shelf's books on a child system as an old release did.

        Returns the ids of the container and of the old child system.
        """
        slug = _slug(name)
        _scan(lib, tmp)
        container = _row(slug)
        db = SessionLocal()
        try:
            old = GameSystem(
                name=f"{name} shared-library",
                slug=f"{slug}--shared-library",
                parent_id=container.id,
                **fields,
            )
            db.add(old)
            db.commit()
            db.query(Book).filter(
                Book.game_system_id == container.id, Book.filepath.startswith(str(lib))
            ).update({"game_system_id": old.id}, synchronize_session=False)
            db.commit()
            return container.id, old.id
        finally:
            db.close()

    def _user(self, role: str) -> User:
        db = SessionLocal()
        try:
            user = User(username=f"{role}-{_stamp()}", hashed_password="x", role=role)
            db.add(user)
            db.commit()
            db.refresh(user)
            db.expunge(user)
            return user
        finally:
            db.close()

    def _rules(self, name: str) -> dict[str, str]:
        db = SessionLocal()
        try:
            rows = db.query(FolderAccessRule).filter(
                FolderAccessRule.path.startswith(f"books/{name}/")
            )
            return {r.path: r.level for r in rows}
        finally:
            db.close()

    def test_a_folded_system_keeps_its_access_level(self, client, player_headers):
        name = f"Shared Locked {_stamp()}"
        tmp, lib, root = _library(name)
        _touch(root / "shared-library" / "core" / "realms.pdf")
        try:
            self._old_shared_system(lib, tmp, name, access_level="admin")
            book_id = _books_in(lib)["realms.pdf"].id
            assert client.get(f"/api/books/{book_id}", headers=player_headers).status_code == 404

            _scan(lib, tmp)
            assert _row(f"{_slug(name)}--shared-library") is None
            assert self._rules(name) == {f"books/{name}/shared-library": "admin"}
            assert client.get(f"/api/books/{book_id}", headers=player_headers).status_code == 404
            db = SessionLocal()
            try:
                player, gm = self._user("player"), self._user("gm")
                assert book_id not in ac.visible_book_ids(db, player)
                assert book_id not in ac.visible_book_ids(db, gm)
                # The editions beside the shelf are untouched.
                assert _books_in(lib)["phb.pdf"].id in ac.visible_book_ids(db, player)
            finally:
                db.close()

            # A later scan, with the old row gone, changes nothing.
            _scan(lib, tmp)
            assert self._rules(name) == {f"books/{name}/shared-library": "admin"}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_a_stricter_rule_already_on_the_shelf_is_kept(self):
        name = f"Shared Ruled {_stamp()}"
        tmp, lib, root = _library(name)
        _touch(root / "shared-library" / "core" / "realms.pdf")
        try:
            self._old_shared_system(lib, tmp, name, access_level="gm")
            db = SessionLocal()
            try:
                db.add(FolderAccessRule(path=f"books/{name}/shared-library", level="admin"))
                db.commit()
            finally:
                db.close()
            _scan(lib, tmp)
            assert self._rules(name) == {f"books/{name}/shared-library": "admin"}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_an_open_folded_system_adds_no_restriction(self):
        name = f"Shared Open {_stamp()}"
        tmp, lib, root = _library(name)
        _touch(root / "shared-library" / "core" / "realms.pdf")
        try:
            self._old_shared_system(lib, tmp, name)
            _scan(lib, tmp)
            assert self._rules(name) == {}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_a_folded_systems_grants_move_to_the_container(self):
        name = f"Shared Granted {_stamp()}"
        tmp, lib, root = _library(name)
        _touch(root / "shared-library" / "core" / "realms.pdf")
        try:
            container_id, old_id = self._old_shared_system(lib, tmp, name, access_level="admin")
            granted, both, other = self._user("gm"), self._user("gm"), self._user("gm")
            db = SessionLocal()
            try:
                db.add_all(
                    [
                        UserAccessGrant(
                            user_id=granted.id, scope_type=SCOPE_SYSTEM, scope_id=old_id, level="admin"
                        ),
                        UserAccessGrant(
                            user_id=both.id, scope_type=SCOPE_SYSTEM, scope_id=old_id, level="admin"
                        ),
                        UserAccessGrant(
                            user_id=both.id, scope_type=SCOPE_SYSTEM, scope_id=container_id, level="gm"
                        ),
                    ]
                )
                db.commit()
            finally:
                db.close()

            _scan(lib, tmp)
            book_id = _books_in(lib)["realms.pdf"].id
            db = SessionLocal()
            try:
                assert db.query(UserAccessGrant).filter_by(scope_id=old_id).count() == 0
                grants = {
                    g.user_id: g.level
                    for g in db.query(UserAccessGrant).filter_by(
                        scope_type=SCOPE_SYSTEM, scope_id=container_id
                    )
                }
                assert grants == {granted.id: "admin", both.id: "admin"}
                assert book_id in ac.visible_book_ids(db, granted)
                assert book_id in ac.visible_book_ids(db, both)
                assert book_id not in ac.visible_book_ids(db, other)
            finally:
                db.close()
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_a_kept_old_system_does_not_restore_a_removed_rule(self):
        """A row kept for its description has no books left to carry a level for."""
        name = f"Shared Kept {_stamp()}"
        tmp, lib, root = _library(name)
        _touch(root / "shared-library" / "core" / "realms.pdf")
        try:
            self._old_shared_system(
                lib, tmp, name, access_level="gm", description="House rules shelf"
            )
            _scan(lib, tmp)
            assert _row(f"{_slug(name)}--shared-library") is not None
            db = SessionLocal()
            try:
                db.query(FolderAccessRule).filter_by(path=f"books/{name}/shared-library").delete()
                db.commit()
            finally:
                db.close()
            _scan(lib, tmp)
            assert self._rules(name) == {}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_a_shelf_whose_access_cannot_be_saved_is_left_for_the_next_scan(self):
        name = f"Shared Busy {_stamp()}"
        tmp, lib, root = _library(name)
        _touch(root / "shared-library" / "core" / "realms.pdf")
        try:
            _, old_id = self._old_shared_system(lib, tmp, name, access_level="admin")
            with patch(
                "backend.indexer.books.carry_old_system_access",
                side_effect=OperationalError("x", {}, Exception("locked")),
            ):
                _scan(lib, tmp, scope_path=f"books/{name}/shared-library")
            assert _books_in(lib)["realms.pdf"].game_system_id == old_id
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_a_rescan_scoped_to_the_shelf_reaches_its_books(self):
        name = f"Shared Scoped {_stamp()}"
        tmp, lib, root = _library(name)
        try:
            _scan(lib, tmp)
            _touch(root / "shared-library" / "core" / "late.pdf")
            _scan(lib, tmp, scope_path=f"books/{name}/shared-library")
            container = _row(_slug(name))
            assert _books_in(lib)["late.pdf"].game_system_id == container.id
            assert _row(f"{_slug(name)}--shared-library") is None
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class TestDepth:
    def test_a_container_reads_its_categories_inside_the_shelf(self):
        container = make_game_system(
            name=f"Depth {_stamp()}", slug=f"depth-{_stamp()}", container_kind="parent"
        )
        child = make_game_system(name=f"Child {_stamp()}", slug=f"child-{_stamp()}", parent_id=container.id)
        db = SessionLocal()
        try:
            assert tag_service.system_category_depth(db, container.id) == 3
            assert tag_service.system_category_depth(db, child.id) == 3
            depths = tag_service.system_category_depths(db)
            assert depths[container.id] == 3
        finally:
            db.close()

    def test_shared_books_group_by_their_folders_below_the_shelf(self, client, admin_headers):
        name = f"Shelf {_stamp()}"
        container = make_game_system(name=name, slug=f"shelf-{_stamp()}", container_kind="parent")
        make_game_system(name=f"{name} 5e", slug=f"shelf-5e-{_stamp()}", parent_id=container.id)
        make_book(
            container.id,
            title="Realms",
            filename="Realms.pdf",
            relative_path=f"books/{name}/shared-library/Core/Sword Coast/Realms.pdf",
            category="core",
        )
        resp = client.get(f"/api/systems/{container.id}/book-groups", headers=admin_headers)
        assert resp.status_code == 200, resp.text
        assert [(g["category"], g["path"]) for g in resp.json()["groups"]] == [
            ("core", "Sword Coast")
        ]
        summary = client.get(
            f"/api/systems/{container.id}", params={"include_books": "false"}, headers=admin_headers
        ).json()
        assert summary["book_count"] == 1
        assert summary["category_depth"] == 3
        assert summary["child_count"] == 1


class TestFileManager:
    def _tree(self) -> tuple[str, str]:
        stamp = _stamp()
        container = f"FM Shared {stamp}"
        root = os.path.join(LIBRARY_PATH, "books", container)
        os.makedirs(os.path.join(root, "shared-library", "Rulebooks"), exist_ok=True)
        os.makedirs(os.path.join(root, "5e", "core"), exist_ok=True)
        Path(root, ".parent-system-container").write_text("")
        return container, root

    def test_a_book_placed_on_the_shelf_belongs_to_the_container(self):
        container, root = self._tree()
        row = make_game_system(name=container, slug=_slug(container), container_kind="parent")
        try:
            db = SessionLocal()
            try:
                system_id, category = fs.resolve_book_placement(
                    db, fs.safe_join(f"books/{container}/shared-library/Rulebooks/x.pdf")
                )
            finally:
                db.close()
            assert system_id == row.id
            assert category == "core"
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_a_category_change_finds_the_shelfs_own_folder(self):
        """``Rulebooks`` inside the shelf is its core folder; no second "Core" appears."""
        container, root = self._tree()
        make_game_system(name=container, slug=_slug(container), container_kind="parent")
        try:
            db = SessionLocal()
            try:
                found = fs.category_folder_for(
                    db,
                    fs.safe_join(f"books/{container}/shared-library/Rulebooks/x.pdf"),
                    "core",
                    create=False,
                )
            finally:
                db.close()
            assert found is not None and found.name == "Rulebooks"
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_the_shelf_cannot_be_made_a_container(self):
        container, root = self._tree()
        try:
            assert not fs.accepts_container_kind(
                fs.safe_join(f"books/{container}/shared-library")
            )
            assert fs.accepts_container_kind(fs.safe_join(f"books/{container}/5e"))
        finally:
            shutil.rmtree(root, ignore_errors=True)
