"""Password hashing: passlib's ``bcrypt_sha256`` scheme, on ``bcrypt`` directly.

Hashes used to be written by passlib 1.7.4, which is unmaintained and breaks on
bcrypt 5 (issue #644). This module reads and writes the same format, so every
stored hash keeps verifying:

    $bcrypt-sha256$v=2,t=2b,r=<rounds>$<22-char salt>$<31-char checksum>

The password is first run through HMAC-SHA256, keyed with the salt string, and
the base64 of that digest (44 bytes, under bcrypt's 72-byte limit) is what
bcrypt hashes, so passwords of any length count in full. The checksum is the
last 31 characters of bcrypt's output.

Older passlib releases wrote a v1 form, ``$bcrypt-sha256$<2a|2b>,<rounds>$...``,
that pre-hashed with plain SHA-256. It still verifies; new hashes are always v2.
"""

import base64
import hashlib
import hmac
import re
from typing import Optional

import bcrypt

PREFIX = "$bcrypt-sha256$"

# passlib's default cost for bcrypt_sha256.
DEFAULT_ROUNDS = 12

_V2_RE = re.compile(
    r"^\$bcrypt-sha256\$v=2,t=2b,r=(?P<rounds>\d{1,2})"
    r"\$(?P<salt>[./A-Za-z0-9]{22})\$(?P<checksum>[./A-Za-z0-9]{31})$"
)
_V1_RE = re.compile(
    r"^\$bcrypt-sha256\$(?P<ident>2[ab]),(?P<rounds>\d{1,2})"
    r"\$(?P<salt>[./A-Za-z0-9]{22})\$(?P<checksum>[./A-Za-z0-9]{31})$"
)

# Lazily built hash that a ``None`` (or unreadable) hash is checked against, so
# refusing an unknown user costs as much as refusing a wrong password.
_dummy_hash: Optional[str] = None


def _checksum(digest: bytes, ident: str, rounds: int, salt: str) -> str:
    """bcrypt the base64 of ``digest`` and return the 31-character checksum."""
    config = f"${ident}${rounds:02d}${salt}".encode("ascii")
    return bcrypt.hashpw(base64.b64encode(digest), config).decode("ascii")[-31:]


def _v2_digest(password: bytes, salt: str) -> bytes:
    return hmac.new(salt.encode("ascii"), password, hashlib.sha256).digest()


def hash_password(password: str, rounds: int = DEFAULT_ROUNDS) -> str:
    """Hash ``password`` in passlib's v2 ``bcrypt_sha256`` format."""
    # gensalt() gives "$2b$<rounds>$<22-char salt>"; its last salt character
    # never carries the padding bits passlib refuses, since bcrypt encodes
    # exactly 16 random bytes.
    salt = bcrypt.gensalt(rounds).decode("ascii")[-22:]
    checksum = _checksum(_v2_digest(password.encode("utf-8"), salt), "2b", rounds, salt)
    return f"{PREFIX}v=2,t=2b,r={rounds}${salt}${checksum}"


def _matches(plain: str, hashed: str) -> Optional[bool]:
    """Whether ``plain`` matches ``hashed``, or None if ``hashed`` is not ours."""
    secret = plain.encode("utf-8")
    m = _V2_RE.match(hashed)
    if m:
        ident = "2b"
        digest = _v2_digest(secret, m["salt"])
    else:
        m = _V1_RE.match(hashed)
        if not m:
            return None
        ident = m["ident"]
        digest = hashlib.sha256(secret).digest()
    rounds = m["rounds"]
    # passlib rejects zero-padded rounds; bcrypt itself takes only 4-31.
    if rounds.startswith("0") or not 4 <= int(rounds) <= 31:
        return None
    expected = _checksum(digest, ident, int(rounds), m["salt"])
    return hmac.compare_digest(expected, m["checksum"])


def verify_password(plain: str, hashed: Optional[str]) -> bool:
    """Whether ``plain`` matches ``hashed``.

    False for a user with no password (OIDC-only, guest) and for a hash in a
    format this module can't read. Both still pay for a full hash, so neither
    can be told apart from a wrong password by timing.
    """
    global _dummy_hash
    if hashed:
        result = _matches(plain, hashed)
        if result is not None:
            return result
    if _dummy_hash is None:
        _dummy_hash = hash_password("")
    _matches(plain, _dummy_hash)
    return False

