"""Shared request field types for the names and ids people type or send.

``Name`` is a display name - a campaign's, a league's, an army's: trimmed, and
refused (422) when nothing is left, rather than stored blank. ``OptionalId`` is
an optional link to another row, where ``""`` means none, so it never reaches
the database as a foreign key that matches nothing.
"""
from typing import Annotated, Optional

from pydantic import BeforeValidator, StringConstraints

#: The width of the name columns.
NAME_MAX_LENGTH = 255

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=NAME_MAX_LENGTH)]


def _blank_is_none(value: object) -> object:
    return None if value == "" else value


OptionalId = Annotated[Optional[str], BeforeValidator(_blank_is_none)]
