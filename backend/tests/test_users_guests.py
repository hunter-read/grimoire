"""Admin listing + conversion of per-campaign guest accounts (1.5.0)."""
import pytest

from backend.tests.conftest import OIDC_CLEARED, OIDC_CONFIGURED


def _set_guest_access(client, admin_headers, enabled: bool):
    resp = client.patch(
        "/api/settings",
        json={"guest_access_enabled": enabled},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text


def _set_password_auth(client, admin_headers, enabled: bool):
    resp = client.patch(
        "/api/settings",
        json={"password_auth_enabled": enabled},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text


@pytest.fixture
def guest(client, gm_headers, admin_headers):
    """A guest invited to a fresh GM campaign; yields the created guest payload."""
    _set_guest_access(client, admin_headers, True)
    campaign_id = client.post(
        "/api/campaigns",
        json={"name": "Convert Test Campaign", "is_gm_campaign": True},
        headers=gm_headers,
    ).json()["id"]
    created = client.post(
        f"/api/campaigns/{campaign_id}/guests",
        json={"nickname": "Ivy"},
        headers=gm_headers,
    ).json()
    created["campaign_id"] = campaign_id
    return created


class TestListGuests:
    def test_lists_guest_with_campaign_and_inviter(self, client, admin_headers, guest):
        resp = client.get("/api/users/guests", headers=admin_headers)
        assert resp.status_code == 200, resp.text
        row = next(g for g in resp.json() if g["id"] == guest["user_id"])
        assert row["display_name"] == "Ivy"
        assert row["campaign_id"] == guest["campaign_id"]
        assert row["campaign_name"] == "Convert Test Campaign"
        # Inviter is the campaign owner (the gm fixture user).
        assert row["invited_by"]

    def test_guests_not_in_regular_user_list(self, client, admin_headers, guest):
        users = client.get("/api/users", headers=admin_headers).json()
        assert all(u["id"] != guest["user_id"] for u in users)

    def test_requires_admin(self, client, gm_headers, guest):
        assert client.get("/api/users/guests", headers=gm_headers).status_code == 403


class TestConvertGuest:
    def test_convert_with_password(self, client, admin_headers, guest):
        _set_password_auth(client, admin_headers, True)
        resp = client.post(
            f"/api/users/{guest['user_id']}/convert",
            json={"username": "ivy_perm", "password": "supersecret1", "role": "player"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["username"] == "ivy_perm"
        assert body["role"] == "player"
        # Keeps the GM-set nickname.
        assert body["display_name"] == "Ivy"

        # Now shows in the regular user list and no longer as a guest.
        users = client.get("/api/users", headers=admin_headers).json()
        assert any(u["id"] == guest["user_id"] for u in users)
        remaining = client.get("/api/users/guests", headers=admin_headers).json()
        assert all(g["id"] != guest["user_id"] for g in remaining)

        # Can log in with the new credentials.
        login = client.post(
            "/api/auth/login",
            json={"username": "ivy_perm", "password": "supersecret1"},
        )
        assert login.status_code == 200

        # The old invite code no longer mints a token.
        assert (
            client.post("/api/auth/guest-login", json={"code": guest["guest_code"]}).status_code
            == 401
        )

    def test_convert_requires_password_when_password_auth_enabled(
        self, client, admin_headers, guest
    ):
        _set_password_auth(client, admin_headers, True)
        resp = client.post(
            f"/api/users/{guest['user_id']}/convert",
            json={"username": "nopass"},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_convert_without_password_when_password_auth_disabled(
        self, client, admin_headers, guest
    ):
        # Password sign-in only goes off once OIDC is set up to replace it.
        client.patch("/api/settings", json=OIDC_CONFIGURED, headers=admin_headers)
        _set_password_auth(client, admin_headers, False)
        try:
            resp = client.post(
                f"/api/users/{guest['user_id']}/convert",
                json={"username": "oidc_only", "role": "player"},
                headers=admin_headers,
            )
            assert resp.status_code == 200, resp.text
            assert resp.json()["username"] == "oidc_only"
        finally:
            _set_password_auth(client, admin_headers, True)
            client.patch("/api/settings", json=OIDC_CLEARED, headers=admin_headers)

    def test_convert_rejects_duplicate_username(self, client, admin_headers, guest):
        _set_password_auth(client, admin_headers, True)
        resp = client.post(
            f"/api/users/{guest['user_id']}/convert",
            json={"username": "admin", "password": "supersecret1"},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_convert_rejects_guest_role(self, client, admin_headers, guest):
        resp = client.post(
            f"/api/users/{guest['user_id']}/convert",
            json={"username": "still_guest", "password": "supersecret1", "role": "guest"},
            headers=admin_headers,
        )
        assert resp.status_code == 422

    def test_convert_non_guest_rejected(self, client, admin_headers, admin_id):
        resp = client.post(
            f"/api/users/{admin_id}/convert",
            json={"username": "whatever", "password": "supersecret1"},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_convert_missing_user(self, client, admin_headers):
        resp = client.post(
            "/api/users/does-not-exist/convert",
            json={"username": "ghost", "password": "supersecret1"},
            headers=admin_headers,
        )
        assert resp.status_code == 404

    def test_convert_requires_admin(self, client, gm_headers, guest):
        resp = client.post(
            f"/api/users/{guest['user_id']}/convert",
            json={"username": "sneaky", "password": "supersecret1"},
            headers=gm_headers,
        )
        assert resp.status_code == 403


@pytest.fixture
def guest_pair(client, gm_headers, admin_headers):
    """The same person invited to two campaigns — two separate guest accounts.

    This is the situation merging exists for: without it the player has one
    login per campaign and no way to join them up.
    """
    _set_guest_access(client, admin_headers, True)
    created = []
    for name in ("Merge Campaign A", "Merge Campaign B"):
        campaign_id = client.post(
            "/api/campaigns",
            json={"name": name, "is_gm_campaign": True},
            headers=gm_headers,
        ).json()["id"]
        guest = client.post(
            f"/api/campaigns/{campaign_id}/guests",
            json={"nickname": "Rowan"},
            headers=gm_headers,
        ).json()
        guest["campaign_id"] = campaign_id
        created.append(guest)
    return created


class TestMergeGuests:
    def test_merges_second_guest_into_first(self, client, admin_headers, guest_pair):
        keep, absorb = guest_pair
        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [absorb["user_id"]]},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == keep["user_id"]
        assert body["merged_ids"] == [absorb["user_id"]]
        # The absorbed account's campaign membership moved across.
        assert body["memberships_moved"] == 1

        # Only the surviving account remains, and it now covers both campaigns.
        guests = client.get("/api/users/guests", headers=admin_headers).json()
        assert all(g["id"] != absorb["user_id"] for g in guests)
        assert any(g["id"] == keep["user_id"] for g in guests)

    def test_merged_guest_code_stops_working(self, client, admin_headers, guest_pair):
        keep, absorb = guest_pair
        client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [absorb["user_id"]]},
            headers=admin_headers,
        )
        # The absorbed account is gone, so its invite code must not mint a token.
        resp = client.post("/api/auth/guest-login", json={"code": absorb["guest_code"]})
        assert resp.status_code == 401
        # The surviving account still logs in.
        assert (
            client.post(
                "/api/auth/guest-login", json={"code": keep["guest_code"]}
            ).status_code
            == 200
        )

    def test_merge_keeps_target_rows_where_both_accounts_have_one(
        self, client, admin_headers, guest_pair
    ):
        """Both guests favourited the same book, saved a filter under the same
        name, answered the same session date and wrote a note on the same
        session. The merge must not trip the unique constraints: the target's
        row wins and the source's duplicate goes."""
        from backend.config import SessionLocal
        from backend.models import (
            Favorite,
            PlayerSessionNote,
            SavedFilter,
            SessionAvailability,
            SessionNote,
        )

        keep, absorb = guest_pair
        campaign_id = keep["campaign_id"]
        db = SessionLocal()
        try:
            session = SessionNote(campaign_id=campaign_id, session_date="2026-10-24")
            db.add(session)
            db.flush()
            for user_id, label in ((keep["user_id"], "keep"), (absorb["user_id"], "absorb")):
                db.add(Favorite(user_id=user_id, item_type="book", item_id="book-1"))
                db.add(
                    SavedFilter(
                        user_id=user_id, scope="books", name="Mine",
                        state={"by": label}, is_default=True,
                    )
                )
                db.add(
                    SessionAvailability(
                        campaign_id=campaign_id, user_id=user_id,
                        session_date="2026-10-24", status=label,
                    )
                )
                db.add(PlayerSessionNote(session_id=session.id, user_id=user_id, content=label))
            # A second default in the same view, under another name: it moves
            # across, but must not leave the target with two defaults.
            db.add(
                SavedFilter(
                    user_id=absorb["user_id"], scope="books", name="Other", is_default=True
                )
            )
            db.commit()
        finally:
            db.close()

        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [absorb["user_id"]]},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text

        db = SessionLocal()
        try:
            mine = {"user_id": keep["user_id"]}
            assert db.query(Favorite).filter_by(**mine).count() == 1
            filters = {f.name: f for f in db.query(SavedFilter).filter_by(**mine)}
            assert set(filters) == {"Mine", "Other"}
            assert filters["Mine"].state == {"by": "keep"}
            assert [n for n, f in filters.items() if f.is_default] == ["Mine"]
            assert [a.status for a in db.query(SessionAvailability).filter_by(**mine)] == [
                "keep"
            ]
            assert [n.content for n in db.query(PlayerSessionNote).filter_by(**mine)] == [
                "keep"
            ]
        finally:
            db.close()

    def test_cannot_merge_account_into_itself(self, client, admin_headers, guest_pair):
        keep, _ = guest_pair
        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [keep["user_id"]]},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_cannot_merge_away_a_permanent_account(
        self, client, admin_headers, guest_pair, player_id
    ):
        keep, _ = guest_pair
        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [player_id]},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_merge_into_a_converted_permanent_user(self, client, admin_headers, guest_pair):
        """A guest can be folded into the real account the same person already has."""
        _set_password_auth(client, admin_headers, True)
        keep, absorb = guest_pair
        client.post(
            f"/api/users/{keep['user_id']}/convert",
            json={"username": "rowan_perm", "password": "supersecret1", "role": "player"},
            headers=admin_headers,
        )
        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [absorb["user_id"]]},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["memberships_moved"] == 1

    def test_rejects_empty_source_list(self, client, admin_headers, guest_pair):
        keep, _ = guest_pair
        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": []},
            headers=admin_headers,
        )
        assert resp.status_code == 422

    def test_missing_source_is_404(self, client, admin_headers, guest_pair):
        keep, _ = guest_pair
        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": ["does-not-exist"]},
            headers=admin_headers,
        )
        assert resp.status_code == 404

    def test_missing_target_is_404(self, client, admin_headers, guest_pair):
        _, absorb = guest_pair
        resp = client.post(
            "/api/users/does-not-exist/merge",
            json={"source_ids": [absorb["user_id"]]},
            headers=admin_headers,
        )
        assert resp.status_code == 404

    def test_requires_admin(self, client, gm_headers, guest_pair):
        keep, absorb = guest_pair
        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [absorb["user_id"]]},
            headers=gm_headers,
        )
        assert resp.status_code == 403


