"""Shared-tag domain logic (issue #235).

All tag reads/writes across resources funnel through here so matching is always
by the lowercased ``internal`` key and the display casing stays consistent. A tag
is created the first time an internal key is seen; its display value defaults to
the exact casing first entered and is only changed explicitly (tags page).
"""
from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import (
    RESOURCE_TYPES,
    SHARED_CATEGORY,
    Audio,
    AudioFolder,
    Book,
    BookFolder,
    GenericMap,
    MapFolder,
    ResourceTag,
    Tag,
    Token,
    TokenFolder,
)

# Media folders carry their own JSON ``tags`` (folder tagging is separate from
# shared item tags). Each maps to the item model + resource_type it contains, so
# folder tags can be surfaced in the tags view as tags on those items (issue #235
# follow-up). A folder's ``path`` is collection-relative (e.g. "Swamps") and an
# item lives under it when its ``relative_path`` contains ``/<path>/``.
_FOLDER_SOURCES = [
    (MapFolder, GenericMap, "map"),
    (TokenFolder, Token, "token"),
    (AudioFolder, Audio, "audio"),
]

# Book subcategory folders (issue #235 follow-up) use a different addressing
# scheme than media folders: a ``BookFolder.path`` is
# ``{system_id}/{category}/{subfolder…}`` and a book "lives under" it when its
# ``game_system_id`` + ``category`` match and its own subfolder path is at/below
# that folder's subfolder path. They're resolved separately from
# ``_FOLDER_SOURCES`` but surfaced as ``book``-type folder tags all the same.
_BOOK_RESOURCE_TYPE = "book"


def _book_subfolder_segments(relative_path: str) -> list[str]:
    """The subfolder segments of a book path, i.e. the parts after the category
    dir and before the filename.

    ``relative_path`` is ``books/{SystemName}/{categoryDir}/<a>/<b>/<file>``; the
    subfolder segments are ``[a, b]`` (empty when the book sits directly in the
    category dir).
    """
    parts = (relative_path or "").replace("\\", "/").split("/")
    return parts[3:-1]


def _book_folder_ancestor_paths(system_id: str, category: str, relative_path: str) -> set[str]:
    """Every ``BookFolder.path`` a book belongs to.

    For subfolder segments ``[a, b]`` the book belongs to
    ``{system_id}/{category}/a`` and ``{system_id}/{category}/a/b``. Books with no
    subfolder (directly in the category dir) belong to no book folder.
    """
    segs = _book_subfolder_segments(relative_path)
    prefix = f"{system_id}/{category}"
    return {prefix + "/" + "/".join(segs[: i + 1]) for i in range(len(segs))}


def _book_folder_display(path: str) -> str:
    """Display casing for a book folder: its last path segment (the folder name)."""
    return path.rstrip("/").split("/")[-1] if path else path


def normalize_internal(raw: str) -> str:
    """The match key for a tag: stripped and lowercased."""
    return str(raw).strip().lower()


def default_display(raw: str) -> str:
    """The display value to store for a brand-new tag: the entered text, trimmed.

    We keep the user's own casing rather than force Title Case, so "GM Screen"
    stays "GM Screen". Purely programmatic callers may pass already-cased text.
    """
    return str(raw).strip()


def dedupe_tags(tags: Iterable[str]) -> list[str]:
    """Strip and de-duplicate tags by lowercased key, keeping first-seen casing.

    Used by the tag-accepting request schemas: the display casing is preserved
    here (the service lowercases only the internal match key), so callers must
    NOT lowercase up front.
    """
    seen: set[str] = set()
    result: list[str] = []
    for t in tags or []:
        stripped = str(t).strip()
        key = stripped.lower()
        if key and key not in seen:
            seen.add(key)
            result.append(stripped)
    return result


def tag_dict(tag: Tag) -> dict:
    """Serialise a tag to the API shape used everywhere: {internal, display, category}."""
    return {"internal": tag.internal, "display": tag.display, "category": tag.category}


