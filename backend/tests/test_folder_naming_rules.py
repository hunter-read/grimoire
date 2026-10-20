"""Folder naming patterns: reading titles out of filenames and renaming onto them.

Issues #521 (titles from structured filenames) and #522 (filenames from
metadata). The renames go through ``library_fs.rename_path``, so the assertions
that matter check the record kept its id, not just that a file changed name.
"""
import os
import shutil
import tempfile
import uuid
from pathlib import Path

import pytest

from backend.config import LIBRARY_PATH, SessionLocal
from backend.indexer import scan_library
from backend.models import Book, FolderNamingRule
from backend.services import library_fs as fs
from backend.services.filename_rules import folders, renames
from backend.services.filename_rules.pattern import PatternError, parse

from .conftest import make_book, make_game_system

LIB = LIBRARY_PATH

READ = "{system} - [{publisher}] - {*} - {title}< (v{version}, {year})>"
WRITE = "[{publisher}] {title}< ({year})>"


@pytest.fixture
def shelf():
    """A unique system folder under books/, with its rules cleaned up after."""
    name = f"Naming-{uuid.uuid4().hex[:8]}"
    root = Path(LIB) / "books" / name
    (root / "Adventures").mkdir(parents=True)
    system = make_game_system(name=name)
    yield {"name": name, "root": root, "rel": f"books/{name}", "system": system}
    shutil.rmtree(root, ignore_errors=True)
    db = SessionLocal()
    db.query(FolderNamingRule).filter(FolderNamingRule.path.startswith(f"books/{name}")).delete(
        synchronize_session=False
    )
    db.query(Book).filter(Book.relative_path.startswith(f"books/{name}/")).delete(
        synchronize_session=False
    )
    db.commit()
    db.close()


def _book(shelf, rel_in_shelf: str, **kw) -> Book:
    path = shelf["root"] / rel_in_shelf
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"grimoire-test-fixture")
    return make_book(
        shelf["system"].id,
        filename=path.name,
        filepath=str(path),
        relative_path=f"{shelf['rel']}/{rel_in_shelf}",
        **kw,
    )


def _set_rule(path: str, pattern: str) -> None:
    db = SessionLocal()
    db.add(FolderNamingRule(path=path, pattern=pattern))
    db.commit()
    db.close()


def _get(book_id: str) -> Book:
    db = SessionLocal()
    book = db.query(Book).filter_by(id=book_id).first()
    db.expunge(book)
    db.close()
    return book


class TestRuleSet:
    def test_nearest_folder_wins(self):
        rules = folders.RuleSet(
            [
                folders.FolderRule("books/A", parse("{title}")),
                folders.FolderRule("books/A/B", parse("x {title}")),
            ]
        )
        assert rules.for_book("books/A/B/c.pdf").path == "books/A/B"
        assert rules.for_book("books/A/c.pdf").path == "books/A"
        assert rules.for_book("books/AB/c.pdf") is None
        assert rules.for_book("books\\A\\c.pdf").path == "books/A"

    def test_an_unparsable_stored_pattern_is_skipped(self, shelf):
        _set_rule(shelf["rel"], "{nope}")
        db = SessionLocal()
        rules = folders.rule_set(db)
        db.close()
        assert all(r.path != shelf["rel"] for r in rules.rules)

    def test_read_filename_without_a_rule_is_empty(self):
        assert folders.read_filename(folders.RuleSet([]), "books/x/y.pdf", "y.pdf") == {}

    def test_normalise_path(self):
        assert folders.normalise_path("\\books//A/./B/") == "books/A/B"
        with pytest.raises(PatternError):
            folders.normalise_path("books/../etc")


