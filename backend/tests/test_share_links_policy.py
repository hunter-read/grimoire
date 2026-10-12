"""Who may create share links, and how a link's state is decided (issue #541)."""
from types import SimpleNamespace

import pytest

from backend import config
from backend.config import SessionLocal
from backend.services import share_links as policy
from backend.tests.share_link_helpers import (
    past,
    set_role_default,
)

# The share-link fixtures (shared_map, and the autouse fixture that puts the
# session users' permissions back) live in a plugin, not in conftest, so they
# only run for these tests.
pytest_plugins = ["backend.tests.share_link_helpers"]


def _user(role="player", override=None, is_guest=False):
    return SimpleNamespace(role=role, share_links_enabled=override, is_guest=is_guest)


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()


class TestRoleDefaults:
    def test_admins_and_gms_may_players_may_not(self, db):
        assert policy.user_can_share(db, _user("admin"))
        assert policy.user_can_share(db, _user("gm"))
        assert not policy.user_can_share(db, _user("player"))

    def test_guests_never_may(self, db):
        assert not policy.user_can_share(db, _user("guest"))
        # Even an override cannot hand a guest account the right.
        assert not policy.user_can_share(db, _user("player", True, is_guest=True))

    def test_admin_can_grant_players_and_withdraw_gms(self, db):
        set_role_default("player", True)
        set_role_default("gm", False)
        assert policy.user_can_share(db, _user("player"))
        assert not policy.user_can_share(db, _user("gm"))
        # Admins are not configurable.
        assert policy.user_can_share(db, _user("admin"))

    def test_unknown_role_may_not(self, db):
        assert not policy.role_allows(db, "wizard")

    def test_empty_stored_default_falls_back(self, db):
        set_role_default("gm", True)
        from backend.models import AppSetting

        db.query(AppSetting).filter_by(key="share_links_role_gm").update({"value": ""})
        db.commit()
        assert policy.role_defaults(db)["gm"] is True


class TestOverride:
    def test_allow_beats_the_role(self, db):
        status = policy.share_status(db, _user("player", True))
        assert status == {"allowed": True, "source": "user", "override": "allow", "role_allows": False}

    def test_deny_beats_the_role(self, db):
        status = policy.share_status(db, _user("gm", False))
        assert status["allowed"] is False
        assert status["source"] == "user"
        assert status["role_allows"] is True

    def test_no_override_reports_the_role(self, db):
        status = policy.share_status(db, _user("gm"))
        assert status == {"allowed": True, "source": "role", "override": "role", "role_allows": True}

    def test_override_names_round_trip(self):
        for name in ("role", "allow", "deny"):
            value = policy.override_value(name)
            assert policy.override_of(SimpleNamespace(share_links_enabled=value)) == name


class TestInstanceSwitch:
    def test_off_means_nobody(self, db, monkeypatch):
        monkeypatch.setattr(config, "SHARE_LINKS_ENABLED", False)
        status = policy.share_status(db, _user("admin"))
        assert status["allowed"] is False
        assert status["source"] == "disabled"

    def test_no_user_is_disabled(self, db):
        assert policy.share_status(db, None)["allowed"] is False


class TestLinkState:
    def _link(self, **over):
        fields = {"revoked_at": None, "expires_at": None}
        fields.update(over)
        return SimpleNamespace(**fields)

    def test_active(self, db):
        assert policy.link_state(db, self._link(), _user("gm"), True) == "active"

    def test_revoked_wins_over_expired(self, db):
        link = self._link(revoked_at=past(), expires_at=past())
        assert policy.link_state(db, link, _user("gm"), True) == "revoked"

    def test_expired_naive_datetime(self, db):
        link = self._link(expires_at=past().replace(tzinfo=None))
        assert policy.link_state(db, link, _user("gm"), True) == "expired"

    def test_suspended_when_creator_may_no_longer_share(self, db):
        assert policy.link_state(db, self._link(), _user("player"), True) == "suspended"
        assert policy.link_state(db, self._link(), None, True) == "suspended"

    def test_unavailable_when_item_unreadable(self, db):
        assert policy.link_state(db, self._link(), _user("gm"), False) == "unavailable"

    def test_disabled_instance(self, db, monkeypatch):
        monkeypatch.setattr(config, "SHARE_LINKS_ENABLED", False)
        assert policy.link_state(db, self._link(), _user("gm"), True) == "disabled"


def test_tokens_are_long_and_unique():
    tokens = {policy.new_token() for _ in range(50)}
    assert len(tokens) == 50
    assert all(len(t) >= 43 for t in tokens)


def test_expiry():
    assert policy.expires_at_for(None) is None
    assert policy.expires_at_for(0) is None
    assert policy.expires_at_for(7) is not None