def get_or_create_tag(
    db: Session,
    raw: str,
    *,
    display: Optional[str] = None,
    category: str = SHARED_CATEGORY,
) -> Optional[Tag]:
    """Return the existing tag for ``raw``'s internal key, creating it if absent.

    Returns ``None`` for blank input. When creating, the display value is
    ``display`` if given, else the entered casing, and ``category`` is the
    resource type it's first used in (defaults to ``shared`` for programmatic
    callers). Matching an existing tag never rewrites its display value; its
    category is promoted to ``shared`` when it's now used in a different category
    (see :func:`_promote_category`).
    """
    internal = normalize_internal(raw)
    if not internal:
        return None
    tag = db.query(Tag).filter(Tag.internal == internal).first()
    if tag is None:
        tag = Tag(
            internal=internal,
            display=(display or default_display(raw)) or internal,
            category=category,
        )
        db.add(tag)
        db.flush()  # assign id without committing; caller owns the transaction
    else:
        _promote_category(tag, category)
    return tag


def register_folder_tags(
    db: Session, raw_tags: Iterable[str], *, category: str = SHARED_CATEGORY
) -> list[str]:
    """Ensure a ``Tag`` catalog row exists for each folder tag, returning the
    de-duplicated **internal** keys to store on the folder record.

    Folder tags are stored on the ``*_folders``/``book_folders`` JSON columns as
    internal keys; their display casing lives in the catalog. A new tag is created
    with its entered casing as the default display; an existing tag keeps its
    display (never overwritten) and may be promoted to ``shared``. Callers own the
    transaction (no commit here).
    """
    seen: set[str] = set()
    internals: list[str] = []
    for raw in raw_tags or []:
        internal = normalize_internal(raw)
        if not internal or internal in seen:
            continue
        seen.add(internal)
        get_or_create_tag(db, raw, category=category)
        internals.append(internal)
    return internals


def upsert_folder_tags(
    db: Session, folder_model: type, path: str, raw_tags: Iterable[str], *, category: str
) -> list[str]:
    """Set a folder record's tags to the given list, registering catalog rows.

    Registers a ``Tag`` catalog row for each tag (see :func:`register_folder_tags`)
    and stores the resulting internal keys on the ``folder_model`` row at ``path``
    (creating it if absent). Returns the stored internal keys. Shared by the
    map/token/audio folder-tag update endpoints; callers own the transaction.
    """
    internals = register_folder_tags(db, raw_tags, category=category)
    folder = db.query(folder_model).filter_by(path=path).first()
    if folder is not None:
        folder.tags = internals
    else:
        db.add(folder_model(path=path, tags=internals))
    return internals


def folder_display_tags(db: Session, internals: Iterable[str]) -> list[str]:
    """Resolve a folder's stored internal keys to display strings for API reads.

    Folder JSON holds internal keys; their display casing comes from the catalog
    (falling back to the key itself when no ``Tag`` row exists yet). Order is
    preserved.
    """
    keys = [normalize_internal(i) for i in (internals or []) if normalize_internal(i)]
    if not keys:
        return []
    catalog = _catalog_display_map(db, set(keys))
    return [catalog.get(k, k) for k in keys]


def _promote_category(tag: Tag, category: str) -> None:
    """Move a tag to ``shared`` if it's used in a category other than its current
    one. A tag stays single-category until it spans a second type (issue #235)."""
    if category == SHARED_CATEGORY or tag.category == SHARED_CATEGORY:
        return
    if tag.category != category:
        tag.category = SHARED_CATEGORY


def folder_types_for_tag(db: Session, internal: str) -> set[str]:
    """The resource types of every media folder whose tags include this key.

    Folder tags live as JSON on the ``*_folders`` tables and never touch a
    ``Tag`` row's stored ``category``, so this is how folder usage is factored
    into a tag's *effective* category (see :func:`effective_category`).
    """
    key = normalize_internal(internal)
    if not key:
        return set()
    types: set[str] = set()
    for folder_model, _item_model, rtype in _FOLDER_SOURCES:
        found = any(
            any(normalize_internal(raw) == key for raw in (f.tags or []))
            for f in db.query(folder_model).all()
        )
        if found:
            types.add(rtype)
    if any(
        any(normalize_internal(raw) == key for raw in (f.tags or []))
        for f in db.query(BookFolder).all()
    ):
        types.add(_BOOK_RESOURCE_TYPE)
    return types


