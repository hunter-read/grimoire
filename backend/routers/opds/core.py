"""OPDS 1.2 catalog endpoints.

Each user has an opaque personal token embedded in their feed URL.
The token is generated on-demand and can be revoked (regenerated) at any time.

Routes are registered without auth middleware — the token IS the credential.
OPDS_ENABLED must be true (env var) for this router to be registered at all.

Two versions of the feed are served side by side. v1 (``/opds/{token}``) is the
original single "All Books" catalog and is kept exactly as it was, so a reader
already pointed at it keeps working. v2 (``/opds/v2/{token}``) adds one
sub-feed per game system (issue #673). Each feed's links stay inside its own
version, so a client never wanders from one into the other.

Both versions page their acquisition feeds when the URL asks with
``?page_size=N`` (issue #706; see ``_paging``). Without it, every feed is the
single unpaged document it always was.
"""
import datetime
import os
from typing import Optional
from xml.sax.saxutils import escape, quoteattr

from fastapi import Depends, HTTPException
from fastapi.responses import Response, FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Query, Session

from .._user_files import serve_user_file
from ._paging import (
    OPENSEARCH_NS,
    Paging,
    page_links,
    page_size_param,
    paging_params,
    with_page_size,
)
from ... import token_vault
from ...config import get_db
from ...models import Book, GameSystem, User
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
    user = db.query(User).filter_by(opds_token_hash=token_vault.lookup_hash(token)).first()
    if not user or user.role == "guest":
        raise HTTPException(404, "Not found")
    return user


def _v1_root(token: str) -> str:
    return f"{_base_url()}/opds/{token}"


def _v2_root(token: str) -> str:
    return f"{_base_url()}/opds/v2/{token}"


def _book_to_entry(
    book: Book, root: str, tags: list[str], page_size: Optional[int] = None
) -> str:
    """Render a single Book as an OPDS Atom <entry>, linking under feed ``root``."""
    title = escape(book.title or "Untitled")
    authors = book.authors or []
    author_xml = "".join(
        f"<author><name>{escape(a)}</name></author>" for a in authors
    )
    description = escape(book.description or "")
    updated = (book.updated_at or book.created_at or datetime.datetime.utcnow()).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    entry_url = with_page_size(f"{root}/entry/{book.id}", page_size)
    download_url = f"{root}/download/{book.id}"
    mime = quoteattr(book.mime_type or "application/pdf")

    cover_link = ""
    if book.has_thumbnail or book.cover_image:
        # Served by the OPDS router under the feed token: the app's own
        # thumbnail route takes a session, which an e-reader doesn't have.
        thumb_url = f"{root}/cover/{book.id}"
        cover_link = (
            f'<link rel="http://opds-spec.org/image" href="{escape(thumb_url)}" type="image/webp"/>'
            f'<link rel="http://opds-spec.org/image/thumbnail" href="{escape(thumb_url)}" type="image/webp"/>'
        )

    # quoteattr picks the quote character and escapes the other, so a tag holding
    # both ' and " still yields well-formed XML (repr() did not, and one such
    # tag broke the whole feed for every client).
    tags_xml = "".join(f"<category term={quoteattr(t)}/>" for t in tags)

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
        f'<link rel="http://opds-spec.org/acquisition" href="{escape(download_url)}" type={mime}/>'
        f"</entry>"
    )


def _feed_wrapper(
    title: str, feed_id: str, updated: str, links: str, entries: str, namespaces: str = _NAMESPACES
) -> str:
    return (
        f"{_XML_HEADER}"
        f'<feed {namespaces}>'
        f"<id>{escape(feed_id)}</id>"
        f"<title>{escape(title)}</title>"
        f"<updated>{updated}</updated>"
        f"{links}"
        f"{entries}"
        f"</feed>"
    )


def _allows_explicit(user: User) -> bool:
    return user.allow_explicit if user.allow_explicit is not None else True


