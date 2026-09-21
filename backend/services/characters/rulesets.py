"""Rulesets: who may read and edit one, and how content moves between them.

A ruleset is a named set of catalog entries — an SRD, a supplement, a table's
house rules. It holds the same data a filesystem content pack does, validated
against the same content types and rendered by the same components.

What is different is **where it lives**:

* a **campaign ruleset** belongs to one table. Everyone in the campaign reads
  it; the GM who owns the campaign edits it. That is what lets two games in the
  same system allow different content.
* a **server ruleset** has no campaign and is available in every game, which is
  what core rules want to be. Only an admin creates one.

The access rules live here and nowhere else, so there is one place to audit.
"""
import logging
from typing import Any, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import Campaign, CampaignMember, Ruleset, RulesetEntry
from .schema import SchemaError, coerce_value

logger = logging.getLogger("grimoire.characters.rulesets")

__all__ = [
    "RulesetError",
    "PACK_SCHEMA",
    "readable_filter",
    "can_edit",
    "assert_can_create",
    "validate_entry",
    "export_ruleset",
    "import_entries",
    "unique_entry_id",
    "slugify",
]


class RulesetError(ValueError):
    """A ruleset or its content is not valid."""


PACK_SCHEMA = "grimoire://ruleset/v1"

#: How an import resolves an entry id a ruleset already has.
CONFLICT_MODES = ("skip", "overwrite", "rename")

MAX_IMPORT_ENTRIES = 20000


def _campaign_ids(db: Session, user_id: str) -> list[str]:
    rows = (
        db.query(CampaignMember.campaign_id)
        .filter(CampaignMember.user_id == user_id)
        .all()
    )
    return [row[0] for row in rows]


def readable_filter(db: Session, user_id: str) -> Any:
    """Every ruleset this user may read.

    Server rulesets (no campaign) reach everyone — that is what makes them the
    right home for core rules. A campaign ruleset reaches the people at that
    table, checked by **membership** rather than by the campaign id merely
    being set, so scoping content to a game does not publish it to the server.
    """
    campaigns = _campaign_ids(db, user_id)
    arms = [Ruleset.campaign_id.is_(None)]
    if campaigns:
        arms.append(Ruleset.campaign_id.in_(campaigns))
    return or_(*arms)


def can_edit(db: Session, ruleset: Ruleset, user_id: str, *, is_admin: bool) -> bool:
    """Whether this user may change a ruleset.

    A server ruleset is the admin's; a campaign's belongs to whoever runs the
    campaign. Being *in* a game lets you read its content, never rewrite it —
    otherwise any player could edit the table's rules.
    """
    if ruleset.campaign_id is None:
        return is_admin
    if is_admin:
        return True
    campaign = db.query(Campaign).filter_by(id=ruleset.campaign_id).first()
    return bool(campaign and campaign.owner_id == user_id)


def assert_can_create(
    db: Session, user_id: str, campaign_id: Optional[str], *, is_admin: bool
) -> None:
    """Check this user may add a ruleset where they are asking to.

    Raises RulesetError with a message naming the reason, which the router
    turns into a 403.
    """
    if campaign_id is None:
        if not is_admin:
            raise RulesetError(
                "Only an administrator can add a ruleset for the whole server"
            )
        return

    campaign = db.query(Campaign).filter_by(id=campaign_id).first()
    if not campaign:
        raise RulesetError("That campaign does not exist")
    if is_admin or campaign.owner_id == user_id:
        return
    raise RulesetError("Only the campaign's owner can add a ruleset to it")


def validate_entry(document: Optional[dict], content_type: str, data: Any) -> dict:
    """Validate and coerce one entry against its content type.

    The same coercion pack content goes through, so a ruleset entry and an SRD
    entry are the same shape — which is what lets one renderer, one catalog and
    one set of formulas treat them identically.
    """
    content_types = (document or {}).get("content_types") or {}
    definition = content_types.get(content_type)
    if definition is None:
        known = ", ".join(sorted(content_types)) or "none"
        raise RulesetError(
            f"This schema declares no content type {content_type!r} (has: {known})"
        )
    if not isinstance(data, dict):
        raise RulesetError("Entry data must be an object")

    declared = definition.get("fields") or {}
    cleaned = {
        key: coerce_value(declared[key], value)
        for key, value in data.items()
        if key in declared
    }
    # Fill declared fields the author left out, so an entry always has the
    # shape its content type promises and the catalog can sort and filter on it.
    for key, field in declared.items():
        cleaned.setdefault(key, coerce_value(field, field.get("default")))

    identity = definition.get("identity_field", "name")
    name = cleaned.get(identity)
    if not isinstance(name, str) or not name.strip():
        label = declared.get(identity, {}).get("label", identity)
        raise RulesetError(f"Entry needs a {label.lower()}")

    return cleaned