def effective_category(stored: Optional[str], usage_types: Iterable[str]) -> str:
    """Reconcile a tag's stored category with the resource types it's used in.

    ``stored`` is the ``Tag.category`` (or ``None`` for a folder-only tag);
    ``usage_types`` is every resource type the tag actually appears on (direct
    links and/or folder tags). A tag used across more than one type is ``shared``;
    otherwise it's that single type. This makes book (direct) + map-folder usage
    resolve to ``shared`` even though folder tags never promote the stored row.
    """
    types = {t for t in usage_types if t in RESOURCE_TYPES}
    if stored and stored != SHARED_CATEGORY:
        types.add(stored)
    if stored == SHARED_CATEGORY:
        return SHARED_CATEGORY
    if len(types) > 1:
        return SHARED_CATEGORY
    if len(types) == 1:
        return next(iter(types))
    return stored or SHARED_CATEGORY


def set_resource_tags(
    db: Session, resource_type: str, resource_id: str, raw_tags: Iterable[str]
) -> list[dict]:
    """Replace all tags on a resource with the given list, returning the new set.

    Input strings are normalised and de-duplicated by internal key. Tags not in
    the new list are unlinked from this resource (orphaned tag rows are left for
    :func:`prune_orphan_tags` / the tags page to clean up). Order of the returned
    list follows first-seen order of the input.
    """
    if resource_type not in RESOURCE_TYPES:
        raise ValueError(f"Unknown resource_type: {resource_type!r}")

    seen: set[str] = set()
    resolved: list[Tag] = []
    for raw in raw_tags or []:
        internal = normalize_internal(raw)
        if not internal or internal in seen:
            continue
        seen.add(internal)
        # The category this tag is being used in is the resource type; a new tag
        # takes it, an existing one may be promoted to shared.
        tag = get_or_create_tag(db, raw, category=resource_type)
        if tag is not None:
            resolved.append(tag)

    # Remove links no longer present.
    db.query(ResourceTag).filter(
        ResourceTag.resource_type == resource_type,
        ResourceTag.resource_id == resource_id,
    ).delete(synchronize_session=False)

    for tag in resolved:
        db.add(
            ResourceTag(
                tag_id=tag.id,
                resource_type=resource_type,
                resource_id=resource_id,
            )
        )
    db.flush()
    return [tag_dict(t) for t in resolved]


def add_resource_tags(
    db: Session, resource_type: str, resource_id: str, raw_tags: Iterable[str]
) -> list[dict]:
    """Add tags to a resource **without removing** any it already has.

    Used by ``tags.json`` application (the library is read-only, so ``tags.json``
    is an additive input): a new tag creates its catalog row with the entered
    casing; an existing tag keeps its display and is linked if not already. Never
    unlinks. Returns the tags added this call (skipping ones already present).
    """
    if resource_type not in RESOURCE_TYPES:
        raise ValueError(f"Unknown resource_type: {resource_type!r}")

    existing = {
        r.tag_id
        for r in db.query(ResourceTag.tag_id).filter(
            ResourceTag.resource_type == resource_type,
            ResourceTag.resource_id == resource_id,
        )
    }
    seen: set[str] = set()
    added: list[Tag] = []
    for raw in raw_tags or []:
        internal = normalize_internal(raw)
        if not internal or internal in seen:
            continue
        seen.add(internal)
        tag = get_or_create_tag(db, raw, category=resource_type)
        if tag is None or tag.id in existing:
            continue
        db.add(
            ResourceTag(
                tag_id=tag.id,
                resource_type=resource_type,
                resource_id=resource_id,
            )
        )
        existing.add(tag.id)
        added.append(tag)
    db.flush()
    return [tag_dict(t) for t in added]


def sync_tags_from_payload(
    db: Session, resource_type: str, resource_id: str, payload: dict
) -> Optional[list[dict]]:
    """If ``payload`` carries a ``tags`` key, mirror it into the join table.

    Used by resource update handlers that apply a ``model_dump`` payload: they
    still ``setattr`` the legacy JSON column, and this keeps the shared-tag tables
    in lock-step (dual-write during the parallel-run period). Returns the new tag
    list when tags were present, else ``None`` (nothing to do).
    """
    if "tags" not in payload:
        return None
    return set_resource_tags(db, resource_type, resource_id, payload.get("tags") or [])