def _visible_books(db: Session, user: User) -> Query:
    """Every book ``user`` may see through OPDS, as an unordered query."""
    # Variants are included on purpose. A catalogue an e-reader syncs from
    # should list every file the user owns; silently omitting the
    # printer-friendly edition would read as a missing book.
    q = db.query(Book).filter(Book.is_missing != True)  # noqa: E712
    if not _allows_explicit(user):
        q = q.filter(Book.is_explicit != True)  # noqa: E712
    # The OPDS token authenticates the user, so their access level applies here
    # exactly as it does in the web UI (issue #258) — an e-reader must not be a
    # way around a restriction.
    return access_control.visible_books(db, q, user)


def _nav_entry(entry_id: str, title: str, updated: str, content: str, href: str) -> str:
    """A navigation-feed <entry> pointing at the acquisition feed ``href``."""
    return (
        f"<entry>"
        f"<id>{escape(entry_id)}</id>"
        f"<title>{escape(title)}</title>"
        f"<updated>{updated}</updated>"
        f"<content type='text'>{escape(content)}</content>"
        f'<link rel="subsection" href="{escape(href)}" type="{_ACQUISITION_TYPE}"/>'
        f"</entry>"
    )


def _books_feed(
    db: Session, title: str, feed_url: str, root: str, query: Query, paging: Paging
) -> Response:
    """An acquisition feed of the books in ``query``, linking under feed ``root``.

    Ordered by title, with the id breaking ties so a page boundary never
    shows one book twice or skips another. Only ``paging``'s page is loaded.
    """
    query = query.order_by(Book.title, Book.id)
    home = escape(with_page_size(root, paging.size))
    nav_links = (
        f'<link rel="start" href="{home}" type="{_CONTENT_TYPE}"/>'
        f'<link rel="up" href="{home}" type="{_CONTENT_TYPE}"/>'
    )
    if paging.size:
        total = query.count()
        books = query.offset(paging.offset).limit(paging.size).all()
        links = page_links(feed_url, paging, total, _ACQUISITION_TYPE) + nav_links
        namespaces = f"{_NAMESPACES} {OPENSEARCH_NS}"
    else:
        books = query.all()
        self_link = f'<link rel="self" href="{escape(feed_url)}" type="{_ACQUISITION_TYPE}"/>'
        links = self_link + nav_links
        namespaces = _NAMESPACES
    book_tags = tag_service.display_tags_for_resources(db, "book", [b.id for b in books])
    entries = "".join(
        _book_to_entry(b, root, book_tags.get(b.id, []), paging.size) for b in books
    )
    body = _feed_wrapper(title, feed_url, _now_iso(), links, entries, namespaces)
    return Response(content=body, media_type=_ACQUISITION_TYPE)


def _entry_feed(
    db: Session, token: str, book_id: str, root: str, page_size: Optional[int]
) -> Response:
    """Single-entry acquisition feed for one book, linking under feed ``root``."""
    user = _resolve_user(db, token)
    book = db.query(Book).filter_by(id=book_id).first()
    if not book or book.is_missing:
        raise HTTPException(404, "Book not found")
    if not access_control.can_access_book(db, user, book):
        # 404, matching the web UI: a restricted book stays indistinguishable
        # from one that does not exist.
        raise HTTPException(404, "Book not found")
    if book.is_explicit and not _allows_explicit(user):
        raise HTTPException(403, "Forbidden")

    feed_url = f"{root}/entry/{book_id}"
    self_url = escape(with_page_size(feed_url, page_size))
    home = escape(with_page_size(root, page_size))
    all_url = escape(with_page_size(f"{root}/all", page_size))
    links = (
        f'<link rel="self" href="{self_url}" type="{_ACQUISITION_TYPE}"/>'
        f'<link rel="start" href="{home}" type="{_CONTENT_TYPE}"/>'
        f'<link rel="up" href="{all_url}" type="{_ACQUISITION_TYPE}"/>'
    )

    tags = tag_service.display_tags_for_resource(db, "book", book.id)
    entry = _book_to_entry(book, root, tags, page_size)
    body = _feed_wrapper(book.title or "Book", feed_url, _now_iso(), links, entry)
    return Response(content=body, media_type=_ACQUISITION_TYPE)


