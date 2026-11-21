"""Token editor recipes: stored with a token, read back to reopen it, gone with it."""
import io
import json
import os
import uuid

import pytest

from backend.services.campaigns.token_recipes import TOKEN_SOURCE_DIR


def _png(color=(120, 80, 200), size=(8, 8)):
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def _recipe(**over):
    base = {
        "size": 512,
        "frame_id": "generic:circle",
        "frame_color": "gold",
        "background": "#112233",
        "transform": {
            "scale": 1.5,
            "offsetX": 12,
            "offsetY": -8,
            "rotation": 90,
            "flipX": True,
            "flipY": False,
        },
        "source": {"type": "token", "id": "tok-1"},
    }
    base.update(over)
    return json.dumps(base)


def _upload_source():
    return {"type": "upload"}


def _files(recipe=None, source=None):
    files = {"file": ("token.png", _png(), "image/png")}
    if source is not None:
        files["source"] = ("art.png", source, "image/png")
    return files, ({"recipe": recipe} if recipe else {})


def _sources(stem):
    if not os.path.isdir(TOKEN_SOURCE_DIR):
        return []
    return [n for n in os.listdir(TOKEN_SOURCE_DIR) if n.rsplit(".", 1)[0] == stem]


@pytest.fixture()
def group(client, gm_headers, player_headers, player_id):
    """A GM's campaign the player has joined; returns (campaign, member id)."""
    c = client.post(
        "/api/campaigns",
        json={"name": f"Recipes {uuid.uuid4().hex[:8]}", "is_gm_campaign": True},
        headers=gm_headers,
    ).json()
    client.post(
        f"/api/campaigns/{c['id']}/invite", json={"user_id": player_id}, headers=gm_headers
    )
    client.patch(
        f"/api/campaigns/{c['id']}/members/{player_id}",
        json={"status": "accepted"},
        headers=player_headers,
    )
    body = client.get(f"/api/campaigns/{c['id']}", headers=gm_headers).json()
    return c, next(m["id"] for m in body["members"] if not m.get("is_owner"))


@pytest.fixture()
def personal(client, player_headers):
    return client.post(
        "/api/campaigns",
        json={"name": f"Solo {uuid.uuid4().hex[:8]}", "is_gm_campaign": False},
        headers=player_headers,
    ).json()


def _member_row(client, cid, mid, headers):
    body = client.get(f"/api/campaigns/{cid}", headers=headers).json()
    return next(m for m in body["members"] if m.get("id") == mid)


def _put_member_token(client, cid, mid, headers, recipe=None, source=None):
    files, data = _files(recipe, source)
    return client.post(
        f"/api/campaigns/{cid}/members/{mid}/token", files=files, data=data, headers=headers
    )


