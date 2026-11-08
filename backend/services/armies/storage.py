"""The imported roster files behind armies, kept so an export is exact.

Stored as ``ARMY_ROSTER_DIR/{army_id}.{ext}`` (``DATA_PATH/army_rosters/``) -
user data no rescan could rebuild, so it belongs with the database in a backup,
not in the library.
"""
from __future__ import annotations

import os
from typing import Iterable, Optional

from sqlalchemy import event
from sqlalchemy.orm import Session

from ... import config

#: The extensions an imported roster may keep.
ROSTER_EXTS = (".ros", ".rosz")


def _path(army_id: str, ext: str) -> str:
    # Read at call time, so a patched config.ARMY_ROSTER_DIR is honoured.
    return os.path.join(config.ARMY_ROSTER_DIR, f"{os.path.basename(army_id)}{ext}")


def save(army_id: str, raw: bytes, ext: str) -> None:
    """Keep an imported roster's bytes, replacing any earlier file for the army."""
    if ext not in ROSTER_EXTS:
        raise ValueError(f"not a roster extension: {ext!r}")
    os.makedirs(config.ARMY_ROSTER_DIR, exist_ok=True)
    delete(army_id)
    with open(_path(army_id, ext), "wb") as handle:
        handle.write(raw)


def load(army_id: str) -> Optional[tuple[bytes, str]]:
    """``(bytes, ext)`` of the army's imported roster, or None."""
    for ext in ROSTER_EXTS:
        path = _path(army_id, ext)
        if os.path.exists(path):
            with open(path, "rb") as handle:
                return handle.read(), ext
    return None


def delete(army_id: str) -> None:
    """Remove the army's roster file, if it has one."""
    for ext in ROSTER_EXTS:
        try:
            os.remove(_path(army_id, ext))
        except FileNotFoundError:
            pass


def delete_after_commit(db: Session, army_ids: Iterable[str]) -> None:
    """Remove these armies' roster files once ``db`` commits, and never otherwise.

    For deletes that go through raw SQL - a user's account being removed takes
    their armies with it. A delete that rolls back must not have cost anyone
    their roster, so the files wait for the commit.
    """
    ids = [army_id for army_id in army_ids if army_id]
    if not ids:
        return
    settled = False

    def _committed(session: Session) -> None:
        nonlocal settled
        if settled:
            return
        settled = True
        for army_id in ids:
            delete(army_id)

    def _rolled_back(session: Session) -> None:
        nonlocal settled
        settled = True

    event.listen(db, "after_commit", _committed, once=True)
    event.listen(db, "after_rollback", _rolled_back, once=True)
