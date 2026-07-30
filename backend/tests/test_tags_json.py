"""Tests for tags.json loading and application in the library scanner."""
from __future__ import annotations

import json
import tempfile
import uuid
from pathlib import Path


from backend.config import SessionLocal
from backend.models import (
    GenericMap,
    MapFolder,
    Token,
    TokenFolder,
    Audio,
    AudioFolder,
    GameSystem,
    Tag,
)
from backend.indexer import _load_tags_json, _apply_tags_from_library
from backend.services import tag_service


def _sync_item_tags(resource_type: str, resource_id: str, tags) -> None:
    """Apply item tags via the shared-tag service (items have no ``tags`` column)."""
    if not tags:
        return
    db = SessionLocal()
    try:
        tag_service.set_resource_tags(db, resource_type, resource_id, tags)
        db.commit()
    finally:
        db.close()


def _tags_of(resource_type: str, resource_id: str) -> list[str]:
    """A resource's shared tags as display strings (sorted by display)."""
    db = SessionLocal()
    try:
        return tag_service.display_tags_for_resource(db, resource_type, resource_id)
    finally:
        db.close()


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
        )
        db.add(m)
        db.commit()
        db.refresh(m)
    finally:
        db.close()
    _sync_item_tags("map", m.id, tags)
    return m


def _add_token(lib: Path, rel: str, tags=None) -> Token:
    full = str(lib / rel)
    db = SessionLocal()
    try:
        t = Token(
            id=str(uuid.uuid4()),
            filename=Path(rel).name,
            filepath=full,
            relative_path=rel,
        )
        db.add(t)
        db.commit()
        db.refresh(t)
    finally:
        db.close()
    _sync_item_tags("token", t.id, tags)
    return t


def _add_system(slug: str, tags=None) -> GameSystem:
    db = SessionLocal()
    try:
        uid = uuid.uuid4().hex[:8]
        sys = GameSystem(
            id=str(uuid.uuid4()),
            name=f"System {uid}",
            slug=slug,
        )
        db.add(sys)
        db.commit()
        db.refresh(sys)
    finally:
        db.close()
    _sync_item_tags("system", sys.id, tags)
    return sys


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


def _add_audio(lib: Path, rel: str, tags=None) -> Audio:
    full = str(lib / rel)
    db = SessionLocal()
    try:
        a = Audio(
            id=str(uuid.uuid4()),
            filename=Path(rel).name,
            filepath=full,
            relative_path=rel,
        )
        db.add(a)
        db.commit()
        db.refresh(a)
    finally:
        db.close()
    _sync_item_tags("audio", a.id, tags)
    return a


def _get_audio(audio_id: str) -> Audio | None:
    db = SessionLocal()
    try:
        return db.query(Audio).filter_by(id=audio_id).first()
    finally:
        db.close()


def _get_audio_folder(path: str) -> AudioFolder | None:
    db = SessionLocal()
    try:
        return db.query(AudioFolder).filter_by(path=path).first()
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


def test_load_tags_json_keeps_entered_casing():
    # tags.json keeps the entered casing; it becomes the default display for a new
    # tag, and the tag service never overwrites an existing tag's display.
    tmp = tempfile.mkdtemp()
    _write_json(Path(tmp) / "tags.json", {".": ["Draw Steel", "FANTASY", "dungeon"]})
    result = _load_tags_json(tmp)
    assert result["."] == ["Draw Steel", "FANTASY", "dungeon"]


def test_load_tags_json_deduplicates_by_key_keeping_first_casing():
    tmp = tempfile.mkdtemp()
    _write_json(Path(tmp) / "tags.json", {".": ["Draw Steel", "draw steel", "DRAW STEEL"]})
    result = _load_tags_json(tmp)
    assert result["."] == ["Draw Steel"]


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

    assert _tags_of("map", m.id) == ["cave", "dungeon"]


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

    assert sorted(_tags_of("map", m.id)) == ["cold", "ice"]


def test_apply_adds_to_existing_map_folder_tags():
    # The library is read-only, so tags.json is additive: it adds tags without
    # removing user-set folder tags (stored as internal keys).
    _, lib = _mk_lib()
    maps_dir = lib / "maps" / "Updater"
    maps_dir.mkdir(parents=True)

    # Pre-create a folder record with an existing (user-set) tag.
    db = SessionLocal()
    try:
        db.add(MapFolder(path="Updater", tags=["old"]))
        db.commit()
    finally:
        db.close()

    _write_json(maps_dir / "tags.json", {".": ["new", "fresh"]})
    _run(lib)

    folder = _get_map_folder("Updater")
    # Existing "old" is kept; the new keys are appended (never removed).
    assert folder.tags == ["old", "new", "fresh"]


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

    assert _tags_of("token", t.id) == ["monster", "small"]


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
# _apply_tags_from_library — audio
# ---------------------------------------------------------------------------


