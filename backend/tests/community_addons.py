"""The community-add-ons checkout the cross-repo contract tests read (issue #581).

These tests load the real definitions published in grimoire-codex/community-add-ons
- scrapers, character importers, sheets and content packs - and check them
against this repo's interpreter, manifest models, importer and sheet renderer.
That boundary is the one most likely to break silently: a change on either side
can break a published add-on, and nothing fails until someone installs it.

The checkout is found at ``$COMMUNITY_ADDONS_PATH``, or else as a sibling of this
repo (``../community-add-ons``). Without one the tests skip, so a contributor who
only cloned Grimoire can still run the suite. CI sets
``REQUIRE_COMMUNITY_ADDONS=true``, and conftest then fails the run on any skip
for this reason, so a missing checkout or a renamed path can't quietly turn the
contract tests back into skips.

Every contract test carries the ``community_addons`` marker, which is how the
community repo's own CI runs just these against Grimoire's ``main``:
``pytest -m community_addons``.
"""
import os

import pytest

ROOT = os.path.abspath(
    os.environ.get("COMMUNITY_ADDONS_PATH")
    or os.path.join(os.path.dirname(__file__), "..", "..", "..", "community-add-ons")
)

# conftest matches skips on this exact text, so keep every skip here using it.
MISSING = (
    "community-add-ons is not checked out: clone it beside this repo, "
    "or set COMMUNITY_ADDONS_PATH"
)

REQUIRED = os.environ.get("REQUIRE_COMMUNITY_ADDONS", "").strip().lower() == "true"


def path(*parts: str) -> str:
    """A path inside the checkout."""
    return os.path.join(ROOT, *parts)


def marks(*required: str) -> list:
    """Marks for a contract test or module: the marker, and a skip without ``required``.

    ``required`` defaults to the checkout itself; name the specific files a test
    reads, so one that the community repo renamed fails CI rather than skipping.
    """
    present = all(os.path.exists(p) for p in (required or (ROOT,)))
    return [pytest.mark.community_addons, pytest.mark.skipif(not present, reason=MISSING)]


def skip_unless_present(*required: str) -> None:
    """The inline form of ``marks``, for a fixture or a test that finds its path late."""
    if not all(os.path.exists(p) for p in required):
        pytest.skip(MISSING)