class TestMemberTokenRecipe:
    def test_a_library_recipe_is_kept_and_read_back(self, client, player_headers, group):
        c, mid = group
        assert _put_member_token(client, c["id"], mid, player_headers, _recipe()).status_code == 200
        assert _member_row(client, c["id"], mid, player_headers)["token_editable"] is True

        got = client.get(
            f"/api/campaigns/{c['id']}/token-recipes/member/{mid}", headers=player_headers
        )
        assert got.status_code == 200, got.text
        body = got.json()
        assert body["size"] == 512
        assert body["frame_id"] == "generic:circle"
        assert body["transform"] == {
            "scale": 1.5,
            "offsetX": 12,
            "offsetY": -8,
            "rotation": 90,
            "flipX": True,
            "flipY": False,
        }
        assert body["source"] == {"type": "token", "id": "tok-1"}

    def test_the_owner_reads_a_players_recipe(self, client, gm_headers, player_headers, group):
        c, mid = group
        _put_member_token(client, c["id"], mid, player_headers, _recipe())
        got = client.get(f"/api/campaigns/{c['id']}/token-recipes/member/{mid}", headers=gm_headers)
        assert got.status_code == 200

    def test_an_outsider_cannot(self, client, admin_headers, player_headers, group):
        c, mid = group
        _put_member_token(client, c["id"], mid, player_headers, _recipe())
        got = client.get(
            f"/api/campaigns/{c['id']}/token-recipes/member/{mid}", headers=admin_headers
        )
        assert got.status_code == 403

    def test_device_art_is_kept_and_served(self, client, player_headers, group):
        c, mid = group
        art = _png((1, 2, 3), (32, 32))
        resp = _put_member_token(
            client, c["id"], mid, player_headers, _recipe(source=_upload_source()), art
        )
        assert resp.status_code == 200, resp.text
        assert len(_sources(f"member-{mid}")) == 1

        recipe = client.get(
            f"/api/campaigns/{c['id']}/token-recipes/member/{mid}", headers=player_headers
        ).json()
        # The stored file's name stays server-side.
        assert recipe["source"] == {"type": "upload", "id": None}
        src = client.get(
            f"/api/campaigns/{c['id']}/token-recipes/member/{mid}/source", headers=player_headers
        )
        assert src.status_code == 200
        assert src.headers["content-type"] == "image/png"
        assert src.content == art

    def test_a_library_source_has_no_stored_art(self, client, player_headers, group):
        c, mid = group
        _put_member_token(client, c["id"], mid, player_headers, _recipe())
        src = client.get(
            f"/api/campaigns/{c['id']}/token-recipes/member/{mid}/source", headers=player_headers
        )
        assert src.status_code == 404

    def test_an_upload_without_a_recipe_clears_it(self, client, player_headers, group):
        c, mid = group
        _put_member_token(client, c["id"], mid, player_headers, _recipe(source=_upload_source()), _png())
        _put_member_token(client, c["id"], mid, player_headers)

        assert _member_row(client, c["id"], mid, player_headers)["token_editable"] is False
        assert _sources(f"member-{mid}") == []
        got = client.get(
            f"/api/campaigns/{c['id']}/token-recipes/member/{mid}", headers=player_headers
        )
        assert got.status_code == 404

    def test_removing_the_token_removes_its_recipe(self, client, player_headers, group):
        c, mid = group
        _put_member_token(client, c["id"], mid, player_headers, _recipe(source=_upload_source()), _png())
        client.delete(f"/api/campaigns/{c['id']}/members/{mid}/token", headers=player_headers)
        assert _sources(f"member-{mid}") == []
        assert _member_row(client, c["id"], mid, player_headers)["token_editable"] is False

    def test_removing_the_member_removes_their_stored_art(
        self, client, gm_headers, player_headers, player_id, group
    ):
        c, mid = group
        _put_member_token(client, c["id"], mid, player_headers, _recipe(source=_upload_source()), _png())
        resp = client.delete(f"/api/campaigns/{c['id']}/members/{player_id}", headers=gm_headers)
        assert resp.status_code in (200, 204), resp.text
        assert _sources(f"member-{mid}") == []

    @pytest.mark.parametrize(
        "recipe, source, status",
        [
            ("not json", None, 400),
            (json.dumps({"size": 512}), None, 400),
            (_recipe(source={"type": "token"}), None, 400),
            (_recipe(source={"type": "upload"}), None, 400),
            (_recipe(size=99999), None, 400),
        ],
    )
    def test_a_bad_recipe_is_refused(self, client, player_headers, group, recipe, source, status):
        c, mid = group
        assert _put_member_token(client, c["id"], mid, player_headers, recipe, source).status_code == status

    def test_source_art_that_is_not_an_image_is_refused(self, client, player_headers, group):
        c, mid = group
        resp = _put_member_token(
            client, c["id"], mid, player_headers, _recipe(source=_upload_source()), b"nope"
        )
        assert resp.status_code == 400

    def test_a_token_with_no_recipe_has_none_to_read(self, client, player_headers, group):
        c, mid = group
        got = client.get(
            f"/api/campaigns/{c['id']}/token-recipes/member/{mid}", headers=player_headers
        )
        assert got.status_code == 404


