"""Integration tests for the /api/tags router and tag dual-write (issue #235)."""
import uuid

from backend.config import SessionLocal
from backend.models import MapFolder
from backend.tests.conftest import (
    make_audio,
    make_book,
    make_game_system,
    make_map,
    make_token,
)


def _map_in_folder_with_folder_tags(folder: str, tags: list):
    """A map inside ``maps/<folder>/`` plus a MapFolder row tagged via tags.json.
    Returns the map. Folder tags live on the folder table, not the shared tags."""
    m = make_map(relative_path=f"maps/{folder}/{uuid.uuid4().hex[:6]}.png")
    db = SessionLocal()
    try:
        if not db.query(MapFolder).filter_by(path=folder).first():
            db.add(MapFolder(path=folder, tags=tags))
            db.commit()
    finally:
        db.close()
    return m


def _tag_a_map(client, headers, tags):
    m = make_map()
    resp = client.patch(f"/api/maps/{m.id}", json={"tags": tags}, headers=headers)
    assert resp.status_code == 200, resp.text
    return m


class TestDualWrite:
    def test_patching_map_tags_populates_shared_tags(self, client, admin_headers):
        _tag_a_map(client, admin_headers, ["Forest", "Cave"])
        listing = client.get("/api/tags?in_use_by=map", headers=admin_headers).json()
        internals = {t["internal"] for t in listing["tags"]}
        assert {"forest", "cave"} <= internals

    def test_patching_book_tags_shares_with_map_tag(self, client, admin_headers):
        system = make_game_system()
        book = make_book(system.id)
        _tag_a_map(client, admin_headers, ["Strahd"])
        client.patch(f"/api/books/{book.id}", json={"tags": ["strahd"]}, headers=admin_headers)
        # Same internal key across a map and a book → one tag, two items.
        items = client.get("/api/tags/strahd/items", headers=admin_headers).json()
        types = {i["item_type"] for i in items["items"]}
        assert {"map", "book"} <= types

    def test_tagged_system_publisher_objects_survive_response_validation(
        self, client, admin_headers
    ):
        """`publishers` holds {name, url} objects; typing it `list[str]` 500'd
        this endpoint for any tagged system that had one (same bug as favorites)."""
        system = make_game_system(publishers=[{"name": "Kobold Press", "url": ""}])
        client.patch(
            f"/api/systems/{system.id}", json={"tags": ["PubTag"]}, headers=admin_headers
        )
        resp = client.get("/api/tags/pubtag/items", headers=admin_headers)
        assert resp.status_code == 200, resp.text
        systems = [i for i in resp.json()["items"] if i["item_type"] == "system"]
        assert systems
        assert systems[0]["publishers"][0]["name"] == "Kobold Press"


class TestListTags:
    def test_in_use_by_scopes_to_resource_type(self, client, admin_headers):
        system = make_game_system()
        book = make_book(system.id)
        client.patch(
            f"/api/books/{book.id}", json={"tags": ["BookOnly"]}, headers=admin_headers
        )
        # A book-only tag must not appear when scoping to maps.
        maps = client.get("/api/tags?in_use_by=map", headers=admin_headers).json()
        assert "bookonly" not in {t["internal"] for t in maps["tags"]}
        books = client.get("/api/tags?in_use_by=book", headers=admin_headers).json()
        assert "bookonly" in {t["internal"] for t in books["tags"]}

    def test_invalid_in_use_by_returns_400(self, client, admin_headers):
        resp = client.get("/api/tags?in_use_by=widget", headers=admin_headers)
        assert resp.status_code == 400

    def test_list_includes_category_single_and_shared(self, client, admin_headers):
        system = make_game_system()
        book = make_book(system.id)
        m = make_map()
        book_only = f"BookCat{uuid.uuid4().hex[:6]}"
        shared = f"SharedCat{uuid.uuid4().hex[:6]}"
        client.patch(f"/api/books/{book.id}", json={"tags": [book_only]}, headers=admin_headers)
        # Same tag on a book and a map → promoted to shared.
        client.patch(f"/api/books/{book.id}", json={"tags": [book_only, shared]}, headers=admin_headers)
        client.patch(f"/api/maps/{m.id}", json={"tags": [shared]}, headers=admin_headers)

        tags = client.get("/api/tags", headers=admin_headers).json()["tags"]
        by = {t["internal"]: t["category"] for t in tags}
        assert by[book_only.lower()] == "book"
        assert by[shared.lower()] == "shared"

    def test_counts_reflect_usage(self, client, admin_headers):
        label = f"Count{uuid.uuid4().hex[:6]}"
        _tag_a_map(client, admin_headers, [label])
        _tag_a_map(client, admin_headers, [label])
        maps = client.get("/api/tags?in_use_by=map", headers=admin_headers).json()
        row = next(t for t in maps["tags"] if t["internal"] == label.lower())
        assert row["count"] == 2


