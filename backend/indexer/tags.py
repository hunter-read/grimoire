"""``tags.json`` folder-tag application across the library tree.

A ``tags.json`` file in a media folder (maps/tokens/audio) or a book system dir
maps relative keys to tag lists; on every scan those tags are (re)applied to the
matching folder/file/system records. Split out of ``scan.py`` (issue #152).
"""
import os
import json
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from ..models import (
    Audio,
    AudioFolder,
    GameSystem,
    GenericMap,
    MapFolder,
    Token,
    TokenFolder,
)
from ..services import tag_service
from .categories import slugify
from .metadata import resolve_collection_dir

logger = logging.getLogger("grimoire.indexer")


def _load_tags_json(folder_path: str) -> dict:
    """Read and parse tags.json from folder_path.

    Returns a dict mapping relative keys to tag lists.  Returns {} on any
    error or if the file does not exist.
    """
    tags_file = Path(folder_path) / "tags.json"
    if not tags_file.exists():
        return {}
    try:
        raw = json.loads(tags_file.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            logger.warning(f"tags.json at {folder_path} must be a JSON object — skipped")
            return {}
        result = {}
        for key, val in raw.items():
            if isinstance(val, list):
                seen: set[str] = set()
                normalized = []
                for t in val:
                    lowered = str(t).strip().lower()
                    if lowered and lowered not in seen:
                        seen.add(lowered)
                        normalized.append(lowered)
                result[key] = normalized
        return result
    except Exception as exc:
        logger.warning(f"tags.json at {folder_path} could not be parsed: {exc}")
        return {}


def _within_scope(path: Path, scope_dir: Path | None) -> bool:
    """Return True if `path` is the scope dir or lives under it (or scope is None)."""
    if scope_dir is None:
        return True
    try:
        return path == scope_dir or scope_dir in path.parents
    except Exception:
        return False


def _apply_tags_from_library(
    library_path: str, session: Session, scope_dir: Path | None = None
) -> None:
    """Apply tags declared in tags.json files throughout the library tree.

    When `scope_dir` is given, only tags.json files within that subtree are applied.
    """
    library = Path(library_path)

    _section_models = {
        "maps": (MapFolder, GenericMap),
        "tokens": (TokenFolder, Token),
        "audio": (AudioFolder, Audio),
    }
    # Section name → shared-tag resource_type (issue #235).
    _section_resource = {"maps": "map", "tokens": "token", "audio": "audio"}
    for section in ("maps", "tokens", "audio"):
        section_dir = resolve_collection_dir(library, section)
        if not section_dir.exists():
            continue
        # Skip sections the scope doesn't touch (scope under section, or == section).
        if scope_dir is not None and not _within_scope(scope_dir, section_dir):
            continue

        folder_model, file_model = _section_models[section]

        for root, dirs, files in os.walk(section_dir):
            dirs[:] = [d for d in dirs if not d.startswith(".")]

            if not _within_scope(Path(root), scope_dir):
                continue

            if "tags.json" not in files:
                continue

            tag_map = _load_tags_json(root)
            if not tag_map:
                continue

            root_path = Path(root)

            for key, tags in tag_map.items():
                if not tags:
                    continue

                if key == ".":
                    folder_rel = str(os.path.relpath(root, section_dir))
                    record = session.query(folder_model).filter_by(path=folder_rel).first()
                    if record:
                        record.tags = tags
                    else:
                        session.add(folder_model(path=folder_rel, tags=tags))
                    logger.debug(f"tags.json: folder {folder_rel} ← {tags}")
                else:
                    target = root_path / key
                    if target.is_dir():
                        folder_rel = str(os.path.relpath(target, section_dir))
                        record = session.query(folder_model).filter_by(path=folder_rel).first()
                        if record:
                            record.tags = tags
                        else:
                            session.add(folder_model(path=folder_rel, tags=tags))
                        logger.debug(f"tags.json: folder {folder_rel} ← {tags}")
                    else:
                        file_rel = os.path.relpath(target, library_path)
                        record = session.query(file_model).filter_by(relative_path=file_rel).first()
                        if record:
                            # Item tags live in the shared-tag tables (issue #235).
                            tag_service.set_resource_tags(
                                session, _section_resource[section], record.id, tags
                            )
                            logger.debug(f"tags.json: file {file_rel} ← {tags}")
                        else:
                            logger.debug(f"tags.json: no record found for {file_rel}")

    # --- books/ section (system-level tags only) ---
    books_dir = resolve_collection_dir(library, "books")
    if books_dir.exists() and (scope_dir is None or _within_scope(scope_dir, books_dir)):
        for system_dir in sorted(books_dir.iterdir()):
            if not system_dir.is_dir() or system_dir.name.startswith("."):
                continue
            # System-level tags only matter when the scope includes this system dir.
            if scope_dir is not None and not _within_scope(scope_dir, system_dir):
                continue

            tag_map = _load_tags_json(str(system_dir))
            if not tag_map or "." not in tag_map:
                continue

            tags = tag_map["."]
            if not tags:
                continue

            system_slug = slugify(system_dir.name)
            system = session.query(GameSystem).filter_by(slug=system_slug).first()
            if system:
                tag_service.set_resource_tags(session, "system", system.id, tags)
                logger.debug(f"tags.json: system {system_dir.name} ← {tags}")

    session.commit()