def tags_for_resource(db: Session, resource_type: str, resource_id: str) -> list[dict]:
    """All tags on one resource, sorted by display value (case-insensitive)."""
    rows = (
        db.query(Tag)
        .join(ResourceTag, ResourceTag.tag_id == Tag.id)
        .filter(
            ResourceTag.resource_type == resource_type,
            ResourceTag.resource_id == resource_id,
        )
        .all()
    )
    rows.sort(key=lambda t: t.display.lower())
    return [tag_dict(t) for t in rows]


def tags_for_resources(
    db: Session, resource_type: str, resource_ids: list[str]
) -> dict[str, list[dict]]:
    """Batch variant of :func:`tags_for_resource`, keyed by resource id.

    Ids with no tags are omitted; callers should default to ``[]``.
    """
    if not resource_ids:
        return {}
    rows = (
        db.query(ResourceTag.resource_id, Tag)
        .join(Tag, ResourceTag.tag_id == Tag.id)
        .filter(
            ResourceTag.resource_type == resource_type,
            ResourceTag.resource_id.in_(resource_ids),
        )
        .all()
    )
    out: dict[str, list[Tag]] = {}
    for rid, tag in rows:
        out.setdefault(rid, []).append(tag)
    result: dict[str, list[dict]] = {}
    for rid, tags in out.items():
        tags.sort(key=lambda t: t.display.lower())
        result[rid] = [tag_dict(t) for t in tags]
    return result


def display_tags_for_resource(db: Session, resource_type: str, resource_id: str) -> list[str]:
    """A resource's tags as display strings, sorted case-insensitively.

    This is the read used by API responses (which expose ``tags`` as a plain
    string list); it sources tags from the shared-tag tables rather than the
    legacy JSON column.
    """
    return [t["display"] for t in tags_for_resource(db, resource_type, resource_id)]


def display_tags_for_resources(
    db: Session, resource_type: str, resource_ids: list[str]
) -> dict[str, list[str]]:
    """Batch variant of :func:`display_tags_for_resource`, keyed by resource id.

    Every requested id is present in the result (empty list when untagged), so
    callers can index directly without a fallback.
    """
    enriched = tags_for_resources(db, resource_type, resource_ids)
    return {rid: [t["display"] for t in enriched.get(rid, [])] for rid in resource_ids}


def resources_for_tag(
    db: Session, internal: str, *, resource_type: Optional[str] = None
) -> list[dict]:
    """Every resource carrying the tag with the given internal key.

    Returns ``[{resource_type, resource_id}]``; optionally filtered to one type.
    """
    tag = db.query(Tag).filter(Tag.internal == normalize_internal(internal)).first()
    if tag is None:
        return []
    q = db.query(ResourceTag).filter(ResourceTag.tag_id == tag.id)
    if resource_type is not None:
        q = q.filter(ResourceTag.resource_type == resource_type)
    return [
        {"resource_type": r.resource_type, "resource_id": r.resource_id}
        for r in q.all()
    ]


def tags_in_use(db: Session, resource_type: Optional[str] = None) -> list[dict]:
    """Tags that are attached to at least one resource, with a usage count.

    Scoped to ``resource_type`` when given (issue #235.3: only show tags used on
    the current page). Sorted by display value. Each entry adds ``count``.
    """
    q = (
        db.query(Tag, func.count(ResourceTag.id).label("count"))
        .join(ResourceTag, ResourceTag.tag_id == Tag.id)
    )
    if resource_type is not None:
        q = q.filter(ResourceTag.resource_type == resource_type)
    q = q.group_by(Tag.id)
    rows = q.all()
    rows.sort(key=lambda row: row[0].display.lower())
    return [{**tag_dict(tag), "count": count} for tag, count in rows]


def _ancestor_folder_paths(relative_path: str) -> set[str]:
    """Every folder path (collection-relative) an item lives under.

    ``relative_path`` is ``<collection>/<a>/<b>/<file>``; the item belongs to
    folders ``a`` and ``a/b`` (folder table paths are collection-relative). This
    mirrors the ``/<path>/`` containment used elsewhere but computed in Python so
    the whole set can be resolved from one item scan (no per-folder LIKE query).
    """
    parts = (relative_path or "").replace("\\", "/").split("/")
    segs = parts[1:-1]  # drop collection prefix and filename
    return {"/".join(segs[: i + 1]) for i in range(len(segs))}


