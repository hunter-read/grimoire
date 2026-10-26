"""Rules for new passwords: account passwords and share-link passwords.

Applied wherever a password is *set* - first-run setup, creating a user, an
admin reset, changing your own password, promoting a guest, and creating or
editing a password-protected share link. Logging in never checks them, so a
password set under older rules keeps working until its owner changes it.

Two rules, both configurable for the instance:

* A minimum length: ``PASSWORD_MIN_LENGTH`` (default 12) for accounts and
  ``SHARE_LINK_PASSWORD_MIN_LENGTH`` (default 8) for share links. An admin can
  raise them, or lower them on a server that only a home network can reach.
* Not a commonly used password. The list ships with Grimoire
  (``resources/common-passwords.txt.gz``) and is checked locally, so nothing
  about the password leaves the server. This applies whatever the length.
"""
from __future__ import annotations

import gzip
import logging
import os
from functools import lru_cache

# Read in backend/config/env.py. Imported by name so tests can patch them here.
from .config import (
    DEFAULT_PASSWORD_MIN_LENGTH,
    DEFAULT_SHARE_LINK_PASSWORD_MIN_LENGTH,
    PASSWORD_MIN_LENGTH,
    SHARE_LINK_PASSWORD_MIN_LENGTH,
)

logger = logging.getLogger("grimoire.passwords")

_COMMON_PASSWORDS_PATH = os.path.join(
    os.path.dirname(__file__), "resources", "common-passwords.txt.gz"
)

@lru_cache(maxsize=1)
def _common_passwords() -> frozenset[str]:
    """The bundled list, loaded on first use rather than at import."""
    try:
        with gzip.open(_COMMON_PASSWORDS_PATH, "rt", encoding="utf-8") as fh:
            return frozenset(line.strip() for line in fh if line.strip())
    except OSError as exc:
        logger.error("Couldn't read the common-password list (%s); skipping that check.", exc)
        return frozenset()


def is_common(password: str) -> bool:
    return password.strip().lower() in _common_passwords()


def problem(password: str, *, minimum: int) -> str | None:
    """Why ``password`` can't be used as a new password, or None if it can."""
    if len(password) < minimum:
        return f"Password must be at least {minimum} characters"
    if is_common(password):
        return "That password is too common - choose one that is harder to guess"
    return None


def check_account_password(password: str) -> str:
    """Pydantic-validator helper for a new account password: raise or pass it through."""
    reason = problem(password, minimum=PASSWORD_MIN_LENGTH)
    if reason:
        raise ValueError(reason)
    return password


def check_share_link_password(password: str) -> str | None:
    """Why a new share-link password can't be used, or None if it can."""
    return problem(password, minimum=SHARE_LINK_PASSWORD_MIN_LENGTH)


def warn_if_relaxed() -> None:
    """Log once at start-up when an admin has lowered a minimum below its default."""
    if PASSWORD_MIN_LENGTH < DEFAULT_PASSWORD_MIN_LENGTH:
        logger.warning(
            "PASSWORD_MIN_LENGTH is below its default (12). New account passwords "
            "can be shorter; only do this on a server that can't be reached from "
            "the internet."
        )
    if SHARE_LINK_PASSWORD_MIN_LENGTH < DEFAULT_SHARE_LINK_PASSWORD_MIN_LENGTH:
        logger.warning(
            "SHARE_LINK_PASSWORD_MIN_LENGTH is below its default (8). New "
            "share-link passwords can be shorter."
        )
