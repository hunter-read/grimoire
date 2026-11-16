"""Books: take image-only EPUBs and DjVus off the OCR queue

The indexer queued any book it found no text in for OCR, whatever its format,
but the OCR queue only ever drains PDFs. An image-only EPUB or DjVu was left
``ocr_pending`` and not indexed, so every scan extracted it again and queued it
again, and it never became searchable. Each such book is now marked image-only
and indexed, as an image-only PDF is when text recognition is off, so scans
leave it alone.

Revision ID: 7d2a9c4e1b58
Revises: 5c1e8a7d3f90
Create Date: 2026-11-16 00:00:00.000000+00:00

"""
import logging
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect, text


revision: str = "7d2a9c4e1b58"
down_revision: Union[str, None] = "5c1e8a7d3f90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("grimoire.db")


def upgrade() -> None:
    bind = op.get_bind()
    if "books" not in set(inspect(bind).get_table_names()):
        return
    # Booleans are bound rather than written as 0/1 or TRUE/FALSE, so the same
    # statement runs on SQLite and PostgreSQL.
    result = bind.execute(
        text(
            "UPDATE books SET ocr_pending = :no, indexed = :yes, index_failed = :no, "
            "index_error = 'image-only', ocr_pages_done = 0, ocr_pages_skipped = 0 "
            "WHERE ocr_pending = :yes AND mime_type != 'application/pdf'"
        ),
        {"yes": True, "no": False},
    )
    if result.rowcount:
        logger.info(
            f"{result.rowcount} image-only non-PDF book(s) taken off the OCR queue - "
            "text recognition reads PDFs only"
        )


def downgrade() -> None:
    # Putting the books back on a queue that never drains them would undo the fix.
    pass
