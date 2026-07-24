"""Shared search helpers and category prioritization for the search router."""
from html import escape

from sqlalchemy import String, cast, or_

from ...models import Audio, AudioFolder, GenericMap, MapFolder, Token, TokenFolder


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
    direct = (
        db.query(GenericMap)
        .filter(
            or_(
                GenericMap.filename.ilike(term),
                cast(GenericMap.tags, String).ilike(term),
            )
        )
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

    return [
        {"id": m.id, "filename": m.filename, "relative_path": m.relative_path, "tags": m.tags}
        for m in (direct + extra)[:50]
    ]


def _search_tokens(db, q: str) -> list:
    term = f"%{q}%"
    direct = (
        db.query(Token)
        .filter(
            or_(
                Token.filename.ilike(term),
                cast(Token.tags, String).ilike(term),
            )
        )
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

    return [
        {"id": t.id, "filename": t.filename, "relative_path": t.relative_path, "tags": t.tags}
        for t in (direct + extra)[:50]
    ]


def _search_audio(db, q: str) -> list:
    term = f"%{q}%"
    direct = (
        db.query(Audio)
        .filter(
            or_(
                Audio.filename.ilike(term),
                Audio.title.ilike(term),
                Audio.artist.ilike(term),
                Audio.album.ilike(term),
                cast(Audio.tags, String).ilike(term),
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

    return [
        {
            "id": a.id,
            "filename": a.filename,
            "relative_path": a.relative_path,
            "title": a.title,
            "tags": a.tags,
        }
        for a in (direct + extra)[:50]
    ]
