"""Loading content packs from disk into the catalog tables.

A pack is a directory under ``DATA_PATH/character-content/``:

    character-content/
    └── dnd-5e-srd/
        ├── _meta.json     ← pack id, the schema it supplies, licence, source
        ├── spells.json    ← an array of entries
        └── classes.json

Each content file is named after the content type it carries, and holds an array
of entries. Every entry needs an ``_id``; ``_source`` defaults to the pack's own
id, so a hand-written pack does not have to repeat it on every entry.

The directory is the source of truth. Rows in ``content_packs`` /
``content_entries`` are a denormalised index of it, rebuilt whenever the files
change, which is why loading a pack replaces its entries wholesale rather than
trying to diff them: a pack is small enough that a rebuild is cheaper than
reconciliation, and it cannot drift.

Nothing here executes pack content. An entry is data, validated against the
schema's declared shape for its content type and stored as JSON.
"""
import json
import logging
import os
from typing import Any, Iterator, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from ... import config
from ...models import ContentEntry, ContentPack
from .schema import SchemaError, coerce_value

logger = logging.getLogger("grimoire.characters.packs")

__all__ = [
    "PackError",
    "CONTENT_DIR",
    "load_pack",
    "load_all_packs",
    "discover_packs",
    "reindex_entry_search",
    "schema_documents_for_packs",
    "sync_packs",
]


class PackError(ValueError):
    """A content pack could not be read or is not valid."""


#: Packs are server-wide, so they sit beside add-ons rather than in the library.
CONTENT_DIR = os.path.join(config.DATA_PATH, "character-content")

META_FILE = "_meta.json"

#: A pack is authored JSON, not a database. These bound what one import can do
#: to memory and to the catalog.
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_ENTRIES_PER_TYPE = 20000


def discover_packs(root: Optional[str] = None) -> list[str]:
    """Every pack directory, as absolute paths."""
    base = root or CONTENT_DIR
    if not os.path.isdir(base):
        return []
    found = []
    for name in sorted(os.listdir(base)):
        if name.startswith("."):
            continue
        directory = os.path.join(base, name)
        if os.path.isfile(os.path.join(directory, META_FILE)):
            found.append(directory)
    return found


def _read_json(path: str) -> Any:
    if os.path.getsize(path) > MAX_FILE_BYTES:
        raise PackError(f"{os.path.basename(path)} exceeds {MAX_FILE_BYTES} bytes")
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as exc:
        raise PackError(f"{os.path.basename(path)} is not valid JSON: {exc}") from exc
    except OSError as exc:
        raise PackError(f"{os.path.basename(path)} could not be read: {exc}") from exc


def _content_files(directory: str) -> Iterator[tuple[str, str]]:
    """Every (content_type, path) pair in a pack, excluding the metadata file."""
    for name in sorted(os.listdir(directory)):
        if not name.endswith(".json") or name == META_FILE or name.startswith("."):
            continue
        yield name[: -len(".json")], os.path.join(directory, name)


def _entry_text(entry: dict, content_type: dict) -> str:
    """The searchable text of an entry, per its type's ``search_fields``.

    A type that names none falls back to every string value, because a catalog
    you cannot search is barely a catalog — better to over-index than to ship
    entries nobody can find.
    """
    names = content_type.get("search_fields")
    if isinstance(names, list) and names:
        values = [entry.get(name) for name in names]
    else:
        values = list(entry.values())

    parts = []
    for value in values:
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            parts.append(str(value))
        elif isinstance(value, list):
            parts.extend(str(item) for item in value if isinstance(item, (str, int, float)))
    return " ".join(parts)


