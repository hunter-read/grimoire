"""A campaign's uploads leave the disk with it.

Deleting a campaign, or the account that owns it, deletes the rows naming its
banner, files and members' art, tokens and sheets; the files themselves must go
too, or they linger in DATA_PATH and in every backup. They wait for the commit,
so a delete that rolls back costs nobody their files.
"""
import io
import os
import uuid

from PIL import Image

from backend.config import SessionLocal
from backend.models import Campaign, CampaignFile, CampaignMember, User
from backend.services.campaigns.upload_files import (
    ART_DIR,
    BANNER_DIR,
    FILES_DIR,
    SHEET_DIR,
    TOKEN_DIR,
    campaign_upload_paths,
    remove_after_commit,
)
from backend.services.campaigns.user_data import purge_user_data, reassign_user_data
from backend.sessions import delete_user_sessions


def uid():
    return uuid.uuid4().hex[:8]


def png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 6), (90, 40, 160)).save(buf, "PNG")
    return buf.getvalue()


def _new_gm(client, admin_headers):
    username = f"gm_{uid()}"
    password = "gm-password-long-enough"
    user = client.post(
        "/api/users",
        json={"username": username, "password": password, "role": "gm"},
        headers=admin_headers,
    ).json()
    token = client.post(
        "/api/auth/login", json={"username": username, "password": password}
    ).json()["token"]
    client.cookies.clear()
    return user["id"], {"Authorization": f"Bearer {token}"}


