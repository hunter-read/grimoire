"""The community GM screen presets, read the way applying one reads them.

Each preset in ``community-add-ons/gm-screens/`` must load as a board with no
panel moved aside or dropped, match the digest its index publishes, and - where
it reads a character sheet from the same repo - name only fields and computed
values that sheet has. A preset that drifts from either side would otherwise
apply as a board missing the stats its author meant.

``gm-screens/`` is newer than the other catalogues, so a checkout without it is
skipped with its own reason rather than the missing-checkout one CI refuses.
"""
import hashlib
import json
import os

import pytest

from backend.services import characters as svc
from backend.services.gm_screen import boards
from backend.tests import community_addons

pytestmark = community_addons.marks()

_SCREENS = community_addons.path("gm-screens")
_SHEETS = community_addons.path("character-sheets")


def _presets() -> list[str]:
    if not os.path.isdir(_SCREENS):
        return []
    return sorted(
        name
        for name in os.listdir(_SCREENS)
        if os.path.isfile(os.path.join(_SCREENS, name, f"{name}.json"))
    )


def _load(name: str) -> dict:
    with open(os.path.join(_SCREENS, name, f"{name}.json"), encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture(params=_presets() or [None])
def preset(request) -> str:
    if request.param is None:
        pytest.skip("this community-add-ons checkout has no gm-screens/ yet")
    return request.param


def test_a_preset_loads_as_the_board_its_author_laid_out(preset):
    document = _load(preset)
    board = boards.parse_board(document)
    assert len(board) == len(document["panels"])
    for panel, raw in zip(board, document["panels"]):
        assert panel["kind"] == raw["kind"]
        if "x" in raw:
            # Nothing was moved aside: the cells are the ones written.
            assert (panel["x"], panel["y"]) == (raw["x"], raw["y"]), raw.get("title")
        for key, value in (raw.get("config") or {}).items():
            assert panel["config"].get(key) == value, (raw.get("title"), key)


def test_the_index_lists_every_preset_with_its_digest():
    index_path = os.path.join(_SCREENS, "index.json")
    if not os.path.isfile(index_path):
        pytest.skip("this community-add-ons checkout has no gm-screens/ yet")
    with open(index_path, encoding="utf-8") as handle:
        index = json.load(handle)
    listed = {entry["id"]: entry for entry in index["screens"]}
    assert set(listed) == set(_presets())
    for name, entry in listed.items():
        with open(os.path.join(community_addons.ROOT, entry["path"]), "rb") as handle:
            assert hashlib.sha256(handle.read()).hexdigest() == entry["sha256"], name


def test_party_stats_name_values_the_systems_sheet_has(preset):
    document = _load(preset)
    sheet_path = os.path.join(_SHEETS, preset, f"{preset}.json")
    stats = [
        stat
        for panel in document["panels"]
        if panel["kind"] == "party"
        for stat in (panel.get("config") or {}).get("stats", [])
    ]
    if not stats:
        return
    assert os.path.isfile(sheet_path), f"{preset} reads stats from a sheet that is not here"
    with open(sheet_path, encoding="utf-8") as handle:
        sheet = json.load(handle)
    known = set(sheet.get("fields") or {}) | set(sheet.get("computed") or {})
    for stat in stats:
        assert stat["value"] in known, stat
        if isinstance(stat.get("max"), str):
            assert stat["max"] in known, stat
    # The sheet itself is one Grimoire accepts.
    svc.validate_schema(sheet)