def slugify(value: str) -> str:
    """An entry id derived from a name, for an author who supplies none.

    Apostrophes are dropped rather than turned into separators, so "Hunter's
    Bolt" reads as `hunters-bolt` rather than `hunter-s-bolt`.
    """
    text = str(value).lower().replace("'", "").replace("’", "")
    cleaned = "".join(char if char.isalnum() else "-" for char in text)
    parts = [part for part in cleaned.split("-") if part]
    return "-".join(parts)[:200] or "entry"


def unique_entry_id(
    db: Session, ruleset_id: str, content_type: str, entry_id: str
) -> str:
    """``entry_id`` if this ruleset does not have it, else a free variant."""
    if not _entry_exists(db, ruleset_id, content_type, entry_id):
        return entry_id
    for suffix in range(2, 1000):
        candidate = f"{entry_id}-{suffix}"[:200]
        if not _entry_exists(db, ruleset_id, content_type, candidate):
            return candidate
    raise RulesetError(f"Could not find a free id near {entry_id!r}")


def _entry_exists(db: Session, ruleset_id: str, content_type: str, entry_id: str) -> bool:
    return bool(
        db.query(RulesetEntry.id)
        .filter_by(ruleset_id=ruleset_id, content_type=content_type, entry_id=entry_id)
        .first()
    )


def export_ruleset(ruleset: Ruleset, entries: list[RulesetEntry]) -> dict:
    """Bundle a ruleset into a portable document.

    Grouped by content type so the file reads the way a filesystem pack does,
    and so one can become the other.
    """
    grouped: dict[str, list[dict]] = {}
    for entry in entries:
        grouped.setdefault(entry.content_type, []).append(
            {"_id": entry.entry_id, **(entry.data if isinstance(entry.data, dict) else {})}
        )

    return {
        "$schema": PACK_SCHEMA,
        "name": ruleset.name,
        "schema_id": ruleset.schema_id,
        "version": ruleset.version or "1.0.0",
        "description": ruleset.description or "",
        "license": ruleset.license or "",
        "license_url": ruleset.license_url or "",
        "attribution": ruleset.attribution or "",
        "entries": grouped,
    }


def import_entries(
    db: Session,
    ruleset: Ruleset,
    grouped: Any,
    *,
    document: Optional[dict],
    conflict: str = "skip",
) -> dict:
    """Add a document's entries to a ruleset.

    ``conflict`` decides what happens to an entry id the ruleset already has:
    ``skip`` (the default — an import should not silently overwrite work),
    ``overwrite``, or ``rename`` to keep both.

    Returns a tally rather than raising on the first conflict, so a
    partly-overlapping import still brings in what it can.
    """
    if conflict not in CONFLICT_MODES:
        raise RulesetError(f"Unknown conflict mode {conflict!r}")
    if not isinstance(grouped, dict):
        raise RulesetError("Entries must be an object keyed by content type")

    total = sum(len(items) for items in grouped.values() if isinstance(items, list))
    if total > MAX_IMPORT_ENTRIES:
        raise RulesetError(f"A ruleset may hold at most {MAX_IMPORT_ENTRIES} entries")

    imported = skipped = renamed = overwritten = 0
    failed: list[dict] = []

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
            except (RulesetError, SchemaError) as exc:
                failed.append({"entry_id": raw_id, "reason": str(exc)})
                continue

            identity = _identity_of(document, content_type)
            entry_id = raw_id or slugify(str(cleaned.get(identity, "")))

            existing = (
                db.query(RulesetEntry)
                .filter_by(
                    ruleset_id=ruleset.id, content_type=content_type, entry_id=entry_id
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
                entry_id = unique_entry_id(db, ruleset.id, content_type, entry_id)
                renamed += 1

            db.add(
                RulesetEntry(
                    ruleset_id=ruleset.id,
                    schema_id=ruleset.schema_id,
                    content_type=content_type,
                    entry_id=entry_id,
                    name=str(cleaned.get(identity) or entry_id)[:500],
                    data=cleaned,
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
