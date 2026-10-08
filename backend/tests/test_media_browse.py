"""Server-side browsing of the media galleries (issue #221).

The list endpoints filter, sort and page in SQL, and ``/groups`` returns the
folders holding matching items. The galleries used to do all of this in the
browser over the whole downloaded collection, so these pin the same meanings
server-side: a folder tag counts for everything beneath it, the tag expression's
groups and sentinels, natural name order, and the search box's ``field:``
prefixes.

The test database is shared across the session, so every test works inside a
uniquely named folder or search term.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

from backend.config import SessionLocal
from backend.models import TokenFolder, User
from backend.tests.conftest import make_audio, make_map, make_token


def _uid(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


def _tokens(client, headers, **params):
    resp = client.get("/api/tokens", params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _groups(client, headers, url="/api/tokens/groups", **params):
    resp = client.get(url, params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _tag_folder(path: str, tags: list) -> None:
    db = SessionLocal()
    try:
        db.add(TokenFolder(path=path, tags=tags))
        db.commit()
    finally:
        db.close()


def _undated(item) -> None:
    """Clear ``added_at`` (the column default fills it on insert)."""
    from backend.models import Token

    db = SessionLocal()
    try:
        db.query(Token).filter_by(id=item.id).update({"added_at": None})
        db.commit()
    finally:
        db.close()


def _names(body) -> list:
    return [t["filename"] for t in body["tokens"]]


class TestGroups:
    def test_folders_with_counts(self, client, admin_headers):
        pack = _uid("Pack")
        for name in ("a.png", "b.png"):
            make_token(filename=name, relative_path=f"tokens/{pack}/{name}")
        make_token(filename="c.png", relative_path=f"tokens/{pack}/Sub/c.png")
        body = _groups(client, admin_headers, q=pack)
        assert body == {
            "total": 3,
            "groups": [{"path": pack, "count": 2}, {"path": f"{pack}/Sub", "count": 1}],
        }

    def test_root_items_group_under_the_empty_path(self, client, admin_headers):
        word = _uid("Loose")
        make_token(filename=f"{word}.png", relative_path=f"tokens/{word}.png")
        body = _groups(client, admin_headers, q=word)
        assert body["groups"] == [{"path": "", "count": 1}]

    def test_two_casings_of_the_collection_dir_merge(self, client, admin_headers):
        pack = _uid("Case")
        make_token(relative_path=f"tokens/{pack}/a.png")
        make_token(relative_path=f"Tokens/{pack}/b.png")
        body = _groups(client, admin_headers, q=pack)
        assert body["groups"] == [{"path": pack, "count": 2}]

    def test_maps_filter_by_map_type(self, client, admin_headers):
        pack = _uid("Maps")
        make_map(relative_path=f"maps/{pack}/a.png", map_type="battle")
        make_map(relative_path=f"maps/{pack}/b.png", map_type="world")
        body = _groups(client, admin_headers, url="/api/maps/groups", q=pack, map_type="battle")
        assert body["total"] == 1


class TestFolderListing:
    def test_lists_only_the_folder_in_natural_order(self, client, admin_headers):
        pack = _uid("Order")
        for n in (10, 2, 1):
            make_token(filename=f"Goblin {n}.png", relative_path=f"tokens/{pack}/Goblin {n}.png")
        make_token(filename="Deep.png", relative_path=f"tokens/{pack}/Below/Deep.png")
        body = _tokens(client, admin_headers, folder=pack, sort="name")
        assert body["total"] == 3
        assert _names(body) == ["Goblin 1.png", "Goblin 2.png", "Goblin 10.png"]

    def test_pages_do_not_overlap(self, client, admin_headers):
        pack = _uid("Page")
        for i in range(5):
            make_token(filename=f"t{i}.png", relative_path=f"tokens/{pack}/t{i}.png")
        first = _tokens(client, admin_headers, folder=pack, sort="name", limit=2, offset=0)
        second = _tokens(client, admin_headers, folder=pack, sort="name", limit=2, offset=2)
        third = _tokens(client, admin_headers, folder=pack, sort="name", limit=2, offset=4)
        assert _names(first) + _names(second) + _names(third) == [f"t{i}.png" for i in range(5)]
        assert first["total"] == 5

    def test_variants_are_hidden(self, client, admin_headers):
        pack = _uid("Variant")
        parent = make_token(relative_path=f"tokens/{pack}/a.png")
        make_token(relative_path=f"tokens/{pack}/a-alt.png", variant_parent_id=parent.id)
        assert _tokens(client, admin_headers, folder=pack)["total"] == 1


class TestSorts:
    def test_size_descending(self, client, admin_headers):
        pack = _uid("Size")
        for name, size in (("s.png", 1), ("l.png", 300), ("m.png", 20)):
            make_token(filename=name, relative_path=f"tokens/{pack}/{name}", file_size=size)
        body = _tokens(client, admin_headers, folder=pack, sort="size", order="desc")
        assert _names(body) == ["l.png", "m.png", "s.png"]

    def test_added_at_puts_undated_last_both_ways(self, client, admin_headers):
        pack = _uid("Added")
        now = datetime.now(timezone.utc)
        make_token(filename="old.png", relative_path=f"tokens/{pack}/old.png", added_at=now - timedelta(days=9))
        make_token(filename="new.png", relative_path=f"tokens/{pack}/new.png", added_at=now)
        _undated(make_token(filename="none.png", relative_path=f"tokens/{pack}/none.png"))
        asc = _tokens(client, admin_headers, folder=pack, sort="added_at", order="asc")
        desc = _tokens(client, admin_headers, folder=pack, sort="added_at", order="desc")
        assert _names(asc) == ["old.png", "new.png", "none.png"]
        assert _names(desc) == ["new.png", "old.png", "none.png"]

    def test_audio_title_and_duration(self, client, admin_headers):
        pack = _uid("Audio")
        make_audio(filename="x.mp3", relative_path=f"audio/{pack}/x.mp3", title="Beta", duration=5)
        make_audio(filename="y.mp3", relative_path=f"audio/{pack}/y.mp3", title="alpha", duration=9)
        by_title = client.get(
            "/api/audio", params={"folder": pack, "sort": "title"}, headers=admin_headers
        ).json()
        assert [a["title"] for a in by_title["audio"]] == ["alpha", "Beta"]
        by_length = client.get(
            "/api/audio",
            params={"folder": pack, "sort": "duration", "order": "desc"},
            headers=admin_headers,
        ).json()
        assert [a["title"] for a in by_length["audio"]] == ["alpha", "Beta"]

    def test_unknown_sort_is_rejected(self, client, admin_headers):
        resp = client.get("/api/tokens?sort=colour", headers=admin_headers)
        assert resp.status_code == 422


class TestSearch:
    def test_bare_text_matches_names_folders_and_tags(self, client, admin_headers):
        word = _uid("Word")
        by_name = make_token(filename=f"{word}.png", relative_path=f"tokens/P/{word}.png")
        by_folder = make_token(relative_path=f"tokens/{word}Folder/x.png")
        by_tag = make_token(relative_path="tokens/P/y.png", tags=[f"{word}tag"])
        by_folder_tag = make_token(relative_path=f"tokens/T{word}/z.png")
        _tag_folder(f"T{word}", [f"{word}folder"])
        ids = {t["id"] for t in _tokens(client, admin_headers, q=word)["tokens"]}
        assert ids == {by_name.id, by_folder.id, by_tag.id, by_folder_tag.id}

    def test_tag_prefix_matches_only_tags(self, client, admin_headers):
        word = _uid("Pref")
        make_token(filename=f"{word}.png", relative_path=f"tokens/P/{word}.png")
        tagged = make_token(relative_path="tokens/P/t.png", tags=[word])
        ids = {t["id"] for t in _tokens(client, admin_headers, q=f"tag:{word}")["tokens"]}
        assert ids == {tagged.id}

    def test_title_prefix_matches_names(self, client, admin_headers):
        word = _uid("Title")
        named = make_token(filename=f"{word}.png", relative_path=f"tokens/P/{word}.png")
        make_token(relative_path="tokens/P/q.png", tags=[word])
        ids = {t["id"] for t in _tokens(client, admin_headers, q=f"title:{word}")["tokens"]}
        assert ids == {named.id}

    def test_a_book_only_field_matches_nothing(self, client, admin_headers):
        word = _uid("Book")
        make_token(filename=f"{word}.png", relative_path=f"tokens/P/{word}.png")
        assert _tokens(client, admin_headers, q=f"{word} author:gygax")["total"] == 0


class TestTagFilter:
    def _scene(self):
        """A pack whose folder is tagged, holding one item with its own tag."""
        pack = _uid("Scene")
        folder_tag, own_tag = _uid("ftag"), _uid("own")
        a = make_token(relative_path=f"tokens/{pack}/In/a.png", tags=[own_tag])
        b = make_token(relative_path=f"tokens/{pack}/In/b.png")
        c = make_token(relative_path=f"tokens/{pack}/Out/c.png")
        _tag_folder(f"{pack}/In", [folder_tag])
        return pack, folder_tag, own_tag, a, b, c

    def _ids(self, client, headers, pack, tags):
        body = _tokens(client, headers, q=pack, tags=json.dumps(tags))
        return {t["id"] for t in body["tokens"]}

    def test_folder_tags_are_inherited(self, client, admin_headers):
        pack, folder_tag, _own, a, b, _c = self._scene()
        assert self._ids(client, admin_headers, pack, [folder_tag]) == {a.id, b.id}

    def test_groups_and_exclusions(self, client, admin_headers):
        pack, folder_tag, own, a, b, c = self._scene()
        both = [{"mode": "include", "tags": [folder_tag]}, {"mode": "include", "tags": [own]}]
        assert self._ids(client, admin_headers, pack, both) == {a.id}
        either = [{"mode": "include", "tags": [own, folder_tag]}]
        assert self._ids(client, admin_headers, pack, either) == {a.id, b.id}
        without = [{"mode": "exclude", "tags": [own]}]
        assert self._ids(client, admin_headers, pack, without) == {b.id, c.id}

    def test_presence_sentinels(self, client, admin_headers):
        pack, _f, _o, a, b, c = self._scene()
        assert self._ids(client, admin_headers, pack, ["__grim:none__"]) == {c.id}
        assert self._ids(client, admin_headers, pack, ["__grim:any__"]) == {a.id, b.id}

    def test_groups_endpoint_takes_the_same_filter(self, client, admin_headers):
        pack, folder_tag, *_ = self._scene()
        body = _groups(client, admin_headers, q=pack, tags=json.dumps([folder_tag]))
        assert body["groups"] == [{"path": f"{pack}/In", "count": 2}]

    def test_malformed_filter_is_a_400(self, client, admin_headers):
        resp = client.get("/api/tokens?tags=not-json", headers=admin_headers)
        assert resp.status_code == 400


class TestOtherFilters:
    def test_favorites(self, client, admin_headers):
        pack = _uid("Fav")
        liked = make_token(relative_path=f"tokens/{pack}/a.png")
        make_token(relative_path=f"tokens/{pack}/b.png")
        resp = client.post(
            "/api/favorites", json={"item_type": "token", "item_id": liked.id}, headers=admin_headers
        )
        assert resp.status_code in (200, 201), resp.text
        body = _tokens(client, admin_headers, folder=pack, favorites="true")
        assert [t["id"] for t in body["tokens"]] == [liked.id]

    def test_added_since(self, client, admin_headers):
        pack = _uid("Recent")
        now = datetime.now(timezone.utc)
        fresh = make_token(relative_path=f"tokens/{pack}/a.png", added_at=now)
        make_token(relative_path=f"tokens/{pack}/b.png", added_at=now - timedelta(days=30))
        _undated(make_token(relative_path=f"tokens/{pack}/c.png"))
        since = (now - timedelta(days=7)).isoformat()
        body = _tokens(client, admin_headers, folder=pack, added_since=since)
        assert [t["id"] for t in body["tokens"]] == [fresh.id]

    def test_explicit_hidden_from_an_opted_out_user(self, client, admin_headers):
        pack = _uid("Explicit")
        make_token(relative_path=f"tokens/{pack}/a.png")
        make_token(relative_path=f"tokens/{pack}/b.png", is_explicit=True)
        name = _uid("prude")
        created = client.post(
            "/api/users",
            json={"username": name, "password": "prudepass123", "role": "player"},
            headers=admin_headers,
        )
        assert created.status_code == 201, created.text
        db = SessionLocal()
        try:
            db.query(User).filter_by(id=created.json()["id"]).update({"allow_explicit": False})
            db.commit()
        finally:
            db.close()
        token = client.post(
            "/api/auth/login", json={"username": name, "password": "prudepass123"}
        ).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert _tokens(client, headers, folder=pack)["total"] == 1
        assert _groups(client, headers, q=pack)["total"] == 1
