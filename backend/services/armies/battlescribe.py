"""Reading BattleScribe rosters: the ``.ros`` / ``.rosz`` army lists.

A roster is the list a player builds in BattleScribe or New Recruit and shares
with others: XML, zipped for ``.rosz``. It holds everything the list needs on
its own - each unit's points, upgrades, stat lines and rules - so Grimoire can
show it without the game's data files (the ``.gst`` / ``.cat`` catalogues).

The shape, trimmed to what is read here::

    <roster name gameSystemId gameSystemName>
      <costs><cost name="pts" value="1995"/></costs>
      <costLimits><costLimit name="pts" value="2000"/></costLimits>
      <forces>
        <force name catalogueId catalogueName>
          <selections>
            <selection id name type number publicationId page>
              <costs/> <categories/> <profiles/> <rules/> <selections/>
          <forces/>                      (a force may hold forces)
          <publications><publication id name/>

It becomes one JSON document (:func:`parse_roster`) the army builder reads
whole. The file is untrusted, so its unzipped size is capped, it is parsed
with defusedxml refusing any DOCTYPE (rosters never carry one, so no entity is
ever declared or expanded, whatever the encoding), and the number of
selections, the publications they cite and the size of the document read from
it are bounded.
"""
from __future__ import annotations

import io
import json
import lzma
import zipfile
import zlib
from typing import Any, Optional
from xml.etree import ElementTree

import defusedxml.ElementTree as SafeElementTree

#: The largest roster read, unzipped. Real ones are tens of kilobytes; a
#: thousand-model Apocalypse list is a few megabytes.
MAX_ROSTER_BYTES = 20 * 1024 * 1024
#: The most selections read from one roster, nested ones included.
MAX_SELECTIONS = 10_000
#: The most publications one roster may cite. Real ones cite a handful: a
#: rulebook, a codex or two, an errata. Each is looked up in the library.
MAX_PUBLICATIONS = 500
#: How deep selections and forces may nest. Real rosters go a handful deep.
MAX_DEPTH = 50
#: The largest cost, count or limit read, either way. Real ones are thousands.
MAX_NUMBER = 1_000_000
#: The largest total points worked out from a roster's units.
MAX_TOTAL = 1_000_000_000
#: The largest document stored for one roster, as JSON. A real roster's is
#: about the size of its XML.
MAX_DOCUMENT_BYTES = MAX_ROSTER_BYTES


class RosterError(ValueError):
    """The file is not a roster that can be read. The message says why."""


def roster_xml(raw: bytes) -> bytes:
    """The roster XML in an uploaded file: as-is for ``.ros``, unzipped for ``.rosz``."""
    if raw[:2] != b"PK":
        if len(raw) > MAX_ROSTER_BYTES:
            raise RosterError("That roster is too large")
        return raw
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            members = [m for m in archive.infolist() if m.filename.lower().endswith(".ros")]
            if not members:
                raise RosterError("That .rosz file holds no roster")
            member = members[0]
            if member.file_size > MAX_ROSTER_BYTES:
                raise RosterError("That roster is too large")
            with archive.open(member) as handle:
                data = handle.read(MAX_ROSTER_BYTES + 1)
    except RosterError:
        raise
    except (
        zipfile.BadZipFile,
        zlib.error,
        lzma.LZMAError,
        EOFError,
        OSError,
        ValueError,
        # An encrypted member, or a compression method zipfile cannot read.
        RuntimeError,
        NotImplementedError,
    ) as exc:
        raise RosterError("That .rosz file is damaged") from exc
    if len(data) > MAX_ROSTER_BYTES:
        raise RosterError("That roster is too large")
    return data


def _tag(element: ElementTree.Element) -> str:
    """An element's name without its XML namespace."""
    return element.tag.rsplit("}", 1)[-1]


def _child(element: Optional[ElementTree.Element], name: str) -> Optional[ElementTree.Element]:
    if element is None:
        return None
    return next((c for c in element if _tag(c) == name), None)


def _children(element: Optional[ElementTree.Element], name: str) -> list[ElementTree.Element]:
    if element is None:
        return []
    return [c for c in element if _tag(c) == name]


def _number(raw: Optional[str]) -> int:
    """A cost or count as stored (``"85.0"``), as a whole number.

    Clamped to :data:`MAX_NUMBER` either way; anything that is not a finite
    number reads as 0.
    """
    try:
        value = int(round(float(raw or 0)))
    except (ValueError, OverflowError):
        return 0
    return max(-MAX_NUMBER, min(MAX_NUMBER, value))


def _costs(element: Optional[ElementTree.Element], tag: str = "cost") -> list[dict[str, Any]]:
    return [
        {"name": c.get("name") or "", "value": _number(c.get("value"))}
        for c in _children(element, tag)
    ]


def _hidden(element: ElementTree.Element) -> bool:
    return (element.get("hidden") or "").lower() == "true"


