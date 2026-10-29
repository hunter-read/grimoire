"""Grimoire Codex DB endpoints (issue #35): settings, connection test, send and unlink.

Lookup itself is not here: Grimoire Codex DB is a built-in source of the regular metadata
endpoints (``/books/{id}/metadata-*``, ``/systems/{id}/metadata-*``).

Without ``GRIMOIRE_CODEX_DB_API_TOKEN`` the integration does not exist on this server: every
endpoint here but ``/status`` answers 404 (see ``require_enabled``).
"""
from typing import Any, Union

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ... import codex
from ...auth import CurrentUser, require_admin, require_gm_or_admin, require_not_guest
from ...codex import client as codex_client
from ...codex import collection as codex_collection
from ...codex import compare as codex_compare
from ...codex.records import local_record, submit_payload
from ...config import get_db, release_connection
from ...models import Book, GameSystem
from ...services import access_control
from ._covers import local_cover
from ._schemas import CodexSettingsUpdate, CodexSubmit


def require_enabled() -> None:
    """404 unless ``GRIMOIRE_CODEX_DB_API_TOKEN`` is set, so an unconfigured server shows no trace of it."""
    if not codex.settings.token():
        raise HTTPException(404, "Grimoire Codex DB is not configured on this server")


def get_status(
    _: CurrentUser = Depends(require_not_guest),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Whether Grimoire Codex DB is configured, and where, so the UI knows what to show."""
    s = codex.load(db)
    return {"enabled": s.enabled, "url": s.url}


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
    """Change the connection. The token is set by ``GRIMOIRE_CODEX_DB_API_TOKEN`` only."""
    try:
        codex.save(db, url=data.url, send_hashes=data.send_hashes, sync_collection=data.sync_collection)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.commit()
    return codex.load(db).public()


def test_connection(
    _: CurrentUser = Depends(require_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Reach Grimoire Codex DB and report the account the token belongs to."""
    s = codex.load(db)
    # Grimoire Codex DB can take seconds to answer (issue #701).
    release_connection(db)
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


def _book_system(db: Session, book: Book, user: CurrentUser) -> GameSystem | None:
    """The book's game system, or None when it has none or ``user`` cannot see it.

    A book can be open inside a system its reader may not open. Sending the
    book then goes without the system: it is neither sent nor linked on their
    say-so, and the compare view does not describe it.
    """
    if not book.game_system_id:
        return None
    system = db.get(GameSystem, book.game_system_id)
    if system is None or not access_control.can_access_system(
        db, access_control.load_user(db, user), system
    ):
        return None
    return system


def _target(resource: Union[Book, GameSystem]) -> str:
    return "book" if isinstance(resource, Book) else "game-system"


def _compare(db: Session, resource: Union[Book, GameSystem], user: CurrentUser) -> dict:
    """What sending ``resource`` would change in Grimoire Codex DB, field by field."""
    s = codex.load(db)
    target = _target(resource)
    entity = "book" if target == "book" else "system"
    remote: dict[str, Any] | None = None
    release_connection(db)
    try:
        if resource.codex_id:
            remote = codex_client.export(s, entity, resource.codex_id)
        system = _system_choices(db, s, resource, user) if isinstance(resource, Book) else None
    except codex.CodexError as exc:
        raise codex.http_error(exc) from exc
    cover = local_cover(db, resource, access_control.load_user(db, user))
    remote_cover = remote.get("cover_url") if remote else None
    return {
        "linked": remote is not None,
        "codex_id": remote.get("codex_id") if remote else None,
        "codex_url": remote.get("codex_url") if remote else None,
        "revision": remote.get("codex_revision") if remote else None,
        "fields": codex_compare.compare_fields(local_record(db, resource, target), remote),
        "cover": {
            "local": cover is not None,
            "remote_url": remote_cover,
            "status": codex_compare.cover_status(cover.sha256 if cover else None, remote_cover),
        },
        "attributions": (remote.get("attributions") or []) if remote else [],
        "attribution_sources": codex_compare.attribution_sources(db, resource, target),
        "system": system,
    }


def _system_choices(
    db: Session, s: codex.CodexSettings, book: Book, user: CurrentUser
) -> dict | None:
    """A new book's game system, with the Grimoire Codex DB systems it might be when it is not linked."""
    if book.codex_id:
        return None
    system = _book_system(db, book, user)
    if system is None:
        return None
    candidates = []
    if not system.codex_id:
        release_connection(db)
        candidates = [
            {
                "codex_id": hit["id"],
                "name": hit.get("name", ""),
                "label": " · ".join(p for p in (hit.get("name", ""), hit.get("detail", "")) if p),
                "url": f"{s.url}/systems/{hit['id']}",
            }
            for hit in codex_client.search(s, system.name, "system", limit=5)
            if hit.get("id")
        ]
    return {"id": system.id, "name": system.name, "codex_id": system.codex_id, "candidates": candidates}


def _kind(resource: Union[Book, GameSystem]) -> codex_collection.EntityType:
    return "book" if isinstance(resource, Book) else "system"


def _send(
    db: Session,
    s: codex.CodexSettings,
    resource: Union[Book, GameSystem],
    data: CodexSubmit,
    user: CurrentUser,
    systems: list[str] | None = None,
    cover_if_any: bool = False,
) -> dict:
    """Send one record and link it once it exists in Grimoire Codex DB.

    ``cover_if_any`` sends the cover when there is one, rather than refusing without it.
    """
    target = _target(resource)
    try:
        payload = submit_payload(
            db,
            resource,
            target,
            s,
            fields=data.fields,
            note=data.note,
            systems=systems,
            # A correction may carry only a new cover or credit.
            allow_empty=bool(data.cover or data.attribution),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if data.sources:
        payload["sources"] = data.sources
    if data.attribution:
        payload["attributions"] = [data.attribution.model_dump()]
    if data.base_revision and resource.codex_id:
        payload["base_revision"] = data.base_revision
    cover = None
    if data.cover or cover_if_any:
        cover = local_cover(db, resource, access_control.load_user(db, user))
        if cover is None and not cover_if_any:
            raise HTTPException(400, "There is no cover to send")
    # Grimoire Codex DB can take seconds to answer (issue #701).
    release_connection(db)
    try:
        if cover is not None:
            payload["cover"] = codex_client.upload_cover(s, cover.data, cover.content_type)
        result: dict[str, Any] = codex_client.submit(s, "book" if target == "book" else "system", payload)
    except codex.CodexError as exc:
        raise codex.http_error(exc) from exc
    edit = result.get("edit") or {}
    status = "applied" if edit.get("status") == "applied" else "pending"
    codex_id = result.get("codex_id")
    # A new record that waits for review does not exist in Grimoire Codex DB yet, and may
    # never: link it only once it does, so a rejection cannot leave a dead link.
    linked = bool(codex_id) and (status == "applied" or bool(resource.codex_id))
    if linked and resource.codex_id != codex_id:
        before = {resource.id: resource.codex_id}
        resource.codex_id = codex_id
        db.commit()
        codex_collection.push_link_changes(db, _kind(resource), before)
    return {
        "status": status,
        "codex_id": codex_id,
        "linked": linked,
        "edit_url": f"{s.url}/edits/{edit.get('id', '')}",
    }


def _submit(db: Session, resource: Union[Book, GameSystem], data: CodexSubmit, user: CurrentUser) -> dict:
    """Send ``resource``; a new book whose system is not linked yet resolves the system first.

    The book either joins an existing Grimoire Codex DB system (linked here once the book
    is sent) or takes its local system along as a new record. A new system that waits
    for review cannot hold a book yet, so the book is then left for later.
    """
    s = codex.load(db)
    system = None
    if isinstance(resource, Book) and not resource.codex_id:
        system = _book_system(db, resource, user)
    choice = data.system
    if system is None or system.codex_id or choice is None or not (choice.codex_id or choice.create):
        return _send(db, s, resource, data, user)

    if choice.codex_id:
        result = _send(db, s, resource, data, user, systems=[choice.codex_id])
        before = {system.id: system.codex_id}
        system.codex_id = choice.codex_id
        db.commit()
        codex_collection.push_link_changes(db, "system", before)
        return result

    # The system goes as a whole new record with its cover; the book's field choice,
    # credits and revision are the book's own.
    system_data = CodexSubmit(note=data.note, sources=data.sources)
    sent_system = _send(db, s, system, system_data, user, cover_if_any=True)
    if not sent_system["linked"]:
        return {**sent_system, "status": "waiting_for_system", "codex_id": None, "system": sent_system}
    return {**_send(db, s, resource, data, user), "system": sent_system}


def compare_book(
    book_id: str,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Compare a book with its Grimoire Codex DB record, ahead of sending it."""
    return _compare(db, _book(db, book_id, current_user), current_user)


def compare_system(
    system_id: str,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Compare a game system with its Grimoire Codex DB record, ahead of sending it."""
    return _compare(db, _system(db, system_id, current_user), current_user)


def submit_book(
    book_id: str,
    data: CodexSubmit,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Send a book to Grimoire Codex DB: a new record, or a correction to the linked one."""
    return _submit(db, _book(db, book_id, current_user), data, current_user)


def submit_system(
    system_id: str,
    data: CodexSubmit,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Send a game system to Grimoire Codex DB: a new record, or a correction to the linked one."""
    return _submit(db, _system(db, system_id, current_user), data, current_user)


def unlink_book(
    book_id: str,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Forget which Grimoire Codex DB record this book is. Nothing changes in Grimoire Codex DB."""
    book = _book(db, book_id, current_user)
    before = {book.id: book.codex_id}
    book.codex_id = None
    db.commit()
    codex_collection.push_link_changes(db, "book", before)
    return {"status": "ok"}


def unlink_system(
    system_id: str,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Forget which Grimoire Codex DB record this system is. Nothing changes in Grimoire Codex DB."""
    system = _system(db, system_id, current_user)
    before = {system.id: system.codex_id}
    system.codex_id = None
    db.commit()
    codex_collection.push_link_changes(db, "system", before)
    return {"status": "ok"}


def sync_collection(
    _: CurrentUser = Depends(require_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Replace every mark Grimoire made in the token owner's collection with what is linked now."""
    s = codex.load(db)
    if not s.sync_collection:
        raise HTTPException(400, "Collection sync is off. Turn it on in the Grimoire Codex DB settings first.")
    try:
        return codex_collection.sync_all(db, s)
    except codex.CodexError as exc:
        raise codex.http_error(exc) from exc