class TestDeleteGuest:
    def test_admin_can_delete_a_guest(self, client, admin_headers, guest):
        resp = client.delete(f"/api/users/{guest['user_id']}", headers=admin_headers)
        assert resp.status_code == 204, resp.text
        remaining = client.get("/api/users/guests", headers=admin_headers).json()
        assert all(g["id"] != guest["user_id"] for g in remaining)

    def test_can_delete_guest_with_no_campaign_or_inviter(
        self, client, admin_headers, gm_headers, guest
    ):
        """An orphaned guest (no campaign or inviter) is still removable. It lists
        with null campaign/inviter and previously had no action that could clear it."""
        from backend.config import SessionLocal
        from backend.models import Campaign

        db = SessionLocal()
        db.delete(db.query(Campaign).filter_by(id=guest["campaign_id"]).one())
        db.commit()
        db.close()

        rows = client.get("/api/users/guests", headers=admin_headers).json()
        orphan = next(g for g in rows if g["id"] == guest["user_id"])
        assert orphan["campaign_id"] is None
        assert orphan["invited_by"] is None

        resp = client.delete(f"/api/users/{guest['user_id']}", headers=admin_headers)
        assert resp.status_code == 204, resp.text
        after = client.get("/api/users/guests", headers=admin_headers).json()
        assert all(g["id"] != guest["user_id"] for g in after)


