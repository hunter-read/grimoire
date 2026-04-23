"""Tests for tags.json loading and application in the library scanner."""
from __future__ import annotations

import json
import os
import tempfile
import uuid
from pathlib import Path

import pytest

from backend.config import SessionLocal
from backend.models import GenericMap, MapFolder, Token, TokenFolder, GameSystem
from backend.indexer import _load_tags_json, _apply_tags_from_library


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data), encoding="utf-8")


def _mk_lib() -> tuple[str, Path]:
    """Create a fresh temp library dir. Returns (tmp_path_str, Path)."""
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    lib.mkdir()
    return tmp, lib


def _add_map(lib: Path, rel: str, tags=None) -> GenericMap:
    """Insert a GenericMap record with the given relative path."""
    full = str(lib / rel)
    db = SessionLocal()
    try:
        m = GenericMap(
            id=str(uuid.uuid4()),
            filename=Path(rel).name,
            filepath=full,
            relative_path=rel,
            tags=tags or [],
        )
        db.add(m)
        db.commit()
        db.refresh(m)
        return m
    finally:
        db.close()


def _add_token(lib: Path, rel: str, tags=None) -> Token:
    full = str(lib / rel)
    db = SessionLocal()
    try:
        t = Token(
            id=str(uuid.uuid4()),
            filename=Path(rel).name,
            filepath=full,
            relative_path=rel,
            tags=tags or [],
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        return t
    finally:
        db.close()


def _add_system(slug: str, tags=None) -> GameSystem:
    db = SessionLocal()
    try:
        uid = uuid.uuid4().hex[:8]
        sys = GameSystem(
            id=str(uuid.uuid4()),
            name=f"System {uid}",
            slug=slug,
            tags=tags or [],
        )
        db.add(sys)
        db.commit()
        db.refresh(sys)
        return sys
    finally:
        db.close()


def _get_map(map_id: str) -> GenericMap | None:
    db = SessionLocal()
    try:
        return db.query(GenericMap).filter_by(id=map_id).first()
    finally:
        db.close()


def _get_token(token_id: str) -> Token | None:
    db = SessionLocal()
    try:
        return db.query(Token).filter_by(id=token_id).first()
    finally:
        db.close()


def _get_map_folder(path: str) -> MapFolder | None:
    db = SessionLocal()
    try:
        return db.query(MapFolder).filter_by(path=path).first()
    finally:
        db.close()


def _get_token_folder(path: str) -> TokenFolder | None:
    db = SessionLocal()
    try:
        return db.query(TokenFolder).filter_by(path=path).first()
    finally:
        db.close()


def _get_system(slug: str) -> GameSystem | None:
    db = SessionLocal()
    try:
        return db.query(GameSystem).filter_by(slug=slug).first()
    finally:
        db.close()


def _run(lib: Path) -> None:
    db = SessionLocal()
    try:
        _apply_tags_from_library(str(lib), db)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# _load_tags_json — unit tests
# ---------------------------------------------------------------------------


def test_load_tags_json_returns_empty_when_no_file():
    tmp = tempfile.mkdtemp()
    assert _load_tags_json(tmp) == {}


def test_load_tags_json_parses_valid_file():
    tmp = tempfile.mkdtemp()
    _write_json(Path(tmp) / "tags.json", {".": ["dungeon", "water"], "file.jpg": ["forest"]})
    result = _load_tags_json(tmp)
    assert result["."] == ["dungeon", "water"]
    assert result["file.jpg"] == ["forest"]


def test_load_tags_json_returns_empty_on_invalid_json():
    tmp = tempfile.mkdtemp()
    (Path(tmp) / "tags.json").write_text("not json", encoding="utf-8")
    assert _load_tags_json(tmp) == {}


def test_load_tags_json_returns_empty_when_root_is_not_object():
    tmp = tempfile.mkdtemp()
    _write_json(Path(tmp) / "tags.json", ["list", "not", "object"])
    assert _load_tags_json(tmp) == {}


def test_load_tags_json_skips_non_list_values():
    tmp = tempfile.mkdtemp()
    _write_json(Path(tmp) / "tags.json", {".": ["good"], "bad": "not-a-list"})
    result = _load_tags_json(tmp)
    assert "." in result
    assert "bad" not in result


def test_load_tags_json_strips_empty_strings_from_tags():
    tmp = tempfile.mkdtemp()
    _write_json(Path(tmp) / "tags.json", {".": ["dungeon", "", "  "]})
    result = _load_tags_json(tmp)
    assert result["."] == ["dungeon"]


def test_load_tags_json_lowercases_tags():
    tmp = tempfile.mkdtemp()
    _write_json(Path(tmp) / "tags.json", {".": ["Draw Steel", "FANTASY", "dungeon"]})
    result = _load_tags_json(tmp)
    assert result["."] == ["draw steel", "fantasy", "dungeon"]


def test_load_tags_json_deduplicates_after_lowercasing():
    tmp = tempfile.mkdtemp()
    _write_json(Path(tmp) / "tags.json", {".": ["Draw Steel", "draw steel", "DRAW STEEL"]})
    result = _load_tags_json(tmp)
    assert result["."] == ["draw steel"]


# ---------------------------------------------------------------------------
# _apply_tags_from_library — maps
# ---------------------------------------------------------------------------


def test_apply_sets_tags_on_map_file():
    _, lib = _mk_lib()
    maps_dir = lib / "maps" / "Creator"
    maps_dir.mkdir(parents=True)
    (maps_dir / "cave.png").touch()

    rel = "maps/Creator/cave.png"
    m = _add_map(lib, rel)

    _write_json(maps_dir / "tags.json", {"cave.png": ["cave", "dungeon"]})
    _run(lib)

    assert _get_map(m.id).tags == ["cave", "dungeon"]


def test_apply_sets_tags_on_map_folder_dot():
    _, lib = _mk_lib()
    maps_dir = lib / "maps" / "Cartographer"
    maps_dir.mkdir(parents=True)

    _write_json(maps_dir / "tags.json", {".": ["fantasy", "city"]})
    _run(lib)

    folder = _get_map_folder("Cartographer")
    assert folder is not None
    assert folder.tags == ["fantasy", "city"]


def test_apply_sets_tags_on_map_subfolder():
    _, lib = _mk_lib()
    maps_dir = lib / "maps" / "BigCreator"
    sub = maps_dir / "dungeons"
    sub.mkdir(parents=True)

    _write_json(maps_dir / "tags.json", {"dungeons": ["underground", "dark"]})
    _run(lib)

    folder = _get_map_folder("BigCreator/dungeons")
    assert folder is not None
    assert folder.tags == ["underground", "dark"]


def test_apply_sets_tags_on_map_file_in_subfolder():
    _, lib = _mk_lib()
    maps_dir = lib / "maps" / "ArtCreator"
    sub = maps_dir / "caves"
    sub.mkdir(parents=True)
    (sub / "ice-cave.png").touch()

    rel = "maps/ArtCreator/caves/ice-cave.png"
    m = _add_map(lib, rel)

    _write_json(maps_dir / "tags.json", {"caves/ice-cave.png": ["ice", "cold"]})
    _run(lib)

    assert _get_map(m.id).tags == ["ice", "cold"]


def test_apply_updates_existing_map_folder_tags():
    _, lib = _mk_lib()
    maps_dir = lib / "maps" / "Updater"
    maps_dir.mkdir(parents=True)

    # Pre-create a folder record with old tags
    db = SessionLocal()
    try:
        db.add(MapFolder(path="Updater", tags=["old"]))
        db.commit()
    finally:
        db.close()

    _write_json(maps_dir / "tags.json", {".": ["new", "fresh"]})
    _run(lib)

    folder = _get_map_folder("Updater")
    assert folder.tags == ["new", "fresh"]


def test_apply_ignores_unknown_file_key_gracefully():
    _, lib = _mk_lib()
    maps_dir = lib / "maps" / "GhostCreator"
    maps_dir.mkdir(parents=True)

    # No actual file, no DB record
    _write_json(maps_dir / "tags.json", {"nonexistent.png": ["ghost"]})
    _run(lib)  # must not raise


# ---------------------------------------------------------------------------
# _apply_tags_from_library — tokens
# ---------------------------------------------------------------------------


def test_apply_sets_tags_on_token_file():
    _, lib = _mk_lib()
    tokens_dir = lib / "tokens" / "Monsters"
    tokens_dir.mkdir(parents=True)
    (tokens_dir / "goblin.png").touch()

    rel = "tokens/Monsters/goblin.png"
    t = _add_token(lib, rel)

    _write_json(tokens_dir / "tags.json", {"goblin.png": ["monster", "small"]})
    _run(lib)

    assert _get_token(t.id).tags == ["monster", "small"]


def test_apply_sets_tags_on_token_folder():
    _, lib = _mk_lib()
    tokens_dir = lib / "tokens" / "NPCs"
    tokens_dir.mkdir(parents=True)

    _write_json(tokens_dir / "tags.json", {".": ["npc", "humanoid"]})
    _run(lib)

    folder = _get_token_folder("NPCs")
    assert folder is not None
    assert folder.tags == ["npc", "humanoid"]


def test_apply_sets_tags_on_token_subfolder():
    _, lib = _mk_lib()
    tokens_dir = lib / "tokens" / "Heroes"
    sub = tokens_dir / "warriors"
    sub.mkdir(parents=True)

    _write_json(tokens_dir / "tags.json", {"warriors": ["melee", "fighter"]})
    _run(lib)

    folder = _get_token_folder("Heroes/warriors")
    assert folder is not None
    assert folder.tags == ["melee", "fighter"]


# ---------------------------------------------------------------------------
# _apply_tags_from_library — books (system-level only)
# ---------------------------------------------------------------------------


def test_apply_sets_tags_on_game_system():
    from backend.indexer import slugify

    uid = uuid.uuid4().hex[:8]
    sys_name = f"TagSystem {uid}"
    slug = slugify(sys_name)

    _, lib = _mk_lib()
    sys_dir = lib / "books" / sys_name
    sys_dir.mkdir(parents=True)

    _add_system(slug)

    _write_json(sys_dir / "tags.json", {".": ["fantasy", "5e"]})
    _run(lib)

    system = _get_system(slug)
    assert system.tags == ["fantasy", "5e"]


# ---------------------------------------------------------------------------
# _apply_tags_from_library — tags.json in subdirectory
# ---------------------------------------------------------------------------


def test_apply_tags_json_in_subdirectory():
    _, lib = _mk_lib()
    sub = lib / "maps" / "DeepCreator" / "sub"
    sub.mkdir(parents=True)
    (sub / "river.png").touch()

    rel = "maps/DeepCreator/sub/river.png"
    m = _add_map(lib, rel)

    _write_json(sub / "tags.json", {"river.png": ["water", "outdoor"]})
    _run(lib)

    assert _get_map(m.id).tags == ["water", "outdoor"]


# ---------------------------------------------------------------------------
# _apply_tags_from_library — no-op when no tags.json
# ---------------------------------------------------------------------------


def test_apply_noop_when_no_tags_json():
    _, lib = _mk_lib()
    maps_dir = lib / "maps" / "Empty"
    maps_dir.mkdir(parents=True)
    (maps_dir / "map.png").touch()

    rel = "maps/Empty/map.png"
    m = _add_map(lib, rel, tags=["keep-me"])
    _run(lib)

    # Tags should be unchanged
    assert _get_map(m.id).tags == ["keep-me"]


# ---------------------------------------------------------------------------
# _apply_tags_from_library — non-existent section dirs
# ---------------------------------------------------------------------------


def test_apply_does_not_error_when_maps_dir_missing():
    _, lib = _mk_lib()
    # No maps/ dir at all
    _run(lib)  # must not raise


def test_apply_does_not_error_when_tokens_dir_missing():
    _, lib = _mk_lib()
    # No tokens/ dir at all
    _run(lib)  # must not raise