class TestOwnerTokenRecipe:
    def test_kept_and_read_back(self, client, player_headers, personal):
        files, data = _files(_recipe(source=_upload_source()), _png())
        resp = client.post(
            f"/api/campaigns/{personal['id']}/owner/token", files=files, data=data, headers=player_headers
        )
        assert resp.status_code == 200, resp.text
        body = client.get(f"/api/campaigns/{personal['id']}", headers=player_headers).json()
        owner = next(m for m in body["members"] if m.get("is_owner"))
        assert owner["token_editable"] is True

        base = f"/api/campaigns/{personal['id']}/token-recipes/owner/{personal['id']}"
        assert client.get(base, headers=player_headers).json()["source"]["type"] == "upload"
        assert client.get(f"{base}/source", headers=player_headers).status_code == 200

    def test_names_only_its_own_campaign(self, client, player_headers, personal):
        files, data = _files(_recipe())
        client.post(
            f"/api/campaigns/{personal['id']}/owner/token", files=files, data=data, headers=player_headers
        )
        got = client.get(
            f"/api/campaigns/{personal['id']}/token-recipes/owner/{uuid.uuid4()}",
            headers=player_headers,
        )
        assert got.status_code == 404

    def test_only_the_owner_reads_it(self, client, gm_headers, player_headers, group):
        c, _ = group
        files, data = _files(_recipe())
        client.post(f"/api/campaigns/{c['id']}/owner/token", files=files, data=data, headers=gm_headers)
        got = client.get(
            f"/api/campaigns/{c['id']}/token-recipes/owner/{c['id']}", headers=player_headers
        )
        assert got.status_code == 403

    def test_deleting_it_removes_the_art(self, client, player_headers, personal):
        files, data = _files(_recipe(source=_upload_source()), _png())
        client.post(
            f"/api/campaigns/{personal['id']}/owner/token", files=files, data=data, headers=player_headers
        )
        client.delete(f"/api/campaigns/{personal['id']}/owner/token", headers=player_headers)
        assert _sources(f"owner-{personal['id']}") == []


def _file_token(client, cid, headers, recipe=None, source=None):
    files, data = _files(recipe, source)
    return client.post(f"/api/campaigns/{cid}/images", files=files, data=data, headers=headers)


def _resource(client, cid, file_id, headers):
    rows = client.get(f"/api/campaigns/{cid}/resources", headers=headers).json()
    rows = rows if isinstance(rows, list) else rows.get("resources", [])
    return next(r for r in rows if r["resource_id"] == file_id)