class TestGuestHoldingCredentials:
    """A guest account can end up owning grants, API keys or share links (an
    older install could change a guest's role). Merging it must still work."""

    def test_merge_deletes_the_sources_grants_keys_and_links(
        self, client, admin_headers, guest_pair
    ):
        import secrets

        from backend.config import SessionLocal
        from backend.models import ApiKey, ShareLink, User, UserAccessGrant
        from backend.services.campaigns.user_data import _USER_DELETE_ONLY_TABLES

        keep, absorb = guest_pair
        src = absorb["user_id"]
        db = SessionLocal()
        try:
            db.query(User).filter_by(id=src).one().role = "gm"
            db.add(UserAccessGrant(user_id=src, scope_type="system", scope_id="sys", level="admin"))
            db.add(ApiKey(user_id=src, name="k", prefix="gk_x", key_hash=secrets.token_hex(32)))
            db.add(
                ShareLink(
                    user_id=src,
                    token_hash=secrets.token_hex(32),
                    token_sealed="sealed",
                    resource_type="book",
                    resource_id="book-1",
                )
            )
            db.commit()
            # Every delete-only table is covered, so a new one needs a row here.
            tables = {
                UserAccessGrant.__tablename__,
                ApiKey.__tablename__,
                ShareLink.__tablename__,
            }
            assert tables == set(_USER_DELETE_ONLY_TABLES)
        finally:
            db.close()

        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [src]},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text

        db = SessionLocal()
        try:
            for model in (UserAccessGrant, ApiKey, ShareLink):
                assert db.query(model).filter_by(user_id=src).count() == 0
                # Credentials are not handed to the account merged into.
                assert db.query(model).filter_by(user_id=keep["user_id"]).count() == 0
            assert db.query(User).filter_by(id=src).first() is None
        finally:
            db.close()

    def test_a_guests_role_is_changed_by_converting_it(self, client, admin_headers, guest):
        resp = client.patch(
            f"/api/users/{guest['user_id']}", json={"role": "player"}, headers=admin_headers
        )
        assert resp.status_code == 400, resp.text
        # Re-sending the role it already has is not a change.
        resp = client.patch(
            f"/api/users/{guest['user_id']}", json={"role": "guest"}, headers=admin_headers
        )
        assert resp.status_code == 200, resp.text
        assert (
            client.post("/api/auth/guest-login", json={"code": guest["guest_code"]}).status_code
            == 200
        )


