"""The token editor's kept source art is bound by the campaign upload limits.

Art from the device that a token recipe keeps (``token_sources/``) counts
towards the campaign's storage total, and for non-admins the per-file cap and
the uploads-off switch apply to it, on all four token uploads. Replacing a
token's art counts only what the new art adds. A refused upload writes nothing.
"""
import io
import json
import math
import os
import uuid

import pytest
from PIL import Image

from backend.config import SessionLocal
from backend.models import Campaign, CampaignFile, CampaignMember
from backend.services.app_settings import set_raw
from backend.services.campaigns.token_recipes import TOKEN_SOURCE_DIR
from backend.services.campaigns.upload_quota import (
    campaign_source_bytes,
    campaign_upload_bytes,
)

MB = 1024 * 1024
UPLOAD_RECIPE = json.dumps({"size": 256, "source": {"type": "upload"}})
LIBRARY_RECIPE = json.dumps({"size": 256, "source": {"type": "token", "id": "tok-1"}})


def _png(size=(8, 8), color=(120, 80, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def _noise_png(at_least: int) -> bytes:
    """A PNG of random pixels, which do not compress, of at least ``at_least`` bytes."""
    side = math.isqrt(at_least // 3) + 1
    buf = io.BytesIO()
    Image.frombytes("RGB", (side, side), os.urandom(side * side * 3)).save(buf, format="PNG")
    data = buf.getvalue()
    assert len(data) >= at_least
    return data


@pytest.fixture()
def limits():
    """Set the campaign upload settings for one test, restoring the defaults after."""

    def apply(total_mb=0, file_mb=0, disabled=False):
        db = SessionLocal()
        set_raw(db, "campaign_upload_max_total_mb", str(total_mb))
        set_raw(db, "campaign_upload_max_file_mb", str(file_mb))
        set_raw(db, "campaign_uploads_disabled", "true" if disabled else "false")
        db.commit()
        db.close()

    yield apply
    apply()


def _sources() -> set[str]:
    return set(os.listdir(TOKEN_SOURCE_DIR)) if os.path.isdir(TOKEN_SOURCE_DIR) else set()


def _source_size(stem: str) -> int:
    names = [n for n in _sources() if n.rsplit(".", 1)[0] == stem]
    return sum(os.path.getsize(os.path.join(TOKEN_SOURCE_DIR, n)) for n in names)


def _campaign(client, headers, gm=True) -> str:
    resp = client.post(
        "/api/campaigns",
        json={"name": f"Sources {uuid.uuid4().hex[:8]}", "is_gm_campaign": gm},
        headers=headers,
    )
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


def _fill(campaign_id: str, size: int) -> None:
    """Record ``size`` bytes of storage the campaign already uses."""
    db = SessionLocal()
    db.add(
        CampaignFile(
            campaign_id=campaign_id,
            stored_path=f"{uuid.uuid4().hex}.bin",
            filename="filler.bin",
            mime_type="application/octet-stream",
            size_bytes=size,
            is_image=False,
        )
    )
    db.commit()
    db.close()


def _used(campaign_id: str) -> int:
    db = SessionLocal()
    try:
        return campaign_upload_bytes(db, campaign_id)
    finally:
        db.close()


def _token_files(picture, recipe, source):
    files = {"file": ("token.png", picture, "image/png")}
    if source is not None:
        files["source"] = ("art.png", source, "image/png")
    return files, ({"recipe": recipe} if recipe else {})


def _image(client, headers, cid, source=None, recipe=UPLOAD_RECIPE, picture=None):
    files, data = _token_files(picture or _png(), recipe, source)
    return client.post(f"/api/campaigns/{cid}/images", files=files, data=data, headers=headers)


def _replace(client, headers, cid, file_id, source=None, recipe=UPLOAD_RECIPE, picture=None):
    files, data = _token_files(picture or _png(), recipe, source)
    return client.put(
        f"/api/campaigns/{cid}/files/{file_id}/token", files=files, data=data, headers=headers
    )


def _member_token(client, headers, cid, mid, source=None, recipe=UPLOAD_RECIPE):
    files, data = _token_files(_png(), recipe, source)
    return client.post(
        f"/api/campaigns/{cid}/members/{mid}/token", files=files, data=data, headers=headers
    )


def _owner_token(client, headers, cid, source=None, recipe=UPLOAD_RECIPE):
    files, data = _token_files(_png(), recipe, source)
    return client.post(f"/api/campaigns/{cid}/owner/token", files=files, data=data, headers=headers)


def _file_count(cid: str) -> int:
    db = SessionLocal()
    try:
        return db.query(CampaignFile).filter_by(campaign_id=cid).count()
    finally:
        db.close()


@pytest.fixture()
def group(client, gm_headers, player_headers, player_id):
    """A GM's campaign the player has joined; returns (campaign id, member id)."""
    cid = _campaign(client, gm_headers)
    client.post(f"/api/campaigns/{cid}/invite", json={"user_id": player_id}, headers=gm_headers)
    client.patch(
        f"/api/campaigns/{cid}/members/{player_id}",
        json={"status": "accepted"},
        headers=player_headers,
    )
    body = client.get(f"/api/campaigns/{cid}", headers=gm_headers).json()
    return cid, next(m["id"] for m in body["members"] if not m.get("is_owner"))


class TestCampaignImage:
    def test_source_past_the_total_is_413_and_leaves_nothing(self, client, gm_headers, limits):
        cid = _campaign(client, gm_headers)
        limits(total_mb=1)
        before = _sources()
        resp = _image(client, gm_headers, cid, _noise_png(2 * MB))
        assert resp.status_code == 413
        assert resp.json()["detail"] == "Campaign upload storage limit reached"
        assert _sources() == before
        assert _file_count(cid) == 0

    def test_picture_and_source_count_together(self, client, gm_headers, limits):
        # Each fits on its own; the two together do not.
        cid = _campaign(client, gm_headers)
        picture, source = _png(), _noise_png(4096)
        # One byte short of room for both, whatever size the PNGs encode to.
        _fill(cid, MB - (len(picture) + len(source) - 1))
        limits(total_mb=1)
        resp = _image(client, gm_headers, cid, source, picture=picture)
        assert resp.status_code == 413

    def test_the_per_file_cap_applies_to_the_source(self, client, gm_headers, limits):
        cid = _campaign(client, gm_headers)
        limits(file_mb=1)
        before = _sources()
        resp = _image(client, gm_headers, cid, _noise_png(MB + 1))
        assert resp.status_code == 413
        assert resp.json()["detail"] == "Source art exceeds the per-file size limit"
        assert _sources() == before
        assert _file_count(cid) == 0

    def test_the_source_is_counted_afterwards(self, client, gm_headers):
        cid = _campaign(client, gm_headers)
        picture, art = _png(), _noise_png(200_000)
        resp = _image(client, gm_headers, cid, art, picture=picture)
        assert resp.status_code == 201, resp.text
        assert _used(cid) == len(picture) + len(art)

    def test_a_library_recipe_keeps_no_art(self, client, gm_headers, limits):
        cid = _campaign(client, gm_headers)
        limits(total_mb=1, file_mb=1)
        resp = _image(client, gm_headers, cid, recipe=LIBRARY_RECIPE)
        assert resp.status_code == 201, resp.text
        assert _source_size(f"file-{resp.json()['resource_id']}") == 0

    def test_admins_are_exempt(self, client, admin_headers, limits):
        cid = _campaign(client, admin_headers)
        limits(total_mb=1, file_mb=1, disabled=True)
        resp = _image(client, admin_headers, cid, _noise_png(2 * MB))
        assert resp.status_code == 201, resp.text
        assert _used(cid) > 2 * MB


class TestTokenReplace:
    def _setup(self, client, headers, art):
        cid = _campaign(client, headers)
        resp = _image(client, headers, cid, art)
        assert resp.status_code == 201, resp.text
        return cid, resp.json()["resource_id"]

    def test_a_source_no_larger_is_saved_at_the_limit(self, client, gm_headers, limits):
        art = _noise_png(400_000)
        cid, file_id = self._setup(client, gm_headers, art)
        # The campaign is exactly full; the old picture and art make room for the new.
        _fill(cid, MB - _used(cid))
        limits(total_mb=1)
        resp = _replace(client, gm_headers, cid, file_id, art)
        assert resp.status_code == 200, resp.text
        assert _used(cid) == MB

    def test_a_source_that_grows_past_the_total_is_413(self, client, gm_headers, limits):
        art = _noise_png(400_000)
        cid, file_id = self._setup(client, gm_headers, art)
        _fill(cid, MB - _used(cid))
        limits(total_mb=1)
        resp = _replace(client, gm_headers, cid, file_id, _noise_png(500_000))
        assert resp.status_code == 413
        # The old art and recipe are still there.
        assert _source_size(f"file-{file_id}") == len(art)
        db = SessionLocal()
        try:
            assert db.get(CampaignFile, file_id).token_recipe["source"]["type"] == "upload"
        finally:
            db.close()

    def test_dropping_the_source_frees_its_room(self, client, gm_headers, limits):
        art = _noise_png(400_000)
        cid, file_id = self._setup(client, gm_headers, art)
        _fill(cid, 2 * MB)
        limits(total_mb=1)
        # Over a limit since lowered, a replace that shrinks the campaign is saved.
        resp = _replace(client, gm_headers, cid, file_id, recipe=LIBRARY_RECIPE)
        assert resp.status_code == 200, resp.text
        assert _source_size(f"file-{file_id}") == 0

    def test_the_per_file_cap_applies_to_the_source(self, client, gm_headers, limits):
        cid, file_id = self._setup(client, gm_headers, _png())
        limits(file_mb=1)
        resp = _replace(client, gm_headers, cid, file_id, _noise_png(MB + 1))
        assert resp.status_code == 413
        assert resp.json()["detail"] == "Source art exceeds the per-file size limit"

    def test_admins_are_exempt(self, client, admin_headers, limits):
        cid, file_id = self._setup(client, admin_headers, _png())
        limits(total_mb=1, file_mb=1)
        assert _replace(client, admin_headers, cid, file_id, _noise_png(2 * MB)).status_code == 200


class TestMemberToken:
    def test_uploads_off_refuses_the_source(self, client, player_headers, group, limits):
        cid, mid = group
        limits(disabled=True)
        before = _sources()
        resp = _member_token(client, player_headers, cid, mid, _png((16, 16)))
        assert resp.status_code == 403
        assert _sources() == before

    def test_uploads_off_still_takes_a_token_without_art(
        self, client, player_headers, group, limits
    ):
        cid, mid = group
        limits(disabled=True)
        assert _member_token(client, player_headers, cid, mid, recipe=LIBRARY_RECIPE).status_code == 200
        assert _member_token(client, player_headers, cid, mid, recipe=None).status_code == 200

    def test_the_per_file_cap_applies(self, client, player_headers, group, limits):
        cid, mid = group
        limits(file_mb=1)
        resp = _member_token(client, player_headers, cid, mid, _noise_png(MB + 1))
        assert resp.status_code == 413
        assert _source_size(f"member-{mid}") == 0

    def test_the_source_counts_towards_the_total(self, client, player_headers, group, limits):
        cid, mid = group
        art = _noise_png(300_000)
        assert _member_token(client, player_headers, cid, mid, art).status_code == 200
        assert _used(cid) == len(art)

        _fill(cid, MB - _used(cid))
        limits(total_mb=1)
        # Art of the same size replaces the old; anything larger does not fit.
        assert _member_token(client, player_headers, cid, mid, art).status_code == 200
        resp = _member_token(client, player_headers, cid, mid, _noise_png(400_000))
        assert resp.status_code == 413
        assert _source_size(f"member-{mid}") == len(art)

    def test_admins_are_exempt(self, client, admin_headers, limits):
        cid = _campaign(client, admin_headers)
        db = SessionLocal()
        try:
            c = db.get(Campaign, cid)
            member = CampaignMember(campaign_id=cid, user_id=c.owner_id, status="accepted")
            db.add(member)
            db.commit()
            mid = member.id
        finally:
            db.close()
        limits(total_mb=1, file_mb=1, disabled=True)
        resp = _member_token(client, admin_headers, cid, mid, _noise_png(2 * MB))
        assert resp.status_code == 200, resp.text


class TestOwnerToken:
    def test_uploads_off_refuses_the_source(self, client, player_headers, limits):
        cid = _campaign(client, player_headers, gm=False)
        limits(disabled=True)
        resp = _owner_token(client, player_headers, cid, _png((16, 16)))
        assert resp.status_code == 403
        assert _source_size(f"owner-{cid}") == 0

    def test_the_source_counts_towards_the_total(self, client, player_headers, limits):
        cid = _campaign(client, player_headers, gm=False)
        art = _noise_png(300_000)
        assert _owner_token(client, player_headers, cid, art).status_code == 200
        assert _used(cid) == len(art)
        limits(total_mb=1)
        resp = _owner_token(client, player_headers, cid, _noise_png(2 * MB))
        assert resp.status_code == 413
        assert _source_size(f"owner-{cid}") == len(art)

    def test_admins_are_exempt(self, client, admin_headers, limits):
        cid = _campaign(client, admin_headers, gm=False)
        limits(total_mb=1, file_mb=1, disabled=True)
        assert _owner_token(client, admin_headers, cid, _noise_png(2 * MB)).status_code == 200


class TestHelpers:
    def test_art_gone_from_disk_takes_no_room(self, client, gm_headers):
        cid = _campaign(client, gm_headers)
        resp = _image(client, gm_headers, cid, _png((16, 16)))
        file_id = resp.json()["resource_id"]
        for name in _sources():
            if name.startswith(f"file-{file_id}"):
                os.remove(os.path.join(TOKEN_SOURCE_DIR, name))
        db = SessionLocal()
        try:
            assert campaign_source_bytes(db, cid) == 0
        finally:
            db.close()
