"""Authorization regression tests for media content routes (maps/tokens/audio).

The by-id content routes (`/{id}`, `/{id}/file`, thumbnail/artwork) bypass the
library-browse guard (`require_not_guest`) so campaign-shared items still render.
Each handler must therefore authorise the caller itself:

  * Guests may only read an item shared into a campaign they belong to, at a
    visibility that permits them (public → any member, private → shared users,
    gm → owner only).
  * Explicit tokens are denied to non-guests who disabled explicit content; an
    item shared into a guest's campaign is served regardless of the flag.
"""
import os
import tempfile

import pytest

from backend.config import SessionLocal
from backend.models import User
from .conftest import make_audio, make_map, make_token


def uid() -> str:
    import uuid

    return str(uuid.uuid4())[:8]


# Per media type: (resource_type, url-prefix, factory, file-suffix, content-route,
# secondary-route). content-route and secondary-route are the by-id sub-paths.
_MEDIA = {
    "map": ("maps", make_map, ".png", "/file", "/thumbnail"),
    "token": ("tokens", make_token, ".png", "/file", "/thumbnail"),
    "audio": ("audio", make_audio, ".mp3", "/file", "/artwork"),
}


def _make_with_file(rtype, **kwargs):
    """Create a media row whose filepath points at a real (tiny) file on disk."""
    _, factory, suffix, _, _ = _MEDIA[rtype]
    f = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    f.write(b"stub-bytes")
    f.close()
    obj = factory(
        filepath=f.name,
        filename=os.path.basename(f.name),
        relative_path=f"System/Folder/{os.path.basename(f.name)}",
        **kwargs,
    )
    return obj, f.name


