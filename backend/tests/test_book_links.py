"""A book shown on a second system's shelf (issue #446).

``POST /books/{id}/systems`` links a book onto another system's shelf like a
symlink: one file and one row, listed in both places, with everything about it
read from the book itself. The links survive rescans because they are keyed on
the book, and they never show the book to anyone who could not already open it.
"""
import uuid

from backend.config import SessionLocal
from backend.models import Book, BookSystemLink
from backend.services import book_links

from .conftest import make_book, make_game_system


def _uid(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


def _system(**kwargs):
    name = _uid("Sys")
    return make_game_system(name=name, slug=name.lower(), **kwargs)


def _book(system, title=None, sub="", **kwargs):
    title = title or _uid("Book")
    folder = f"{sub}/" if sub else ""
    return make_book(
        system.id,
        title=title,
        filename=f"{title}.pdf",
        relative_path=f"books/{system.name}/Core/{folder}{title}.pdf",
        category="core",
        **kwargs,
    )


def _link(client, headers, book, system):
    return client.post(
        f"/api/books/{book.id}/systems", json={"system_id": system.id}, headers=headers
    )


def _titles(resp) -> list:
    assert resp.status_code == 200, resp.text
    return [b["title"] for b in resp.json()["books"]]


class TestLinking:
    def test_a_gm_links_a_book_onto_another_shelf(self, client, gm_headers):
        home, other = _system(), _system()
        book = _book(home)
        resp = _link(client, gm_headers, book, other)
        assert resp.status_code == 200, resp.text
        assert [s["id"] for s in resp.json()] == [other.id]
        listed = client.get(f"/api/books/{book.id}/systems", headers=gm_headers).json()
        assert [s["name"] for s in listed] == [other.name]
        detail = client.get(f"/api/books/{book.id}", headers=gm_headers).json()
        assert [s["id"] for s in detail["linked_systems"]] == [other.id]
        assert detail["game_system"]["id"] == home.id

    def test_linking_twice_is_a_no_op(self, client, gm_headers):
        home, other = _system(), _system()
        book = _book(home)
        _link(client, gm_headers, book, other)
        resp = _link(client, gm_headers, book, other)
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_the_books_own_system_is_refused(self, client, gm_headers):
        home = _system()
        book = _book(home)
        assert _link(client, gm_headers, book, home).status_code == 400

    def test_a_version_is_refused(self, client, gm_headers):
        home, other = _system(), _system()
        main = _book(home)
        version = _book(home, variant_parent_id=main.id, variant_kind="printer-friendly")
        assert _link(client, gm_headers, version, other).status_code == 400

    def test_the_library_and_the_armory_do_not_mix(self, client, gm_headers):
        home, wargame = _system(), _system(game_type="wargame")
        book = _book(home)
        resp = _link(client, gm_headers, book, wargame)
        assert resp.status_code == 400
        assert "wargame" in resp.json()["detail"]

    def test_a_player_cannot_link(self, client, player_headers):
        home, other = _system(), _system()
        assert _link(client, player_headers, _book(home), other).status_code == 403

    def test_an_unknown_system_is_404(self, client, gm_headers):
        book = _book(_system())
        resp = client.post(
            f"/api/books/{book.id}/systems", json={"system_id": "nope"}, headers=gm_headers
        )
        assert resp.status_code == 404

    def test_unlinking(self, client, gm_headers):
        home, other = _system(), _system()
        book = _book(home)
        _link(client, gm_headers, book, other)
        resp = client.delete(f"/api/books/{book.id}/systems/{other.id}", headers=gm_headers)
        assert resp.status_code == 200 and resp.json() == []
        again = client.delete(f"/api/books/{book.id}/systems/{other.id}", headers=gm_headers)
        assert again.status_code == 404


class TestShelf:
    def test_a_linked_book_stands_on_the_other_shelf(self, client, admin_headers):
        home, other = _system(), _system()
        book = _book(home, title="Midgard", sub="Setting/Deep")
        _book(other, title="Own")
        _link(client, admin_headers, book, other)

        groups = client.get(f"/api/systems/{other.id}/book-groups", headers=admin_headers).json()
        assert groups["total"] == 2
        # Another system's folders mean nothing here: the category's top level.
        assert sorted((g["category"], g["path"], g["count"]) for g in groups["groups"]) == [
            ("core", "", 1),
            ("core", "", 1),
        ]
        assert {g["dir"] for g in groups["groups"]} == {f"books/{other.name}/Core", ""}

        root = client.get(
            f"/api/systems/{other.id}/books",
            params={"category": "core", "folder": ""},
            headers=admin_headers,
        )
        assert sorted(_titles(root)) == ["Midgard", "Own"]
        rows = {b["title"]: b for b in root.json()["books"]}
        assert rows["Midgard"]["is_linked"] is True
        assert rows["Midgard"]["linked_from"]["id"] == home.id
        assert rows["Midgard"]["game_system_id"] == home.id
        assert rows["Own"]["is_linked"] is False
        assert rows["Own"]["linked_from"] is None

        # A subfolder of the other shelf does not pick it up.
        sub = client.get(
            f"/api/systems/{other.id}/books",
            params={"category": "core", "folder": "Setting"},
            headers=admin_headers,
        )
        assert _titles(sub) == []

    def test_it_stays_on_its_own_shelf_unmarked(self, client, admin_headers):
        home, other = _system(), _system()
        book = _book(home, title="Stays", sub="Setting")
        _link(client, admin_headers, book, other)
        groups = client.get(f"/api/systems/{home.id}/book-groups", headers=admin_headers).json()
        assert [(g["category"], g["path"]) for g in groups["groups"]] == [("core", "Setting")]
        own = client.get(
            f"/api/systems/{home.id}/books",
            params={"category": "core", "folder": "Setting"},
            headers=admin_headers,
        ).json()["books"]
        assert own[0]["is_linked"] is False

    def test_counts_and_the_full_system_include_it(self, client, admin_headers):
        home, other = _system(), _system()
        book = _book(home, page_count=40)
        _book(other, page_count=10)
        _link(client, admin_headers, book, other)
        listed = {
            s["id"]: s for s in client.get("/api/systems", headers=admin_headers).json()
        }
        assert listed[other.id]["book_count"] == 2
        assert listed[other.id]["total_page_count"] == 50
        assert listed[home.id]["book_count"] == 1
        full = client.get(f"/api/systems/{other.id}", headers=admin_headers).json()
        assert full["book_count"] == 2
        assert {b["title"]: b["is_linked"] for b in full["books"]}[book.title] is True
        summary = client.get(
            f"/api/systems/{other.id}", params={"include_books": "false"}, headers=admin_headers
        ).json()
        assert summary["book_count"] == 2

    def test_a_container_child_count_includes_it(self, client, admin_headers):
        container = _system(container_kind="parent")
        child = make_game_system(name=_uid("Ed"), slug=_uid("ed"), parent_id=container.id)
        book = _book(_system())
        _link(client, admin_headers, book, child)
        body = client.get(f"/api/systems/{container.id}", headers=admin_headers).json()
        assert {c["id"]: c["book_count"] for c in body["children"]}[child.id] == 1

    def test_the_book_list_by_system_includes_it(self, client, admin_headers):
        home, other = _system(), _system()
        book = _book(home)
        _link(client, admin_headers, book, other)
        resp = client.get("/api/books", params={"system_id": other.id}, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        assert book.id in {b["id"] for b in resp.json()["books"]}

    def test_the_facets_cover_it(self, client, admin_headers):
        home, other = _system(), _system()
        book = _book(home, genres=["Horror"])
        _link(client, admin_headers, book, other)
        facets = client.get(f"/api/systems/{other.id}/book-facets", headers=admin_headers).json()
        assert facets["genres"] == ["Horror"]


class TestAccess:
    def test_a_link_never_shows_a_book_its_reader_cannot_open(self, client, admin_headers, player_headers):
        home, other = _system(), _system()
        hidden = _book(home, access_level="gm")
        _link(client, admin_headers, hidden, other)
        resp = client.get(
            f"/api/systems/{other.id}/books",
            params={"category": "core", "folder": ""},
            headers=player_headers,
        )
        assert hidden.id not in {b["id"] for b in resp.json()["books"]}
        listed = {s["id"]: s for s in client.get("/api/systems", headers=player_headers).json()}
        assert listed.get(other.id, {"book_count": 0})["book_count"] == 0

    def test_a_hidden_home_system_is_not_named(self, client, admin_headers, player_headers):
        home, other = _system(access_level="gm"), _system()
        # An explicitly open book inside a GM-only system: players may open it,
        # but must not learn the system it lives in.
        book = _book(home, access_level="")
        _link(client, admin_headers, book, other)
        rows = client.get(
            f"/api/systems/{other.id}/books",
            params={"category": "core", "folder": ""},
            headers=player_headers,
        ).json()["books"]
        row = next(b for b in rows if b["id"] == book.id)
        assert row["is_linked"] is True
        assert row["linked_from"] is None

    def test_a_restricted_target_is_hidden_from_the_books_list(self, client, admin_headers, player_headers):
        home, secret = _system(), _system(access_level="gm")
        book = _book(home)
        _link(client, admin_headers, book, secret)
        listed = client.get(f"/api/books/{book.id}/systems", headers=player_headers)
        assert listed.status_code == 200
        assert listed.json() == []

    def test_a_guest_cannot_list_links(self, client, admin_headers):
        book = _book(_system())
        # No session at all is refused before the guest check, which is enough
        # to show the route is not open; the guest inventory test covers guests.
        assert client.get(f"/api/books/{book.id}/systems").status_code == 401


class TestCascade:
    def test_deleting_the_book_or_the_system_drops_its_links(self, client, admin_headers):
        home, other, third = _system(), _system(), _system()
        book = _book(home)
        _link(client, admin_headers, book, other)
        _link(client, admin_headers, book, third)
        db = SessionLocal()
        try:
            from backend.models import GameSystem

            db.delete(db.get(GameSystem, third.id))
            db.commit()
            assert {
                link.game_system_id
                for link in db.query(BookSystemLink).filter_by(book_id=book.id)
            } == {other.id}
            db.delete(db.get(Book, book.id))
            db.commit()
            assert db.query(BookSystemLink).filter_by(book_id=book.id).count() == 0
        finally:
            db.close()

    def test_a_link_to_the_books_new_home_is_not_listed(self, client, admin_headers):
        """A move can carry a book onto a shelf it was already linked to."""
        home, other = _system(), _system()
        book = _book(home)
        _link(client, admin_headers, book, other)
        db = SessionLocal()
        try:
            db.query(Book).filter_by(id=book.id).update({"game_system_id": other.id})
            db.commit()
            moved = db.get(Book, book.id)
            assert book_links.linked_systems(db, moved, _Admin()) == []
        finally:
            db.close()
        listed = {s["id"]: s for s in client.get("/api/systems", headers=admin_headers).json()}
        assert listed[other.id]["book_count"] == 1


class _Admin:
    id = "admin-probe"
    role = "admin"
