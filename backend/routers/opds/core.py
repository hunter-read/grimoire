"""OPDS 1.2 catalog endpoints.

Each user has an opaque personal token embedded in their feed URL.
The token is generated on-demand and can be revoked (regenerated) at any time.

Routes are registered without auth middleware — the token IS the credential.
OPDS_ENABLED must be true (env var) for this router to be registered at all.
"""
import datetime
import os
from xml.sax.saxutils import escape

from fastapi import Depends, HTTPException
from fastapi.responses import Response, FileResponse
from sqlalchemy.orm import Session

from ...config import get_db
from ...models import Book, User
from ...services import access_control, tag_service


_ATOM_NS = 'xmlns="http://www.w3.org/2005/Atom"'
_OPDS_NS = 'xmlns:opds="http://opds-spec.org/2010/catalog"'
_DC_NS = 'xmlns:dc="http://purl.org/dc/terms/"'
_NAMESPACES = f'{_ATOM_NS} {_OPDS_NS} {_DC_NS}'

_XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>'
_CONTENT_TYPE = "application/atom+xml;profile=opds-catalog;kind=navigation"
_ACQUISITION_TYPE = "application/atom+xml;profile=opds-catalog;kind=acquisition"


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _resolve_user(db, token: str) -> User:
    """Look up a user by their OPDS token. Raises 404 if not found/revoked.

    Guests are campaign-scoped and never entitled to the full-library OPDS feed;
    a guest token (e.g. left over from before a role change) is rejected here so
    the feed and download routes can't be used to bypass campaign scoping.
    """
    user = db.query(User).filter_by(opds_token=token).first()
    if not user or user.role == "guest":
        raise HTTPException(404, "Not found")
    return user


def _book_to_entry(book: Book, token: str, base_url: str, tags: list[str]) -> str:
    """Render a single Book as an OPDS Atom <entry>."""
    title = escape(book.title or "Untitled")
    authors = book.authors or []
    author_xml = "".join(
        f"<author><name>{escape(a)}</name></author>" for a in authors
    )
    description = escape(book.description or "")
    updated = (book.updated_at or book.created_at or datetime.datetime.utcnow()).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    entry_url = f"{base_url}/opds/{token}/entry/{book.id}"
    download_url = f"{base_url}/opds/{token}/download/{book.id}"
    mime = escape(book.mime_type or "application/pdf")

    cover_link = ""
    if book.has_thumbnail:
        thumb_url = f"{base_url}/api/books/{book.id}/thumbnail?token={token}"
        cover_link = (
            f'<link rel="http://opds-spec.org/image" href="{escape(thumb_url)}" type="image/jpeg"/>'
            f'<link rel="http://opds-spec.org/image/thumbnail" href="{escape(thumb_url)}" type="image/jpeg"/>'
        )

    tags_xml = "".join(
        f"<category term={escape(repr(t))}/>" for t in tags
    )

    return (
        f"<entry>"
        f"<id>urn:grimoire:book:{book.id}</id>"
        f"<title>{title}</title>"
        f"{author_xml}"
        f"<updated>{updated}</updated>"
        f"<summary>{description}</summary>"
        f"{tags_xml}"
        f"{cover_link}"
        f'<link rel="alternate" href="{escape(entry_url)}" type="{_ACQUISITION_TYPE}"/>'
        f'<link rel="http://opds-spec.org/acquisition" href="{escape(download_url)}" type="{mime}"/>'
        f"</entry>"
    )


def _feed_wrapper(title: str, feed_id: str, updated: str, links: str, entries: str) -> str:
    return (
        f"{_XML_HEADER}"
        f'<feed {_NAMESPACES}>'
        f"<id>{escape(feed_id)}</id>"
        f"<title>{escape(title)}</title>"
        f"<updated>{updated}</updated>"
        f"{links}"
        f"{entries}"
        f"</feed>"
    )


def catalog(token: str, request_url: str = "", db: Session = Depends(get_db)) -> Response:
    """Root navigation feed — lists available sub-feeds."""
    # Validates the token (raises on an invalid/expired one) before we build
    # the feed; the resolved user itself isn't needed for the root catalog.
    _resolve_user(db, token)
    # Derive base URL from the request — FastAPI passes Request via DI,
    # but we keep this free-function friendly by computing it from config.
    base_url = _base_url()
    updated = _now_iso()
    feed_url = f"{base_url}/opds/{token}"

    links = (
        f'<link rel="self" href="{escape(feed_url)}" type="{_CONTENT_TYPE}"/>'
        f'<link rel="start" href="{escape(feed_url)}" type="{_CONTENT_TYPE}"/>'
    )

    all_url = f"{base_url}/opds/{token}/all"
    entries = (
        f"<entry>"
        f"<id>urn:grimoire:opds:all</id>"
        f"<title>All Books</title>"
        f"<updated>{updated}</updated>"
        f"<content type='text'>Browse the complete library</content>"
        f'<link rel="subsection" href="{escape(all_url)}" type="{_ACQUISITION_TYPE}"/>'
        f"</entry>"
    )

    body = _feed_wrapper("Grimoire Library", feed_url, updated, links, entries)
    return Response(content=body, media_type=_CONTENT_TYPE)


