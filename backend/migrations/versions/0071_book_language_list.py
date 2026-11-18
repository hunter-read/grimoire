"""Books: a language is one of a fixed list, stored lowercase

A book's language was free text, so one language turned up as ``English``,
``english``, ``en`` and ``en-US``. It is now one of ``LANGUAGES`` in
backend/models/languages.py, stored lowercase (``english``) and shown with a
capital. Each distinct stored value is rewritten to the listed language it
names - any case, an ISO 639 code or the language's own name - and a value
that names none is cleared. Only an exact name or code counts: a spelling the
list does not hold is not read as the nearest listed language, since that
would turn a real unlisted language into a different one (Bulgarian into
Hungarian).

The list is the one frozen in backend/migrations/_frozen/book_languages.py.

Revision ID: 5c1e8a7d3f90
Revises: 9b2f6d4e8c17
Create Date: 2026-11-14 00:00:00.000000+00:00

"""
import logging
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

from backend.migrations._frozen.book_languages import stored_language


revision: str = "5c1e8a7d3f90"
down_revision: Union[str, None] = "9b2f6d4e8c17"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("grimoire.db")


def upgrade() -> None:
    bind = op.get_bind()
    values = bind.execute(
        text("SELECT DISTINCT language FROM books WHERE language IS NOT NULL AND language != ''")
    ).scalars().all()
    for old in values:
        new = stored_language(old)
        if new == old:
            continue
        bind.execute(
            text("UPDATE books SET language = :new WHERE language = :old"),
            {"new": new, "old": old},
        )
        if new:
            logger.info(f"Book language {old!r} is now {new!r}")
        else:
            logger.info(f"Book language {old!r} names no listed language, so it was cleared")


def downgrade() -> None:
    # The old spellings are not kept; the lowercase names read fine as free text.
    pass
