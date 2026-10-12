"""The public side of share links (issue #541): no login, just the token.

Every request re-decides whether the link works (see ``_links.evaluate``), and
anything short of a working link - unknown, revoked, expired, suspended, or the
item gone - is the same 404, so the response never says which.
"""
import datetime
from typing import Optional

from fastapi import Cookie, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ...auth import verify_password
from ...config import get_db
from ...models import ShareLink
from ...models.base import utc_iso
from ...security import (
    SHARE_LOOKUP_SCOPE,
    SHARE_UNLOCK_SCOPE,
    record_share_failure,
    share_attempts_blocked,
)
from . import _content, _links
from ._schemas import ShareUnlock

# Headers on everything served through a link. Cross-origin reads are allowed
# because the point is to be loaded by other sites - a WebGL canvas (Owlbear
# Rodeo) cannot even read an image without them - and no credentials are
# involved. Kept out of search engines and referrer logs.
_PUBLIC_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, max-age=300",
}

# A password-protected link is meant for a browser on the share page, which
# holds the unlock cookie. Cross-origin readers could not send that cookie
# anyway, so they are not invited, and nothing is kept in a shared cache.
_PROTECTED_HEADERS = {
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, no-store",
}

def _find(db: Session, token: str, request: Request) -> ShareLink:
    if share_attempts_blocked(request, SHARE_LOOKUP_SCOPE):
        raise HTTPException(429, "Too many attempts - try again shortly")
    link = db.query(ShareLink).filter_by(token=token).first()
    if link is None:
        # Only an unknown token counts towards the throttle; see security.py.
        record_share_failure(request, SHARE_LOOKUP_SCOPE)
        raise HTTPException(404, "Not found")
    return link


def _working(db: Session, link: ShareLink):
    state, _creator, record = _links.evaluate(db, link)
    if state != "active":
        raise HTTPException(404, "Not found")
    return record


def share_meta(
    token: str,
    request: Request,
    unlock: Optional[str] = Cookie(None, alias=_links.UNLOCK_COOKIE),
    db: Session = Depends(get_db),
):
    """What the share page needs to show a link. Withholds everything about the
    item until a password-protected link is unlocked."""
    link = _find(db, token, request)
    record = _working(db, link)
    unlocked = _links.is_unlocked(link, unlock)
    body: dict = {"password_required": bool(link.password_hash), "unlocked": unlocked}
    if not unlocked:
        return body
    mime = _content.served_media_type(link.resource_type, record)
    file_path = f"/api/share/{link.token}/{link.filename or link.resource_type}"
    body.update(
        {
            "resource_type": link.resource_type,
            "name": _content.display_name(link.resource_type, record),
            "label": link.label or "",
            "filename": link.filename or "",
            "media_type": mime,
            "media_kind": _content.media_kind(link.resource_type, record, mime),
            "file_size": record.file_size or None,
            "file_url": file_path,
            "download_url": f"{file_path}?download=1",
            "expires_at": utc_iso(link.expires_at),
        }
    )
    return body


def unlock_share(
    token: str,
    data: ShareUnlock,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Check a link's password and remember it in this browser for a while."""
    link = _find(db, token, request)
    _working(db, link)
    if not link.password_hash:
        return {"unlocked": True}
    if share_attempts_blocked(request, SHARE_UNLOCK_SCOPE, link.id):
        raise HTTPException(429, "Too many attempts - try again shortly")
    if not verify_password(data.password, link.password_hash):
        record_share_failure(request, SHARE_UNLOCK_SCOPE, link.id)
        raise HTTPException(403, "Wrong password")
    response.set_cookie(value=_links.unlock_token(link), **_links.unlock_cookie_options(link))
    return {"unlocked": True}


def _record_use(db: Session, link: ShareLink, request: Request) -> None:
    """Count a fetch. HEAD and mid-file range requests are not new uses: a player
    seeking through shared audio makes many requests for one listen."""
    if request.method != "GET":
        return
    rng = request.headers.get("range", "")
    if rng and not rng.replace(" ", "").startswith("bytes=0-"):
        return
    link.use_count = (link.use_count or 0) + 1
    link.last_used_at = datetime.datetime.now(datetime.timezone.utc)
    db.commit()


def share_content(
    token: str,
    request: Request,
    filename: Optional[str] = None,
    download: bool = Query(False, description="Serve as an attachment rather than inline."),
    unlock: Optional[str] = Cookie(None, alias=_links.UNLOCK_COOKIE),
    db: Session = Depends(get_db),
):
    """The shared item itself. ``filename`` is cosmetic: tools that pick a decoder
    from the URL's extension get one, and any name serves the same file."""
    link = _find(db, token, request)
    record = _working(db, link)
    if not _links.is_unlocked(link, unlock):
        raise HTTPException(401, "This link needs a password")
    shared = _content.shared_file(link.resource_type, record)
    _record_use(db, link, request)

    name = (link.filename or link.resource_type).replace('"', "")
    headers = dict(_PROTECTED_HEADERS if link.password_hash else _PUBLIC_HEADERS)
    headers["Content-Disposition"] = f'{"attachment" if download else "inline"}; filename="{name}"'
    if shared.path is not None:
        return FileResponse(shared.path, media_type=shared.media_type, headers=headers)
    return Response(content=shared.content or b"", media_type=shared.media_type, headers=headers)