def catalog_all(token: str, db: Session = Depends(get_db)) -> Response:
    """Acquisition feed — all books the user is allowed to see."""
    user = _resolve_user(db, token)
    base_url = _base_url()
    updated = _now_iso()
    feed_url = f"{base_url}/opds/{token}/all"
    root_url = f"{base_url}/opds/{token}"

    # Variants are included on purpose. A catalogue an e-reader syncs from
    # should list every file the user owns; silently omitting the
    # printer-friendly edition would read as a missing book.
    q = db.query(Book).filter(Book.is_missing != True)
    if not (user.allow_explicit if user.allow_explicit is not None else True):
        q = q.filter(Book.is_explicit != True)
    # The OPDS token authenticates the user, so their access level applies here
    # exactly as it does in the web UI (issue #258) — an e-reader must not be a
    # way around a restriction.
    q = access_control.visible_books(db, q, user)
    books = q.order_by(Book.title).all()

    links = (
        f'<link rel="self" href="{escape(feed_url)}" type="{_ACQUISITION_TYPE}"/>'
        f'<link rel="start" href="{escape(root_url)}" type="{_CONTENT_TYPE}"/>'
        f'<link rel="up" href="{escape(root_url)}" type="{_CONTENT_TYPE}"/>'
    )

    book_tags = tag_service.display_tags_for_resources(db, "book", [b.id for b in books])
    entries = "".join(_book_to_entry(b, token, base_url, book_tags.get(b.id, [])) for b in books)
    body = _feed_wrapper("All Books", feed_url, updated, links, entries)
    return Response(content=body, media_type=_ACQUISITION_TYPE)


def book_entry(token: str, book_id: str, db: Session = Depends(get_db)) -> Response:
    """Single-entry acquisition feed for a specific book."""
    user = _resolve_user(db, token)
    book = db.query(Book).filter_by(id=book_id).first()
    if not book or book.is_missing:
        raise HTTPException(404, "Book not found")
    if not access_control.can_access_book(db, user, book):
        # 404, matching the web UI: a restricted book stays indistinguishable
        # from one that does not exist.
        raise HTTPException(404, "Book not found")
    if book.is_explicit and not (user.allow_explicit if user.allow_explicit is not None else True):
        raise HTTPException(403, "Forbidden")

    base_url = _base_url()
    updated = _now_iso()
    feed_url = f"{base_url}/opds/{token}/entry/{book_id}"
    root_url = f"{base_url}/opds/{token}"

    links = (
        f'<link rel="self" href="{escape(feed_url)}" type="{_ACQUISITION_TYPE}"/>'
        f'<link rel="start" href="{escape(root_url)}" type="{_CONTENT_TYPE}"/>'
        f'<link rel="up" href="{escape(root_url)}/all" type="{_ACQUISITION_TYPE}"/>'
    )

    entry = _book_to_entry(
        book, token, base_url, tag_service.display_tags_for_resource(db, "book", book.id)
    )
    body = _feed_wrapper(book.title or "Book", feed_url, updated, links, entry)
    return Response(content=body, media_type=_ACQUISITION_TYPE)


def download_book(token: str, book_id: str, db: Session = Depends(get_db)) -> FileResponse:
    """File download via OPDS token — no JWT required."""
    user = _resolve_user(db, token)
    book = db.query(Book).filter_by(id=book_id).first()
    if not book or book.is_missing:
        raise HTTPException(404, "Book not found")
    if not access_control.can_access_book(db, user, book):
        # 404, matching the web UI: a restricted book stays indistinguishable
        # from one that does not exist.
        raise HTTPException(404, "Book not found")
    if book.is_explicit and not (user.allow_explicit if user.allow_explicit is not None else True):
        raise HTTPException(403, "Forbidden")
    if not os.path.isfile(book.filepath):
        raise HTTPException(404, "File not found on disk")
    return FileResponse(
        book.filepath,
        media_type=book.mime_type or "application/pdf",
        filename=book.filename,
    )


def _base_url() -> str:
    """Return the configured base URL, stripping any trailing slash."""
    from ...config import BASE_URL
    return BASE_URL
