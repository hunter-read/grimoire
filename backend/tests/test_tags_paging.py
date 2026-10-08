"""The tags view's items, a page at a time (issue #221).

``/tags/{internal}/items`` returns per-type counts and the folders carrying the
tag, plus one page of the directly-tagged items; ``/folder-items`` pages through
one folder. These pin the paging arithmetic, the ordering, and that counts only
include what the caller may open.
"""
import uuid

from backend.config import SessionLocal
from backend.models import MapFolder, TokenFolder
from backend.tests.conftest import make_book, make_game_system, make_map, make_token


def _label(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


def _items(client, headers, label, **params):
    resp = client.get(f"/api/tags/{label.lower()}/items", params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _tag_folder(model, folder: str, tags: list) -> None:
    db = SessionLocal()
    try:
        db.add(model(path=folder, tags=tags))
        db.commit()
    finally:
        db.close()


class TestDirectItems:
    def test_counts_per_type_and_total(self, client, admin_headers):
        label = _label("Count")
        system = make_game_system()
        for _ in range(2):
            make_book(system.id, tags=[label])
        for _ in range(3):
            make_map(tags=[label])
        data = _items(client, admin_headers, label)
        assert data["counts"] == {"book": 2, "map": 3}
        assert data["total"] == 5
        assert len(data["items"]) == 5

    def test_limit_zero_is_just_the_summary(self, client, admin_headers):
        label = _label("Summary")
        make_map(tags=[label])
        data = _items(client, admin_headers, label, limit=0)
        assert data["counts"] == {"map": 1}
        assert data["items"] == []

    def test_pages_run_across_types_in_order(self, client, admin_headers):
        label = _label("Across")
        system = make_game_system()
        books = [make_book(system.id, title=f"Book {i}", tags=[label]) for i in range(3)]
        maps = [make_map(filename=f"map {i}.png", tags=[label]) for i in range(3)]
        first = _items(client, admin_headers, label, limit=2, offset=0)["items"]
        second = _items(client, admin_headers, label, limit=2, offset=2)["items"]
        third = _items(client, admin_headers, label, limit=2, offset=4)["items"]
        ids = [i["item_id"] for i in first + second + third]
        # Books before maps, each in name order, with no item twice.
        assert ids == [b.id for b in books] + [m.id for m in maps]

    def test_one_type_pages_in_natural_order(self, client, admin_headers):
        label = _label("Natural")
        for n in (10, 2, 1):
            make_map(filename=f"Map {n}.png", tags=[label])
        data = _items(client, admin_headers, label, resource_type="map", limit=2, offset=1)
        assert data["counts"] == {"map": 3}
        # "Map 2" sorts before "Map 10", as the gallery's collator placed it.
        assert [i["filename"] for i in data["items"]] == ["Map 2.png", "Map 10.png"]

    def test_bad_type_is_rejected(self, client, admin_headers):
        label = _label("BadType")
        make_map(tags=[label])
        resp = client.get(
            f"/api/tags/{label.lower()}/items?resource_type=widget", headers=admin_headers
        )
        assert resp.status_code == 400


class TestVisibility:
    def test_restricted_book_is_neither_counted_nor_listed_for_a_player(
        self, client, admin_headers, player_headers
    ):
        label = _label("Restricted")
        system = make_game_system()
        open_book = make_book(system.id, tags=[label])
        make_book(system.id, tags=[label], access_level="gm")

        admin = _items(client, admin_headers, label)
        assert admin["counts"] == {"book": 2}

        player = _items(client, player_headers, label)
        assert player["counts"] == {"book": 1}
        assert [i["item_id"] for i in player["items"]] == [open_book.id]

    def test_variant_children_are_not_counted(self, client, admin_headers):
        label = _label("Variant")
        parent = make_map(tags=[label])
        make_map(tags=[label], variant_parent_id=parent.id, variant_kind="gridless")
        assert _items(client, admin_headers, label)["counts"] == {"map": 1}


class TestFolderItems:
    def test_folder_groups_carry_counts_and_page_through_contents(self, client, admin_headers):
        label = _label("Folder")
        folder = _label("Crypts")
        names = ["Room 10.png", "Room 2.png", "Room 1.png"]
        for name in names:
            make_token(filename=name, relative_path=f"tokens/{folder}/{name}")
        # A nested item belongs to the folder too.
        make_token(filename="Deep.png", relative_path=f"tokens/{folder}/Lower/Deep.png")
        _tag_folder(TokenFolder, folder, [label])

        data = _items(client, admin_headers, label)
        assert data["folders"] == [
            {"resource_type": "token", "path": folder, "key": folder, "count": 4}
        ]

        def page(offset):
            resp = client.get(
                f"/api/tags/{label.lower()}/folder-items",
                params={"resource_type": "token", "folder": folder, "limit": 2, "offset": offset},
                headers=admin_headers,
            )
            assert resp.status_code == 200, resp.text
            return resp.json()

        first, second = page(0), page(2)
        assert first["total"] == 4
        assert [i["filename"] for i in first["items"] + second["items"]] == [
            "Deep.png",
            "Room 1.png",
            "Room 2.png",
            "Room 10.png",
        ]

    def test_a_folder_not_carrying_the_tag_is_404(self, client, admin_headers):
        label = _label("Owner")
        folder = _label("Swamp")
        make_map(relative_path=f"maps/{folder}/bog.png")
        _tag_folder(MapFolder, folder, [label])
        resp = client.get(
            f"/api/tags/{label.lower()}/folder-items",
            params={"resource_type": "map", "folder": "Elsewhere"},
            headers=admin_headers,
        )
        assert resp.status_code == 404

    def test_explicit_folder_items_are_hidden_from_an_opted_out_user(
        self, client, admin_headers
    ):
        from backend.models import User

        label = _label("Spicy")
        folder = _label("Lounge")
        make_token(relative_path=f"tokens/{folder}/a.png")
        make_token(relative_path=f"tokens/{folder}/b.png", is_explicit=True)
        _tag_folder(TokenFolder, folder, [label])

        resp = client.post(
            "/api/users",
            json={"username": _label("prude"), "password": "prudepass123", "role": "player"},
            headers=admin_headers,
        )
        assert resp.status_code == 201, resp.text
        user_id = resp.json()["id"]
        db = SessionLocal()
        try:
            db.query(User).filter_by(id=user_id).update({"allow_explicit": False})
            db.commit()
        finally:
            db.close()
        login = client.post(
            "/api/auth/login",
            json={"username": resp.json()["username"], "password": "prudepass123"},
        )
        headers = {"Authorization": f"Bearer {login.json()['token']}"}

        data = _items(client, headers, label)
        assert data["folders"][0]["count"] == 1
        page = client.get(
            f"/api/tags/{label.lower()}/folder-items",
            params={"resource_type": "token", "folder": folder},
            headers=headers,
        ).json()
        assert page["total"] == 1
