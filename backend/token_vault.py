"""Bearer tokens kept so a copy of the database alone cannot use them (issue #583).

The OPDS feed, calendar feed and share-link tokens are credentials in a URL:
whoever holds one can read what it opens. They used to sit in the database as
plaintext, so a leaked backup (which holds ``grimoire.db`` but deliberately not
``secret_key``) handed over every working feed and link.

Each token is now stored twice, neither usable without SECRET_KEY:

* ``lookup_hash`` - an HMAC-SHA256 of the token under a key derived from
  SECRET_KEY. Requests are matched on it, so the token is never compared or
  indexed in the clear. A plain SHA-256 would do for matching, but the keyed
  hash also stops anyone with the database guessing tokens offline.
* ``seal`` - the token encrypted (Fernet: AES-CBC with an HMAC) under a second
  key derived from SECRET_KEY, so its owner can copy the link again later.

The two keys come from SECRET_KEY by HKDF with distinct labels, so neither
reveals the other or the JWT signing key itself.

Changing SECRET_KEY strands every stored token: lookups stop matching and
``unseal`` returns None, which callers show as "no token yet" so the owner can
simply make a new one. That is the same trade sessions already make.
"""
import base64
import hashlib
import hmac
from functools import lru_cache
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

_LOOKUP_LABEL = b"grimoire/bearer-token/lookup/v1"
_SEAL_LABEL = b"grimoire/bearer-token/seal/v1"


def _derive(secret: str, label: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=label).derive(
        secret.encode("utf-8")
    )


@lru_cache(maxsize=4)
def _keys(secret: str) -> tuple[bytes, Fernet]:
    """(lookup key, sealing cipher) for ``secret``. Cached: HKDF per request adds up."""
    seal_key = base64.urlsafe_b64encode(_derive(secret, _SEAL_LABEL))
    return _derive(secret, _LOOKUP_LABEL), Fernet(seal_key)


def _secret() -> str:
    # Read at call time rather than import time, so tests (and a key resolved
    # after this module loads) see the current value.
    from . import auth

    return auth.SECRET_KEY


def lookup_hash(token: str) -> str:
    """The value to store and to match requests on, in place of ``token``."""
    key, _ = _keys(_secret())
    return hmac.new(key, token.encode("utf-8"), hashlib.sha256).hexdigest()


def seal(token: str) -> str:
    """``token`` encrypted, for showing it to its owner again."""
    _, cipher = _keys(_secret())
    return cipher.encrypt(token.encode("utf-8")).decode("ascii")


def unseal(sealed: Optional[str]) -> Optional[str]:
    """The token ``sealed`` holds, or None if there is none or SECRET_KEY changed."""
    if not sealed:
        return None
    _, cipher = _keys(_secret())
    try:
        return cipher.decrypt(sealed.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None