def _add_resource(client, gm_headers, campaign_id, rtype, rid, visibility, shared_user_ids=None):
    payload = {"resource_type": rtype, "resource_id": rid, "visibility": visibility}
    if shared_user_ids is not None:
        payload["shared_user_ids"] = shared_user_ids
    resp = client.post(
        f"/api/campaigns/{campaign_id}/resources", json=payload, headers=gm_headers
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture
def guest_campaign(client, gm_headers, admin_headers):
    client.patch(
        "/api/settings", json={"guest_access_enabled": True}, headers=admin_headers
    )
    resp = client.post(
        "/api/campaigns",
        json={"name": f"Media Access {uid()}", "is_gm_campaign": True},
        headers=gm_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


@pytest.fixture
def guest(client, gm_headers, guest_campaign):
    """A logged-in guest of `guest_campaign`. Returns (headers, user_id)."""
    created = client.post(
        f"/api/campaigns/{guest_campaign}/guests",
        json={"nickname": "MediaGuest"},
        headers=gm_headers,
    ).json()
    login = client.post("/api/auth/guest-login", json={"code": created["guest_code"]})
    assert login.status_code == 200, login.text
    assert login.json()["user"]["role"] == "guest"
    return {"Authorization": f"Bearer {login.json()['token']}"}, created["user_id"]


ALL_TYPES = ["map", "token", "audio"]


@pytest.mark.parametrize("rtype", ALL_TYPES)
class TestGuestMediaScoping:
    def _routes(self, rtype, rid):
        prefix, _, _, content, secondary = _MEDIA[rtype]
        base = f"/api/{prefix}/{rid}"
        return [base, base + content, base + secondary]

    def test_guest_denied_unshared_item(self, client, guest, rtype):
        guest_headers, _ = guest
        obj, path = _make_with_file(rtype)
        try:
            for url in self._routes(rtype, obj.id):
                r = client.get(url, headers=guest_headers)
                assert r.status_code == 403, f"{url} → {r.status_code}, expected 403"
        finally:
            os.unlink(path)

    def test_guest_allowed_public_shared_item(
        self, client, gm_headers, guest_campaign, guest, rtype
    ):
        guest_headers, _ = guest
        obj, path = _make_with_file(rtype)
        try:
            _add_resource(client, gm_headers, guest_campaign, rtype, obj.id, "public")
            prefix = _MEDIA[rtype][0]
            r = client.get(f"/api/{prefix}/{obj.id}/file", headers=guest_headers)
            assert r.status_code == 200, r.text
        finally:
            os.unlink(path)

    def test_guest_denied_gm_only_shared_item(
        self, client, gm_headers, guest_campaign, guest, rtype
    ):
        guest_headers, _ = guest
        obj, path = _make_with_file(rtype)
        try:
            _add_resource(client, gm_headers, guest_campaign, rtype, obj.id, "gm")
            prefix = _MEDIA[rtype][0]
            r = client.get(f"/api/{prefix}/{obj.id}/file", headers=guest_headers)
            assert r.status_code == 403, r.text
        finally:
            os.unlink(path)

    def test_guest_denied_private_not_shared_with_them(
        self, client, gm_headers, guest_campaign, guest, rtype
    ):
        guest_headers, _ = guest
        obj, path = _make_with_file(rtype)
        try:
            _add_resource(
                client, gm_headers, guest_campaign, rtype, obj.id, "private", shared_user_ids=[]
            )
            prefix = _MEDIA[rtype][0]
            r = client.get(f"/api/{prefix}/{obj.id}/file", headers=guest_headers)
            assert r.status_code == 403, r.text
        finally:
            os.unlink(path)

    def test_guest_allowed_private_shared_with_them(
        self, client, gm_headers, guest_campaign, guest, rtype
    ):
        guest_headers, guest_id = guest
        obj, path = _make_with_file(rtype)
        try:
            _add_resource(
                client,
                gm_headers,
                guest_campaign,
                rtype,
                obj.id,
                "private",
                shared_user_ids=[guest_id],
            )
            prefix = _MEDIA[rtype][0]
            r = client.get(f"/api/{prefix}/{obj.id}/file", headers=guest_headers)
            assert r.status_code == 200, r.text
        finally:
            os.unlink(path)

    def test_guest_denied_item_shared_into_other_campaign(
        self, client, gm_headers, guest, rtype
    ):
        guest_headers, _ = guest
        obj, path = _make_with_file(rtype)
        try:
            other = client.post(
                "/api/campaigns",
                json={"name": f"Other {uid()}", "is_gm_campaign": True},
                headers=gm_headers,
            ).json()
            _add_resource(client, gm_headers, other["id"], rtype, obj.id, "public")
            prefix = _MEDIA[rtype][0]
            r = client.get(f"/api/{prefix}/{obj.id}/file", headers=guest_headers)
            assert r.status_code == 403, r.text
        finally:
            os.unlink(path)


class TestNonGuestMediaUnaffected:
    """Players/admins keep library-wide read access to media by id."""

    @pytest.mark.parametrize("rtype", ALL_TYPES)
    def test_player_can_read_any_item(self, client, player_headers, rtype):
        obj, path = _make_with_file(rtype)
        try:
            prefix = _MEDIA[rtype][0]
            assert (
                client.get(f"/api/{prefix}/{obj.id}", headers=player_headers).status_code
                == 200
            )
            assert (
                client.get(
                    f"/api/{prefix}/{obj.id}/file", headers=player_headers
                ).status_code
                == 200
            )
        finally:
            os.unlink(path)


class TestExplicitTokenEnforcement:
    """Explicit tokens honour allow_explicit on the file/thumbnail routes."""

    def _set_explicit_pref(self, username, allow):
        db = SessionLocal()
        u = db.query(User).filter_by(username=username).first()
        u.allow_explicit = allow
        db.commit()
        db.close()

    def test_explicit_token_file_denied_when_disabled(self, client, player_headers):
        self._set_explicit_pref("playeruser", False)
        try:
            obj, path = _make_with_file("token", is_explicit=True)
            try:
                r = client.get(f"/api/tokens/{obj.id}/file", headers=player_headers)
                assert r.status_code == 403, r.text
                # get_token already enforced this; the file route now matches.
                assert (
                    client.get(
                        f"/api/tokens/{obj.id}", headers=player_headers
                    ).status_code
                    == 403
                )
            finally:
                os.unlink(path)
        finally:
            self._set_explicit_pref("playeruser", True)

    def test_explicit_token_served_to_guest_when_shared(
        self, client, gm_headers, admin_headers
    ):
        # A guest has no NSFW preference: an explicit token shared into their
        # campaign is served regardless of the explicit flag.
        client.patch(
            "/api/settings", json={"guest_access_enabled": True}, headers=admin_headers
        )
        campaign = client.post(
            "/api/campaigns",
            json={"name": f"NSFW Guest {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        created = client.post(
            f"/api/campaigns/{campaign['id']}/guests",
            json={"nickname": "NsfwGuest"},
            headers=gm_headers,
        ).json()
        guest_headers = {
            "Authorization": "Bearer "
            + client.post(
                "/api/auth/guest-login", json={"code": created["guest_code"]}
            ).json()["token"]
        }

        obj, path = _make_with_file("token", is_explicit=True)
        try:
            _add_resource(client, gm_headers, campaign["id"], "token", obj.id, "public")
            r = client.get(f"/api/tokens/{obj.id}/file", headers=guest_headers)
            assert r.status_code == 200, r.text
        finally:
            os.unlink(path)