def load_pack(
    db: Session, directory: str, *, schema_document: Optional[dict] = None
) -> ContentPack:
    """Load one pack directory into the catalog, replacing what it had before.

    ``schema_document`` is the validated character schema whose ``content_types``
    describe the entries. Without one the entries are stored as authored — a
    pack may legitimately be installed before anyone has installed the matching
    sheet, and refusing it then would make install order matter.
    """
    meta_path = os.path.join(directory, META_FILE)
    if not os.path.isfile(meta_path):
        raise PackError(f"{directory} has no {META_FILE}")

    meta = _read_json(meta_path)
    if not isinstance(meta, dict):
        raise PackError(f"{META_FILE} must be an object")

    pack_id = meta.get("pack_id")
    schema_id = meta.get("schema_id")
    if not isinstance(pack_id, str) or not pack_id.strip():
        raise PackError(f"{META_FILE} needs a 'pack_id'")
    if not isinstance(schema_id, str) or not schema_id.strip():
        raise PackError(f"{META_FILE} needs a 'schema_id' naming the sheet it supplies")

    # Licensed content must credit its source, the same rule the community
    # repository enforces on the way in.
    if meta.get("license") and not meta.get("attribution"):
        raise PackError(
            f"{META_FILE} sets a 'license' but no 'attribution' — licensed "
            "content must carry the credit Grimoire displays"
        )

    pack = db.query(ContentPack).filter_by(pack_id=pack_id).first()
    if not pack:
        pack = ContentPack(pack_id=pack_id)
        db.add(pack)

    pack.schema_id = schema_id
    pack.name = str(meta.get("name") or pack_id)[:200]
    pack.version = str(meta.get("version") or "1.0.0")[:20]
    pack.description = str(meta.get("description") or "")
    pack.license = str(meta.get("license") or "")[:200]
    pack.license_url = str(meta.get("license_url") or "")
    pack.attribution = str(meta.get("attribution") or "")
    pack.source_url = str(meta.get("source_url") or "")
    pack.directory = os.path.basename(directory)
    db.flush()

    # The directory is the source of truth, so its entries are replaced whole.
    # Cheaper than reconciling, and it cannot drift from the files.
    db.query(ContentEntry).filter_by(pack_id=pack.id).delete(synchronize_session=False)

    content_types = (schema_document or {}).get("content_types") or {}
    default_source = str(meta.get("source") or pack_id)
    total = 0

    for content_type, path in _content_files(directory):
        entries = _read_json(path)
        if not isinstance(entries, list):
            raise PackError(f"{content_type}.json must be an array of entries")
        if len(entries) > MAX_ENTRIES_PER_TYPE:
            raise PackError(
                f"{content_type}.json has more than {MAX_ENTRIES_PER_TYPE} entries"
            )

        type_definition = content_types.get(content_type) or {}
        identity = type_definition.get("identity_field", "name")
        declared = type_definition.get("fields") or {}

        seen: set[str] = set()
        for index, entry in enumerate(entries):
            if not isinstance(entry, dict):
                raise PackError(f"{content_type}.json entry {index} is not an object")
            entry_id = entry.get("_id")
            if not isinstance(entry_id, str) or not entry_id.strip():
                raise PackError(f"{content_type}.json entry {index} has no '_id'")
            entry_id = entry_id.strip()
            if entry_id in seen:
                raise PackError(f"{content_type}.json defines {entry_id!r} twice")
            seen.add(entry_id)

            source = str(entry.get("_source") or default_source)
            data = _clean_entry(entry, declared)

            db.add(
                ContentEntry(
                    pack_id=pack.id,
                    schema_id=schema_id,
                    content_type=content_type,
                    entry_id=entry_id,
                    source=source,
                    name=str(data.get(identity) or entry_id)[:500],
                    data=data,
                )
            )
            total += 1

    pack.entry_count = total
    db.flush()
    logger.info("Loaded content pack %s: %d entr%s", pack_id, total,
                "y" if total == 1 else "ies")
    return pack


def _clean_entry(entry: dict, declared: dict) -> dict:
    """Coerce an entry against its content type's declared fields.

    With no declaration — a pack installed before its sheet — the entry is kept
    as authored, minus the private keys. Coercing it later, once the sheet is
    installed, is a rescan away.
    """
    private = {"_id", "_source"}
    if not declared:
        return {key: value for key, value in entry.items() if key not in private}

    data = {}
    for key, definition in declared.items():
        if key in entry:
            data[key] = coerce_value(definition, entry[key])
    # Keep `_tags` if present: the catalog filters on them and they are not a
    # declared field.
    if isinstance(entry.get("_tags"), list):
        data["_tags"] = [str(tag) for tag in entry["_tags"]]
    return data