def _campaign(client, headers, player_id=None, player_headers=None):
    cid = client.post(
        "/api/campaigns", json={"name": f"Uploads {uid()}", "is_gm_campaign": True}, headers=headers
    ).json()["id"]
    if player_id:
        client.post(f"/api/campaigns/{cid}/invite", json={"user_id": player_id}, headers=headers)
        client.patch(
            f"/api/campaigns/{cid}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )
    return cid


def _member_id(cid, user_id):
    db = SessionLocal()
    try:
        return db.query(CampaignMember).filter_by(campaign_id=cid, user_id=user_id).one().id
    finally:
        db.close()


def _upload_everything(client, cid, gm_headers, member_id=None, member_headers=None):
    """A file, an image, a banner and - for a member - art, a token and a sheet."""
    def ok(resp):
        assert resp.status_code in (200, 201), resp.text

    ok(client.post(
        f"/api/campaigns/{cid}/files",
        files={"file": ("notes.pdf", b"%PDF-1.4 test", "application/pdf")},
        headers=gm_headers,
    ))
    ok(client.post(
        f"/api/campaigns/{cid}/images",
        files={"file": ("map.png", png(), "image/png")},
        headers=gm_headers,
    ))
    ok(client.post(
        f"/api/campaigns/{cid}/banner",
        files={"file": ("banner.png", png(), "image/png")},
        headers=gm_headers,
    ))
    if member_id:
        for kind in ("art", "token", "sheet"):
            ok(client.post(
                f"/api/campaigns/{cid}/members/{member_id}/{kind}",
                files={"file": (f"{kind}.png", png(), "image/png")},
                headers=member_headers,
            ))


def _paths(cid):
    db = SessionLocal()
    try:
        return campaign_upload_paths(db, [cid])
    finally:
        db.close()


def _on_disk(paths):
    return [p for p in paths if os.path.exists(p)]


class TestDeletingACampaign:
    def test_takes_its_files_banner_and_member_uploads(
        self, client, gm_headers, player_headers, player_id
    ):
        cid = _campaign(client, gm_headers, player_id, player_headers)
        member_id = _member_id(cid, player_id)
        _upload_everything(client, cid, gm_headers, member_id, player_headers)
        paths = _paths(cid)
        # Two campaign files, the banner and its small copy, and three member uploads.
        assert len(_on_disk(paths)) == 7
        assert {os.path.dirname(p) for p in paths} == {
            FILES_DIR, BANNER_DIR, ART_DIR, TOKEN_DIR, SHEET_DIR
        }

        assert client.delete(f"/api/campaigns/{cid}", headers=gm_headers).status_code == 204

        assert _on_disk(paths) == []
        assert not [n for n in os.listdir(BANNER_DIR) if n.startswith(cid)]
        assert not [n for d in (ART_DIR, TOKEN_DIR, SHEET_DIR) for n in os.listdir(d)
                    if n.startswith(member_id)]

    def test_leaves_other_campaigns_alone(self, client, gm_headers):
        doomed = _campaign(client, gm_headers)
        kept = _campaign(client, gm_headers)
        _upload_everything(client, doomed, gm_headers)
        _upload_everything(client, kept, gm_headers)
        kept_paths = _paths(kept)

        assert client.delete(f"/api/campaigns/{doomed}", headers=gm_headers).status_code == 204

        assert _on_disk(kept_paths) == kept_paths

    def test_a_rolled_back_delete_removes_nothing(self, client, gm_headers):
        cid = _campaign(client, gm_headers)
        _upload_everything(client, cid, gm_headers)
        paths = _paths(cid)

        db = SessionLocal()
        try:
            remove_after_commit(db, campaign_upload_paths(db, [cid]))
            db.delete(db.query(Campaign).filter_by(id=cid).one())
            db.flush()
            db.rollback()
            # A later commit on the same session does not remove them either.
            db.commit()
        finally:
            db.close()

        assert _on_disk(paths) == paths
        assert client.get(f"/api/campaigns/{cid}", headers=gm_headers).status_code == 200


class TestRemovingAMember:
    def test_takes_their_art_token_and_sheet(
        self, client, gm_headers, player_headers, player_id
    ):
        cid = _campaign(client, gm_headers, player_id, player_headers)
        member_id = _member_id(cid, player_id)
        _upload_everything(client, cid, gm_headers, member_id, player_headers)
        member_paths = [p for p in _paths(cid) if os.path.dirname(p) in (ART_DIR, TOKEN_DIR, SHEET_DIR)]
        assert len(_on_disk(member_paths)) == 3

        resp = client.delete(f"/api/campaigns/{cid}/members/{player_id}", headers=gm_headers)
        assert resp.status_code in (200, 204), resp.text

        assert _on_disk(member_paths) == []
        # The campaign's own uploads stay.
        assert len(_on_disk(_paths(cid))) == 4

    def test_a_sheet_link_replaces_the_uploaded_sheet(
        self, client, gm_headers, player_headers, player_id
    ):
        cid = _campaign(client, gm_headers, player_id, player_headers)
        member_id = _member_id(cid, player_id)
        _upload_everything(client, cid, gm_headers, member_id, player_headers)
        sheet = [p for p in _paths(cid) if os.path.dirname(p) == SHEET_DIR]
        assert len(_on_disk(sheet)) == 1

        resp = client.patch(
            f"/api/campaigns/{cid}/members/{player_id}",
            json={"character_sheet_url": "https://example.com/sheet"},
            headers=player_headers,
        )
        assert resp.status_code == 200, resp.text
        assert _on_disk(sheet) == []

    def test_removing_a_guest_takes_their_uploads(self, client, admin_headers, gm_headers):
        client.patch("/api/settings", json={"guest_access_enabled": True}, headers=admin_headers)
        try:
            cid = _campaign(client, gm_headers)
            guest = client.post(
                f"/api/campaigns/{cid}/guests", json={"nickname": "Rowan"}, headers=gm_headers
            ).json()
            member_id = guest["id"]
            _upload_everything(client, cid, gm_headers, member_id, gm_headers)
            art = [p for p in _paths(cid) if os.path.dirname(p) == ART_DIR]
            assert len(_on_disk(art)) == 1

            resp = client.delete(f"/api/campaigns/{cid}/guests/{member_id}", headers=gm_headers)
            assert resp.status_code in (200, 204), resp.text
            assert _on_disk(art) == []
        finally:
            client.patch(
                "/api/settings", json={"guest_access_enabled": False}, headers=admin_headers
            )


class TestDeletingTheOwner:
    def test_takes_their_campaigns_uploads_and_their_own_elsewhere(
        self, client, admin_headers, gm_headers, player_headers, player_id
    ):
        owner_id, owner_headers = _new_gm(client, admin_headers)
        theirs = _campaign(client, owner_headers, player_id, player_headers)
        _upload_everything(
            client, theirs, owner_headers, _member_id(theirs, player_id), player_headers
        )
        theirs_paths = _paths(theirs)
        assert len(_on_disk(theirs_paths)) == 7

        # They play in someone else's campaign too, with art there.
        other = _campaign(client, gm_headers, owner_id, owner_headers)
        _upload_everything(client, other, gm_headers, _member_id(other, owner_id), owner_headers)
        other_paths = _paths(other)
        their_art_elsewhere = [
            p for p in other_paths if os.path.dirname(p) in (ART_DIR, TOKEN_DIR, SHEET_DIR)
        ]

        assert client.delete(f"/api/users/{owner_id}", headers=admin_headers).status_code == 204

        assert _on_disk(theirs_paths) == []
        assert _on_disk(their_art_elsewhere) == []
        # The other campaign's own uploads are its GM's, and stay.
        kept = [p for p in other_paths if p not in their_art_elsewhere]
        assert _on_disk(kept) == kept

    def test_a_reassigned_campaign_keeps_its_files(self, client, admin_headers):
        source_id, source_headers = _new_gm(client, admin_headers)
        target_id, _ = _new_gm(client, admin_headers)
        cid = _campaign(client, source_headers)
        _upload_everything(client, cid, source_headers)
        paths = _paths(cid)

        db = SessionLocal()
        try:
            # As an account merge does, then deleting the emptied account.
            reassign_user_data(db, source_id, target_id)
            delete_user_sessions(db, source_id)
            purge_user_data(db, source_id)
            db.delete(db.query(User).filter_by(id=source_id).one())
            db.commit()
            assert db.query(Campaign).filter_by(id=cid).one().owner_id == target_id
            assert db.query(CampaignFile).filter_by(campaign_id=cid).count() == 2
        finally:
            db.close()

        assert _on_disk(paths) == paths

    def test_a_merge_dropping_a_duplicate_membership_takes_its_uploads(
        self, client, admin_headers, gm_headers
    ):
        source_id, source_headers = _new_gm(client, admin_headers)
        target_id, target_headers = _new_gm(client, admin_headers)
        cid = _campaign(client, gm_headers, source_id, source_headers)
        client.post(f"/api/campaigns/{cid}/invite", json={"user_id": target_id}, headers=gm_headers)
        client.patch(
            f"/api/campaigns/{cid}/members/{target_id}",
            json={"status": "accepted"},
            headers=target_headers,
        )
        dropped = _member_id(cid, source_id)
        kept = _member_id(cid, target_id)
        for member_id, headers in ((dropped, source_headers), (kept, target_headers)):
            resp = client.post(
                f"/api/campaigns/{cid}/members/{member_id}/art",
                files={"file": ("art.png", png(), "image/png")},
                headers=headers,
            )
            assert resp.status_code == 200, resp.text
        art = {n: os.path.join(ART_DIR, f"{n}.png") for n in (dropped, kept)}
        assert all(os.path.exists(p) for p in art.values())

        db = SessionLocal()
        try:
            reassign_user_data(db, source_id, target_id)
            db.commit()
        finally:
            db.close()

        assert not os.path.exists(art[dropped])
        assert os.path.exists(art[kept])
