"""Password hashing without passlib (backend/password_hash.py, issue #644)."""
import pytest

from backend import password_hash
from backend.auth import hash_password, verify_password

# Written by passlib 1.7.4 (bcrypt 4.0.1) before it was removed, so hashes
# already stored in users.hashed_password / share_links.password_hash keep
# verifying. Low rounds keep the suite quick; the format is the same at any cost.
PASSLIB_V2 = [
    (
        "correct horse battery staple",
        "$bcrypt-sha256$v=2,t=2b,r=4$Yi5WrvEvWTXo8CPgKyIBb.$72TGt6YRMpc.e3b01kKvdYIZcGgQxWy",
    ),
    (
        "pässwörd-ünïcode",
        "$bcrypt-sha256$v=2,t=2b,r=4$efMGfJu91ENDaeQ4I7o6cu$7cQxX.z6Yw2cD7zCzBEPemHxfPgm5hu",
    ),
    (
        "x" * 100,
        "$bcrypt-sha256$v=2,t=2b,r=4$RCyQugZfhytkpE0TnM7aKu$BZvlvMbACmakUfxMReBf2yWV9SQqWBi",
    ),
    (
        "",
        "$bcrypt-sha256$v=2,t=2b,r=4$TdIDEyzxpNjp6S0tEhRlSe$WI1Ob81SRXvDDSe25nujtWEY0pj5d1e",
    ),
    (
        "a" * 72 + "b",
        "$bcrypt-sha256$v=2,t=2b,r=4$1tuNc2zjH2advqZAHTW7ku$7MpbJ3g/m6zcatBTsxATXJXRIAr1lOi",
    ),
    (
        "twelve-rounds-pass",
        "$bcrypt-sha256$v=2,t=2b,r=12$Z03q5h7Fb8.5MhKxZ4nK3u$fAfsTuhJXiWmVnTfKpObYpU7B06X4pW",
    ),
]

# The v1 form older passlib releases wrote (plain SHA-256, 2a or 2b).
PASSLIB_V1 = [
    (
        "correct horse battery staple",
        "$bcrypt-sha256$2b,4$VGV1WnzPNvKv4KZQzuIbZu$qd1ezBHBTqzXQ9J0WJN5IqyvsQvc2l2",
    ),
    (
        "x" * 100,
        "$bcrypt-sha256$2b,4$j2v7UbDnlf/B8QtgNgNwwu$op/swqeLQH9mZQFvTaMlxa/IRAPlb0m",
    ),
    (
        "legacy-2a-password",
        "$bcrypt-sha256$2a,4$6f8/tqs23HioX7H4QMOOuu$B/TtOIPrk3CbRIOmf3oGC/suX6n8AC6",
    ),
]


@pytest.mark.parametrize("plain,hashed", PASSLIB_V2 + PASSLIB_V1)
def test_passlib_hashes_still_verify(plain, hashed):
    assert verify_password(plain, hashed) is True
    assert verify_password(plain + "!", hashed) is False


def test_bytes_past_72_still_count():
    # Same first 72 bytes, different 73rd: plain bcrypt would call these equal.
    hashed = PASSLIB_V2[4][1]
    assert verify_password("a" * 72 + "c", hashed) is False
    fresh = hash_password("a" * 72 + "b", rounds=4)
    assert verify_password("a" * 72 + "b", fresh) is True
    assert verify_password("a" * 72 + "c", fresh) is False


def test_new_hash_round_trips_in_passlib_v2_format():
    hashed = hash_password("lantern harbor crossing", rounds=4)
    assert password_hash._V2_RE.match(hashed)
    assert hashed.startswith("$bcrypt-sha256$v=2,t=2b,r=4$")
    assert verify_password("lantern harbor crossing", hashed) is True
    assert verify_password("lantern harbor crossinG", hashed) is False


def test_default_cost_matches_passlib():
    assert hash_password("x").startswith("$bcrypt-sha256$v=2,t=2b,r=12$")


def test_salts_differ():
    assert hash_password("same", rounds=4) != hash_password("same", rounds=4)


def test_long_and_unicode_passwords_round_trip():
    for plain in ("🐉" * 50, "y" * 4096):
        assert verify_password(plain, hash_password(plain, rounds=4)) is True


@pytest.mark.parametrize(
    "hashed",
    [
        None,
        "",
        # Plain bcrypt, not the bcrypt_sha256 wrapper.
        "$2b$04$Yi5WrvEvWTXo8CPgKyIBb.72TGt6YRMpc.e3b01kKvdYIZcGgQxWy",
        "not-a-hash",
        # Truncated checksum.
        "$bcrypt-sha256$v=2,t=2b,r=4$Yi5WrvEvWTXo8CPgKyIBb.$72TGt6YRMpc",
        # Unknown version / type.
        "$bcrypt-sha256$v=3,t=2b,r=4$Yi5WrvEvWTXo8CPgKyIBb.$72TGt6YRMpc.e3b01kKvdYIZcGgQxWy",
        "$bcrypt-sha256$v=2,t=2y,r=4$Yi5WrvEvWTXo8CPgKyIBb.$72TGt6YRMpc.e3b01kKvdYIZcGgQxWy",
        # Zero-padded and out-of-range costs.
        "$bcrypt-sha256$v=2,t=2b,r=04$Yi5WrvEvWTXo8CPgKyIBb.$72TGt6YRMpc.e3b01kKvdYIZcGgQxWy",
        "$bcrypt-sha256$v=2,t=2b,r=3$Yi5WrvEvWTXo8CPgKyIBb.$72TGt6YRMpc.e3b01kKvdYIZcGgQxWy",
        "$bcrypt-sha256$2b,32$VGV1WnzPNvKv4KZQzuIbZu$qd1ezBHBTqzXQ9J0WJN5IqyvsQvc2l2",
    ],
)
def test_missing_or_unreadable_hash_is_a_miss(hashed):
    assert verify_password("correct horse battery staple", hashed) is False


def test_missing_hash_still_pays_for_a_hash(monkeypatch):
    """An unknown user must cost a real bcrypt run, like a wrong password does."""
    calls = []
    real = password_hash.bcrypt.hashpw

    def spy(secret, config):
        calls.append(config)
        return real(secret, config)

    monkeypatch.setattr(password_hash.bcrypt, "hashpw", spy)
    monkeypatch.setattr(password_hash, "_dummy_hash", None)
    assert verify_password("anything", None) is False
    # Built once at the default cost, then checked against.
    assert len(calls) == 2
    assert all(c.startswith(b"$2b$12$") for c in calls)
    calls.clear()
    assert verify_password("anything", "garbage") is False
    assert len(calls) == 1
