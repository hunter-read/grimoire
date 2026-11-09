"""Folder access rules: restricting every book beneath a library folder (issue #772).

The centrepiece is ``test_filter_matches_resolver``, the folder-rule twin of the
one in ``test_access_control``: every combination of book level, system level,
category default and folder placement is created, and the SQL filter must
select exactly the books ``can_access_book`` allows.
"""
import json
import shutil
import uuid
from pathlib import Path

import pytest

from backend.config import LIBRARY_PATH, SessionLocal
from backend.models import (
    AppSetting,
    Book,
    CampaignResource,
    FolderAccessRule,
    GameSystem,
    UserAccessGrant,
)
from backend.models.access import (
    CATEGORY_DEFAULTS_KEY,
    LEVEL_ADMIN,
    LEVEL_GM,
    LEVEL_OPEN,
    SCOPE_SYSTEM,
)
from backend.services import access_control as ac
from backend.services import folder_access
from backend.services import library_fs as fs
from backend.services.folder_access import FolderAccessError, FolderRules

from .conftest import make_book, make_game_system


class _User:
    def __init__(self, role, id=None):
        self.role = role
        self.id = id or f"user-{uuid.uuid4()}"


@pytest.fixture
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture(autouse=True)
def clean_state(db):
    """Drop every rule, grant, category default and book this module made.

    Folder rules are global: one left behind would hide books in other modules.
    """
    before = {row[0] for row in db.query(Book.id).all()}
    yield
    db.query(FolderAccessRule).delete()
    db.query(AppSetting).filter_by(key=CATEGORY_DEFAULTS_KEY).delete()
    db.query(UserAccessGrant).delete()
    created = [row[0] for row in db.query(Book.id).all() if row[0] not in before]
    if created:
        db.query(CampaignResource).filter(CampaignResource.resource_id.in_(created)).delete(
            synchronize_session=False
        )
        db.query(Book).filter(Book.id.in_(created)).delete(synchronize_session=False)
    db.query(GameSystem).filter(GameSystem.access_level != "").update(
        {GameSystem.access_level: ""}, synchronize_session=False
    )
    db.commit()


@pytest.fixture
def shelf():
    """A unique system folder under books/ with Core/GM inside, removed after."""
    name = f"FolderAccess-{uuid.uuid4().hex[:8]}"
    root = Path(LIBRARY_PATH) / "books" / name
    (root / "Core" / "GM").mkdir(parents=True)
    system = make_game_system(name=name)
    yield {"name": name, "root": root, "rel": f"books/{name}", "system": system}
    shutil.rmtree(root, ignore_errors=True)


def _rule(db, path, level):
    db.add(FolderAccessRule(path=path, level=level))
    db.commit()


def _on_disk(shelf, rel_in_shelf, **kw):
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


# ---------------------------------------------------------------------------
# Paths and matching
# ---------------------------------------------------------------------------


class TestValidate:
    def test_normalises_the_path(self):
        assert folder_access.validate("\\books\\D&D/Core/GM/", "gm") == ("books/D&D/Core/GM", "gm")
        assert folder_access.validate("Armoury/40k/Core", "admin")[0] == "Armoury/40k/Core"

    @pytest.mark.parametrize(
        "path", ["books", "", "maps/Swamps", "books/../etc", "tokens/x", "/"]
    )
    def test_refuses_paths_outside_a_book_collection(self, path):
        with pytest.raises(FolderAccessError):
            folder_access.validate(path, "gm")

    @pytest.mark.parametrize("level", ["", "player", None, "inherit"])
    def test_refuses_anything_but_a_restricted_level(self, level):
        with pytest.raises(FolderAccessError):
            folder_access.validate("books/x", level)