class TestFileTokenRecipe:
    def test_a_token_filed_as_a_resource_keeps_its_recipe(self, client, gm_headers, group):
        c, _ = group
        resp = _file_token(client, c["id"], gm_headers, _recipe(source=_upload_source()), _png())
        assert resp.status_code == 201, resp.text
        file_id = resp.json()["resource_id"]
        assert resp.json()["token_editable"] is True
        assert _resource(client, c["id"], file_id, gm_headers)["token_editable"] is True
        got = client.get(f"/api/campaigns/{c['id']}/token-recipes/file/{file_id}", headers=gm_headers)
        assert got.status_code == 200
        assert _sources(f"file-{file_id}")

    def test_a_plain_image_is_not_editable(self, client, gm_headers, group):
        c, _ = group
        file_id = _file_token(client, c["id"], gm_headers).json()["resource_id"]
        assert _resource(client, c["id"], file_id, gm_headers)["token_editable"] is False

    def test_players_cannot_read_a_files_recipe(self, client, gm_headers, player_headers, group):
        c, _ = group
        file_id = _file_token(client, c["id"], gm_headers, _recipe()).json()["resource_id"]
        got = client.get(
            f"/api/campaigns/{c['id']}/token-recipes/file/{file_id}", headers=player_headers
        )
        assert got.status_code == 403

    def test_an_unknown_file_is_404(self, client, gm_headers, group):
        c, _ = group
        got = client.get(
            f"/api/campaigns/{c['id']}/token-recipes/file/{uuid.uuid4()}", headers=gm_headers
        )
        assert got.status_code == 404

    def test_updating_in_place_keeps_the_resource(self, client, gm_headers, group):
        c, _ = group
        made = _file_token(client, c["id"], gm_headers, _recipe()).json()
        file_id = made["resource_id"]
        before = client.get(f"/api/campaigns/{c['id']}/files/{file_id}", headers=gm_headers).content

        files, data = _files(_recipe(size=1024, source=_upload_source()), _png())
        files["file"] = ("token.png", _png((9, 9, 9), (16, 16)), "image/png")
        resp = client.put(
            f"/api/campaigns/{c['id']}/files/{file_id}/token", files=files, data=data, headers=gm_headers
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"id": file_id, "token_editable": True}

        after = client.get(f"/api/campaigns/{c['id']}/files/{file_id}", headers=gm_headers)
        assert after.status_code == 200
        assert after.content != before
        assert _resource(client, c["id"], file_id, gm_headers)["id"] == made["id"]
        recipe = client.get(
            f"/api/campaigns/{c['id']}/token-recipes/file/{file_id}", headers=gm_headers
        ).json()
        assert recipe["size"] == 1024

    def test_updating_without_a_recipe_clears_it(self, client, gm_headers, group):
        c, _ = group
        file_id = _file_token(client, c["id"], gm_headers, _recipe()).json()["resource_id"]
        files, data = _files()
        resp = client.put(
            f"/api/campaigns/{c['id']}/files/{file_id}/token", files=files, data=data, headers=gm_headers
        )
        assert resp.json()["token_editable"] is False

    def test_only_the_gm_updates_a_file(self, client, gm_headers, player_headers, group):
        c, _ = group
        file_id = _file_token(client, c["id"], gm_headers, _recipe()).json()["resource_id"]
        files, data = _files(_recipe())
        resp = client.put(
            f"/api/campaigns/{c['id']}/files/{file_id}/token", files=files, data=data, headers=player_headers
        )
        assert resp.status_code == 403

    def test_only_an_image_is_replaced(self, client, gm_headers, group):
        c, _ = group
        doc = client.post(
            f"/api/campaigns/{c['id']}/files",
            files={"file": ("notes.txt", b"hello", "text/plain")},
            headers=gm_headers,
        ).json()
        files, data = _files(_recipe())
        resp = client.put(
            f"/api/campaigns/{c['id']}/files/{doc['resource_id']}/token",
            files=files,
            data=data,
            headers=gm_headers,
        )
        assert resp.status_code == 400

    def test_an_unknown_file_cannot_be_updated(self, client, gm_headers, group):
        c, _ = group
        files, data = _files(_recipe())
        resp = client.put(
            f"/api/campaigns/{c['id']}/files/{uuid.uuid4()}/token", files=files, data=data, headers=gm_headers
        )
        assert resp.status_code == 404

    def test_removing_the_resource_removes_its_art(self, client, gm_headers, group):
        c, _ = group
        made = _file_token(client, c["id"], gm_headers, _recipe(source=_upload_source()), _png()).json()
        client.delete(f"/api/campaigns/{c['id']}/resources/{made['id']}", headers=gm_headers)
        assert _sources(f"file-{made['resource_id']}") == []

    def test_deleting_the_campaign_removes_every_kept_art(self, client, gm_headers, player_headers, group):
        c, mid = group
        _put_member_token(client, c["id"], mid, player_headers, _recipe(source=_upload_source()), _png())
        made = _file_token(client, c["id"], gm_headers, _recipe(source=_upload_source()), _png()).json()
        files, data = _files(_recipe(source=_upload_source()), _png())
        client.post(f"/api/campaigns/{c['id']}/owner/token", files=files, data=data, headers=gm_headers)

        assert client.delete(f"/api/campaigns/{c['id']}", headers=gm_headers).status_code in (200, 204)
        assert _sources(f"member-{mid}") == []
        assert _sources(f"file-{made['resource_id']}") == []
        assert _sources(f"owner-{c['id']}") == []