def _catalog_display_map(db: Session, internals: set[str]) -> dict[str, str]:
    """Map internal keys → the ``Tag`` catalog's display casing, for keys present.

    Folder tags store internal keys; their display comes from the catalog so a
    rename on the tags page (which updates the ``Tag`` row) is reflected in
    folder-derived listings and a ``tags.json`` rescan can't revert it.
    """
    if not internals:
        return {}
    return {
        t.internal: t.display
        for t in db.query(Tag).filter(Tag.internal.in_(internals)).all()
    }


def folder_tags_in_use(
    db: Session, resource_type: Optional[str] = None
) -> dict[str, dict]:
    """Folder-derived tags keyed by internal, with display + a de-duplicated set
    of the item refs they cover.

    Folder tags live as plain JSON on the ``*_folders`` tables and are not part of
    the shared-tag tables, but the media galleries treat them as tags on the items
    inside the folder. This resolves them the same way so the tags view can list
    them and show their items. Scoped to ``resource_type`` when given.

    Returns ``{internal: {"display": str, "refs": [{resource_type, resource_id}]}}``.
    The display is the first-seen casing across folders. Resolves everything from
    two bulk queries per type (all folders + all item id/paths) rather than a LIKE
    per folder, so the tags listing stays fast as libraries grow.
    """
    out: dict[str, dict] = {}
    for folder_model, item_model, rtype in _FOLDER_SOURCES:
        if resource_type is not None and rtype != resource_type:
            continue

        # folder path -> its tag list (skip untagged folders).
        folder_tags: dict[str, list] = {
            f.path: f.tags for f in db.query(folder_model).all() if f.tags
        }
        if not folder_tags:
            continue

        # For each item, attach its folders' tags via the item's ancestor paths.
        for item_id, rel in db.query(item_model.id, item_model.relative_path).all():
            ancestors = _ancestor_folder_paths(rel)
            if not ancestors:
                continue
            for path in ancestors & folder_tags.keys():
                for raw in folder_tags[path]:
                    internal = normalize_internal(raw)
                    if not internal:
                        continue
                    entry = out.setdefault(
                        internal, {"display": default_display(raw) or internal, "refs": {}}
                    )
                    entry["refs"][(rtype, item_id)] = {
                        "resource_type": rtype,
                        "resource_id": item_id,
                    }

    # Book subcategory folders (distinct addressing — see _BOOK_RESOURCE_TYPE).
    if resource_type is None or resource_type == _BOOK_RESOURCE_TYPE:
        book_folder_tags = {f.path: f.tags for f in db.query(BookFolder).all() if f.tags}
        if book_folder_tags:
            books = db.query(
                Book.id, Book.game_system_id, Book.category, Book.relative_path
            ).all()
            for book_id, sys_id, category, rel in books:
                ancestors = _book_folder_ancestor_paths(sys_id or "", category or "", rel)
                for path in ancestors & book_folder_tags.keys():
                    for raw in book_folder_tags[path]:
                        internal = normalize_internal(raw)
                        if not internal:
                            continue
                        entry = out.setdefault(
                            internal, {"display": default_display(raw) or internal, "refs": {}}
                        )
                        entry["refs"][(_BOOK_RESOURCE_TYPE, book_id)] = {
                            "resource_type": _BOOK_RESOURCE_TYPE,
                            "resource_id": book_id,
                        }

    # The catalog is authoritative for display casing (a rename updates the Tag
    # row); fall back to the JSON-derived default for keys with no Tag row yet.
    catalog = _catalog_display_map(db, set(out.keys()))
    return {
        internal: {
            "display": catalog.get(internal, v["display"]),
            "refs": list(v["refs"].values()),
        }
        for internal, v in out.items()
    }


