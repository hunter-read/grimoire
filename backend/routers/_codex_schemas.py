"""Validation shared by every schema that accepts a Grimoire Codex id (issue #35)."""
import re
from typing import Optional

_CODEX_ID = re.compile(r"^[A-Za-z0-9_-]{4,40}$")


def codex_id_validator(value: Optional[str]) -> Optional[str]:
    """Accept a Codex record id (letters, digits, ``_`` and ``-``) or None."""
    if value is None:
        return value
    value = value.strip()
    if not _CODEX_ID.match(value):
        raise ValueError("codex_id must be a Grimoire Codex record id")
    return value
