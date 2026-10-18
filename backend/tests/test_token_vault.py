"""Bearer tokens stored hashed and sealed (issue #583), and URL redaction for logs."""
import pytest

from backend import auth, config, token_vault


class TestLookupHash:
    def test_is_stable_for_one_token(self):
        assert token_vault.lookup_hash("abc") == token_vault.lookup_hash("abc")

    def test_differs_between_tokens(self):
        assert token_vault.lookup_hash("abc") != token_vault.lookup_hash("abd")

    def test_is_not_a_plain_sha256(self):
        """Keyed on SECRET_KEY, so a copy of the database can't test guesses offline."""
        import hashlib

        assert token_vault.lookup_hash("abc") != hashlib.sha256(b"abc").hexdigest()

    def test_depends_on_the_secret_key(self, monkeypatch):
        before = token_vault.lookup_hash("abc")
        monkeypatch.setattr(auth, "SECRET_KEY", "a-different-secret")
        assert token_vault.lookup_hash("abc") != before

    def test_fits_the_column(self):
        assert len(token_vault.lookup_hash("x" * 64)) == 64


class TestSeal:
    def test_round_trips(self):
        sealed = token_vault.seal("feed-token-123")
        assert sealed != "feed-token-123"
        assert "feed-token-123" not in sealed
        assert token_vault.unseal(sealed) == "feed-token-123"

    def test_each_seal_is_different(self):
        """Fernet is randomised: two links with one token would not look alike."""
        assert token_vault.seal("same") != token_vault.seal("same")

    @pytest.mark.parametrize("value", [None, "", "not-a-sealed-value", "gAAAAAB-garbage"])
    def test_unsealable_values_are_none(self, value):
        assert token_vault.unseal(value) is None

    def test_a_changed_secret_key_cannot_unseal(self, monkeypatch):
        sealed = token_vault.seal("feed-token-123")
        monkeypatch.setattr(auth, "SECRET_KEY", "a-different-secret")
        assert token_vault.unseal(sealed) is None

    def test_lookup_and_seal_keys_are_independent(self):
        lookup_key, cipher = token_vault._keys(auth.SECRET_KEY)
        assert lookup_key not in (auth.SECRET_KEY.encode(), cipher._signing_key)
        assert lookup_key != cipher._encryption_key


class TestRedactUrl:
    @pytest.mark.parametrize(
        "url, expected",
        [
            ("redis://:s3cret@valkey:6379/0", "redis://***@valkey:6379/0"),
            ("redis://user:s3cret@valkey:6379/0", "redis://***@valkey:6379/0"),
            ("rediss://default:p%40ss@cache.example:6380", "rediss://***@cache.example:6380"),
            ("redis://valkey:6379/0", "redis://valkey:6379/0"),
            ("unix:///run/valkey.sock", "unix:///run/valkey.sock"),
        ],
    )
    def test_drops_credentials_and_keeps_the_host(self, url, expected):
        assert config.redact_url(url) == expected
        assert "s3cret" not in config.redact_url(url)
