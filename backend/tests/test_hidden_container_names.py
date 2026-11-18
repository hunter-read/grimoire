"""A visible system inside a container hidden from the reader.

A container's access level does not apply to its children, so a player can see
a child system whose container they cannot. Nothing about that child may name
the container to them: not its parent fields, not the `?parent_id=` list, and
not the paths of its books. Admins see everything as before.
"""
import uuid

import pytest

from backend.config import SessionLocal
from backend.services.reader_paths import ReaderPaths
from backend.tests.conftest import make_book, make_game_system


def uid() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture
def tree():
    tag = uid()
    container = make_game_system(
        name=f"Sealed Vault {tag}", container_kind="parent", access_level="admin"
    )
    child = make_game_system(name=f"Open Child {tag}", parent_id=container.id)
    path = f"books/Sealed Vault {tag}/Open Child {tag}/core/Main {tag}.pdf"
    book = make_book(child.id, title=f"Main {tag}", relative_path=path)
    variant = make_book(
        child.id,
        title=f"Main {tag} (print)",
        relative_path=f"books/Sealed Vault {tag}/Open Child {tag}/core/Print {tag}.pdf",
        variant_parent_id=book.id,
        variant_kind="printer",
    )
    return {
        "container": container,
        "child": child,
        "book": book,
        "variant": variant,
        "secret": f"Sealed Vault {tag}",
        "shown": f"books/Open Child {tag}/core/Main {tag}.pdf",
        "raw": path,
    }


def _names_nothing(payload, tree) -> None:
    text = str(payload)
    assert tree["secret"] not in text
    assert tree["container"].id not in text