class TestFolderRules:
    def test_strictest_covering_rule_wins(self):
        rules = FolderRules((("books/S", LEVEL_ADMIN), ("books/S/Core/GM", LEVEL_GM)))
        assert rules.level_for("books/S/Core/GM/dmg.pdf") == LEVEL_ADMIN
        assert rules.level_for("books/S/Core/phb.pdf") == LEVEL_ADMIN

    def test_matches_whole_folder_names_only(self):
        rules = FolderRules((("books/S/Core/GM", LEVEL_GM),))
        assert rules.level_for("books/S/Core/GM/dmg.pdf") == LEVEL_GM
        assert rules.level_for("books/S/Core/GM/Deep/x.pdf") == LEVEL_GM
        # A sibling sharing the prefix, a file named like the folder, and case.
        assert rules.level_for("books/S/Core/GM2/x.pdf") == LEVEL_OPEN
        assert rules.level_for("books/S/Core/GM.pdf") == LEVEL_OPEN
        assert rules.level_for("books/S/Core/gm/x.pdf") == LEVEL_OPEN
        assert rules.level_for("books\\S\\Core\\GM\\x.pdf") == LEVEL_GM
        assert rules.level_for("") == LEVEL_OPEN
        assert rules.level_for(None) == LEVEL_OPEN

    def test_load_skips_rows_without_a_restricted_level(self, db):
        _rule(db, "books/ok", LEVEL_GM)
        _rule(db, "books/bad", "nonsense")
        rules = folder_access.load(db)
        assert rules.rules == (("books/ok", LEVEL_GM),)
        assert rules and not FolderRules()
        assert rules.paths_at({LEVEL_ADMIN}) == []


# ---------------------------------------------------------------------------
# The cascade
# ---------------------------------------------------------------------------


class TestResolveLevel:
    def test_an_inheriting_book_takes_the_folder_level(self, db):
        _rule(db, "books/S/Core/GM", LEVEL_GM)
        book = make_book(make_game_system().id, relative_path="books/S/Core/GM/dmg.pdf")
        assert ac.resolve_level(db, book) == LEVEL_GM
        assert ac.can_access_book(db, _User("gm"), book)
        assert not ac.can_access_book(db, _User("player"), book)

    def test_a_folder_rule_never_lifts_a_system_or_category_level(self, db):
        _rule(db, "books/S/Core/GM", LEVEL_GM)
        system = make_game_system(access_level=LEVEL_ADMIN)
        book = make_book(system.id, relative_path="books/S/Core/GM/dmg.pdf")
        assert ac.resolve_level(db, book) == LEVEL_ADMIN

        db.add(AppSetting(key=CATEGORY_DEFAULTS_KEY, value=json.dumps({"adventure": LEVEL_ADMIN})))
        db.commit()
        book = make_book(
            make_game_system().id, relative_path="books/S/Core/GM/a.pdf", category="adventure"
        )
        assert ac.resolve_level(db, book) == LEVEL_ADMIN

    def test_a_stricter_folder_beats_a_system_level(self, db):
        _rule(db, "books/S/Core/GM", LEVEL_ADMIN)
        book = make_book(
            make_game_system(access_level=LEVEL_GM).id, relative_path="books/S/Core/GM/x.pdf"
        )
        assert ac.resolve_level(db, book) == LEVEL_ADMIN

    def test_the_books_own_level_overrides_the_folder(self, db):
        _rule(db, "books/S/Core/GM", LEVEL_ADMIN)
        system_id = make_game_system().id
        shared = make_book(system_id, relative_path="books/S/Core/GM/h.pdf", access_level=LEVEL_OPEN)
        assert ac.resolve_level(db, shared) == LEVEL_OPEN

    def test_effective_levels_batches_folder_rules(self, db):
        _rule(db, "books/S/Core/GM", LEVEL_GM)
        system_id = make_game_system().id
        inside = make_book(system_id, relative_path="books/S/Core/GM/x.pdf")
        outside = make_book(system_id, relative_path="books/S/Core/x.pdf")
        assert ac.effective_levels(db, [inside, outside]) == {
            inside.id: LEVEL_GM,
            outside.id: LEVEL_OPEN,
        }

    def test_a_system_grant_covers_folder_restricted_books(self, client, admin_headers, db):
        resp = client.post(
            "/api/users",
            json={"username": f"gm-{uuid.uuid4().hex[:8]}", "password": "accesstestpass123", "role": "gm"},
            headers=admin_headers,
        )
        gm = _User("gm", id=resp.json()["id"])
        _rule(db, "books/S/Core/GM", LEVEL_ADMIN)
        system = make_game_system()
        book = make_book(system.id, relative_path="books/S/Core/GM/x.pdf")
        assert not ac.can_access_book(db, gm, book)
        assert book.id not in ac.visible_book_ids(db, gm)

        db.add(UserAccessGrant(user_id=gm.id, scope_type=SCOPE_SYSTEM, scope_id=system.id, level=LEVEL_ADMIN))
        db.commit()
        assert ac.can_access_book(db, gm, book)
        assert book.id in ac.visible_book_ids(db, gm)


