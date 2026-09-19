"""Homebrew entries: visibility rules, validation, and portable packs.

Homebrew is the same data as pack content — the same content type, the same
validation, the same renderer — owned by the user who wrote it. This module
holds the two things that are genuinely different: **who may see an entry**, and
**how entries move between instances**.

The visibility rule is enforced here and nowhere else, so there is one place to
audit. Every read path calls :func:`visible_filter`; nothing else builds a
homebrew query by hand.
"""
import logging
from typing import Any, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import CampaignMember, HomebrewEntry
from .schema import SchemaError, coerce_value

logger = logging.getLogger("grimoire.characters.homebrew")

__all__ = [
    "HomebrewError",
    "PACK_SCHEMA",
    "visible_filter",
    "can_edit",
    "validate_entry",
    "export_pack",
    "import_pack",
    "unique_entry_id",
    "slugify",
]


class HomebrewError(ValueError):
    """A homebrew entry or pack is not valid."""


PACK_SCHEMA = "grimoire://homebrew-pack/v1"

#: How an import resolves an entry id the user already has.
CONFLICT_MODES = ("skip", "overwrite", "rename")

MAX_IMPORT_ENTRIES = 5000


def _campaign_ids(db: Session, user_id: str) -> list[str]:
    """Campaigns this user belongs to, for `campaign`-visibility entries."""
    rows = (
        db.query(CampaignMember.campaign_id)
        .filter(CampaignMember.user_id == user_id)
        .all()
    )
    return [row[0] for row in rows]


def visible_filter(db: Session, user_id: str) -> Any:
    """A SQLAlchemy condition matching every homebrew entry this user may see.

    The whole visibility model lives in this one expression so there is a single
    thing to audit:

    * anything they own, whatever its visibility;
    * anything marked ``public``;
    * anything marked ``campaign`` whose campaign they are a member of.

    Note the campaign arm checks **membership**, not merely that a campaign id
    is set — otherwise sharing to a campaign would publish to the instance.
    """
    campaigns = _campaign_ids(db, user_id)
    arms = [
        HomebrewEntry.owner_id == user_id,
        HomebrewEntry.visibility == "public",
    ]
    if campaigns:
        arms.append(
            (HomebrewEntry.visibility == "campaign")
            & (HomebrewEntry.campaign_id.in_(campaigns))
        )
    return or_(*arms)


def can_edit(entry: HomebrewEntry, user_id: str) -> bool:
    """Only the owner edits. Sharing grants reading, never writing."""
    return entry.owner_id == user_id


def validate_entry(document: dict, content_type: str, data: Any) -> dict:
    """Validate and coerce a homebrew entry against its content type.

    The same coercion pack content goes through, so a homebrew spell and an SRD
    spell are the same shape — which is what lets one renderer, one catalog and
    one set of formulas treat them identically.
    """
    content_types = (document or {}).get("content_types") or {}
    definition = content_types.get(content_type)
    if definition is None:
        known = ", ".join(sorted(content_types)) or "none"
        raise HomebrewError(
            f"This schema declares no content type {content_type!r} (has: {known})"
        )
    if not isinstance(data, dict):
        raise HomebrewError("Entry data must be an object")

    declared = definition.get("fields") or {}
    cleaned = {
        key: coerce_value(declared[key], value)
        for key, value in data.items()
        if key in declared
    }
    # Fill declared fields the author left out, so an entry always has the shape
    # its content type promises and the catalog can sort and filter on it.
    for key, field in declared.items():
        cleaned.setdefault(key, coerce_value(field, field.get("default")))

    identity = definition.get("identity_field", "name")
    name = cleaned.get(identity)
    if not isinstance(name, str) or not name.strip():
        label = declared.get(identity, {}).get("label", identity)
        raise HomebrewError(f"Entry needs a {label.lower()}")

    return cleaned


def slugify(value: str) -> str:
    """An entry id derived from a name, for an author who supplies none.

    Apostrophes are dropped rather than turned into separators, so "Hunter's
    Bolt" reads as `hunters-bolt` rather than `hunter-s-bolt` — the stray `s`
    looks like a typo in a URL someone may have to type.
    """
    text = str(value).lower().replace("'", "").replace("\u2019", "")
    cleaned = "".join(char if char.isalnum() else "-" for char in text)
    parts = [part for part in cleaned.split("-") if part]
    return "-".join(parts)[:200] or "entry"


