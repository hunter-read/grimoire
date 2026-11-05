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


    def test_short_key_starts_with_a_warning(self, tmp_path, caplog):
        with caplog.at_level("WARNING", logger="grimoire.auth"):
            assert resolve_secret_key("short-key", str(tmp_path)) == "short-key"
        assert "openssl rand -hex 32" in caplog.text

    def test_long_key_starts_quietly(self, tmp_path, caplog):
        with caplog.at_level("WARNING", logger="grimoire.auth"):
            resolve_secret_key("k" * 64, str(tmp_path))
        assert caplog.text == ""


# Every SECRET_KEY value Grimoire has ever published - in the README, the docs,
# the example compose files or a sibling repo's scripts - found by searching the
# git history. Kept apart from REJECTED_SECRET_KEYS on purpose: a value dropped
# from (or never added to) that set fails here instead of passing by omission.
PUBLISHED_SECRET_KEYS = [
    "grimoire-dev-secret-change-in-production",
    "change-me",
    "replace-this-with-a-long-random-string",
    "zx7k2mQpR9nLwT4vBcYeHs3JuAoDfGiN",
    "7ba05239cdd5752065eb6bd5db866bf8a0919d2760b1fcf158744f5ef5833834",
    "generate-with-openssl-rand-hex-32",
    "e2e-local-secret-not-for-production",
    "<paste the generated value here>",
]


@pytest.mark.parametrize("value", PUBLISHED_SECRET_KEYS)
def test_every_key_value_ever_published_is_refused(value, tmp_path):
    with pytest.raises(InsecureSecretKeyError):
        resolve_secret_key(value, str(tmp_path))


def _documented_key_values():
    """Every value written after ``SECRET_KEY=`` / ``SECRET_KEY:`` in the repo's docs,
    README and compose files, as (file, value) pairs with any YAML comment and
    surrounding quotes removed."""
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    files = [
        *root.glob("docs/**/*.md"),
        *root.glob("docs/**/*.yml"),
        *root.glob("*.yml"),
        *root.glob("*.yaml"),
        *root.glob("*.example"),
        root / "README.md",
    ]
    pattern = re.compile(r"SECRET_KEY['\"]?[ \t]*[=:][ \t]*([^\n`]*)")
    values = []
    for path in files:
        for match in pattern.finditer(path.read_text(encoding="utf-8")):
            value = re.split(r"\s+#", match.group(1), maxsplit=1)[0].strip()
            values.append((path.relative_to(root).as_posix(), value.strip("'\"")))
    return values


def test_every_key_value_in_the_docs_is_refused(tmp_path):
    """A SECRET_KEY written out in the repo's docs or compose files never starts a server.

    Two kinds of value can't reach the app as written, so they are skipped: an
    empty one (Grimoire then generates its own key) and a shell or compose
    substitution like ``$(openssl rand -hex 32)``, which the shell replaces with
    a fresh random value before Grimoire sees it.
    """
    values = _documented_key_values()
    assert any(value for _, value in values), "found no documented SECRET_KEY values"
    for name, value in values:
        if not value or value.startswith("$"):
            continue
        with pytest.raises(InsecureSecretKeyError):
            resolve_secret_key(value, str(tmp_path))
            pytest.fail(f"{name}: SECRET_KEY={value!r} would start a server")


@pytest.mark.parametrize(
    "value",
    [
        "<paste the generated value here>",
        "<your-secret-key>",
        '"<paste the generated value here>"',
        "'<generated key>'",
        "  <x>  ",
    ],
)
def test_angle_bracket_placeholders_are_refused(value, tmp_path):
    with pytest.raises(InsecureSecretKeyError):
        resolve_secret_key(value, str(tmp_path))


@pytest.mark.parametrize("value", ["<starts-with-a-bracket" + "k" * 32, "k" * 32 + "ends-with>"])
def test_a_key_merely_containing_a_bracket_is_accepted(value, tmp_path):
    assert resolve_secret_key(value, str(tmp_path)) == value


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