def folders_for_tag(
    db: Session, internal: str, *, resource_type: Optional[str] = None
) -> list[dict]:
    """Folders carrying the given tag, each with the item refs they contain.

    Used by the tags view to show a folder tag as a folder group (like the media
    pages) listing everything inside the folder — even items that don't carry the
    tag themselves. Returns
    ``[{resource_type, path, items: [{resource_type, resource_id}]}]``, sorted by
    (resource_type, path).
    """
    key = normalize_internal(internal)
    result: list[dict] = []
    for folder_model, item_model, rtype in _FOLDER_SOURCES:
        if resource_type is not None and rtype != resource_type:
            continue
        # Folders whose tags include this key.
        paths = [
            f.path
            for f in db.query(folder_model).all()
            if any(normalize_internal(raw) == key for raw in (f.tags or []))
        ]
        if not paths:
            continue
        path_set = set(paths)
        # Bucket items into the matching folders via their ancestor paths.
        buckets: dict[str, list] = {p: [] for p in paths}
        for item_id, rel in db.query(item_model.id, item_model.relative_path).all():
            for p in _ancestor_folder_paths(rel) & path_set:
                buckets[p].append({"resource_type": rtype, "resource_id": item_id})
        for p in paths:
            result.append({"resource_type": rtype, "path": p, "items": buckets[p]})

    # Book subcategory folders (distinct addressing — see _BOOK_RESOURCE_TYPE).
    if resource_type is None or resource_type == _BOOK_RESOURCE_TYPE:
        book_paths = [
            f.path
            for f in db.query(BookFolder).all()
            if any(normalize_internal(raw) == key for raw in (f.tags or []))
        ]
        if book_paths:
            path_set = set(book_paths)
            buckets = {p: [] for p in book_paths}
            books = db.query(
                Book.id, Book.game_system_id, Book.category, Book.relative_path
            ).all()
            for book_id, sys_id, category, rel in books:
                ancestors = _book_folder_ancestor_paths(sys_id or "", category or "", rel)
                for p in ancestors & path_set:
                    buckets[p].append(
                        {"resource_type": _BOOK_RESOURCE_TYPE, "resource_id": book_id}
                    )
            for p in book_paths:
                # Show only the subfolder hierarchy (drop the system_id/category
                # prefix), so the folder title reads like the media pages.
                display_path = "/".join(p.split("/")[2:]) or _book_folder_display(p)
                result.append(
                    {"resource_type": _BOOK_RESOURCE_TYPE, "path": display_path, "items": buckets[p]}
                )
    result.sort(key=lambda f: (f["resource_type"], f["path"].lower()))
    return result


def remove_tag_from_folders(db: Session, internal: str) -> int:
    """Strip the tag with the given internal key from every media folder's JSON
    ``tags`` list. Returns the number of folder rows changed.

    A rescan may reapply the tag from ``tags.json``; that's expected. Callers own
    the transaction (no commit here).
    """
    key = normalize_internal(internal)
    changed = 0
    folder_models = [m for m, _i, _r in _FOLDER_SOURCES] + [BookFolder]
    for folder_model in folder_models:
        for folder in db.query(folder_model).all():
            tags = folder.tags or []
            kept = [raw for raw in tags if normalize_internal(raw) != key]
            if len(kept) != len(tags):
                folder.tags = kept
                changed += 1
    return changed


def tags_meta_for_internals(db: Session, internals: list[str]) -> dict[str, dict]:
    """Resolve tag internal keys to ``{internal, display, count}`` metadata.

    Used to enrich favorited tags. ``count`` is the number of distinct items the
    tag covers (shared links + folder-derived), matching the tags-view total.
    A favorited tag that no longer exists anywhere is omitted from the result.
    """
    keys = {normalize_internal(i) for i in internals if normalize_internal(i)}
    if not keys:
        return {}

    # Shared tags matching the keys, with their direct link counts.
    shared = {
        t.internal: {"internal": t.internal, "display": t.display, "id": t.id}
        for t in db.query(Tag).filter(Tag.internal.in_(keys)).all()
    }
    link_counts: dict[str, int] = {}
    if shared:
        ids = [v["id"] for v in shared.values()]
        rows = (
            db.query(ResourceTag.tag_id, func.count(func.distinct(ResourceTag.resource_id)))
            .filter(ResourceTag.tag_id.in_(ids))
            .group_by(ResourceTag.tag_id)
            .all()
        )
        id_to_internal = {v["id"]: k for k, v in shared.items()}
        for tag_id, cnt in rows:
            link_counts[id_to_internal[tag_id]] = cnt

    # Folder-derived coverage for the same keys.
    folder = folder_tags_in_use(db)

    out: dict[str, dict] = {}
    for key in keys:
        display = None
        count = link_counts.get(key, 0)
        if key in shared:
            display = shared[key]["display"]
        if key in folder:
            display = display or folder[key]["display"]
            count += len(folder[key]["refs"])  # upper bound; folder ∪ shared rarely overlap
        if display is not None:
            out[key] = {"internal": key, "display": display, "count": count}
    return out


