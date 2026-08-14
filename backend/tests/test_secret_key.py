"""Tests for SECRET_KEY resolution (issue #158).

The published default must never sign real tokens: an explicit placeholder is
refused outright, and an unset SECRET_KEY generates a key that is persisted
under DATA_PATH and reused on later boots.
"""

import os
import stat

import pytest

from backend.auth import (
    REJECTED_SECRET_KEYS,
    SECRET_KEY_FILENAME,
    InsecureSecretKeyError,
    resolve_secret_key,
)


class TestExplicitKey:
    def test_uses_provided_key(self, tmp_path):
        assert resolve_secret_key("a-real-private-key", str(tmp_path)) == "a-real-private-key"

    def test_does_not_write_a_key_file(self, tmp_path):
        resolve_secret_key("a-real-private-key", str(tmp_path))
        assert not (tmp_path / SECRET_KEY_FILENAME).exists()

    def test_strips_surrounding_whitespace(self, tmp_path):
        assert resolve_secret_key("  padded-key  ", str(tmp_path)) == "padded-key"

    @pytest.mark.parametrize("placeholder", sorted(REJECTED_SECRET_KEYS))
    def test_rejects_published_placeholders(self, placeholder, tmp_path):
        with pytest.raises(InsecureSecretKeyError) as exc:
            resolve_secret_key(placeholder, str(tmp_path))
        assert "SECRET_KEY" in str(exc.value)

    def test_rejects_placeholder_with_whitespace(self, tmp_path):
        with pytest.raises(InsecureSecretKeyError):
            resolve_secret_key("  change-me\n", str(tmp_path))

    def test_rejection_message_names_the_fix(self, tmp_path):
        with pytest.raises(InsecureSecretKeyError) as exc:
            resolve_secret_key("change-me", str(tmp_path))
        assert "openssl rand -hex 32" in str(exc.value)


class TestGeneratedKey:
    def test_generates_when_unset(self, tmp_path):
        key = resolve_secret_key(None, str(tmp_path))
        assert len(key) == 64
        assert key not in REJECTED_SECRET_KEYS

    def test_generates_when_empty_or_whitespace(self, tmp_path):
        assert resolve_secret_key("", str(tmp_path))
        assert resolve_secret_key("   ", str(tmp_path))

    def test_persists_key_to_data_path(self, tmp_path):
        key = resolve_secret_key(None, str(tmp_path))
        key_file = tmp_path / SECRET_KEY_FILENAME
        assert key_file.exists()
        assert key_file.read_text().strip() == key

    def test_reuses_key_across_restarts(self, tmp_path):
        first = resolve_secret_key(None, str(tmp_path))
        second = resolve_secret_key(None, str(tmp_path))
        assert first == second

    def test_distinct_data_paths_get_distinct_keys(self, tmp_path):
        a = resolve_secret_key(None, str(tmp_path / "a"))
        b = resolve_secret_key(None, str(tmp_path / "b"))
        assert a != b

    def test_key_file_is_owner_only(self, tmp_path):
        resolve_secret_key(None, str(tmp_path))
        mode = os.stat(tmp_path / SECRET_KEY_FILENAME).st_mode
        assert stat.S_IMODE(mode) == 0o600

    def test_creates_missing_data_path(self, tmp_path):
        nested = tmp_path / "does" / "not" / "exist"
        key = resolve_secret_key(None, str(nested))
        assert (nested / SECRET_KEY_FILENAME).read_text().strip() == key

    def test_regenerates_when_key_file_is_empty(self, tmp_path):
        (tmp_path / SECRET_KEY_FILENAME).write_text("   \n")
        key = resolve_secret_key(None, str(tmp_path))
        assert len(key) == 64
        assert (tmp_path / SECRET_KEY_FILENAME).read_text().strip() == key

    def test_raises_when_key_cannot_be_written(self, tmp_path):
        # A file where the data dir should be makes both makedirs and open fail.
        blocked = tmp_path / "blocked"
        blocked.write_text("not a directory")
        with pytest.raises(InsecureSecretKeyError) as exc:
            resolve_secret_key(None, str(blocked))
        assert "SECRET_KEY" in str(exc.value)

    def test_raises_when_key_file_is_unreadable(self, tmp_path, monkeypatch):
        (tmp_path / SECRET_KEY_FILENAME).write_text("existing-key")

        def _boom(*args, **kwargs):
            raise PermissionError("denied")

        monkeypatch.setattr("builtins.open", _boom)
        with pytest.raises(InsecureSecretKeyError) as exc:
            resolve_secret_key(None, str(tmp_path))
        assert "could not" in str(exc.value)


class TestTokensStillWork:
    """The resolved key must actually sign and verify tokens end to end."""

    def test_round_trip_with_generated_key(self, tmp_path, monkeypatch):
        import backend.auth as auth

        monkeypatch.setattr(auth, "SECRET_KEY", resolve_secret_key(None, str(tmp_path)))
        token = auth.create_token("u1", "alice", "admin")
        claims = auth.decode_token(token)
        assert claims["username"] == "alice"
        assert claims["role"] == "admin"
