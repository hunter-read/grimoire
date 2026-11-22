"""The per-campaign storage total holds on every upload that adds a campaign file.

The admin's ``campaign_upload_max_total_mb`` bounds a plain file upload, an
image embedded in a note, and a token replaced in place - the last counting
only what the new picture adds. Admins are exempt.
"""
import io
import uuid

import pytest
from fastapi import HTTPException
from PIL import Image

from backend.config import SessionLocal
from backend.models import CampaignFile
from backend.services.app_settings import set_raw
from backend.services.campaigns.upload_quota import (
    assert_within_campaign_quota,
    campaign_upload_bytes,
)

MB = 1024 * 1024


def _png(size=(8, 8), color=(120, 80, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture()
def limit():
    """Set the per-campaign total (in MB) for one test, restoring "unlimited" after."""

    def apply(mb):
        db = SessionLocal()
        set_raw(db, "campaign_upload_max_total_mb", str(mb))
        db.commit()
        db.close()

    yield apply
    apply(0)


def _campaign(client, headers) -> str:
    resp = client.post(
        "/api/campaigns", json={"name": f"Quota {uuid.uuid4().hex[:8]}"}, headers=headers
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


def _upload_file(client, headers, cid, data=b"hello"):
    return client.post(
        f"/api/campaigns/{cid}/files",
        files={"file": ("notes.txt", data, "text/plain")},
        headers=headers,
    )


def _upload_image(client, headers, cid, data=None):
    return client.post(
        f"/api/campaigns/{cid}/images",
        files={"file": ("art.png", data or _png(), "image/png")},
        headers=headers,
    )


def _replace_token(client, headers, cid, file_id, data):
    return client.put(
        f"/api/campaigns/{cid}/files/{file_id}/token",
        files={"file": ("token.png", data, "image/png")},
        headers=headers,
    )


def _row(file_id: str) -> CampaignFile:
    db = SessionLocal()
    cf = db.query(CampaignFile).filter_by(id=file_id).one()
    db.expunge(cf)
    db.close()
    return cf


class TestFileUpload:
    def test_an_upload_past_the_total_is_413(self, client, gm_headers, limit):
        cid = _campaign(client, gm_headers)
        _fill(cid, MB - 2)
        limit(1)
        resp = _upload_file(client, gm_headers, cid, b"abc")
        assert resp.status_code == 413
        assert resp.json()["detail"] == "Campaign upload storage limit reached"

    def test_an_upload_that_fits_goes_through(self, client, gm_headers, limit):
        cid = _campaign(client, gm_headers)
        _fill(cid, MB - 3)
        limit(1)
        assert _upload_file(client, gm_headers, cid, b"abc").status_code == 201

    def test_admins_are_exempt(self, client, admin_headers, limit):
        cid = _campaign(client, admin_headers)
        _fill(cid, MB)
        limit(1)
        assert _upload_file(client, admin_headers, cid).status_code == 201


class TestImageUpload:
    def test_an_image_past_the_total_is_413(self, client, gm_headers, limit):
        cid = _campaign(client, gm_headers)
        _fill(cid, MB)
        limit(1)
        resp = _upload_image(client, gm_headers, cid)
        assert resp.status_code == 413
        assert resp.json()["detail"] == "Campaign upload storage limit reached"

    def test_an_image_that_fits_goes_through(self, client, gm_headers, limit):
        cid = _campaign(client, gm_headers)
        limit(1)
        assert _upload_image(client, gm_headers, cid).status_code == 201

    def test_admins_are_exempt(self, client, admin_headers, limit):
        cid = _campaign(client, admin_headers)
        _fill(cid, MB)
        limit(1)
        assert _upload_image(client, admin_headers, cid).status_code == 201

    def test_the_type_comes_from_the_stored_extension(self, client, gm_headers):
        cid = _campaign(client, gm_headers)
        resp = _upload_image(client, gm_headers, cid)
        cf = _row(resp.json()["resource_id"])
        assert cf.stored_path.endswith(".png")
        assert cf.mime_type == "image/png"


class TestTokenReplace:
    def _setup(self, client, headers, picture):
        cid = _campaign(client, headers)
        resp = _upload_image(client, headers, cid, picture)
        assert resp.status_code == 201, resp.text
        return cid, resp.json()["resource_id"]

    def test_a_replace_that_grows_past_the_total_is_413(self, client, gm_headers, limit):
        small, big = _png((4, 4)), _png((64, 64), (1, 2, 3))
        cid, file_id = self._setup(client, gm_headers, small)
        # Room for the old picture and not one byte more.
        _fill(cid, MB - len(small))
        limit(1)
        resp = _replace_token(client, gm_headers, cid, file_id, big)
        assert resp.status_code == 413
        assert _row(file_id).size_bytes == len(small)

    def test_only_the_difference_counts(self, client, gm_headers, limit):
        # The campaign is exactly at its limit; a picture of the same size
        # replaces the old one without needing any more room.
        picture = _png((16, 16))
        cid, file_id = self._setup(client, gm_headers, picture)
        _fill(cid, MB - len(picture))
        limit(1)
        resp = _replace_token(client, gm_headers, cid, file_id, _png((16, 16), (5, 5, 5)))
        assert resp.status_code == 200, resp.text

    def test_a_replace_that_shrinks_is_allowed_over_the_limit(self, client, gm_headers, limit):
        big, small = _png((64, 64), (1, 2, 3)), _png((4, 4))
        cid, file_id = self._setup(client, gm_headers, big)
        # Already past a limit the admin has since lowered.
        _fill(cid, 2 * MB)
        limit(1)
        resp = _replace_token(client, gm_headers, cid, file_id, small)
        assert resp.status_code == 200, resp.text
        cf = _row(file_id)
        assert cf.size_bytes == len(small)
        assert cf.mime_type == "image/png"

    def test_admins_are_exempt(self, client, admin_headers, limit):
        small, big = _png((4, 4)), _png((64, 64), (1, 2, 3))
        cid, file_id = self._setup(client, admin_headers, small)
        _fill(cid, 2 * MB)
        limit(1)
        assert _replace_token(client, admin_headers, cid, file_id, big).status_code == 200


class TestHelpers:
    def test_used_bytes_are_summed_per_campaign(self, client, gm_headers):
        cid, other = _campaign(client, gm_headers), _campaign(client, gm_headers)
        _fill(cid, 10)
        _fill(cid, 32)
        _fill(other, 1000)
        db = SessionLocal()
        try:
            assert campaign_upload_bytes(db, cid) == 42
            assert campaign_upload_bytes(db, str(uuid.uuid4())) == 0
        finally:
            db.close()

    def test_no_total_means_no_limit(self, client, gm_headers, limit):
        cid = _campaign(client, gm_headers)
        _fill(cid, 5 * MB)
        limit(0)
        db = SessionLocal()
        try:
            assert_within_campaign_quota(db, cid, MB)
        finally:
            db.close()

    def test_the_check_counts_growth_only(self, client, gm_headers, limit):
        cid = _campaign(client, gm_headers)
        _fill(cid, MB - 10)
        limit(1)
        db = SessionLocal()
        try:
            assert_within_campaign_quota(db, cid, 10)
            assert_within_campaign_quota(db, cid, 100, replacing=90)
            with pytest.raises(HTTPException) as err:
                assert_within_campaign_quota(db, cid, 100, replacing=89)
            assert err.value.status_code == 413
        finally:
            db.close()
