"""Settings refuse a change that would leave no way to sign in.

Password sign-in can only go off while single sign-on (OIDC) is configured, and
OIDC can only go off while password sign-in is on.
"""
import pytest

from backend.config import SessionLocal
from backend.models import AppSetting
from backend.routers.settings import _helpers as settings_helpers
from backend.tests.conftest import OIDC_CONFIGURED

SETTINGS = "/api/settings"
PASSWORD_OFF_DETAIL = (
    "Set up single sign-on (OIDC) before turning off password sign-in - "
    "otherwise no one could sign in."
)
OIDC_OFF_DETAIL = (
    "Turn password sign-in back on before turning off single sign-on - "
    "otherwise no one could sign in."
)
_SIGN_IN_KEYS = ("password_auth_enabled", "hide_maps", *OIDC_CONFIGURED)


@pytest.fixture(autouse=True)
def _restore_sign_in():
    """Put sign-in back to its defaults straight in the database afterwards.

    Going through the API could itself be refused as a lock-out (or blocked by
    a simulated env lock), so the rows are simply removed.
    """
    yield
    db = SessionLocal()
    try:
        db.query(AppSetting).filter(AppSetting.key.in_(_SIGN_IN_KEYS)).delete(
            synchronize_session=False
        )
        db.commit()
    finally:
        db.close()


def _patch(client, headers, body):
    return client.patch(SETTINGS, json=body, headers=headers)


def _settings(client, headers):
    return client.get(SETTINGS, headers=headers).json()


def _lock_password_env(monkeypatch, value: bool):
    monkeypatch.setattr(settings_helpers, "ALLOW_PASSWORD_AUTHENTICATION_ENV", value)


class TestOidcConfiguredField:
    def test_false_by_default(self, client, admin_headers):
        assert _settings(client, admin_headers)["oidc_configured"] is False

    def test_true_once_configured(self, client, admin_headers):
        body = _patch(client, admin_headers, OIDC_CONFIGURED).json()
        assert body["oidc_configured"] is True
        assert _settings(client, admin_headers)["oidc_configured"] is True

    def test_enabled_without_a_secret_is_not_configured(self, client, admin_headers):
        partial = {k: v for k, v in OIDC_CONFIGURED.items() if k != "oidc_client_secret"}
        body = _patch(client, admin_headers, partial).json()
        assert body["oidc_enabled"] is True
        assert body["oidc_configured"] is False


class TestPasswordOff:
    def test_refused_without_oidc(self, client, admin_headers):
        resp = _patch(client, admin_headers, {"password_auth_enabled": False})
        assert resp.status_code == 400
        assert resp.json()["detail"] == PASSWORD_OFF_DETAIL
        assert _settings(client, admin_headers)["password_auth_enabled"] is True

    def test_refusal_discards_the_whole_patch(self, client, admin_headers):
        resp = _patch(client, admin_headers, {"hide_maps": True, "password_auth_enabled": False})
        assert resp.status_code == 400
        assert _settings(client, admin_headers)["hide_maps"] is False

    def test_allowed_once_oidc_is_configured(self, client, admin_headers):
        assert _patch(client, admin_headers, OIDC_CONFIGURED).status_code == 200
        resp = _patch(client, admin_headers, {"password_auth_enabled": False})
        assert resp.status_code == 200, resp.text
        assert resp.json()["password_auth_enabled"] is False

    def test_allowed_when_oidc_is_set_up_in_the_same_patch(self, client, admin_headers):
        resp = _patch(client, admin_headers, {**OIDC_CONFIGURED, "password_auth_enabled": False})
        assert resp.status_code == 200, resp.text

    def test_turning_both_off_names_password(self, client, admin_headers):
        _patch(client, admin_headers, OIDC_CONFIGURED)
        resp = _patch(
            client, admin_headers, {"password_auth_enabled": False, "oidc_enabled": False}
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == PASSWORD_OFF_DETAIL

    def test_turning_password_back_on_is_always_allowed(self, client, admin_headers):
        _patch(client, admin_headers, {**OIDC_CONFIGURED, "password_auth_enabled": False})
        resp = _patch(client, admin_headers, {"password_auth_enabled": True})
        assert resp.status_code == 200


class TestOidcOff:
    def _password_off_with_oidc(self, client, admin_headers):
        resp = _patch(client, admin_headers, {**OIDC_CONFIGURED, "password_auth_enabled": False})
        assert resp.status_code == 200, resp.text

    def test_refused_while_password_is_off(self, client, admin_headers):
        self._password_off_with_oidc(client, admin_headers)
        resp = _patch(client, admin_headers, {"oidc_enabled": False})
        assert resp.status_code == 400
        assert resp.json()["detail"] == OIDC_OFF_DETAIL
        assert _settings(client, admin_headers)["oidc_configured"] is True

    def test_clearing_the_secret_is_refused_too(self, client, admin_headers):
        self._password_off_with_oidc(client, admin_headers)
        resp = _patch(client, admin_headers, {"oidc_client_secret": "__CLEAR__"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == OIDC_OFF_DETAIL

    def test_allowed_while_password_is_on(self, client, admin_headers):
        _patch(client, admin_headers, OIDC_CONFIGURED)
        resp = _patch(client, admin_headers, {"oidc_enabled": False})
        assert resp.status_code == 200
        assert resp.json()["oidc_configured"] is False

    def test_env_locked_password_off_counts(self, client, admin_headers, monkeypatch):
        _patch(client, admin_headers, OIDC_CONFIGURED)
        _lock_password_env(monkeypatch, False)
        resp = _patch(client, admin_headers, {"oidc_enabled": False})
        assert resp.status_code == 400
        assert resp.json()["detail"] == OIDC_OFF_DETAIL

    def test_env_locked_password_on_allows_it(self, client, admin_headers, monkeypatch):
        _patch(client, admin_headers, OIDC_CONFIGURED)
        _lock_password_env(monkeypatch, True)
        resp = _patch(client, admin_headers, {"oidc_enabled": False})
        assert resp.status_code == 200


class TestRepairingABrokenSetup:
    def test_oidc_can_be_set_up_step_by_step_when_no_one_can_sign_in(
        self, client, admin_headers, monkeypatch
    ):
        # Password sign-in pinned off by the environment and OIDC not yet working:
        # a partial OIDC patch does not make anything worse, so it is allowed.
        _lock_password_env(monkeypatch, False)
        resp = _patch(client, admin_headers, {"oidc_issuer_url": "https://idp.example.com"})
        assert resp.status_code == 200, resp.text

    def test_unrelated_settings_are_not_checked(self, client, admin_headers, monkeypatch):
        _lock_password_env(monkeypatch, False)
        assert _patch(client, admin_headers, {"hide_maps": True}).status_code == 200