class TestVisibleBooksFilter:
    @pytest.mark.parametrize("role", ["admin", "gm", "player", "guest"])
    def test_filter_matches_resolver(self, db, role):
        """Exhaustive cross-check of the SQL filter against can_access_book."""
        stamp = uuid.uuid4().hex[:8]
        db.add(AppSetting(key=CATEGORY_DEFAULTS_KEY, value=json.dumps({"adventure": LEVEL_GM})))
        db.commit()
        base = f"books/F_{stamp}"
        _rule(db, f"{base}/gm", LEVEL_GM)
        _rule(db, f"{base}/admin", LEVEL_ADMIN)
        _rule(db, f"{base}/admin/gm", LEVEL_GM)
        # Names that are LIKE wildcards: a rule on "a_b" must not reach "aXb".
        _rule(db, f"{base}/a_b%", LEVEL_ADMIN)

        folders = ["", "gm/", "gm/deep/", "admin/", "admin/gm/", "a_b%/", "aXbY/", "gm2/", "GM/"]
        made = []
        for sys_level in (None, LEVEL_OPEN, LEVEL_GM, LEVEL_ADMIN):
            system_id = make_game_system(access_level=sys_level).id if sys_level else None
            for book_level in (None, LEVEL_OPEN, LEVEL_GM, LEVEL_ADMIN):
                for category in ("core", "adventure"):
                    for folder in folders:
                        made.append(
                            make_book(
                                system_id,
                                access_level=book_level,
                                category=category,
                                relative_path=f"{base}/{folder}{uuid.uuid4().hex[:6]}.pdf",
                            )
                        )

        user = _User(role)
        made_ids = {b.id for b in made}
        expected = {b.id for b in made if ac.can_access_book(db, user, b)}
        actual = {b.id for b in ac.visible_books(db, db.query(Book), user).all() if b.id in made_ids}
        assert actual == expected, f"role={role}: disagree on {sorted(actual ^ expected)}"
        if role in ("player", "guest"):
            # The rules did hide something, so the check above was not vacuous.
            assert len(expected) < len(made)


# ---------------------------------------------------------------------------
# Folder changes carry the rules
# ---------------------------------------------------------------------------