def test_apply_sets_tags_on_audio_file():
    _, lib = _mk_lib()
    audio_dir = lib / "audio" / "Ambient"
    audio_dir.mkdir(parents=True)
    (audio_dir / "tavern.mp3").touch()

    rel = "audio/Ambient/tavern.mp3"
    a = _add_audio(lib, rel)

    _write_json(audio_dir / "tags.json", {"tavern.mp3": ["ambient", "tavern"]})
    _run(lib)

    assert _tags_of("audio", a.id) == ["ambient", "tavern"]


def test_apply_sets_tags_on_audio_folder():
    _, lib = _mk_lib()
    # Unique folder name so the additive merge isn't polluted by an AudioFolder
    # another test seeded in the shared DB.
    name = f"Soundscapes{uuid.uuid4().hex[:6]}"
    audio_dir = lib / "audio" / name
    audio_dir.mkdir(parents=True)

    _write_json(audio_dir / "tags.json", {".": ["soundscape", "atmosphere"]})
    _run(lib)

    folder = _get_audio_folder(name)
    assert folder is not None
    assert folder.tags == ["soundscape", "atmosphere"]


def test_apply_sets_tags_on_audio_subfolder():
    _, lib = _mk_lib()
    audio_dir = lib / "audio" / "Creator"
    sub = audio_dir / "battle"
    sub.mkdir(parents=True)

    _write_json(audio_dir / "tags.json", {"battle": ["combat", "intense"]})
    _run(lib)

    folder = _get_audio_folder("Creator/battle")
    assert folder is not None
    assert folder.tags == ["combat", "intense"]


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
    assert sorted(_tags_of("system", system.id)) == ["5e", "fantasy"]


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

    assert sorted(_tags_of("map", m.id)) == ["outdoor", "water"]


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
    assert _tags_of("map", m.id) == ["keep-me"]


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


# ---------------------------------------------------------------------------
# Read-only library: tags.json is additive, catalog owns the display
# ---------------------------------------------------------------------------


def _tag_row(internal: str) -> Tag | None:
    db = SessionLocal()
    try:
        return db.query(Tag).filter_by(internal=internal).first()
    finally:
        db.close()


def test_tags_json_registers_catalog_row_with_entered_casing():
    _, lib = _mk_lib()
    maps_dir = lib / "maps" / "Registrar"
    maps_dir.mkdir(parents=True)
    _write_json(maps_dir / "tags.json", {".": ["Gothic Horror"]})
    _run(lib)

    # A catalog row exists with the entered casing as its display; the folder
    # stores the internal key.
    row = _tag_row("gothic horror")
    assert row is not None and row.display == "Gothic Horror"
    assert _get_map_folder("Registrar").tags == ["gothic horror"]


def test_rescan_does_not_overwrite_edited_display():
    _, lib = _mk_lib()
    maps_dir = lib / "maps" / "Keeper"
    maps_dir.mkdir(parents=True)
    _write_json(maps_dir / "tags.json", {".": ["wetland"]})
    _run(lib)

    # User edits the tag's display casing (same internal key) in the DB.
    db = SessionLocal()
    try:
        tag_service.rename_tag(db, "wetland", "Wetland")  # same key, nicer casing
        db.commit()
    finally:
        db.close()
    # Sanity: display updated, key unchanged.
    assert _tag_row("wetland").display == "Wetland"

    # A later rescan reads tags.json again but must NOT revert the display
    # (tags.json only sets the internal key, never overwrites an existing
    # tag's display).
    _run(lib)
    assert _tag_row("wetland").display == "Wetland"


def test_rescan_does_not_remove_user_added_folder_tags():
    _, lib = _mk_lib()
    maps_dir = lib / "maps" / "Additive"
    maps_dir.mkdir(parents=True)
    _write_json(maps_dir / "tags.json", {".": ["fromjson"]})
    _run(lib)

    # User adds another folder tag via the DB (as the API would).
    db = SessionLocal()
    try:
        folder = db.query(MapFolder).filter_by(path="Additive").first()
        folder.tags = list(folder.tags) + ["byhand"]
        db.commit()
    finally:
        db.close()

    # A rescan re-applies tags.json additively; the user's tag survives.
    _run(lib)
    assert set(_get_map_folder("Additive").tags) == {"fromjson", "byhand"}
