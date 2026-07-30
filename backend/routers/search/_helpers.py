"""Shared search helpers and category prioritization for the search router."""
from html import escape

from sqlalchemy import String, cast, or_

from ...models import (
    Audio,
    AudioFolder,
    GenericMap,
    MapFolder,
    ResourceTag,
    Tag,
    Token,
    TokenFolder,
)
from ...services import tag_service


def _ids_matching_tag(db, resource_type: str, term: str) -> set:
    """Ids of resources of ``resource_type`` whose shared tag matches ``term``.

    Matches the tag's display OR internal value against the ILIKE ``term``
    (``%q%``), so tag search works off the join table rather than the legacy JSON
    column.
    """
    rows = (
        db.query(ResourceTag.resource_id)
        .join(Tag, Tag.id == ResourceTag.tag_id)
        .filter(
            ResourceTag.resource_type == resource_type,
            or_(Tag.display.ilike(term), Tag.internal.ilike(term)),
        )
        .all()
    )
    return {r[0] for r in rows}


# FTS5 snippet() wraps matches in these sentinels rather than literal <mark>
# tags. The snippet's surrounding text comes from a PDF's text layer and is
# untrusted; it is HTML-escaped below before the sentinels are swapped for real
# <mark> tags, so injected markup (e.g. "<script>" in a scanned page) is rendered
# inert while our own highlight markup survives.
#
# The sentinels are private-use-area codepoints (U+E000..): they survive a SQL
# string literal (unlike NUL, which SQLite's driver rejects) and html.escape()
# untouched, and don't occur in real document text. Even if a document did embed
# one, the worst case is a stray (already-escaped) highlight — never markup
# injection, since escaping runs first.
_SNIPPET_OPEN = "\ue000"
_SNIPPET_CLOSE = "\ue001"

# The snippet() column call callers embed in their FTS query. Column index 2 is
# ``content``; ``40`` is the token budget; ``...`` is the ellipsis for truncation.
SNIPPET_SQL = f"snippet(book_search, 2, '{_SNIPPET_OPEN}', '{_SNIPPET_CLOSE}', '...', 40)"


def escape_snippet(raw: str) -> str:
    """Make an FTS5 snippet() result safe for dangerouslySetInnerHTML.

    HTML-escapes the whole snippet (the surrounding text is untrusted document
    content), then replaces the escaped highlight sentinels with real
    ``<mark>``/``</mark>`` tags. Returns "" for a None/empty snippet.
    """
    if not raw:
        return ""
    return (
        escape(raw)
        .replace(escape(_SNIPPET_OPEN), "<mark>")
        .replace(escape(_SNIPPET_CLOSE), "</mark>")
    )


# Lower number = shown first in results
_CATEGORY_PRIORITY = {
    "core": 0,
    "supplement": 1,
    "adventure": 2,
    "character-sheet": 3,
    "map": 4,
    "handout": 5,
    "homebrew": 6,
}


def _search_maps(db, q: str) -> list:
    term = f"%{q}%"
    # Filename matches, plus items whose shared tag matches the term.
    tag_ids = _ids_matching_tag(db, "map", term)
    direct = (
        db.query(GenericMap)
        .filter(or_(GenericMap.filename.ilike(term), GenericMap.id.in_(tag_ids)))
        .limit(50)
        .all()
    )
    seen = {m.id for m in direct}

    matching_folders = (
        db.query(MapFolder)
        .filter(
            or_(
                MapFolder.path.ilike(term),
                cast(MapFolder.tags, String).ilike(term),
            )
        )
        .all()
    )
    extra = []
    for folder in matching_folders:
        # Folder paths are stored relative to the collection dir (e.g. "Swamps"),
        # while relative_path keeps the collection prefix ("maps/Swamps/...").
        for m in (
            db.query(GenericMap).filter(GenericMap.relative_path.ilike(f"%/{folder.path}/%")).all()
        ):
            if m.id not in seen:
                seen.add(m.id)
                extra.append(m)

    results = (direct + extra)[:50]
    tags = tag_service.display_tags_for_resources(db, "map", [m.id for m in results])
    return [
        {
            "id": m.id,
            "filename": m.filename,
            "relative_path": m.relative_path,
            "tags": tags.get(m.id, []),
        }
        for m in results
    ]


def _search_tokens(db, q: str) -> list:
    term = f"%{q}%"
    tag_ids = _ids_matching_tag(db, "token", term)
    direct = (
        db.query(Token)
        .filter(or_(Token.filename.ilike(term), Token.id.in_(tag_ids)))
        .limit(50)
        .all()
    )
    seen = {t.id for t in direct}

    matching_folders = (
        db.query(TokenFolder)
        .filter(
            or_(
                TokenFolder.path.ilike(term),
                cast(TokenFolder.tags, String).ilike(term),
            )
        )
        .all()
    )
    extra = []
    for folder in matching_folders:
        for t in db.query(Token).filter(Token.relative_path.ilike(f"%/{folder.path}/%")).all():
            if t.id not in seen:
                seen.add(t.id)
                extra.append(t)

    results = (direct + extra)[:50]
    tags = tag_service.display_tags_for_resources(db, "token", [t.id for t in results])
    return [
        {
            "id": t.id,
            "filename": t.filename,
            "relative_path": t.relative_path,
            "tags": tags.get(t.id, []),
        }
        for t in results
    ]


def _search_audio(db, q: str) -> list:
    term = f"%{q}%"
    tag_ids = _ids_matching_tag(db, "audio", term)
    direct = (
        db.query(Audio)
        .filter(
            or_(
                Audio.filename.ilike(term),
                Audio.title.ilike(term),
                Audio.artist.ilike(term),
                Audio.album.ilike(term),
                Audio.id.in_(tag_ids),
            )
        )
        .limit(50)
        .all()
    )
    seen = {a.id for a in direct}

    matching_folders = (
        db.query(AudioFolder)
        .filter(
            or_(
                AudioFolder.path.ilike(term),
                cast(AudioFolder.tags, String).ilike(term),
            )
        )
        .all()
    )
    extra = []
    for folder in matching_folders:
        for a in db.query(Audio).filter(Audio.relative_path.ilike(f"%/{folder.path}/%")).all():
            if a.id not in seen:
                seen.add(a.id)
                extra.append(a)

    results = (direct + extra)[:50]
    tags = tag_service.display_tags_for_resources(db, "audio", [a.id for a in results])
    return [
        {
            "id": a.id,
            "filename": a.filename,
            "relative_path": a.relative_path,
            "title": a.title,
            "tags": tags.get(a.id, []),
        }
        for a in results
    ]