class TestRelinkAndPurge:
    def test_a_folder_rename_moves_its_rules(self, db, shelf):
        _rule(db, shelf["rel"] + "/Core/GM", LEVEL_GM)
        fs.rename_path(db, shelf["rel"] + "/Core/GM", "Game Master")
        db.commit()
        paths = {r.path for r in db.query(FolderAccessRule).all()}
        assert shelf["rel"] + "/Core/Game Master" in paths
        assert shelf["rel"] + "/Core/GM" not in paths

    def test_a_moved_book_stays_restricted(self, db, shelf):
        _rule(db, shelf["rel"] + "/Core/GM", LEVEL_GM)
        book = _on_disk(shelf, "Core/GM/dmg.pdf")
        (shelf["root"] / "Vault").mkdir()
        fs.move_paths(db, [shelf["rel"] + "/Core/GM"], shelf["rel"] + "/Vault")
        db.commit()
        moved = db.query(Book).filter_by(id=book.id).one()
        assert moved.relative_path == f"{shelf['rel']}/Vault/GM/dmg.pdf"
        assert ac.resolve_level(db, moved) == LEVEL_GM

    def test_the_stricter_rule_survives_a_collision(self, db):
        stamp = uuid.uuid4().hex[:8]
        _rule(db, f"books/src-{stamp}", LEVEL_ADMIN)
        _rule(db, f"books/dst-{stamp}", LEVEL_GM)
        _rule(db, f"books/src-{stamp}/x", LEVEL_GM)
        assert folder_access.relink_rules(db, f"books/src-{stamp}", f"books/dst-{stamp}") == 2
        db.commit()
        rows = db.query(FolderAccessRule).filter(FolderAccessRule.path.contains(stamp)).all()
        assert sorted((r.path, r.level) for r in rows) == [
            (f"books/dst-{stamp}", LEVEL_ADMIN),
            (f"books/dst-{stamp}/x", LEVEL_GM),
        ]
        assert folder_access.relink_rules(db, "", "books/x") == 0
        assert folder_access.relink_rules(db, "books/x", "books/x") == 0

    def test_relink_and_purge_leave_a_look_alike_folder_alone(self, db):
        stamp = uuid.uuid4().hex[:8]
        _rule(db, f"books/a_{stamp}/x", LEVEL_GM)
        _rule(db, f"books/aZ{stamp}/x", LEVEL_GM)
        assert folder_access.relink_rules(db, f"books/a_{stamp}", f"books/b{stamp}") == 1
        db.commit()
        assert folder_access.purge_rules(db, f"books/b{stamp}") == 1
        db.commit()
        left = [r.path for r in db.query(FolderAccessRule).filter(FolderAccessRule.path.contains(stamp))]
        assert left == [f"books/aZ{stamp}/x"]
        assert folder_access.purge_rules(db, "") == 0

    def test_deleting_a_folder_drops_its_rules(self, db, shelf):
        _rule(db, shelf["rel"] + "/Core/GM", LEVEL_GM)
        fs.delete_path(db, shelf["rel"] + "/Core/GM", confirm_name="GM")
        db.commit()
        assert db.query(FolderAccessRule).count() == 0


# ---------------------------------------------------------------------------
# The API
# ---------------------------------------------------------------------------

URL = "/api/settings/folder-access"