def _root_feed(root: str, entries: str, updated: str, page_size: Optional[int]) -> Response:
    home = escape(with_page_size(root, page_size))
    links = (
        f'<link rel="self" href="{home}" type="{_CONTENT_TYPE}"/>'
        f'<link rel="start" href="{home}" type="{_CONTENT_TYPE}"/>'
    )
    body = _feed_wrapper("Grimoire Library", root, updated, links, entries)
    return Response(content=body, media_type=_CONTENT_TYPE)


# ---------------------------------------------------------------------------
# v1 — the original catalog. Its URLs and output are frozen: readers already
# subscribed to it must see exactly what they always have. Paging changes
# nothing unless the URL asks for it with ``page_size``.
# ---------------------------------------------------------------------------


def catalog(
    token: str,
    request_url: str = "",
    page_size: Optional[int] = Depends(page_size_param),
    db: Session = Depends(get_db),
) -> Response:
    """Root navigation feed — lists available sub-feeds."""
    # Validates the token (raises on an invalid/expired one) before we build
    # the feed; the resolved user itself isn't needed for the root catalog.
    _resolve_user(db, token)
    root = _v1_root(token)
    updated = _now_iso()
    entries = _nav_entry(
        "urn:grimoire:opds:all",
        "All Books",
        updated,
        "Browse the complete library",
        with_page_size(f"{root}/all", page_size),
    )
    return _root_feed(root, entries, updated, page_size)


def catalog_all(
    token: str, paging: Paging = Depends(paging_params), db: Session = Depends(get_db)
) -> Response:
    """Acquisition feed — all books the user is allowed to see."""
    user = _resolve_user(db, token)
    root = _v1_root(token)
    return _books_feed(db, "All Books", f"{root}/all", root, _visible_books(db, user), paging)


def book_entry(
    token: str,
    book_id: str,
    page_size: Optional[int] = Depends(page_size_param),
    db: Session = Depends(get_db),
) -> Response:
    """Single-entry acquisition feed for a specific book."""
    return _entry_feed(db, token, book_id, _v1_root(token), page_size)


# ---------------------------------------------------------------------------
# v2 — the catalog browsable by game system (issue #673).
# ---------------------------------------------------------------------------


def _book_count(n: int) -> str:
    return "1 book" if n == 1 else f"{n} books"


def _visible_systems(db: Session, user: User) -> Query:
    """The game systems ``user`` may browse, hiding explicit ones as the web UI does."""
    q = access_control.visible_systems(db, db.query(GameSystem), user)
    if not _allows_explicit(user):
        q = q.filter(GameSystem.is_explicit != True)  # noqa: E712
    return q


def catalog_v2(
    token: str,
    page_size: Optional[int] = Depends(page_size_param),
    db: Session = Depends(get_db),
) -> Response:
    """Root navigation feed: All Books, then one sub-feed per game system."""
    user = _resolve_user(db, token)
    root = _v2_root(token)
    updated = _now_iso()

    # Counted from the books the user can actually open, so a system with
    # nothing visible in it is left out rather than shown empty.
    counts = dict(
        _visible_books(db, user)
        .with_entities(Book.game_system_id, func.count(Book.id))
        .group_by(Book.game_system_id)
        .all()
    )
    systems = (
        _visible_systems(db, user)
        .filter(GameSystem.id.in_([sid for sid in counts if sid]))
        .order_by(func.lower(GameSystem.name))
        .all()
    )

    entries = [
        _nav_entry(
            "urn:grimoire:opds:all",
            "All Books",
            updated,
            "Browse the complete library",
            with_page_size(f"{root}/all", page_size),
        )
    ]
    entries += [
        _nav_entry(
            f"urn:grimoire:opds:system:{s.id}",
            s.name,
            updated,
            _book_count(counts[s.id]),
            with_page_size(f"{root}/system/{s.id}", page_size),
        )
        for s in systems
    ]
    if counts.get(None):
        entries.append(
            _nav_entry(
                "urn:grimoire:opds:other",
                "Other Books",
                updated,
                f"{_book_count(counts[None])} without a game system",
                with_page_size(f"{root}/other", page_size),
            )
        )
    return _root_feed(root, "".join(entries), updated, page_size)


