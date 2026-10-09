"""GrimoireCodexDB endpoints (issue #35): settings, connection test, send and unlink.

Lookup itself is not here: GrimoireCodexDB is a built-in source of the regular metadata
endpoints (``/books/{id}/metadata-*``, ``/systems/{id}/metadata-*``).
"""
from typing import Any, Union

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ... import codex
from ...auth import CurrentUser, require_admin, require_gm_or_admin, require_not_guest
from ...codex import client as codex_client
from ...codex.records import submit_payload
from ...config import get_db
from ...models import Book, GameSystem
from ...services import access_control
from ._schemas import CodexSettingsUpdate, CodexSubmit


def get_status(
    _: CurrentUser = Depends(require_not_guest),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Whether GrimoireCodexDB is on and where, so the UI knows which actions to offer."""
    s = codex.load(db)
    return {"enabled": s.enabled, "url": s.url, "can_submit": s.can_submit}


def get_settings(
    _: CurrentUser = Depends(require_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    return codex.load(db).public()


def update_settings(
    data: CodexSettingsUpdate,
    _: CurrentUser = Depends(require_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Change the connection. The token is write-only: it is never returned."""
    try:
        codex.save(
            db,
            enabled=data.enabled,
            url=data.url,
            token=data.api_token,
            send_hashes=data.send_hashes,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.commit()
    return codex.load(db).public()


def test_connection(
    _: CurrentUser = Depends(require_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Reach GrimoireCodexDB and, with a token set, report the account it belongs to."""
    s = codex.load(db)
    try:
        me = codex_client.me(s)
    except codex.CodexError as exc:
        raise codex.http_error(exc) from exc
    user = me.get("user") if isinstance(me, dict) else None
    account = {"name": user.get("name", ""), "role": user.get("role", "")} if user else None
    return {"ok": True, "url": s.url, "account": account}


def _book(db: Session, book_id: str, user: CurrentUser) -> Book:
    book = db.query(Book).filter_by(id=book_id).first()
    if not book or not access_control.can_access_book(db, access_control.load_user(db, user), book):
        raise HTTPException(404, "Book not found")
    return book


def _system(db: Session, system_id: str, user: CurrentUser) -> GameSystem:
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if not system or not access_control.can_access_system(
        db, access_control.load_user(db, user), system
    ):
        raise HTTPException(404, "System not found")
    return system


def _submit(db: Session, resource: Union[Book, GameSystem], target: str, data: CodexSubmit) -> dict:
    s = codex.load(db)
    try:
        payload = submit_payload(db, resource, target, s, fields=data.fields, note=data.note)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    try:
        result: dict[str, Any] = codex_client.submit(s, "book" if target == "book" else "system", payload)
    except codex.CodexError as exc:
        raise codex.http_error(exc) from exc
    edit = result.get("edit") or {}
    status = "applied" if edit.get("status") == "applied" else "pending"
    codex_id = result.get("codex_id")
    # A new record that waits for review does not exist in GrimoireCodexDB yet, and may
    # never: link it only once it does, so a rejection cannot leave a dead link.
    linked = bool(codex_id) and (status == "applied" or bool(resource.codex_id))
    if linked and resource.codex_id != codex_id:
        resource.codex_id = codex_id
        db.commit()
    return {
        "status": status,
        "codex_id": codex_id,
        "linked": linked,
        "edit_url": f"{s.url}/edits/{edit.get('id', '')}",
    }


def submit_book(
    book_id: str,
    data: CodexSubmit,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Send a book to GrimoireCodexDB: a new record, or a correction to the linked one."""
    return _submit(db, _book(db, book_id, current_user), "book", data)


def submit_system(
    system_id: str,
    data: CodexSubmit,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Send a game system to GrimoireCodexDB: a new record, or a correction to the linked one."""
    return _submit(db, _system(db, system_id, current_user), "game-system", data)


def unlink_book(
    book_id: str,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Forget which GrimoireCodexDB record this book is. Nothing changes in GrimoireCodexDB."""
    book = _book(db, book_id, current_user)
    book.codex_id = None
    db.commit()
    return {"status": "ok"}


def unlink_system(
    system_id: str,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Forget which GrimoireCodexDB record this system is. Nothing changes in GrimoireCodexDB."""
    system = _system(db, system_id, current_user)
    system.codex_id = None
    db.commit()
    return {"status": "ok"}