class _Reader:
    """One roster's parse: the publications it cites and a selection budget."""

    def __init__(self, publications: dict[str, str]) -> None:
        self.publications = publications
        self.cited: set[str] = set()
        self.selections = 0

    def _source(self, element: ElementTree.Element) -> dict[str, str]:
        publication = self.publications.get(element.get("publicationId") or "", "")
        if publication and publication not in self.cited:
            self.cited.add(publication)
            if len(self.cited) > MAX_PUBLICATIONS:
                raise RosterError("That roster cites too many publications to read")
        return {"publication": publication, "page": element.get("page") or ""}

    def profile(self, element: ElementTree.Element) -> dict[str, Any]:
        characteristics = _children(_child(element, "characteristics"), "characteristic")
        return {
            "name": element.get("name") or "",
            "type": element.get("typeName") or "",
            "characteristics": [
                {"name": c.get("name") or "", "value": (c.text or "").strip()}
                for c in characteristics
            ],
            **self._source(element),
        }

    def rule(self, element: ElementTree.Element) -> dict[str, Any]:
        description = _child(element, "description")
        return {
            "name": element.get("name") or "",
            "description": (description.text or "").strip() if description is not None else "",
            **self._source(element),
        }

    def selection(self, element: ElementTree.Element, depth: int = 0) -> dict[str, Any]:
        self.selections += 1
        if self.selections > MAX_SELECTIONS:
            raise RosterError("That roster has too many entries to read")
        if depth > MAX_DEPTH:
            raise RosterError("That roster nests its entries too deeply to read")
        categories = _children(_child(element, "categories"), "category")
        primary = next((c for c in categories if c.get("primary") == "true"), None)
        return {
            "id": element.get("id") or "",
            "name": element.get("name") or "",
            "type": element.get("type") or "",
            "number": _number(element.get("number") or "1"),
            "costs": _costs(_child(element, "costs")),
            "categories": [c.get("name") or "" for c in categories],
            "primary_category": (primary.get("name") or "") if primary is not None else "",
            "profiles": [
                self.profile(p)
                for p in _children(_child(element, "profiles"), "profile")
                if not _hidden(p)
            ],
            "rules": [
                self.rule(r) for r in _children(_child(element, "rules"), "rule") if not _hidden(r)
            ],
            **self._source(element),
            "children": [
                self.selection(s, depth + 1)
                for s in _children(_child(element, "selections"), "selection")
            ],
        }

    def force(self, element: ElementTree.Element, depth: int = 0) -> dict[str, Any]:
        if depth > MAX_DEPTH:
            raise RosterError("That roster nests its forces too deeply to read")
        return {
            "id": element.get("id") or "",
            "name": element.get("name") or "",
            "catalogue": element.get("catalogueName") or "",
            "catalogue_id": element.get("catalogueId") or "",
            "units": [
                self.selection(s, depth + 1)
                for s in _children(_child(element, "selections"), "selection")
            ],
            "forces": [
                self.force(f, depth + 1) for f in _children(_child(element, "forces"), "force")
            ],
        }


def parse_roster(xml: bytes) -> dict[str, Any]:
    """A roster's XML as the army builder's JSON document.

    Raises :class:`RosterError` for anything that is not a readable roster.
    """
    try:
        root = SafeElementTree.fromstring(xml, forbid_dtd=True)
    except (ElementTree.ParseError, ValueError) as exc:
        # defusedxml's refusals (a DOCTYPE, an entity) are ValueErrors.
        raise RosterError("That file is not a BattleScribe roster") from exc
    if _tag(root) != "roster":
        raise RosterError("That file is not a BattleScribe roster")

    publications = {
        p.get("id") or "": p.get("name") or ""
        for p in root.iter()
        if _tag(p) == "publication" and p.get("id")
    }
    reader = _Reader(publications)
    document = {
        "format": "battlescribe",
        "name": root.get("name") or "",
        "game_system_id": root.get("gameSystemId") or "",
        "game_system_name": root.get("gameSystemName") or "",
        "costs": _costs(_child(root, "costs")),
        "cost_limits": _costs(_child(root, "costLimits"), "costLimit"),
        "forces": [reader.force(f) for f in _children(_child(root, "forces"), "force")],
    }
    if len(json.dumps(document)) > MAX_DOCUMENT_BYTES:
        raise RosterError("That roster is too large")
    return document


def roster_points(data: dict[str, Any], cost_name: str) -> int:
    """The army's total in ``cost_name``: the roster's own total, or the sum of its units.

    Clamped to :data:`MAX_TOTAL`, so it always fits the database column.
    """
    for cost in data.get("costs") or []:
        if cost.get("name") == cost_name:
            return max(-MAX_TOTAL, min(MAX_TOTAL, int(cost.get("value") or 0)))

    def unit_total(unit: dict[str, Any]) -> int:
        own = sum(c.get("value", 0) for c in unit.get("costs") or [] if c.get("name") == cost_name)
        return own + sum(unit_total(child) for child in unit.get("children") or [])

    def force_total(force: dict[str, Any]) -> int:
        return sum(unit_total(u) for u in force.get("units") or []) + sum(
            force_total(f) for f in force.get("forces") or []
        )

    total = sum(force_total(f) for f in data.get("forces") or [])
    return max(-MAX_TOTAL, min(MAX_TOTAL, total))


def roster_limit(data: dict[str, Any], cost_name: str) -> Optional[int]:
    """The roster's points limit in ``cost_name``, or None. BattleScribe uses -1 for none."""
    for limit in data.get("cost_limits") or []:
        if limit.get("name") == cost_name:
            value = int(limit.get("value") or 0)
            return value if value > 0 else None
    return None


def main_cost_name(data: dict[str, Any]) -> str:
    """The roster's main cost type: "pts" when present, else its first."""
    names = [c.get("name") for c in data.get("costs") or [] if c.get("name")]
    if "pts" in names or not names:
        return "pts"
    return str(names[0])