def test_child_detail_leaves_out_the_container(client, player_headers, tree):
    child = tree["child"]
    for include in ("true", "false"):
        r = client.get(f"/api/systems/{child.id}?include_books={include}", headers=player_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["parent_id"] is None
        assert body["parent_name"] == ""
        assert body["category_depth"] == 2
        assert body["scope_path"] == f"books/{child.name}"
        _names_nothing(body, tree)
    full = client.get(f"/api/systems/{child.id}", headers=player_headers).json()
    assert [b["relative_path"] for b in full["books"]] == [tree["shown"]]


def test_child_lists_at_the_top_level(client, player_headers, tree):
    for query in ("", "?include_children=true"):
        rows = client.get(f"/api/systems{query}", headers=player_headers).json()
        row = next(s for s in rows if s["id"] == tree["child"].id)
        assert row["parent_id"] is None and row["parent_name"] == ""
        _names_nothing(rows, tree)


def test_hidden_container_lists_no_children(client, player_headers, tree):
    r = client.get(f"/api/systems?parent_id={tree['container'].id}", headers=player_headers)
    assert r.status_code == 200
    assert r.json() == []
    assert client.get(f"/api/systems/{tree['container'].id}", headers=player_headers).status_code == 404


def test_book_paths_leave_out_the_container(client, player_headers, tree):
    child, book = tree["child"], tree["book"]
    page = client.get(f"/api/systems/{child.id}/books", headers=player_headers).json()
    assert [b["relative_path"] for b in page["books"]] == [tree["shown"]]
    _names_nothing(page, tree)

    listed = client.get(f"/api/books?system_id={child.id}", headers=player_headers).json()
    assert [b["id"] for b in listed["books"]] == [book.id]
    _names_nothing(listed, tree)

    detail = client.get(f"/api/books/{book.id}", headers=player_headers).json()
    assert detail["relative_path"] == tree["shown"]
    assert [v["relative_path"] for v in detail["variants"]] == [
        tree["variant"].relative_path.replace(f"{tree['secret']}/", "")
    ]
    _names_nothing(detail, tree)

    found = client.get(
        "/api/search", params={"q": book.title, "type": "books"}, headers=player_headers
    )
    assert found.status_code == 200
    _names_nothing(found.json(), tree)


def test_admin_sees_the_container(client, admin_headers, tree):
    child, container = tree["child"], tree["container"]
    body = client.get(f"/api/systems/{child.id}", headers=admin_headers).json()
    assert body["parent_id"] == container.id
    assert body["parent_name"] == container.name
    assert body["category_depth"] == 3
    assert [b["relative_path"] for b in body["books"]] == [tree["raw"]]
    rows = client.get(f"/api/systems?parent_id={container.id}", headers=admin_headers).json()
    assert [s["id"] for s in rows] == [child.id]
    detail = client.get(f"/api/books/{tree['book'].id}", headers=admin_headers).json()
    assert detail["relative_path"] == tree["raw"]


def test_a_visible_container_is_still_named(client, player_headers):
    container = make_game_system(name=f"Open Vault {uid()}", container_kind="parent")
    child = make_game_system(name=f"Inner {uid()}", parent_id=container.id)
    body = client.get(f"/api/systems/{child.id}", headers=player_headers).json()
    assert body["parent_id"] == container.id
    assert body["parent_name"] == container.name
    assert body["category_depth"] == 3
    rows = client.get(f"/api/systems?parent_id={container.id}", headers=player_headers).json()
    assert [s["id"] for s in rows] == [child.id]


def test_wargame_list_leaves_out_a_hidden_parent(client, player_headers):
    container = make_game_system(
        name=f"Sealed Front {uid()}", container_kind="parent", access_level="admin",
        game_type="wargame",
    )
    child = make_game_system(name=f"Open Front {uid()}", parent_id=container.id, game_type="wargame")
    games = client.get("/api/armies/games", headers=player_headers).json()
    row = next(g for g in games if g["id"] == child.id)
    assert row["parent_id"] is None
    assert container.id not in str(games)


# ---------------------------------------------------------------------------
# ReaderPaths on its own
# ---------------------------------------------------------------------------


class _Reader:
    def __init__(self, user_id: str, role: str = "player") -> None:
        self.id = user_id
        self.role = role


def test_nested_containers_cut_only_the_hidden_one(player_id):
    tag = uid()
    outer = make_game_system(name=f"Outer {tag}", container_kind="parent")
    middle = make_game_system(
        name=f"Middle {tag}", container_kind="parent", parent_id=outer.id, access_level="admin"
    )
    inner = make_game_system(name=f"Inner {tag}", parent_id=middle.id)
    db = SessionLocal()
    try:
        paths = ReaderPaths(db, _Reader(player_id))
        assert paths.shown_parent_id(inner) is None
        assert paths.shown_parent_id(middle) == outer.id
        assert paths.shown_parent_id(outer) is None
        assert paths.category_depth(inner.id, 4) == 3
        assert paths.cut("books/O/M/I/core/b.pdf", inner.id) == "books/O/I/core/b.pdf"
        # The filename is never cut, however short the path.
        assert paths.cut("books/b.pdf", inner.id) == "books/b.pdf"
        assert paths.cut(None, inner.id) == ""
        assert paths.cut("books/O/x.pdf", None) == "books/O/x.pdf"
    finally:
        db.close()


def test_admin_paths_load_nothing():
    db = SessionLocal()
    try:
        paths = ReaderPaths(db, _Reader("nobody", role="admin"))
        assert paths.cut("books/A/B/core/x.pdf", "any") == "books/A/B/core/x.pdf"
        assert paths.category_depth("any", 3) == 3
        assert paths._parents == {}
    finally:
        db.close()


def test_book_path_of_a_hidden_system_cuts_its_folders(player_id, tree):
    db = SessionLocal()
    try:
        paths = ReaderPaths(db, _Reader(player_id))
        # Its system hidden too: every folder down to the category goes.
        name = tree["raw"].rsplit("/", 1)[1]
        assert paths.book_path(tree["book"], None) == f"books/core/{name}"
        assert paths.book_path(tree["book"], tree["child"]) == tree["shown"]
    finally:
        db.close()


def test_a_parent_cycle_ends_the_walk(player_id):
    a = make_game_system(name=f"Loop A {uid()}", container_kind="parent", access_level="admin")
    b = make_game_system(name=f"Loop B {uid()}", container_kind="parent", parent_id=a.id)
    db = SessionLocal()
    try:
        from backend.models import GameSystem

        db.query(GameSystem).filter_by(id=a.id).update({"parent_id": b.id})
        db.commit()
        paths = ReaderPaths(db, _Reader(player_id))
        assert paths.shown_parent_id(b) is None
        assert paths.cut("books/A/B/core/x.pdf", b.id) == "books/B/core/x.pdf"
    finally:
        db.query(GameSystem).filter_by(id=a.id).update({"parent_id": None})
        db.commit()
        db.close()