class TestEndpoints:
    def test_save_list_and_delete(self, client, admin_headers, shelf):
        r = client.put(
            "/api/naming/folders",
            json={"path": shelf["rel"] + "/", "pattern": READ},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json() == {
            "path": shelf["rel"], "pattern": READ, "exists": True, "renderable": False, "error": None,
        }
        # Saving again replaces the pattern in place.
        r = client.put(
            "/api/naming/folders", json={"path": shelf["rel"], "pattern": WRITE}, headers=admin_headers
        )
        assert r.json()["renderable"] is True

        body = client.get("/api/naming/folders", headers=admin_headers).json()
        mine = [x for x in body["rules"] if x["path"] == shelf["rel"]]
        assert mine == [r.json()]
        assert "title" in body["fields"] and "system" not in body["read_fields"]

        r = client.delete("/api/naming/folders", params={"path": shelf["rel"]}, headers=admin_headers)
        assert r.status_code == 200
        r = client.delete("/api/naming/folders", params={"path": shelf["rel"]}, headers=admin_headers)
        assert r.status_code == 404

    def test_list_flags_a_missing_folder_and_a_broken_pattern(self, client, admin_headers, shelf):
        _set_rule(shelf["rel"] + "/Gone", "{bad}")
        body = client.get("/api/naming/folders", headers=admin_headers).json()
        row = next(x for x in body["rules"] if x["path"] == shelf["rel"] + "/Gone")
        assert row["exists"] is False
        assert "Unknown field" in row["error"]

    @pytest.mark.parametrize(
        "path, pattern, status",
        [
            ("maps/x", "{title}", 400),
            ("books/does-not-exist-anywhere", "{title}", 404),
            ("books/../x", "{title}", 400),
        ],
    )
    def test_save_rejects(self, client, admin_headers, path, pattern, status):
        r = client.put("/api/naming/folders", json={"path": path, "pattern": pattern}, headers=admin_headers)
        assert r.status_code == status

    def test_save_rejects_a_bad_pattern(self, client, admin_headers, shelf):
        r = client.put(
            "/api/naming/folders", json={"path": shelf["rel"], "pattern": "{nope}"}, headers=admin_headers
        )
        assert r.status_code == 400
        assert "Unknown field" in r.json()["detail"]

    def test_delete_rejects_a_bad_path(self, client, admin_headers):
        r = client.delete("/api/naming/folders", params={"path": "books/../x"}, headers=admin_headers)
        assert r.status_code == 400

    def test_admin_only(self, client, gm_headers):
        assert client.get("/api/naming/folders", headers=gm_headers).status_code == 403

    def test_preview_errors_are_400(self, client, admin_headers, shelf):
        # No saved pattern, and none supplied.
        r = client.post("/api/naming/preview", json={"path": shelf["rel"]}, headers=admin_headers)
        assert r.status_code == 400
        r = client.post("/api/naming/preview", json={"path": "maps", "pattern": "{title}"}, headers=admin_headers)
        assert r.status_code == 400
        for route in ("/api/naming/apply-titles", "/api/naming/rename"):
            r = client.post(route, json={"path": shelf["rel"], "ids": []}, headers=admin_headers)
            assert r.status_code == 400


class TestPreview:
    def test_reads_and_proposes(self, client, admin_headers, shelf):
        book = _book(
            shelf,
            "Adventures/X - [Loot Tavern] - adventure - Crystallica (v0.99, 2026).pdf",
            title="X   [Loot Tavern]   adventure   Crystallica (v0.99, 2026)",
        )
        other = _book(shelf, "Adventures/unstructured.pdf", title="unstructured")
        r = client.post(
            "/api/naming/preview", json={"path": shelf["rel"], "pattern": READ}, headers=admin_headers
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 2 and body["renderable"] is False and body["truncated"] is False
        rows = {row["id"]: row for row in body["rows"]}
        assert rows[book.id]["read"]["title"] == "Crystallica"
        assert rows[book.id]["title_status"] == "change"
        assert rows[book.id]["rename_status"] == "unavailable"
        assert rows[other.id]["title_status"] == "no_match"

    def test_a_nearer_rule_takes_its_books_away(self, shelf):
        _book(shelf, "top.pdf")
        _book(shelf, "Adventures/deep.pdf")
        _set_rule(shelf["rel"] + "/Adventures", "{title}")
        db = SessionLocal()
        body = renames.preview(db, shelf["rel"], "{title}")
        db.close()
        assert [row["filename"] for row in body["rows"]] == ["top.pdf"]

    def test_an_underscore_in_the_folder_is_not_a_wildcard(self, shelf):
        """`_` is a LIKE wildcard; `Sys_A` must not sweep in `SysXA`'s books."""
        _book(shelf, "Sys_A/mine.pdf")
        _book(shelf, "SysXA/theirs.pdf")
        db = SessionLocal()
        body = renames.preview(db, shelf["rel"] + "/Sys_A", "{title}")
        db.close()
        assert [row["filename"] for row in body["rows"]] == ["mine.pdf"]

    def test_rename_statuses(self, shelf):
        ok = _book(shelf, "a.pdf", title="Alpha", publisher="Pub", year=2020)
        same = _book(shelf, "[Pub] Beta.pdf", title="Beta", publisher="Pub")
        missing = _book(shelf, "c.pdf", title="Gamma")
        clash_a = _book(shelf, "d1.pdf", title="Delta", publisher="Pub")
        clash_b = _book(shelf, "d2.pdf", title="Delta", publisher="Pub")
        on_disk = _book(shelf, "e.pdf", title="Eps", publisher="Pub")
        (shelf["root"] / "[Pub] Eps.pdf").write_bytes(b"x")
        long_one = _book(shelf, "f.pdf", title="L" * 300, publisher="Pub")
        sep = _book(shelf, "g.pdf", title="A] B", publisher="Pub")

        db = SessionLocal()
        rows = {r["id"]: r for r in renames.preview(db, shelf["rel"], WRITE)["rows"]}
        db.close()
        assert rows[ok.id]["rename_status"] == "ok"
        assert rows[ok.id]["proposed"] == "[Pub] Alpha (2020).pdf"
        assert rows[same.id]["rename_status"] == "same"
        assert rows[missing.id]["rename_status"] == "missing"
        assert rows[missing.id]["missing"] == ["publisher"]
        assert {rows[clash_a.id]["rename_status"], rows[clash_b.id]["rename_status"]} == {"ok", "conflict"}
        assert rows[on_disk.id]["rename_status"] == "conflict"
        assert rows[long_one.id]["rename_status"] == "too_long"
        assert rows[long_one.id]["long_path"] is True
        assert rows[sep.id]["reads_back"] is True
        assert rows[ok.id]["path_length"] > 0

    def test_category_and_date_values(self, shelf):
        book = _book(shelf, "a.pdf", title="T", category="adventure", year=2024, month=5, day=1)
        db = SessionLocal()
        row = renames.preview(db, shelf["rel"], "{category} - {title} - {date}")["rows"][0]
        db.close()
        assert row["id"] == book.id
        assert row["proposed"] == "Adventures - T - 2024-05-01.pdf"


class TestApplyTitles:
    def test_overwrites_the_title_and_fills_only_blank_fields(self, client, admin_headers, shelf):
        book = _book(
            shelf,
            "Sys - [Loot Tavern] - adventure - Crystallica (v0.99, 2026).pdf",
            title="raw name",
            publisher="",
            year=1999,
        )
        same = _book(shelf, "Sys - [P] - x - Same.pdf", title="Same", publisher="P")
        nomatch = _book(shelf, "plain.pdf", title="plain")
        _set_rule(shelf["rel"], READ)
        r = client.post(
            "/api/naming/apply-titles",
            json={"path": shelf["rel"], "ids": [book.id, same.id, nomatch.id]},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["updated"] == [book.id]
        assert {s["id"]: s["reason"] for s in body["skipped"]} == {same.id: "same", nomatch.id: "no_match"}
        fresh = _get(book.id)
        assert fresh.title == "Crystallica"
        assert fresh.publisher == "Loot Tavern"
        assert fresh.version == "0.99"
        # A year the book already had is not overwritten by the filename's.
        assert fresh.year == 1999


class TestApplyRenames:
    def test_renames_selected_books_and_keeps_their_ids(self, client, admin_headers, shelf):
        book = _book(shelf, "Adventures/raw.pdf", title="Curse: Reloaded", publisher="Pub")
        untouched = _book(shelf, "Adventures/other.pdf", title="Other", publisher="Pub")
        blocked = _book(shelf, "Adventures/blocked.pdf", title="Blocked")
        _set_rule(shelf["rel"], WRITE)
        r = client.post(
            "/api/naming/rename",
            json={"path": shelf["rel"], "ids": [book.id, blocked.id]},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["renamed"] == [
            {
                "id": book.id,
                "from": f"{shelf['rel']}/Adventures/raw.pdf",
                "to": f"{shelf['rel']}/Adventures/[Pub] Curse - Reloaded.pdf",
            }
        ]
        assert body["skipped"] == [{"id": blocked.id, "reason": "missing", "detail": None}]
        fresh = _get(book.id)
        assert fresh.filename == "[Pub] Curse - Reloaded.pdf"
        assert (shelf["root"] / "Adventures" / "[Pub] Curse - Reloaded.pdf").is_file()
        assert _get(untouched.id).filename == "other.pdf"

    def test_a_wildcard_pattern_cannot_rename(self, shelf):
        _set_rule(shelf["rel"], READ)
        db = SessionLocal()
        with pytest.raises(PatternError):
            renames.apply_renames(db, shelf["rel"], [])
        db.close()

    def test_a_filesystem_failure_is_reported_per_book(self, shelf, monkeypatch):
        book = _book(shelf, "raw.pdf", title="T", publisher="P")
        other = _book(shelf, "raw2.pdf", title="U", publisher="P")
        _set_rule(shelf["rel"], WRITE)

        def boom(db, source, name):
            if source.endswith("raw.pdf"):
                raise fs.LibraryFSError("read-only", code="read_only")
            raise OSError("disk on fire")

        monkeypatch.setattr(fs, "rename_path", boom)
        db = SessionLocal()
        result = renames.apply_renames(db, shelf["rel"], [book.id, other.id])
        db.close()
        reasons = {s["id"]: s["reason"] for s in result["skipped"]}
        assert reasons == {book.id: "read_only", other.id: "io_error"}

    def test_a_case_only_rename_is_not_a_conflict(self, shelf):
        src = shelf["root"] / "crystallica.pdf"
        src.write_bytes(b"x")
        db = SessionLocal()
        result = fs.rename_path(db, f"{shelf['rel']}/crystallica.pdf", "Crystallica.pdf")
        db.close()
        assert result["to"].endswith("Crystallica.pdf")
        assert "Crystallica.pdf" in os.listdir(shelf["root"])


class TestFolderChangesCarryRules:
    def test_a_folder_rename_moves_its_rules(self, shelf):
        _set_rule(shelf["rel"] + "/Adventures", "{title}")
        db = SessionLocal()
        fs.rename_path(db, shelf["rel"] + "/Adventures", "Modules")
        paths = {r.path for r in db.query(FolderNamingRule).all()}
        db.close()
        assert shelf["rel"] + "/Modules" in paths
        assert shelf["rel"] + "/Adventures" not in paths

    def test_a_rule_already_on_the_destination_wins(self):
        db = SessionLocal()
        stamp = uuid.uuid4().hex[:8]
        db.add_all(
            [
                FolderNamingRule(path=f"books/src-{stamp}", pattern="{title}"),
                FolderNamingRule(path=f"books/dst-{stamp}", pattern="x {title}"),
            ]
        )
        db.commit()
        assert folders.relink_rules(db, f"books/src-{stamp}", f"books/dst-{stamp}") == 1
        db.commit()
        rows = db.query(FolderNamingRule).filter(FolderNamingRule.path.contains(stamp)).all()
        assert [(r.path, r.pattern) for r in rows] == [(f"books/dst-{stamp}", "x {title}")]
        assert folders.relink_rules(db, "", "books/x") == 0
        db.query(FolderNamingRule).filter(FolderNamingRule.path.contains(stamp)).delete(
            synchronize_session=False
        )
        db.commit()
        db.close()

    def test_relink_and_purge_leave_a_look_alike_folder_alone(self):
        stamp = uuid.uuid4().hex[:8]
        db = SessionLocal()
        db.add_all(
            [
                FolderNamingRule(path=f"books/a_{stamp}/x", pattern="{title}"),
                FolderNamingRule(path=f"books/aZ{stamp}/x", pattern="{title}"),
            ]
        )
        db.commit()
        assert folders.relink_rules(db, f"books/a_{stamp}", f"books/b{stamp}") == 1
        db.commit()
        assert folders.purge_rules(db, f"books/b{stamp}") == 1
        db.commit()
        left = [r.path for r in db.query(FolderNamingRule).filter(FolderNamingRule.path.contains(stamp))]
        assert left == [f"books/aZ{stamp}/x"]
        db.query(FolderNamingRule).filter(FolderNamingRule.path.contains(stamp)).delete(
            synchronize_session=False
        )
        db.commit()
        db.close()

    def test_deleting_a_folder_drops_its_rules(self, shelf):
        _set_rule(shelf["rel"] + "/Adventures", "{title}")
        db = SessionLocal()
        fs.delete_path(db, shelf["rel"] + "/Adventures", confirm_name="Adventures")
        assert db.query(FolderNamingRule).filter_by(path=shelf["rel"] + "/Adventures").count() == 0
        assert folders.purge_rules(db, "") == 0
        db.close()


class TestScanReadsThePattern:
    def test_a_new_book_takes_its_title_from_the_folders_pattern(self):
        tmp = tempfile.mkdtemp()
        lib = Path(tmp) / "library"
        name = f"Scan-{uuid.uuid4().hex[:8]}"
        folder = lib / "books" / name / "Adventures"
        folder.mkdir(parents=True)
        (folder / f"{name} - [Loot Tavern] - adventure - Crystallica (v0.99, 2026).png").write_bytes(
            b"\x89PNG\r\n\x1a\n"
        )
        (folder / "loose name.png").write_bytes(b"\x89PNG\r\n\x1a\n")
        _set_rule(f"books/{name}", READ)
        db = SessionLocal()
        try:
            scan_library(str(lib), tmp, db)
            books = {
                b.filename: (b.title, b.publisher, b.version, b.year)
                for b in db.query(Book).filter(Book.relative_path.startswith(f"books/{name}/")).all()
            }
        finally:
            db.query(FolderNamingRule).filter_by(path=f"books/{name}").delete()
            db.commit()
            db.close()
            shutil.rmtree(tmp, ignore_errors=True)
        structured = next(b for f, b in books.items() if f.startswith(name))
        assert structured == ("Crystallica", "Loot Tavern", "0.99", 2026)
        assert books["loose name.png"][0] == "loose name"
