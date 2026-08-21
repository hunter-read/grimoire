"""remove books created from folder cover artwork (#372)

A ``cover.*`` / ``folder.*`` image at a system root is shelf artwork, but the
books walk also registered it as a 1-page book, so every system with folder
artwork grew a bogus "cover" entry. The walk now skips those files; this clears
the rows earlier scans already wrote.

Only rows whose path *is* artwork some system actually claimed (a
``game_systems.folder_cover_path`` value) are removed, so a real book that
happens to be named ``cover.pdf`` — or a ``cover.jpg`` deeper in the tree, which
the folder-cover convention never picked up — is left alone. Bookmarks,
favorites, tags, and FTS rows for the deleted books go with them.

Revision ID: b4d90c2e75af
Revises: c72e5b81a934
Create Date: 2026-08-21 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect, text


revision: str = "b4d90c2e75af"
down_revision: Union[str, None] = "c72e5b81a934"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    tables = set(insp.get_table_names())
    if "books" not in tables or "game_systems" not in tables:
        return
    if "folder_cover_path" not in {c["name"] for c in insp.get_columns("game_systems")}:
        return

    covers = [
        path
        for (path,) in bind.execute(
            text("SELECT folder_cover_path FROM game_systems WHERE folder_cover_path <> ''")
        ).fetchall()
        if path
    ]
    if not covers:
        return

    # folder_cover_path is library-relative; Book.filepath is absolute, so match
    # on the tail. Separators are normalised because a library written on one
    # platform can be read on the other.
    tails = {"/" + path.replace("\\", "/") for path in covers}

    # Matched by path rather than by owning system: under a one-page container
    # the artwork was registered against a *child* system invented for it
    # ("Cover"), not the container row holding folder_cover_path. That empty
    # child is pruned by the next full scan once its only book is gone.
    doomed = [
        book_id
        for book_id, filepath in bind.execute(
            text("SELECT id, filepath FROM books WHERE filepath IS NOT NULL")
        ).fetchall()
        if any((filepath or "").replace("\\", "/").endswith(tail) for tail in tails)
    ]

    if not doomed:
        return

    for book_id in doomed:
        if "bookmarks" in tables:
            bind.execute(text("DELETE FROM bookmarks WHERE book_id = :id"), {"id": book_id})
        if "favorites" in tables:
            bind.execute(
                text("DELETE FROM favorites WHERE item_type = 'book' AND item_id = :id"),
                {"id": book_id},
            )
        if "resource_tags" in tables:
            bind.execute(
                text(
                    "DELETE FROM resource_tags "
                    "WHERE resource_type = 'book' AND resource_id = :id"
                ),
                {"id": book_id},
            )
        if "book_search" in tables:
            bind.execute(text("DELETE FROM book_search WHERE book_id = :id"), {"id": book_id})
        bind.execute(text("DELETE FROM books WHERE id = :id"), {"id": book_id})


def downgrade() -> None:
    # The rows were never meant to exist; there is nothing to restore.
    pass