class TestApi:
    def test_save_list_and_delete(self, client, admin_headers, shelf):
        _on_disk(shelf, "Core/GM/dmg.pdf")
        _on_disk(shelf, "Core/phb.pdf")
        path = shelf["rel"] + "/Core/GM"
        r = client.put(URL, json={"path": path + "/", "level": "gm"}, headers=admin_headers)
        assert r.status_code == 200, r.text
        assert r.json() == {"path": path, "level": "gm", "exists": True, "books": 1}

        r = client.put(URL, json={"path": path, "level": "admin"}, headers=admin_headers)
        assert r.json()["level"] == "admin"
        assert client.get(URL, headers=admin_headers).json()["rules"] == [r.json()]

        assert client.delete(URL, params={"path": path}, headers=admin_headers).status_code == 200
        assert client.delete(URL, params={"path": path}, headers=admin_headers).status_code == 404

    def test_a_rule_whose_folder_is_gone_is_flagged(self, client, admin_headers, db):
        _rule(db, "books/no-such-folder-" + uuid.uuid4().hex[:8], LEVEL_GM)
        [rule] = client.get(URL, headers=admin_headers).json()["rules"]
        assert rule["exists"] is False and rule["books"] == 0

    def test_refusals(self, client, admin_headers, shelf):
        assert client.put(URL, json={"path": "maps/x", "level": "gm"}, headers=admin_headers).status_code == 400
        assert client.put(URL, json={"path": "books/../x", "level": "gm"}, headers=admin_headers).status_code == 400
        bad_level = client.put(URL, json={"path": shelf["rel"], "level": "player"}, headers=admin_headers)
        assert bad_level.status_code == 422
        missing = client.put(URL, json={"path": shelf["rel"] + "/Nope", "level": "gm"}, headers=admin_headers)
        assert missing.status_code == 404
        assert client.delete(URL, params={"path": "books/../x"}, headers=admin_headers).status_code == 400

    def test_admin_only(self, client, gm_headers, player_headers):
        assert client.get(URL, headers=gm_headers).status_code == 403
        assert client.put(URL, json={"path": "books/x", "level": "gm"}, headers=gm_headers).status_code == 403
        assert client.delete(URL, params={"path": "books/x"}, headers=player_headers).status_code == 403

    def test_players_stop_seeing_the_folder(self, client, admin_headers, player_headers, gm_headers, shelf):
        book = _on_disk(shelf, "Core/GM/dmg.pdf")
        assert client.get(f"/api/books/{book.id}", headers=player_headers).status_code == 200
        client.put(URL, json={"path": shelf["rel"] + "/Core/GM", "level": "gm"}, headers=admin_headers)
        assert client.get(f"/api/books/{book.id}", headers=player_headers).status_code == 404
        detail = client.get(f"/api/books/{book.id}", headers=gm_headers)
        assert detail.status_code == 200
        assert detail.json()["effective_access_level"] == "gm"

    def test_saving_demotes_campaign_shares(self, client, admin_headers, db, shelf):
        restricted = _on_disk(shelf, "Core/GM/dmg.pdf")
        shared = _on_disk(shelf, "Core/GM/handout.pdf", access_level=LEVEL_OPEN)
        outside = _on_disk(shelf, "Core/phb.pdf")
        campaign = client.post("/api/campaigns", json={"name": "Folder access"}, headers=admin_headers).json()
        for book in (restricted, shared, outside):
            db.add(
                CampaignResource(
                    campaign_id=campaign["id"], resource_type="book", resource_id=book.id, visibility="public"
                )
            )
        db.commit()

        client.put(URL, json={"path": shelf["rel"] + "/Core/GM", "level": "gm"}, headers=admin_headers)
        db.expire_all()
        visibility = {
            r.resource_id: r.visibility
            for r in db.query(CampaignResource).filter_by(campaign_id=campaign["id"])
        }
        assert visibility == {restricted.id: "gm", shared.id: "public", outside.id: "public"}
        client.delete(f"/api/campaigns/{campaign['id']}", headers=admin_headers)


class TestRecategorising:
    """A category change moves the file, so it must not carry a book out of a rule."""

    def test_a_gm_cannot_move_a_book_out_of_a_restricted_folder(self, client, gm_headers, db, shelf):
        book = _on_disk(shelf, "Core/GM/dmg.pdf")
        _rule(db, shelf["rel"] + "/Core/GM", LEVEL_GM)
        r = client.patch(f"/api/books/{book.id}", json={"category": "supplement"}, headers=gm_headers)
        assert r.status_code == 403
        assert (shelf["root"] / "Core" / "GM" / "dmg.pdf").is_file()

    def test_a_rule_on_the_system_folder_goes_wherever_the_book_does(self, client, gm_headers, db, shelf):
        book = _on_disk(shelf, "Core/GM/dmg.pdf")
        _rule(db, shelf["rel"], LEVEL_GM)
        r = client.patch(f"/api/books/{book.id}", json={"category": "supplement"}, headers=gm_headers)
        assert r.status_code == 200, r.text
        db.expire_all()
        moved = db.query(Book).filter_by(id=book.id).one()
        assert ac.resolve_level(db, moved) == LEVEL_GM

    def test_a_book_outside_any_system_folder_is_judged_without_folders(self, db):
        from backend.routers.books._helpers import _moved_relative_path

        assert _moved_relative_path(db, Book(filepath="", filename="x.pdf")) == ""
        assert _moved_relative_path(db, Book(filepath="/elsewhere/x.pdf", filename="x.pdf")) == ""