def rename_tag(db: Session, internal: str, new_display: str) -> Optional[Tag]:
    """Rename a tag's display value, re-keying its ``internal`` when the new
    display normalizes to a different key (e.g. fixing a typo ``freinds`` →
    ``friends`` so search-by-internal finds it).

    If another tag already owns the new internal key, this tag is merged into it
    (links re-pointed, folder JSON entries rewritten, source row deleted) and the
    surviving tag is returned. Otherwise the same row is updated in place.

    A **folder-only** tag (no ``Tag`` row yet — it exists only in folder JSON) is
    materialised into a catalog row first, so its new display is stored in the DB
    and a ``tags.json`` rescan can't revert it (the library is read-only). Returns
    ``None`` only if ``internal`` resolves to nothing at all. Callers own the
    transaction.
    """
    key = normalize_internal(internal)
    src = db.query(Tag).filter(Tag.internal == key).first()
    if src is None:
        # Folder-only tag: create its catalog row so the rename can persist.
        folder_types = folder_types_for_tag(db, key)
        if not folder_types:
            return None
        category = next(iter(folder_types)) if len(folder_types) == 1 else SHARED_CATEGORY
        src = get_or_create_tag(db, key, category=category)
        if src is None:
            return None
    display = default_display(new_display)
    if not display:
        return src
    new_internal = normalize_internal(display)

    # Same key → just update the display casing (the common rename).
    if new_internal == src.internal:
        src.display = display
        db.flush()
        return src

    # Key changes: fold any media-folder JSON entries onto the new key so folder
    # tags follow the rename too.
    _rekey_folder_tags(db, src.internal, display)

    existing = db.query(Tag).filter(Tag.internal == new_internal).first()
    if existing is None or existing.id == src.id:
        src.internal = new_internal
        src.display = display
        db.flush()
        return src

    # Collision: merge src → existing (re-point links, drop dupes, delete src).
    existing.display = display
    _promote_category(existing, src.category)
    dst_links = {
        (r.resource_type, r.resource_id)
        for r in db.query(ResourceTag).filter(ResourceTag.tag_id == existing.id)
    }
    for link in db.query(ResourceTag).filter(ResourceTag.tag_id == src.id).all():
        if (link.resource_type, link.resource_id) in dst_links:
            db.delete(link)
        else:
            link.tag_id = existing.id
    db.query(Tag).filter(Tag.id == src.id).delete(synchronize_session=False)
    db.flush()
    return existing


def _rekey_folder_tags(db: Session, old_internal: str, new_display: str) -> None:
    """Rewrite media-folder JSON tag entries matching ``old_internal`` to the new
    tag's internal key (folders store internal keys; display lives in the
    catalog), de-duplicating by key within each folder."""
    old_key = normalize_internal(old_internal)
    new_key = normalize_internal(new_display)
    folder_models = [m for m, _i, _r in _FOLDER_SOURCES] + [BookFolder]
    for folder_model in folder_models:
        for folder in db.query(folder_model).all():
            tags = folder.tags or []
            if not any(normalize_internal(raw) == old_key for raw in tags):
                continue
            rebuilt: list[str] = []
            seen: set[str] = set()
            for raw in tags:
                key = new_key if normalize_internal(raw) == old_key else normalize_internal(raw)
                if not key or key in seen:
                    continue
                seen.add(key)
                rebuilt.append(key)
            folder.tags = rebuilt


def prune_orphan_tags(db: Session) -> int:
    """Delete tags with no remaining resource links. Returns the count removed."""
    orphans = (
        db.query(Tag.id)
        .outerjoin(ResourceTag, ResourceTag.tag_id == Tag.id)
        .filter(ResourceTag.id.is_(None))
        .all()
    )
    ids = [row[0] for row in orphans]
    if ids:
        db.query(Tag).filter(Tag.id.in_(ids)).delete(synchronize_session=False)
    return len(ids)
