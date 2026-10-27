"""The token hashing and sealing revisions 0047 and 0048 use, as written for them.

Frozen copy of ``backend/token_vault.py``: the HKDF labels, key length and
ciphers. What these produce must still match what the running app reads, so
``test_migrations_frozen.py`` checks the two agree. If the live vault ever
changes, that test fails, and the change has to decide what happens to tokens
stored the old way; this copy stays as it is.

SECRET_KEY is the one live value read, since tokens must be sealed under the
key the app will run with.
"""
import base64
import hashlib
import hmac
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

_LOOKUP_LABEL = b"grimoire/bearer-token/lookup/v1"
_SEAL_LABEL = b"grimoire/bearer-token/seal/v1"
_SECRET_LABEL = b"grimoire/stored-secret/seal/v1"


def secret_key() -> str:
    from backend import auth

    return auth.SECRET_KEY


def _derive(secret: str, label: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=label).derive(
        secret.encode("utf-8")
    )


def _cipher(secret: str, label: bytes) -> Fernet:
    return Fernet(base64.urlsafe_b64encode(_derive(secret, label)))


def _decrypt(cipher: Fernet, sealed: Optional[str]) -> Optional[str]:
    if not sealed:
        return None
    try:
        return cipher.decrypt(sealed.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None


def lookup_hash(secret: str, token: str) -> str:
    key = _derive(secret, _LOOKUP_LABEL)
    return hmac.new(key, token.encode("utf-8"), hashlib.sha256).hexdigest()


def seal(secret: str, token: str) -> str:
    return _cipher(secret, _SEAL_LABEL).encrypt(token.encode("utf-8")).decode("ascii")


def unseal(secret: str, sealed: Optional[str]) -> Optional[str]:
    return _decrypt(_cipher(secret, _SEAL_LABEL), sealed)


def seal_secret(secret: str, value: str) -> str:
    return _cipher(secret, _SECRET_LABEL).encrypt(value.encode("utf-8")).decode("ascii")


def unseal_secret(secret: str, sealed: Optional[str]) -> Optional[str]:
    return _decrypt(_cipher(secret, _SECRET_LABEL), sealed)
