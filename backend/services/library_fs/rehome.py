"""Moving everything that points at one library record onto another.

The counterpart to :func:`references.purge_references` for a merge (issue #589).
Deleting a duplicate used to purge what pointed at it, so the safe choice was
"keep whichever copy has more bookmarks" rather than "keep the better file".
Re-homing them first makes the choice of keeper a question about the file alone.

The list is wider than the purge's, because a merge has to keep what a delete
could afford to strand:

* bookmarks, favorites, tag links, and campaign resources (with their shares) -
  the same set :func:`purge_references` knows;
* share links, book-scoped access grants, soundboard and playlist entries, and a
  system's fallback cover book, which a delete leaves dangling as harmless
  orphans but a merge would otherwise silently break;
* ``[[book:ID]]``-style embeds in campaign notes, which are the GM's handout
  links and carry the id in their text.

Each move deduplicates against what the target already has, so the merged copy
never leaves the kept one with two favorites from the same user or two links to
the same campaign. Nothing here commits: the merge owns the transaction, and a
dry run rolls the whole thing back.
"""
import re
from typing import Any, Callable

from sqlalchemy import String, cast
from sqlalchemy.orm import Session

from ...models import Audio, Book, CampaignResource, Favorite, GameSystem, ResourceTag
from ...models.access import UserAccessGrant, rank
from ...models.audio_sets import AudioSet
from ...models.campaigns import (
    Campaign,
    CampaignResourceShare,
    GMSessionNote,
    PlayerSessionNote,
    WikiPage,
    WikiTemplate,
)
from ...models.share_links import ShareLink
from ...models.users import Bookmark
from .references import item_type_for

# Every text column that is rendered through WikiMarkdown and so can hold an
# `[[type:ID]]` embed. A column missing here keeps pointing at a deleted record
# after a merge - the embed renders as "not found" in the middle of a handout.
_EMBED_COLUMNS: tuple[tuple[Any, str], ...] = (
    (Campaign, "description"),
    (WikiPage, "body"),
    (WikiTemplate, "body"),
    (GMSessionNote, "internal_content"),
    (GMSessionNote, "external_content"),
    (PlayerSessionNote, "content"),
)

# The reference kinds a merge reports on, in the order the UI lists them.
REFERENCE_KINDS: tuple[str, ...] = (
    "bookmarks",
    "favorites",
    "tags",
    "campaigns",
    "share_links",
    "access_grants",
    "audio_sets",
    "system_covers",
    "notes",
)


def _tally(moved: int = 0, deduplicated: int = 0) -> dict[str, int]:
    return {"moved": moved, "deduplicated": deduplicated}


def _move_rows(
    rows: list[Any], taken: set[Any], key: Callable[[Any], Any], retarget: Callable[[Any], None],
    db: Session,
) -> dict[str, int]:
    """Retarget each row, or delete it when the target already has its twin.

    ``taken`` holds the keys the target already carries and grows as rows move,
    so two merged copies favorited by the same user leave exactly one favorite.
    """
    out = _tally()
    for row in rows:
        k = key(row)
        if k in taken:
            db.delete(row)
            out["deduplicated"] += 1
            continue
        retarget(row)
        taken.add(k)
        out["moved"] += 1
    return out


def _bookmarks(db: Session, from_id: str, to_id: str) -> dict[str, int]:
    # No uniqueness constraint here - a reader may bookmark a page twice with
    # different notes - so only a row identical in every user-visible field is
    # treated as the same bookmark.
    def key(b: Bookmark) -> tuple:
        return (b.user_id, b.page_number, b.label or "", b.notes or "", b.selected_text or "")

    taken = {key(b) for b in db.query(Bookmark).filter_by(book_id=to_id).all()}
    rows = db.query(Bookmark).filter_by(book_id=from_id).all()
    return _move_rows(rows, taken, key, lambda b: setattr(b, "book_id", to_id), db)


def _favorites(db: Session, item_type: str, from_id: str, to_id: str) -> dict[str, int]:
    taken = {
        f.user_id for f in db.query(Favorite).filter_by(item_type=item_type, item_id=to_id).all()
    }
    rows = db.query(Favorite).filter_by(item_type=item_type, item_id=from_id).all()
    return _move_rows(
        rows, taken, lambda f: f.user_id, lambda f: setattr(f, "item_id", to_id), db
    )


def _tags(db: Session, item_type: str, from_id: str, to_id: str) -> dict[str, int]:
    taken = {
        t.tag_id
        for t in db.query(ResourceTag).filter_by(resource_type=item_type, resource_id=to_id).all()
    }
    rows = db.query(ResourceTag).filter_by(resource_type=item_type, resource_id=from_id).all()
    return _move_rows(
        rows, taken, lambda t: t.tag_id, lambda t: setattr(t, "resource_id", to_id), db
    )


def _campaigns(db: Session, item_type: str, from_id: str, to_id: str) -> dict[str, int]:
    """Campaign links, keeping every player a private link was shared with.

    Where the campaign already links the kept copy, that row wins - its
    visibility, category and position are what the GM sees today - and the
    dropped row's shares are added to it, so no player loses a handout.
    """
    existing = {
        r.campaign_id: r
        for r in db.query(CampaignResource)
        .filter_by(resource_type=item_type, resource_id=to_id)
        .all()
    }
    out = _tally()
    for row in (
        db.query(CampaignResource).filter_by(resource_type=item_type, resource_id=from_id).all()
    ):
        keeper = existing.get(row.campaign_id)
        if keeper is None:
            row.resource_id = to_id
            existing[row.campaign_id] = row
            out["moved"] += 1
            continue
        shared = {s.user_id for s in keeper.shares}
        for share in row.shares:
            if share.user_id not in shared:
                keeper.shares.append(CampaignResourceShare(user_id=share.user_id))
                shared.add(share.user_id)
        # The relationship cascade takes the dropped row's own shares with it.
        db.delete(row)
        out["deduplicated"] += 1
    return out