class TestTagItems:
    def test_items_for_unknown_tag_404(self, client, admin_headers):
        resp = client.get("/api/tags/no-such-tag-xyz/items", headers=admin_headers)
        assert resp.status_code == 404

    def test_items_filtered_by_resource_type(self, client, admin_headers):
        system = make_game_system()
        book = make_book(system.id)
        label = f"Both{uuid.uuid4().hex[:6]}"
        _tag_a_map(client, admin_headers, [label])
        client.patch(f"/api/books/{book.id}", json={"tags": [label]}, headers=admin_headers)
        resp = client.get(
            f"/api/tags/{label.lower()}/items?resource_type=book", headers=admin_headers
        )
        items = resp.json()["items"]
        assert all(i["item_type"] == "book" for i in items)
        assert len(items) == 1


class TestMutationPermissions:
    def test_player_cannot_rename_tag(self, client, admin_headers, player_headers):
        label = f"Perm{uuid.uuid4().hex[:6]}"
        _tag_a_map(client, admin_headers, [label])
        resp = client.patch(
            f"/api/tags/{label.lower()}", json={"display": "Renamed"}, headers=player_headers
        )
        assert resp.status_code == 403

    def test_admin_can_rename_display_same_key(self, client, admin_headers):
        # A rename that only changes casing keeps the internal key.
        label = f"Rename{uuid.uuid4().hex[:6]}"
        _tag_a_map(client, admin_headers, [label])
        resp = client.patch(
            f"/api/tags/{label.lower()}",
            json={"display": label.upper()},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["display"] == label.upper()
        assert resp.json()["internal"] == label.lower()

    def test_rename_rekeys_internal_on_typo_fix(self, client, admin_headers):
        # Renaming to a different word re-keys the internal so search-by-internal
        # finds the corrected value (e.g. "Freinds" → "Friends").
        _tag_a_map(client, admin_headers, ["Freinds"])
        resp = client.patch(
            "/api/tags/freinds",
            json={"display": "Friends"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["display"] == "Friends"
        assert resp.json()["internal"] == "friends"
        # The old key no longer resolves.
        gone = client.get("/api/tags/freinds/items", headers=admin_headers)
        assert gone.status_code == 404


class TestMergeAndDelete:
    def test_merge_repoints_links(self, client, admin_headers):
        src = f"Src{uuid.uuid4().hex[:6]}"
        dst = f"Dst{uuid.uuid4().hex[:6]}"
        m = _tag_a_map(client, admin_headers, [src])
        resp = client.post(
            f"/api/tags/{src.lower()}/merge", json={"into": dst}, headers=admin_headers
        )
        assert resp.status_code == 200
        # Source tag is gone; the map now carries the destination tag.
        assert client.get(f"/api/tags/{src.lower()}/items", headers=admin_headers).status_code == 404
        items = client.get(f"/api/tags/{dst.lower()}/items", headers=admin_headers).json()
        assert any(i["item_id"] == m.id for i in items["items"])

    def test_cannot_merge_into_self(self, client, admin_headers):
        label = f"Self{uuid.uuid4().hex[:6]}"
        _tag_a_map(client, admin_headers, [label])
        resp = client.post(
            f"/api/tags/{label.lower()}/merge", json={"into": label}, headers=admin_headers
        )
        assert resp.status_code == 400

    def test_delete_removes_tag_and_links(self, client, admin_headers):
        label = f"Del{uuid.uuid4().hex[:6]}"
        _tag_a_map(client, admin_headers, [label])
        resp = client.delete(f"/api/tags/{label.lower()}", headers=admin_headers)
        assert resp.status_code == 204
        assert client.get(f"/api/tags/{label.lower()}/items", headers=admin_headers).status_code == 404


class TestListAllTags:
    def test_list_all_includes_unscoped_tags_with_counts(self, client, admin_headers):
        label = f"All{uuid.uuid4().hex[:6]}"
        _tag_a_map(client, admin_headers, [label])
        resp = client.get("/api/tags", headers=admin_headers)
        assert resp.status_code == 200
        row = next(t for t in resp.json()["tags"] if t["internal"] == label.lower())
        assert row["count"] == 1


class TestCreateTag:
    def test_create_tag_up_front(self, client, admin_headers):
        label = f"Made{uuid.uuid4().hex[:6]}"
        resp = client.post(
            "/api/tags", json={"value": label, "display": "Made Nice"}, headers=admin_headers
        )
        assert resp.status_code == 201
        assert resp.json() == {
            "internal": label.lower(),
            "display": "Made Nice",
            "category": "shared",
        }

    def test_create_blank_tag_returns_400(self, client, admin_headers):
        resp = client.post("/api/tags", json={"value": "   "}, headers=admin_headers)
        assert resp.status_code == 400

    def test_player_cannot_create(self, client, player_headers):
        resp = client.post("/api/tags", json={"value": "nope"}, headers=player_headers)
        assert resp.status_code == 403


class TestValidationEdges:
    def test_tag_items_invalid_resource_type_400(self, client, admin_headers):
        label = f"Edge{uuid.uuid4().hex[:6]}"
        _tag_a_map(client, admin_headers, [label])
        resp = client.get(
            f"/api/tags/{label.lower()}/items?resource_type=widget", headers=admin_headers
        )
        assert resp.status_code == 400

    def test_rename_blank_display_400(self, client, admin_headers):
        label = f"Blank{uuid.uuid4().hex[:6]}"
        _tag_a_map(client, admin_headers, [label])
        resp = client.patch(
            f"/api/tags/{label.lower()}", json={"display": "   "}, headers=admin_headers
        )
        assert resp.status_code == 400

    def test_rename_unknown_tag_404(self, client, admin_headers):
        resp = client.patch(
            "/api/tags/no-such-xyz", json={"display": "X"}, headers=admin_headers
        )
        assert resp.status_code == 404

    def test_merge_unknown_source_404(self, client, admin_headers):
        resp = client.post(
            "/api/tags/no-such-xyz/merge", json={"into": "anything"}, headers=admin_headers
        )
        assert resp.status_code == 404

    def test_delete_unknown_tag_404(self, client, admin_headers):
        resp = client.delete("/api/tags/no-such-xyz", headers=admin_headers)
        assert resp.status_code == 404


class TestItemEnrichmentTypes:
    def test_items_include_map_audio_and_system(self, client, admin_headers):
        label = f"Multi{uuid.uuid4().hex[:6]}"
        system = make_game_system()
        m = make_map()
        a = make_audio()
        client.patch(f"/api/systems/{system.id}", json={"tags": [label]}, headers=admin_headers)
        client.patch(f"/api/maps/{m.id}", json={"tags": [label]}, headers=admin_headers)
        client.patch(f"/api/audio/{a.id}", json={"tags": [label]}, headers=admin_headers)
        items = client.get(f"/api/tags/{label.lower()}/items", headers=admin_headers).json()[
            "items"
        ]
        by_type = {i["item_type"] for i in items}
        assert {"system", "map", "audio"} <= by_type


class TestExplicitFiltering:
    def test_explicit_token_hidden_from_restricted_user(
        self, client, admin_headers, player_headers, player_id
    ):
        # Restrict the player from explicit content.
        client.patch(
            f"/api/users/{player_id}", json={"allow_explicit": False}, headers=admin_headers
        )
        label = f"Explicit{uuid.uuid4().hex[:6]}"
        tok = make_token(is_explicit=True)
        client.patch(f"/api/tokens/{tok.id}", json={"tags": [label]}, headers=admin_headers)
        # Admin sees it; restricted player does not.
        admin_items = client.get(f"/api/tags/{label.lower()}/items", headers=admin_headers).json()
        assert any(i["item_id"] == tok.id for i in admin_items["items"])
        player_items = client.get(
            f"/api/tags/{label.lower()}/items", headers=player_headers
        ).json()
        assert all(i["item_id"] != tok.id for i in player_items["items"])


class TestFolderTags:
    """Folder tags (from tags.json / folder tagging) surface in the tags view even
    though they live on the folder tables, not the shared-tag tables."""

    def test_folder_tag_appears_in_listing(self, client, admin_headers):
        label = f"Wetland{uuid.uuid4().hex[:6]}"
        _map_in_folder_with_folder_tags(f"Swamps{uuid.uuid4().hex[:6]}", [label])
        listing = client.get("/api/tags?in_use_by=map", headers=admin_headers).json()
        row = next((t for t in listing["tags"] if t["internal"] == label.lower()), None)
        assert row is not None
        assert row["count"] >= 1

    def test_folder_tag_items_resolve_to_folder_contents(self, client, admin_headers):
        label = f"Cave{uuid.uuid4().hex[:6]}"
        m = _map_in_folder_with_folder_tags(f"Caves{uuid.uuid4().hex[:6]}", [label])
        resp = client.get(f"/api/tags/{label.lower()}/items", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        # Folder-derived items appear as a folder group, listing the folder's items.
        folder_items = [i for g in data["folders"] for i in g["items"]]
        assert any(i["item_id"] == m.id for i in folder_items)

    def test_folder_only_tag_not_404(self, client, admin_headers):
        # A tag that exists only as a folder tag still resolves (no 404).
        label = f"Forest{uuid.uuid4().hex[:6]}"
        _map_in_folder_with_folder_tags(f"Woods{uuid.uuid4().hex[:6]}", [label])
        resp = client.get(f"/api/tags/{label.lower()}/items", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["display"] == label

    def test_shared_and_folder_tag_counts_combine(self, client, admin_headers):
        # Same tag on a folder and directly on a different map → count reflects both.
        label = f"Ruins{uuid.uuid4().hex[:6]}"
        _map_in_folder_with_folder_tags(f"Ancient{uuid.uuid4().hex[:6]}", [label])
        _tag_a_map(client, admin_headers, [label])
        listing = client.get("/api/tags?in_use_by=map", headers=admin_headers).json()
        row = next(t for t in listing["tags"] if t["internal"] == label.lower())
        assert row["count"] >= 2

    def test_delete_folder_only_tag_strips_folder_association(self, client, admin_headers):
        # Deleting a folder-derived tag removes it from the folder (no 404).
        label = f"DelFolder{uuid.uuid4().hex[:6]}"
        folder = f"Grotto{uuid.uuid4().hex[:6]}"
        _map_in_folder_with_folder_tags(folder, [label, "keep"])
        resp = client.delete(f"/api/tags/{label.lower()}", headers=admin_headers)
        assert resp.status_code == 204
        # The tag no longer appears; the sibling folder tag survives.
        listing = client.get("/api/tags", headers=admin_headers).json()["tags"]
        internals = {t["internal"] for t in listing}
        assert label.lower() not in internals
        assert "keep" in internals

    def test_rename_folder_only_tag_does_not_404(self, client, admin_headers):
        # Renaming a folder-derived tag (no shared Tag row yet) must persist to
        # the DB instead of 404ing; the display then survives a rescan.
        label = f"FolderRen{uuid.uuid4().hex[:6]}"
        folder = f"Vault{uuid.uuid4().hex[:6]}"
        _map_in_folder_with_folder_tags(folder, [label.lower()])
        resp = client.patch(
            f"/api/tags/{label.lower()}",
            json={"display": f"{label} Pretty"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["display"] == f"{label} Pretty"

    def test_delete_missing_tag_still_404s(self, client, admin_headers):
        resp = client.delete(
            f"/api/tags/none-{uuid.uuid4().hex[:6]}", headers=admin_headers
        )
        assert resp.status_code == 404
