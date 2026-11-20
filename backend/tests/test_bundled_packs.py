"""Every content pack in the community repository must load as its author meant.

The loader is forgiving on purpose: a property no content type declares is
dropped, and a file whose type nobody declares is stored as authored. Both are
right for a pack an admin dropped in by hand, and both would hide a mistake in
a published one - a monster's hit points that never reach the compendium, or a
file of conditions no sheet or pack describes. So the shipped packs are held to
the strict version: every file's type is declared by the pack's sheet or by the
pack itself (``_meta.json`` ``content_types``), every declaration validates, and
every property an entry carries is a declared field.
"""
import json
import os

import pytest

from backend.services.characters import packs
from backend.services.characters.schema import validate_content_types
from backend.tests import community_addons

_PACK_DIR = community_addons.path("content-packs")
_SHEET_DIR = community_addons.path("character-sheets")

pytestmark = community_addons.marks(_PACK_DIR, _SHEET_DIR)

_PRIVATE = {"_id", "_source", "_tags"}


def _packs():
    if not os.path.isdir(_PACK_DIR):
        return []
    return [
        pytest.param(os.path.join(_PACK_DIR, name), id=name)
        for name in sorted(os.listdir(_PACK_DIR))
        if os.path.isfile(os.path.join(_PACK_DIR, name, packs.META_FILE))
    ]


def _read(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _sheet_types(schema_id: str) -> dict:
    path = os.path.join(_SHEET_DIR, schema_id, f"{schema_id}.json")
    return _read(path).get("content_types", {}) if os.path.isfile(path) else {}


@pytest.mark.parametrize("directory", _packs())
class TestBundledPacks:
    def test_its_declared_types_validate(self, directory):
        meta = _read(os.path.join(directory, packs.META_FILE))
        if "content_types" in meta:
            validate_content_types(meta["content_types"])

    def test_every_file_and_property_is_declared(self, directory):
        meta = _read(os.path.join(directory, packs.META_FILE))
        types = packs.merged_content_types(
            meta.get("content_types"), {"content_types": _sheet_types(meta["schema_id"])}
        )
        for content_type, path in packs._content_files(directory):
            assert content_type in types, (
                f"{os.path.basename(path)}: neither the {meta['schema_id']} sheet nor the "
                "pack's _meta.json declares this content type"
            )
            fields = set(types[content_type].get("fields") or {})
            for entry in _read(path):
                extra = set(entry) - fields - _PRIVATE
                assert not extra, f"{content_type} {entry.get('_id')}: undeclared {sorted(extra)}"