def reindex_entry_search(
    db: Session, pack: ContentPack, schema_document: Optional[dict]
) -> None:
    """Rebuild the FTS rows for one pack's entries.

    FTS5 has no foreign keys, so the old rows are cleared by hand. They are
    keyed on the *pack*, not on the entries it currently owns: ``load_pack``
    replaces its entries wholesale, so by the time this runs the previous rows
    point at ids that no longer exist and deleting by entry would leave every
    one of them behind. Clearing by pack also leaves other packs serving the
    same schema untouched.
    """
    content_types = (schema_document or {}).get("content_types") or {}
    rows = db.query(ContentEntry).filter_by(pack_id=pack.id).all()

    db.execute(
        text("DELETE FROM content_search WHERE pack_row = :pack_row"),
        {"pack_row": pack.id},
    )

    for row in rows:
        definition = content_types.get(row.content_type) or {}
        db.execute(
            text(
                "INSERT INTO content_search "
                "(entry_row, pack_row, schema_id, content_type, name, body) "
                "VALUES (:entry_row, :pack_row, :schema_id, :content_type, :name, :body)"
            ),
            {
                "entry_row": row.id,
                "pack_row": pack.id,
                "schema_id": row.schema_id,
                "content_type": row.content_type,
                "name": row.name,
                "body": _entry_text(row.data or {}, definition),
            },
        )


def load_all_packs(db: Session, *, root: Optional[str] = None,
                   schemas: Optional[dict] = None) -> list[ContentPack]:
    """Load every installed pack, skipping (and logging) any that will not read.

    One bad pack must not stop the others loading: a server with a malformed
    directory should still serve the catalogs that are fine.
    """
    loaded = []
    for directory in discover_packs(root):
        try:
            document = (schemas or {}).get(_peek_schema_id(directory))
            pack = load_pack(db, directory, schema_document=document)
            reindex_entry_search(db, pack, document)
            loaded.append(pack)
        except PackError as exc:
            logger.warning("Skipping content pack %s: %s", os.path.basename(directory), exc)
        except SchemaError as exc:
            logger.warning("Content pack %s does not match its schema: %s",
                           os.path.basename(directory), exc)
    if loaded:
        db.commit()
    return loaded


def _peek_schema_id(directory: str) -> str:
    """The schema a pack names, read without loading the whole pack."""
    try:
        meta = _read_json(os.path.join(directory, META_FILE))
        return str(meta.get("schema_id") or "") if isinstance(meta, dict) else ""
    except PackError:
        return ""


def schema_documents_for_packs(db: Session) -> dict:
    """The best available schema document for each schema id a pack names.

    Packs are server-wide but schemas are per user, so there is no single
    canonical document to validate against. Any installed copy describes the
    content types well enough to index by — they are the same sheet — so the
    first one that validates is used, and a schema nobody has installed yields
    nothing, which stores its pack's entries as authored.
    """
    from ...models import CharacterSchema
    from .schema import validate_schema

    wanted = {pack.schema_id for pack in db.query(ContentPack).all()}
    wanted |= {
        _peek_schema_id(directory) for directory in discover_packs()
    }
    wanted.discard("")

    documents: dict[str, dict] = {}
    for schema_id in wanted:
        rows = db.query(CharacterSchema).filter_by(schema_id=schema_id).all()
        for row in rows:
            try:
                documents[schema_id] = validate_schema(row.document or {})
                break
            except SchemaError:
                continue
    return documents


def sync_packs(db: Session) -> list[ContentPack]:
    """Load every installed pack, and drop rows for packs removed from disk.

    Called at startup and on rescan. The directory is the source of truth, so a
    pack whose directory is gone loses its rows — characters referencing its
    entries are unaffected, since a reference is soft and resolves to a
    "missing" marker the sheet can explain.
    """
    present = {os.path.basename(directory) for directory in discover_packs()}
    removed = [
        pack
        for pack in db.query(ContentPack).all()
        if pack.directory and pack.directory not in present
    ]
    for pack in removed:
        db.execute(
            text("DELETE FROM content_search WHERE pack_row = :pack_row"),
            {"pack_row": pack.id},
        )
        db.delete(pack)
        logger.info("Content pack %s was removed from disk", pack.pack_id)
    if removed:
        db.commit()

    return load_all_packs(db, schemas=schema_documents_for_packs(db))