def catalog_all_v2(
    token: str, paging: Paging = Depends(paging_params), db: Session = Depends(get_db)
) -> Response:
    """Acquisition feed — all books the user is allowed to see."""
    user = _resolve_user(db, token)
    root = _v2_root(token)
    return _books_feed(db, "All Books", f"{root}/all", root, _visible_books(db, user), paging)


def catalog_system_v2(
    token: str,
    system_id: str,
    paging: Paging = Depends(paging_params),
    db: Session = Depends(get_db),
) -> Response:
    """Acquisition feed — one game system's books."""
    user = _resolve_user(db, token)
    system = _visible_systems(db, user).filter(GameSystem.id == system_id).first()
    if not system:
        # 404 for a restricted or explicit system too, so it stays
        # indistinguishable from one that does not exist.
        raise HTTPException(404, "Game system not found")
    root = _v2_root(token)
    books = _visible_books(db, user).filter(Book.game_system_id == system.id)
    return _books_feed(db, system.name, f"{root}/system/{system.id}", root, books, paging)


def catalog_other_v2(
    token: str, paging: Paging = Depends(paging_params), db: Session = Depends(get_db)
) -> Response:
    """Acquisition feed — books that belong to no game system."""
    user = _resolve_user(db, token)
    root = _v2_root(token)
    books = _visible_books(db, user).filter(Book.game_system_id.is_(None))
    return _books_feed(db, "Other Books", f"{root}/other", root, books, paging)


def book_entry_v2(
    token: str,
    book_id: str,
    page_size: Optional[int] = Depends(page_size_param),
    db: Session = Depends(get_db),
) -> Response:
    """Single-entry acquisition feed for a specific book."""
    return _entry_feed(db, token, book_id, _v2_root(token), page_size)


# ---------------------------------------------------------------------------
# Files — the same in both versions, served under either root.
# ---------------------------------------------------------------------------


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
    return serve_user_file(
        book.filepath, book.mime_type or "application/pdf", filename=book.filename
    )


def book_cover(token: str, book_id: str, db: Session = Depends(get_db)) -> FileResponse:
    """A book's cover thumbnail via OPDS token, for the feed's image links."""
    from ..books.core import book_thumbnail_path

    user = _resolve_user(db, token)
    book = _readable_book(db, user, book_id)
    path = book_thumbnail_path(book)
    if not path:
        raise HTTPException(404, "No thumbnail available")
    return serve_user_file(path, "image/webp")


def _readable_book(db, user: User, book_id: str) -> Book:
    """The book, if ``user`` may read it through OPDS; 404 otherwise."""
    book = db.query(Book).filter_by(id=book_id).first()
    if not book or book.is_missing or not access_control.can_access_book(db, user, book):
        # 404, matching the web UI: a restricted book stays indistinguishable
        # from one that does not exist.
        raise HTTPException(404, "Book not found")
    if book.is_explicit and not (user.allow_explicit if user.allow_explicit is not None else True):
        raise HTTPException(404, "Book not found")
    return book


def _base_url() -> str:
    """Return the configured base URL, stripping any trailing slash."""
    from ...config import BASE_URL
    return BASE_URL
