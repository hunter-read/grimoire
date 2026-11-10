"""Whole boards: reading one from a preset or another campaign, and writing one out.

A board travels as a small JSON document - its panels, each with a kind, a
title, a cell on the grid, its config and (optionally) a starting state. That
one shape serves three things:

* a community preset, downloaded from the add-on catalogue;
* a board exported from one campaign, to paste into another or to publish;
* copying a board between two campaigns the same GM runs.

The document is untrusted in the first two cases, so it is read strictly at
the top - a board needs a list of panels of known kinds - and every panel's
contents are cleaned by ``panels``, which bounds each value. A preset carries
no code and no markup: the most it can do is set up built-in tools.
"""
from typing import Any

from . import panels as p

__all__ = ["BOARD_FORMAT", "parse_board", "export_board", "settle"]

#: The `format` an exported board declares, so a reader can tell it from an
#: unrelated JSON file.
BOARD_FORMAT = "grimoire://gm-screen/v1"


def settle(cells: list[dict]) -> list[dict]:
    """The same cells with every overlap moved to the first free spot.

    A hand-written preset may well stack two panels on one cell; rather than
    refusing it, the later panel moves out of the way, as it would on screen.
    """
    taken: list[dict] = []
    for cell in cells:
        clash = any(p.overlaps(cell, other) for other in taken)
        if clash:
            cell.update(p.place(taken, cell["w"], cell["h"]))
        taken.append(cell)
    return cells


def parse_board(document: Any, *, keep_state: bool = True) -> list[dict]:
    """A board document's panels, cleaned and laid out without overlaps.

    Raises PanelError when the document is not a board at all, or names a
    kind of panel this version does not have - better to say so than to drop a
    tool the author meant to include.

    ``keep_state`` False starts every panel empty, which is how a board is
    copied: the setup comes across, the numbers from the last session do not.
    """
    if not isinstance(document, dict):
        raise p.PanelError("A GM screen board must be a JSON object")
    raw_panels = document.get("panels")
    if not isinstance(raw_panels, list) or not raw_panels:
        raise p.PanelError("A GM screen board needs a non-empty 'panels' list")
    if len(raw_panels) > p.MAX_PANELS:
        raise p.PanelError(f"A GM screen board holds at most {p.MAX_PANELS} panels")

    cleaned: list[dict] = []
    placed: list[dict] = []
    for index, raw in enumerate(raw_panels):
        if not isinstance(raw, dict):
            raise p.PanelError(f"Panel {index} must be an object")
        kind = raw.get("kind")
        if kind not in p.KINDS:
            raise p.PanelError(
                f"Panel {index} has unknown kind {kind!r} (expected one of: {', '.join(p.KINDS)})"
            )
        config = p.clean_config(kind, raw.get("config"))
        state = p.clean_state(kind, raw.get("state") if keep_state else None, config)
        cell = p.clean_geometry(raw.get("x"), raw.get("y"), raw.get("w"), raw.get("h"), kind)
        if "x" not in raw or "y" not in raw:
            # No position given: the first gap the panel fits, in order.
            cell = p.place(placed, cell["w"], cell["h"])
        placed.append(cell)
        cleaned.append(
            {
                "kind": kind,
                "title": p.clean_title(raw.get("title")),
                **cell,
                "config": config,
                "state": state,
            }
        )
    settle(placed)
    for panel, cell in zip(cleaned, placed):
        panel.update(cell)
    return cleaned


def export_board(name: str, panels: list[dict]) -> dict:
    """A board as a document another campaign, or the catalogue, can read.

    Note pages travel by slug: an id means nothing in another campaign, while a
    page called ``session-zero`` there is very likely the one meant.
    """
    exported = []
    for panel in panels:
        config = dict(panel.get("config") or {})
        if panel.get("kind") == "note":
            config.pop("page_id", None)
        exported.append(
            {
                "kind": panel["kind"],
                "title": panel.get("title") or "",
                "x": panel["x"],
                "y": panel["y"],
                "w": panel["w"],
                "h": panel["h"],
                "config": config,
                "state": panel.get("state") or {},
            }
        )
    return {"format": BOARD_FORMAT, "name": name, "panels": exported}
