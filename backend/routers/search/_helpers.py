"""Shared search helpers and category prioritization for the search router."""
from html import escape
from typing import Optional

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
from ...services import tag_service, variants
from ._query import MEDIA_FIELDS, ParsedQuery


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
# Variants (printer-friendly cuts, older versions, gridless maps) collapse into
# their parent entry everywhere else, so search hides them too — one book, one
# result. Applied in SQL rather than in the Python enrichment loop below because
# the FTS LIMIT runs first: filtering afterwards would silently shrink a full
# page of results (issues #304, #306).
VISIBLE_BOOKS_SQL = "book_id IN (SELECT id FROM books WHERE variant_parent_id IS NULL)"


def access_clause(excluded_book_ids) -> tuple[str, dict]:
    """Build the ``AND book_id NOT IN (...)`` fragment hiding restricted books.

    Returns ``(sql, params)``. The ids are emitted as **bound parameters**, one
    per id, never interpolated: these strings come from the database rather than
    the request, but this fragment is spliced into an f-string alongside
    user-supplied search text, and a query builder that interpolates *some* of
    its values is one refactor away from interpolating the wrong one.

    An empty list yields an empty fragment rather than ``NOT IN ()``, which is a
    syntax error in SQLite — and is also the overwhelmingly common case, since
    an unrestricted library excludes nothing and an admin excludes nothing.
    """
    ids = list(excluded_book_ids)
    if not ids:
        return "", {}
    names = [f"excl_{i}" for i in range(len(ids))]
    placeholders = ", ".join(f":{n}" for n in names)
    return (
        f"AND book_id NOT IN ({placeholders})",
        dict(zip(names, ids)),
    )


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


def _media_filter_terms(parsed: ParsedQuery, field_name: str) -> list[str]:
    """Values a media row should match for ``field_name``, honouring aliases.

    ``title:`` and ``filename:`` both land on a media row's filename — a map has
    no title of its own, and "the map called Swamp" is what a user means by
    either word.
    """
    if field_name == "filename":
        return parsed.values("title") + parsed.values("filename")
    return parsed.values(field_name)


# Columns beyond ``filename`` that a ``title:``/``filename:`` term should also
# match on a given collection. Audio carries an embedded track title, which is
# the name a user actually sees in the player, so a title search has to reach it.
_TITLE_ALIAS_COLUMNS = {"audio": "title"}


def _media_terms(parsed: ParsedQuery) -> Optional[dict]:
    """Resolve a parsed query into the terms a media search should apply.

    Returns ``None`` when this query cannot match media at all — a book-only
    filter is in play, or a recognised filter names no media field. That is
    distinct from an empty result: the caller skips the section entirely rather
    than running a query that would return everything.
    """
    if parsed.books_only:
        return None
    if parsed.has_filters:
        used = parsed.metadata_fields
        if not (used & MEDIA_FIELDS):
            return None
        return {
            "filename": _media_filter_terms(parsed, "filename"),
            "tag": parsed.values("tag"),
            "artist": parsed.values("artist"),
            "album": parsed.values("album"),
            # Leftover free text alongside a filter narrows the filename further.
            "free": [parsed.free_text] if parsed.free_text else [],
        }
    if not parsed.free_text:
        return None
    return {"free_any": [parsed.free_text]}


def _tag_ids_for_terms(db, resource_type: str, terms: list[str]) -> set:
    """Union of :func:`_ids_matching_tag` over several terms."""
    ids: set = set()
    for term in terms:
        ids |= _ids_matching_tag(db, resource_type, f"%{term}%")
    return ids


def _media_clauses(db, model, resource_type: str, terms: dict, extra_fields: dict) -> list:
    """Build the AND-ed SQLAlchemy clauses for one media collection.

    ``extra_fields`` maps a field name (``artist``, ``album``) to its column, so
    audio can be filtered on metadata that maps and tokens do not have.
    """
    clauses = []

    # Unprefixed query: filename OR tag OR any of the collection's own metadata.
    for term in terms.get("free_any", []):
        like = f"%{term}%"
        any_of = [model.filename.ilike(like), model.id.in_(_ids_matching_tag(db, resource_type, like))]
        for column in extra_fields.values():
            any_of.append(column.ilike(like))
        clauses.append(or_(*any_of))

    alias_column = extra_fields.get(_TITLE_ALIAS_COLUMNS.get(resource_type, ""))
    for term in terms.get("filename", []) + terms.get("free", []):
        like = f"%{term}%"
        name_match = model.filename.ilike(like)
        clauses.append(or_(name_match, alias_column.ilike(like)) if alias_column is not None else name_match)

    if tag_terms := terms.get("tag"):
        clauses.append(model.id.in_(_tag_ids_for_terms(db, resource_type, tag_terms)))

    for name, column in extra_fields.items():
        if name == _TITLE_ALIAS_COLUMNS.get(resource_type):
            continue  # already applied above, via the filename terms
        for term in terms.get(name, []):
            clauses.append(column.ilike(f"%{term}%"))

    return clauses