def export_pack(entries: list[HomebrewEntry], *, pack_name: str, author: str) -> dict:
    """Bundle homebrew entries into a portable pack.

    Grouped by content type so the file reads the way a hand-written pack does,
    and so importing one into a different instance needs no extra mapping.
    """
    schema_ids = {entry.schema_id for entry in entries}
    if len(schema_ids) > 1:
        raise HomebrewError(
            "A pack holds one system's content; export each schema separately"
        )

    grouped: dict[str, list[dict]] = {}
    for entry in entries:
        grouped.setdefault(entry.content_type, []).append(
            {"_id": entry.entry_id, **(entry.data if isinstance(entry.data, dict) else {})}
        )

    return {
        "$schema": PACK_SCHEMA,
        "pack_name": pack_name,
        "schema_id": next(iter(schema_ids), ""),
        "author": author,
        "version": "1.0.0",
        "entries": grouped,
    }


def import_pack(
    db: Session,
    pack: Any,
    *,
    owner_id: str,
    document: Optional[dict],
    conflict: str = "skip",
) -> dict:
    """Import a homebrew pack for one user.

    ``conflict`` decides what happens to an entry id they already have:

    * ``skip`` — leave theirs alone (the default: an import should not
      silently overwrite work)
    * ``overwrite`` — replace theirs with the incoming entry
    * ``rename`` — keep both, giving the incoming one a suffixed id

    Returns a per-entry tally rather than raising on the first conflict, so a
    partly-overlapping pack still imports what it can.
    """
    if conflict not in CONFLICT_MODES:
        raise HomebrewError(f"Unknown conflict mode {conflict!r}")
    if not isinstance(pack, dict):
        raise HomebrewError("A pack must be an object")

    schema_id = pack.get("schema_id")
    if not isinstance(schema_id, str) or not schema_id.strip():
        raise HomebrewError("Pack needs a 'schema_id' naming the system it is for")

    grouped = pack.get("entries")
    if not isinstance(grouped, dict):
        raise HomebrewError("Pack needs an 'entries' object keyed by content type")

    total = sum(len(items) for items in grouped.values() if isinstance(items, list))
    if total > MAX_IMPORT_ENTRIES:
        raise HomebrewError(f"A pack may hold at most {MAX_IMPORT_ENTRIES} entries")

    imported, skipped, renamed, overwritten, failed = 0, 0, 0, 0, []

    for content_type, items in grouped.items():
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            raw_id = str(item.get("_id") or "").strip()
            data = {key: value for key, value in item.items() if key != "_id"}

            try:
                cleaned = (
                    validate_entry(document, content_type, data) if document else dict(data)
                )
            except (HomebrewError, SchemaError) as exc:
                failed.append({"entry_id": raw_id, "reason": str(exc)})
                continue

            identity = _identity_of(document, content_type)
            entry_id = raw_id or slugify(cleaned.get(identity, ""))

            existing = (
                db.query(HomebrewEntry)
                .filter_by(
                    owner_id=owner_id,
                    schema_id=schema_id,
                    content_type=content_type,
                    entry_id=entry_id,
                )
                .first()
            )

            if existing:
                if conflict == "skip":
                    skipped += 1
                    continue
                if conflict == "overwrite":
                    existing.data = cleaned
                    existing.name = str(cleaned.get(identity) or entry_id)[:500]
                    overwritten += 1
                    continue
                entry_id = unique_entry_id(db, owner_id, schema_id, content_type, entry_id)
                renamed += 1

            db.add(
                HomebrewEntry(
                    owner_id=owner_id,
                    schema_id=schema_id,
                    content_type=content_type,
                    entry_id=entry_id,
                    name=str(cleaned.get(identity) or entry_id)[:500],
                    data=cleaned,
                    visibility="private",
                )
            )
            imported += 1

    return {
        "imported": imported,
        "skipped": skipped,
        "renamed": renamed,
        "overwritten": overwritten,
        "failed": failed,
    }


def _identity_of(document: Optional[dict], content_type: str) -> str:
    definition = ((document or {}).get("content_types") or {}).get(content_type) or {}
    return definition.get("identity_field", "name")


def unique_entry_id(
    db: Session, owner_id: str, schema_id: str, content_type: str, entry_id: str
) -> str:
    """``entry_id`` if this user does not already have it, else a free variant.

    Used by the rename conflict mode and by forking, which is the same problem:
    keep both copies rather than refusing or overwriting.
    """
    if not _entry_exists(db, owner_id, schema_id, content_type, entry_id):
        return entry_id
    for suffix in range(2, 1000):
        candidate = f"{entry_id}-{suffix}"[:200]
        if not _entry_exists(db, owner_id, schema_id, content_type, candidate):
            return candidate
    raise HomebrewError(f"Could not find a free id near {entry_id!r}")


def _entry_exists(
    db: Session, owner_id: str, schema_id: str, content_type: str, entry_id: str
) -> bool:
    return bool(
        db.query(HomebrewEntry.id)
        .filter_by(
            owner_id=owner_id,
            schema_id=schema_id,
            content_type=content_type,
            entry_id=entry_id,
        )
        .first()
    )