def _give_character(user_id: str, campaign_id: str) -> str:
    from backend.config import SessionLocal
    from backend.models import Character

    db = SessionLocal()
    try:
        row = Character(user_id=user_id, schema_ref="sheet", name="Rowan", campaign_id=campaign_id)
        db.add(row)
        db.commit()
        return row.id
    finally:
        db.close()


def _account_state(user_id: str):
    """(user exists, {campaign_id: guest_code}, {character_id: campaign_id})."""
    from backend.config import SessionLocal
    from backend.models import CampaignMember, Character, User

    db = SessionLocal()
    try:
        exists = db.query(User).filter_by(id=user_id).first() is not None
        members = {
            m.campaign_id: m.guest_code
            for m in db.query(CampaignMember).filter_by(user_id=user_id).all()
        }
        characters = {
            c.id: c.campaign_id for c in db.query(Character).filter_by(user_id=user_id).all()
        }
        return exists, members, characters
    finally:
        db.close()


@pytest.fixture
def merged_guest(client, admin_headers, guest_pair):
    """One guest merged across two campaigns, with a character in each.

    Returns (keep, absorb, {campaign_id: character_id}). The surviving account
    signs in with ``keep['guest_code']``, which lives on campaign A's membership.
    """
    keep, absorb = guest_pair
    chars = {
        keep["campaign_id"]: _give_character(keep["user_id"], keep["campaign_id"]),
        absorb["campaign_id"]: _give_character(absorb["user_id"], absorb["campaign_id"]),
    }
    resp = client.post(
        f"/api/users/{keep['user_id']}/merge",
        json={"source_ids": [absorb["user_id"]]},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text
    return keep, absorb, chars


def _assert_still_in(client, keep, campaign_id, character_id, code=None):
    """The merged guest is in ``campaign_id`` alone, with its character, and
    signs in with ``code`` (its original code unless given)."""
    exists, members, characters = _account_state(keep["user_id"])
    assert exists
    assert set(members) == {campaign_id}
    assert characters[character_id] == campaign_id
    login = client.post("/api/auth/guest-login", json={"code": code or keep["guest_code"]})
    assert login.status_code == 200, login.text
    assert login.json()["campaign_id"] == campaign_id


def _current_code(user_id: str, campaign_id: str):
    return _account_state(user_id)[1][campaign_id]


def _guest_refresh_cookie(client, code: str) -> str:
    client.cookies.clear()
    resp = client.post("/api/auth/guest-login", json={"code": code})
    assert resp.status_code == 200, resp.text
    refresh = resp.cookies.get("grimoire_refresh")
    assert refresh
    client.cookies.clear()
    return refresh


def _refreshes(client, refresh: str) -> bool:
    client.cookies.clear()
    client.cookies.set("grimoire_refresh", refresh, path="/api/auth")
    ok = client.post("/api/auth/refresh").status_code == 200
    client.cookies.clear()
    return ok


def _assert_code_replaced(client, keep, campaign_id, character_id):
    """Someone other than the guest released the code-holding membership: the
    old code is retired and the remaining membership carries a fresh one."""
    assert (
        client.post("/api/auth/guest-login", json={"code": keep["guest_code"]}).status_code
        == 401
    )
    fresh = _current_code(keep["user_id"], campaign_id)
    assert fresh and fresh != keep["guest_code"]
    _assert_still_in(client, keep, campaign_id, character_id, code=fresh)


class TestMergedGuestLosesOneCampaign:
    """A merged guest taken out of one campaign keeps every other one."""

    def test_deleting_the_campaign_holding_the_code(self, client, gm_headers, merged_guest):
        keep, absorb, chars = merged_guest
        refresh = _guest_refresh_cookie(client, keep["guest_code"])
        resp = client.delete(f"/api/campaigns/{keep['campaign_id']}", headers=gm_headers)
        assert resp.status_code == 204, resp.text
        # The GM who deleted it knew the old code, so the guest gets a new one
        # on the campaign it is still in, and sessions opened with the old one end.
        _assert_code_replaced(client, keep, absorb["campaign_id"], chars[absorb["campaign_id"]])
        assert not _refreshes(client, refresh)

    def test_deleting_the_other_campaign(self, client, gm_headers, merged_guest):
        keep, absorb, chars = merged_guest
        resp = client.delete(f"/api/campaigns/{absorb['campaign_id']}", headers=gm_headers)
        assert resp.status_code == 204, resp.text
        # The code was never on that membership, so it is untouched.
        _assert_still_in(client, keep, keep["campaign_id"], chars[keep["campaign_id"]])

    def test_gm_removing_the_guest(self, client, gm_headers, merged_guest):
        keep, absorb, chars = merged_guest
        refresh = _guest_refresh_cookie(client, keep["guest_code"])
        resp = client.delete(
            f"/api/campaigns/{keep['campaign_id']}/guests/{keep['id']}", headers=gm_headers
        )
        assert resp.status_code == 204, resp.text
        # Whoever signed in with the old code is signed out with it, at the
        # session's next refresh - as when a GM regenerates a code.
        assert not _refreshes(client, refresh)
        _assert_code_replaced(client, keep, absorb["campaign_id"], chars[absorb["campaign_id"]])
        # Like any member's, the character from the campaign they left stays theirs.
        assert _account_state(keep["user_id"])[2][chars[keep["campaign_id"]]] == keep[
            "campaign_id"
        ]

    def test_gm_removing_through_the_member_route(self, client, gm_headers, merged_guest):
        keep, absorb, chars = merged_guest
        resp = client.delete(
            f"/api/campaigns/{keep['campaign_id']}/members/{keep['user_id']}",
            headers=gm_headers,
        )
        assert resp.status_code == 204, resp.text
        _assert_code_replaced(client, keep, absorb["campaign_id"], chars[absorb["campaign_id"]])

    def test_guest_leaving_keeps_their_code(self, client, merged_guest):
        keep, absorb, chars = merged_guest
        token = client.post(
            "/api/auth/guest-login", json={"code": keep["guest_code"]}
        ).json()["token"]
        client.cookies.clear()
        # Leaving the campaign whose membership holds the code: it moves across.
        resp = client.delete(
            f"/api/campaigns/{keep['campaign_id']}/members/{keep['user_id']}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 204, resp.text
        _assert_still_in(client, keep, absorb["campaign_id"], chars[absorb["campaign_id"]])
        assert _current_code(keep["user_id"], absorb["campaign_id"]) == keep["guest_code"]
        # Their own session carries on.
        assert client.get(
            f"/api/campaigns/{absorb['campaign_id']}", headers={"Authorization": f"Bearer {token}"}
        ).status_code == 200

    def test_deleting_the_gm_account_holding_the_code(
        self, client, admin_headers, guest_pair
    ):
        """An admin deleting the GM whose campaign held the code: same as the GM
        deleting the campaign."""
        import uuid

        username = f"gm_{uuid.uuid4().hex[:8]}"
        password = "gm-password-long-enough"
        gm = client.post(
            "/api/users",
            json={"username": username, "password": password, "role": "gm"},
            headers=admin_headers,
        ).json()
        gm_token = client.post(
            "/api/auth/login", json={"username": username, "password": password}
        ).json()["token"]
        client.cookies.clear()
        theirs = {"Authorization": f"Bearer {gm_token}"}
        campaign_id = client.post(
            "/api/campaigns", json={"name": "Doomed", "is_gm_campaign": True}, headers=theirs
        ).json()["id"]
        keep = client.post(
            f"/api/campaigns/{campaign_id}/guests", json={"nickname": "Rowan"}, headers=theirs
        ).json()
        _, absorb = guest_pair
        stays = _give_character(absorb["user_id"], absorb["campaign_id"])
        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [absorb["user_id"]]},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text

        assert client.delete(f"/api/users/{gm['id']}", headers=admin_headers).status_code == 204
        _assert_code_replaced(client, keep, absorb["campaign_id"], stays)

    def test_last_campaign_gone_deletes_the_guest(self, client, gm_headers, merged_guest):
        keep, absorb, _ = merged_guest
        for campaign_id in (keep["campaign_id"], absorb["campaign_id"]):
            resp = client.delete(f"/api/campaigns/{campaign_id}", headers=gm_headers)
            assert resp.status_code == 204, resp.text
        exists, members, characters = _account_state(keep["user_id"])
        assert not exists and not members and not characters
        assert (
            client.post("/api/auth/guest-login", json={"code": keep["guest_code"]}).status_code
            == 401
        )

    def test_unmerged_guest_is_still_deleted_with_its_campaign(
        self, client, gm_headers, guest
    ):
        resp = client.delete(f"/api/campaigns/{guest['campaign_id']}", headers=gm_headers)
        assert resp.status_code == 204, resp.text
        assert _account_state(guest["user_id"])[0] is False
