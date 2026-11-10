"""Map pages in wiki export and import (issue #578).

A map page round-trips with its picture and its pins:

* The JSON bundle carries ``map_id``, ``map_file_id`` and a ``pins`` list.
* The markdown zip carries the same in frontmatter - ``map:``, ``map_file:``,
  and ``pins:`` as a one-line JSON list, which is also a valid YAML flow
  sequence, so an Obsidian vault reads it as a list.
* The single-file export, which is for reading rather than re-importing, lists
  each pin under the page as a linked location.

A pin names its target page by slug, the way ``parent:`` does, and the importer
resolves it against the pages it is creating. An export holds only the pins its
reader could see in the app: GM pins for the GM alone, and no pin to a page left
out of the export.

Imported files are untrusted, so pins are rebuilt field by field and bounded.
A campaign file is kept only when it belongs to *this* campaign - never another
campaign's file by id. A library map id is kept as it is; one this server
doesn't hold imports as a placeholder that keeps its pins, ready for *Replace
map*.
"""

import json
from typing import Any, Callable, Optional

from sqlalchemy.orm import Session

from ...auth import CurrentUser
from ...models import CampaignFile, WikiMapPin, WikiPage
from ._schemas import clean_icon_color
from ._wiki_maps import MAP_PAGE_TYPE, PIN_VISIBILITIES, visible_pins

# Bounds a single imported page. A region map with a thousand places is
# already unusual; this is a ceiling against a hostile file, not a design limit.
_MAX_IMPORT_PINS = 1000


def export_pins(
    db: Session, campaign: Any, page: WikiPage, user: CurrentUser, slug_of: dict
) -> list[dict]:
    """The pins of ``page`` that ``user`` can see, with targets as slugs.

    ``slug_of`` maps the exported pages' ids to their slugs; a pin whose target
    is not among them is left out, like the page it points at.
    """
    if page.page_type != MAP_PAGE_TYPE:
        return []
    out = []
    for pin, _target in visible_pins(db, campaign, page, user):
        if pin.target_page_id and pin.target_page_id not in slug_of:
            continue
        out.append(
            {
                "x": round(pin.x, 6),
                "y": round(pin.y, 6),
                "label": pin.label or "",
                "target": slug_of.get(pin.target_page_id) if pin.target_page_id else None,
                "icon": pin.icon,
                "icon_color": pin.icon_color,
                "visibility": pin.visibility or "page",
            }
        )
    return out


def pins_frontmatter(pins: list[dict]) -> str:
    """``pins`` as one frontmatter value: compact JSON, a YAML flow sequence."""
    return json.dumps(pins, ensure_ascii=False, separators=(",", ":"))


def pins_markdown(pins: list[dict], title_of: Callable[[str], Optional[str]]) -> str:
    """The pins of a page as a list of locations, for the single-file export."""
    lines = []
    for pin in pins:
        target = title_of(pin["target"]) if pin.get("target") else None
        label = pin.get("label") or target
        if not label:
            continue
        if target and target != label:
            lines.append(f"- {label} - [[{target}]]")
        elif target:
            lines.append(f"- [[{target}]]")
        else:
            lines.append(f"- {label}")
    return "\n".join(lines)


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if value != value:  # NaN
        return None
    return min(1.0, max(0.0, float(value)))


def _text(value: Any, limit: int) -> Optional[str]:
    return value.strip()[:limit] if isinstance(value, str) else None


def _icon_color(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    try:
        return clean_icon_color(value) or None
    except ValueError:
        return None


def clean_import_pins(raw: Any) -> list[dict]:
    """Pins from an imported file, rebuilt from what we accept and bounded.

    A string is read as the frontmatter's JSON list. A pin without numeric
    coordinates is dropped rather than parked in a corner.
    """
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return []
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[:_MAX_IMPORT_PINS]:
        if not isinstance(item, dict):
            continue
        x, y = _number(item.get("x")), _number(item.get("y"))
        if x is None or y is None:
            continue
        visibility = item.get("visibility")
        out.append(
            {
                "x": x,
                "y": y,
                "label": _text(item.get("label"), 255) or "",
                "target": _text(item.get("target"), 255) or None,
                "icon": _text(item.get("icon"), 50) or None,
                "icon_color": _icon_color(item.get("icon_color")),
                "visibility": visibility if visibility in PIN_VISIBILITIES else "page",
            }
        )
    return out


def clean_import_id(value: Any) -> Optional[str]:
    """An imported map or file id, or None for anything that isn't one."""
    text = _text(value, 36)
    return text if text and all(ch.isalnum() or ch in "-_" for ch in text) else None


def apply_imported_map(
    db: Session,
    campaign_id: str,
    page: WikiPage,
    record: dict,
    page_id_for: Callable[[str], Optional[str]],
    user: CurrentUser,
) -> None:
    """Give an imported map page its picture and pins.

    ``page_id_for`` resolves a pin's target key to the id of a page this import
    created (or None, leaving the pin unlinked).
    """
    if page.page_type != MAP_PAGE_TYPE:
        return
    # Kept even when this server has no such map: the page then reads as one
    # whose map has gone (with Replace map), rather than one never given a map.
    page.map_id = record.get("map_id")
    file_id = record.get("map_file_id")
    if (
        not page.map_id
        and file_id
        and db.query(CampaignFile.id)
        .filter_by(id=file_id, campaign_id=campaign_id, is_image=True)
        .first()
        is not None
    ):
        page.map_file_id = file_id
    for order, pin in enumerate(record.get("pins") or []):
        target_id = page_id_for(pin["target"]) if pin.get("target") else None
        db.add(
            WikiMapPin(
                page_id=page.id,
                x=pin["x"],
                y=pin["y"],
                label=pin["label"],
                target_page_id=target_id if target_id != page.id else None,
                icon=pin["icon"],
                icon_color=pin["icon_color"],
                visibility=pin["visibility"],
                sort_order=order,
                created_by_id=user.id,
            )
        )
