"""Every character sheet in the community repository must load in the engine.

These are the shipped sheets (issue #134). A sheet that stops validating is a
sheet nobody can install, and the failure would otherwise surface as a support
question rather than a test.

The repository is a sibling checkout, so the whole module skips when it is not
present — a contributor working only on the app should not see failures for a
repo they have not cloned.
"""
import json
import os

import pytest

from backend.services import characters as svc

_REPO = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "community-add-ons")
)
_SHEET_DIR = os.path.join(_REPO, "character-sheets")

pytestmark = pytest.mark.skipif(
    not os.path.isdir(_SHEET_DIR),
    reason="the community-add-ons repository is not checked out beside this one",
)


def _sheets():
    if not os.path.isdir(_SHEET_DIR):
        return []
    found = []
    for name in sorted(os.listdir(_SHEET_DIR)):
        path = os.path.join(_SHEET_DIR, name, f"{name}.json")
        if os.path.isfile(path):
            found.append(pytest.param(path, id=name))
    return found


def _load(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        document = json.load(handle)
    # `$schema` is an editor affordance, not part of the document.
    document.pop("$schema", None)
    return document


@pytest.mark.parametrize("path", _sheets())
class TestBundledSheets:
    def test_validates(self, path):
        assert svc.validate_schema(_load(path))

    def test_computes_on_an_empty_character(self, path):
        """A brand-new character must render, not error."""
        document = svc.validate_schema(_load(path))
        assert svc.compute_values(document, {}) is not None
        assert svc.run_validators(document, {}) is not None
        assert svc.visible_fields(document, {}) is not None

    def test_carries_its_licence_and_credit(self, path):
        """Licensed content must credit its source; several licences demand it."""
        document = _load(path)
        if document.get("license"):
            assert document.get("attribution"), "a licensed sheet needs an attribution"

    def test_a_custom_layout_parses_and_scopes_its_css(self, path):
        document = svc.validate_schema(_load(path), scope="gc-test")
        raw = _load(path)
        if raw.get("layout_html"):
            assert document["layout_ast"], "layout_html produced no nodes"
        if raw.get("styles"):
            # Every rule is confined to the sheet, so a sheet cannot restyle
            # the app around it.
            for line in document["styles_css"].splitlines():
                if line.strip().startswith(("@", "}")) or "{" not in line:
                    continue
                assert ".gc-test" in line, f"unscoped rule: {line}"


def test_at_least_the_five_shipped_systems_are_present():
    """Phase 6 committed to five systems; this is that list."""
    names = {os.path.basename(param.values[0]).removesuffix(".json") for param in _sheets()}
    assert {"dnd-5e-2024", "draw-steel", "pathfinder-2e", "cairn", "basic-fantasy"} <= names