def _folder_matches(db, model, folder_model, terms: dict, seen: set) -> list:
    """Rows living under a folder whose path or tags match the query.

    Only applies to the filename-ish terms: a folder has no artist, and matching
    ``artist:`` against a folder path would be a coincidence, not a result.
    """
    words = terms.get("free_any", []) + terms.get("filename", []) + terms.get("free", [])
    words += terms.get("tag", [])
    if not words:
        return []
    extra = []
    for word in words:
        like = f"%{word}%"
        folders = (
            db.query(folder_model)
            .filter(
                or_(
                    folder_model.path.ilike(like),
                    cast(folder_model.tags, String).ilike(like),
                )
            )
            .all()
        )
        for folder in folders:
            # Folder paths are stored relative to the collection dir (e.g. "Swamps"),
            # while relative_path keeps the collection prefix ("maps/Swamps/...").
            for row in (
                db.query(model)
                .filter(
                    model.relative_path.ilike(f"%/{folder.path}/%"),
                    variants.parent_filter(model),
                )
                .all()
            ):
                if row.id not in seen:
                    seen.add(row.id)
                    extra.append(row)
    return extra


def _search_media(
    db,
    parsed: ParsedQuery,
    model,
    folder_model,
    resource_type: str,
    *,
    extra_fields: Optional[dict] = None,
    serialize=None,
) -> list:
    """Shared body of the map/token/audio searches.

    The three differed only in their model, their folder table, and (for audio)
    a few extra metadata columns; with field filters to thread through all
    three, keeping them as one function is what keeps the filter semantics
    identical across collections.
    """
    terms = _media_terms(parsed)
    if terms is None:
        return []
    extra_fields = extra_fields or {}

    clauses = _media_clauses(db, model, resource_type, terms, extra_fields)
    if not clauses:
        return []

    direct = (
        db.query(model)
        .filter(*clauses, variants.parent_filter(model))
        .limit(50)
        .all()
    )
    seen = {row.id for row in direct}
    extra = _folder_matches(db, model, folder_model, terms, seen)

    results = (direct + extra)[:50]
    tags = tag_service.display_tags_for_resources(db, resource_type, [r.id for r in results])
    return [serialize(row, tags.get(row.id, [])) for row in results]


def _search_maps(db, parsed: ParsedQuery) -> list:
    return _search_media(
        db,
        parsed,
        GenericMap,
        MapFolder,
        "map",
        serialize=lambda m, tags: {
            "id": m.id,
            "filename": m.filename,
            "relative_path": m.relative_path,
            "has_thumbnail": bool(m.has_thumbnail),
            "tags": tags,
        },
    )


def _search_tokens(db, parsed: ParsedQuery) -> list:
    return _search_media(
        db,
        parsed,
        Token,
        TokenFolder,
        "token",
        serialize=lambda t, tags: {
            "id": t.id,
            "filename": t.filename,
            "relative_path": t.relative_path,
            "has_thumbnail": bool(t.has_thumbnail),
            "tags": tags,
        },
    )


def _search_audio(db, parsed: ParsedQuery) -> list:
    return _search_media(
        db,
        parsed,
        Audio,
        AudioFolder,
        "audio",
        extra_fields={
            "title": Audio.title,
            "artist": Audio.artist,
            "album": Audio.album,
        },
        serialize=lambda a, tags: {
            "id": a.id,
            "filename": a.filename,
            "relative_path": a.relative_path,
            "title": a.title,
            # Either embedded/folder artwork or a UI-set cover gives the row a
            # thumbnail; the artwork endpoint serves whichever is present.
            "has_thumbnail": bool(a.has_artwork or a.cover_image),
            "tags": tags,
        },
    )
