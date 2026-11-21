"""The campaign owner's own VTT token (``/campaigns/{id}/owner/token``).

A player running a personal campaign has no membership in it - their row in the
member list is synthetic - so their token lives on the campaign instead, apart
from their character sheet's portrait.
"""
import io
import os
import uuid

import pytest

from backend.routers.campaigns.uploads import _TOKEN_DIR


def _png_bytes(color=(120, 80, 200), size=(8, 8)):
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def _upload(client, cid, headers, data=None, mime="image/png"):
    return client.post(
        f"/api/campaigns/{cid}/owner/token",
        files={"file": ("token.png", data if data is not None else _png_bytes(), mime)},
        headers=headers,
    )


def _owner_row(client, cid, headers):
    body = client.get(f"/api/campaigns/{cid}", headers=headers).json()
    return next(m for m in body["members"] if m.get("is_owner"))


@pytest.fixture()
def personal(client, player_headers):
    """A personal campaign the player runs."""
    return client.post(
        "/api/campaigns",
        json={"name": f"Solo {uuid.uuid4().hex[:8]}", "is_gm_campaign": False},
        headers=player_headers,
    ).json()


@pytest.fixture()
def group(client, gm_headers, player_headers, player_id):
    """A GM's campaign the player has joined."""
    c = client.post(
        "/api/campaigns",
        json={"name": f"Group {uuid.uuid4().hex[:8]}", "is_gm_campaign": True},
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
    return c


class TestOwnerToken:
    def test_owner_sets_their_token(self, client, player_headers, personal):
        resp = _upload(client, personal["id"], player_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["owner_token_path"] == f"owner-{personal['id']}.png"
        assert _owner_row(client, personal["id"], player_headers)["has_token"] is True

    def test_owner_row_reports_no_token_by_default(self, client, player_headers, personal):
        assert _owner_row(client, personal["id"], player_headers)["has_token"] is False

    def test_token_is_served_back(self, client, player_headers, personal):
        _upload(client, personal["id"], player_headers)
        resp = client.get(f"/api/campaigns/{personal['id']}/owner/token", headers=player_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("image/")

    def test_missing_token_is_404(self, client, player_headers, personal):
        resp = client.get(f"/api/campaigns/{personal['id']}/owner/token", headers=player_headers)
        assert resp.status_code == 404

    def test_a_token_whose_file_is_gone_is_404(self, client, player_headers, personal):
        path = _upload(client, personal["id"], player_headers).json()["owner_token_path"]
        os.remove(os.path.join(_TOKEN_DIR, path))
        resp = client.get(f"/api/campaigns/{personal['id']}/owner/token", headers=player_headers)
        assert resp.status_code == 404

    def test_replacing_keeps_one_file(self, client, player_headers, personal):
        _upload(client, personal["id"], player_headers)
        jpeg = io.BytesIO()
        from PIL import Image

        Image.new("RGB", (8, 8), (10, 20, 30)).save(jpeg, format="JPEG")
        resp = _upload(client, personal["id"], player_headers, jpeg.getvalue(), "image/jpeg")
        assert resp.status_code == 200, resp.text
        stem = f"owner-{personal['id']}"
        left = [n for n in os.listdir(_TOKEN_DIR) if n.rsplit(".", 1)[0] == stem]
        assert left == [resp.json()["owner_token_path"]]

    def test_delete_clears_it(self, client, player_headers, personal):
        path = _upload(client, personal["id"], player_headers).json()["owner_token_path"]
        resp = client.delete(f"/api/campaigns/{personal['id']}/owner/token", headers=player_headers)
        assert resp.status_code == 204
        assert _owner_row(client, personal["id"], player_headers)["has_token"] is False
        assert not os.path.exists(os.path.join(_TOKEN_DIR, path))

    def test_rejects_a_non_image(self, client, player_headers, personal):
        resp = _upload(client, personal["id"], player_headers, b"not an image", "text/plain")
        assert resp.status_code == 400

    def test_only_the_owner_sets_it(self, client, gm_headers, player_headers, group):
        # The player is in the GM's campaign, but the owner's slot is the GM's.
        assert _upload(client, group["id"], player_headers).status_code == 403
        assert (
            client.delete(
                f"/api/campaigns/{group['id']}/owner/token", headers=player_headers
            ).status_code
            == 403
        )

    def test_members_can_see_the_owners_token(self, client, gm_headers, player_headers, group):
        assert _upload(client, group["id"], gm_headers).status_code == 200
        resp = client.get(f"/api/campaigns/{group['id']}/owner/token", headers=player_headers)
        assert resp.status_code == 200

    def test_outsiders_cannot_see_it(self, client, gm_headers, player_headers, personal):
        _upload(client, personal["id"], player_headers)
        resp = client.get(f"/api/campaigns/{personal['id']}/owner/token", headers=gm_headers)
        assert resp.status_code == 403

    def test_archived_campaign_refuses_a_new_token(self, client, player_headers, personal):
        client.put(
            f"/api/campaigns/{personal['id']}/archive",
            json={"archived": True},
            headers=player_headers,
        )
        assert _upload(client, personal["id"], player_headers).status_code == 409

    def test_deleting_the_campaign_removes_the_file(self, client, player_headers, personal):
        path = _upload(client, personal["id"], player_headers).json()["owner_token_path"]
        resp = client.delete(f"/api/campaigns/{personal['id']}", headers=player_headers)
        assert resp.status_code in (200, 204), resp.text
        assert not os.path.exists(os.path.join(_TOKEN_DIR, path))

    def test_a_members_token_is_untouched(self, client, gm_headers, player_headers, group):
        """The owner's slot and a membership's live side by side in one directory."""
        body = client.get(f"/api/campaigns/{group['id']}", headers=gm_headers).json()
        member_id = next(m["id"] for m in body["members"] if not m.get("is_owner"))
        client.post(
            f"/api/campaigns/{group['id']}/members/{member_id}/token",
            files={"file": ("token.png", _png_bytes(), "image/png")},
            headers=player_headers,
        )
        _upload(client, group["id"], gm_headers)
        client.delete(f"/api/campaigns/{group['id']}/owner/token", headers=gm_headers)

        body = client.get(f"/api/campaigns/{group['id']}", headers=gm_headers).json()
        member = next(m for m in body["members"] if m.get("id") == member_id)
        assert member["has_token"] is True
