"""The tag catalog: normalising, validating, and getting-or-creating ``Tag`` rows.

Split out of the former single-module ``tag_service`` (issue #235). Everything
that decides *what a tag is* lives here; the resource- and folder-level code
builds on top of it.
"""
from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...models import SHARED_CATEGORY, Tag


def normalize_internal(raw: str) -> str:
    """The match key for a tag: stripped and lowercased."""
    return str(raw).strip().lower()


def default_display(raw: str) -> str:
    """The display value to store for a brand-new tag: the entered text, trimmed.

    We keep the user's own casing rather than force Title Case, so "GM Screen"
    stays "GM Screen". Purely programmatic callers may pass already-cased text.
    """
    return str(raw).strip()


#: Characters a tag may not contain. A tag's internal key addresses it in the
#: API path (``/api/tags/{internal}``), and a slash there reads as a path
#: separator: the browser sends %2F but the ASGI server decodes it before
#: routing, so the tag lands on no route at all. Grimoire has no notion of
#: subtags, so "Storage/Box1" is a flat tag whose name merely looks nested —
#: and it used to be one you could create but never edit or delete (issue
#: #430). Rejecting it on the way in is clearer than accepting a tag the UI
#: cannot then manage. Backslash goes too: it is the same mistake on Windows,
#: and proxies routinely rewrite it to a forward slash.
TAG_FORBIDDEN_CHARS = "/\\"


def validate_tag_value(raw: str) -> Optional[str]:
    """The reason ``raw`` is not a usable tag, or ``None`` if it is fine.

    Returns a message rather than raising so schema validators and route
    handlers can each surface it in their own way. Blank values are *not* an
    error here — callers drop them silently, as they always have.
    """
    if any(c in str(raw) for c in TAG_FORBIDDEN_CHARS):
        return (
            "Tags cannot contain '/' or '\\'. Grimoire has no subtags, so use a "
            "separate tag (or a different separator) instead."
        )
    return None


def dedupe_tags(tags: Iterable[str], *, validate: bool = False) -> list[str]:
    """Strip and de-duplicate tags by lowercased key, keeping first-seen casing.

    Used by the tag-accepting request schemas: the display casing is preserved
    here (the service lowercases only the internal match key), so callers must
    NOT lowercase up front.

    With ``validate=True`` a tag carrying a forbidden character raises
    ``ValueError``, which Pydantic surfaces as a 422 on the field that carried
    it. That belongs on **request input** only. It is off by default because the
    other callers fold *stored* tags back in (the bulk "add tags" path, the
    duplicate-merge field copier), and a tag already in the database may predate
    the rule — validating there would turn one legacy tag into a 500 on an
    unrelated operation. Tags from a ``tags.json`` bypass this function entirely:
    that file is the user's own and Grimoire treats it as read-only, so a slash
    there is still applied rather than failing their scan.
    """
    seen: set[str] = set()
    result: list[str] = []
    for t in tags or []:
        stripped = str(t).strip()
        if validate:
            problem = validate_tag_value(stripped)
            if problem:
                raise ValueError(problem)
        key = stripped.lower()
        if key and key not in seen:
            seen.add(key)
            result.append(stripped)
    return result


def _promote_category(tag: Tag, category: str) -> None:
    """Move a tag to ``shared`` if it's used in a category other than its current
    one. A tag stays single-category until it spans a second type (issue #235)."""
    if category == SHARED_CATEGORY or tag.category == SHARED_CATEGORY:
        return
    if tag.category != category:
        tag.category = SHARED_CATEGORY


def tag_dict(tag: Tag) -> dict:
    """Serialise a tag to the API shape used everywhere: {internal, display, category}."""
    return {"internal": tag.internal, "display": tag.display, "category": tag.category}


def get_or_create_tag(
    db: Session,
    raw: str,
    *,
    display: Optional[str] = None,
    category: str = SHARED_CATEGORY,
) -> Optional[Tag]:
    """Return the existing tag for ``raw``'s internal key, creating it if absent.

    Returns ``None`` for blank input. When creating, the display value is
    ``display`` if given, else the entered casing, and ``category`` is the
    resource type it's first used in (defaults to ``shared`` for programmatic
    callers). Matching an existing tag never rewrites its display value; its
    category is promoted to ``shared`` when it's now used in a different category
    (see :func:`_promote_category`).

    ``Tag.internal`` is unique, so the read-then-insert below is a race: two
    concurrent requests applying the same new tag both see "absent" and both
    insert. The insert runs in a SAVEPOINT and the loser re-reads the winner's
    row, rather than letting an ``IntegrityError`` poison the caller's whole
    transaction (issue #270).
    """
    internal = normalize_internal(raw)
    if not internal:
        return None
    tag = db.query(Tag).filter(Tag.internal == internal).first()
    if tag is None:
        new_tag = Tag(
            internal=internal,
            display=(display or default_display(raw)) or internal,
            category=category,
        )
        try:
            with db.begin_nested():  # SAVEPOINT: rolled back on conflict
                db.add(new_tag)
                db.flush()  # assign id without committing; caller owns the transaction
            return new_tag
        except IntegrityError:
            # Someone else created it between our read and our insert; adopt
            # theirs. The savepoint rollback leaves the outer transaction usable.
            tag = db.query(Tag).filter(Tag.internal == internal).first()
            if tag is None:  # pragma: no cover - the constraint implies a winner
                raise
    _promote_category(tag, category)
    return tag