def _share_links(db: Session, item_type: str, from_id: str, to_id: str) -> dict[str, int]:
    # Never deduplicated: each link is its own URL that someone may hold, and
    # two links to the same item are two working URLs, not a conflict.
    rows = db.query(ShareLink).filter_by(resource_type=item_type, resource_id=from_id).all()
    for link in rows:
        link.resource_id = to_id
    return _tally(moved=len(rows))


def _access_grants(db: Session, from_id: str, to_id: str) -> dict[str, int]:
    """Per-book access grants. A user granted on both keeps the wider grant."""
    existing = {
        g.user_id: g
        for g in db.query(UserAccessGrant).filter_by(scope_type="book", scope_id=to_id).all()
    }
    out = _tally()
    for grant in db.query(UserAccessGrant).filter_by(scope_type="book", scope_id=from_id).all():
        keeper = existing.get(grant.user_id)
        if keeper is None:
            grant.scope_id = to_id
            existing[grant.user_id] = grant
            out["moved"] += 1
            continue
        # A grant's level is the ceiling it raises the user to, so the more
        # restrictive level is the one that reaches *more* content.
        if rank(grant.level) > rank(keeper.level):
            keeper.level = grant.level
        db.delete(grant)
        out["deduplicated"] += 1
    return out


def _audio_sets(db: Session, from_id: str, to_id: str) -> dict[str, int]:
    """Soundboard and playlist entries, which store audio ids inside JSON."""
    out = _tally()
    # Prefiltered on the JSON text so a library with many saved sets only
    # loads the ones that can possibly mention this track.
    for audio_set in db.query(AudioSet).filter(cast(AudioSet.entries, String).like(f"%{from_id}%")).all():
        entries = list(audio_set.entries or [])
        present = any(isinstance(e, dict) and e.get("audio_id") == to_id for e in entries)
        rewritten: list[Any] = []
        changed = False
        for entry in entries:
            if not (isinstance(entry, dict) and entry.get("audio_id") == from_id):
                rewritten.append(entry)
                continue
            changed = True
            if present:
                out["deduplicated"] += 1
                continue
            rewritten.append({**entry, "audio_id": to_id})
            present = True
            out["moved"] += 1
        if changed:
            # A new list, not an in-place edit: JSON columns only notice
            # reassignment.
            audio_set.entries = rewritten
    return out


def _system_covers(db: Session, from_id: str, to_id: str) -> dict[str, int]:
    rows = db.query(GameSystem).filter_by(cover_book_id=from_id).all()
    for system in rows:
        system.cover_book_id = to_id
    return _tally(moved=len(rows))


def _embed_pattern(item_type: str, record_id: str) -> re.Pattern[str]:
    # The prefix is matched case-insensitively, as `is_embed` does; the id must
    # end at a boundary the embed syntax allows (`]`, `:PAGE`, or `|label`) so
    # one id that prefixes another is never rewritten by mistake.
    return re.compile(
        rf"(\[\[\s*{re.escape(item_type)}:\s*){re.escape(record_id)}(?=\s*[\]:|])",
        re.IGNORECASE,
    )


def _notes(db: Session, item_type: str, from_id: str, to_id: str) -> dict[str, int]:
    """Rewrite ``[[type:ID]]`` embeds in campaign text. Counts documents changed."""
    pattern = _embed_pattern(item_type, from_id)
    out = _tally()
    for model, column in _EMBED_COLUMNS:
        attr = getattr(model, column)
        for row in db.query(model).filter(attr.like(f"%{from_id}%")).all():
            text = getattr(row, column) or ""
            new_text, hits = pattern.subn(lambda m: f"{m.group(1)}{to_id}", text)
            if hits:
                setattr(row, column, new_text)
                out["moved"] += 1
    return out


def rehome_references(db: Session, model: Any, from_id: str, to_id: str) -> dict[str, dict[str, int]]:
    """Move every reference from ``from_id`` onto ``to_id``, deduplicating.

    Returns ``{kind: {"moved": n, "deduplicated": m}}`` for every kind in
    :data:`REFERENCE_KINDS`, zero where the kind does not apply to ``model``,
    so a caller can sum results across records without key checks.
    """
    report = {kind: _tally() for kind in REFERENCE_KINDS}
    item_type = item_type_for(model)
    if not item_type or from_id == to_id:
        return report

    if model is Book:
        report["bookmarks"] = _bookmarks(db, from_id, to_id)
        report["access_grants"] = _access_grants(db, from_id, to_id)
        report["system_covers"] = _system_covers(db, from_id, to_id)
    if model is Audio:
        report["audio_sets"] = _audio_sets(db, from_id, to_id)
    report["favorites"] = _favorites(db, item_type, from_id, to_id)
    report["tags"] = _tags(db, item_type, from_id, to_id)
    report["campaigns"] = _campaigns(db, item_type, from_id, to_id)
    report["share_links"] = _share_links(db, item_type, from_id, to_id)
    report["notes"] = _notes(db, item_type, from_id, to_id)
    # Flushed so a following rehome for another merged copy sees these rows on
    # the target and deduplicates against them.
    db.flush()
    return report
