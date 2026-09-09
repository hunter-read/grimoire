"""Archive-streaming helpers and file-resolution logic for the downloads router."""
import io
import os
import tarfile
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from ...models import Model3D, Audio, Book, GameSystem, GenericMap, Token, User
from ...models.collections import COLLECTIONS
from ...services import access_control, tag_service


_FORMATS = {
    "zip":     {"ext": ".zip",     "mime": "application/zip"},
    "tar":     {"ext": ".tar",     "mime": "application/x-tar"},
    "tar.gz":  {"ext": ".tar.gz",  "mime": "application/gzip"},
    "tar.bz2": {"ext": ".tar.bz2", "mime": "application/x-bzip2"},
}

_ZIP_STORED_EXTS = {
    ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif",
    # Already-compressed archive payloads — re-deflating them wastes CPU.
    ".zip", ".cbz", ".rar", ".cbr", ".7z", ".cb7",
    ".tar", ".cbt", ".gz", ".tgz", ".bz2", ".tbz2",
}
_WIN_ILLEGAL = set(':*?"<>|\\')


def _safe_filepath(raw: str) -> Optional[str]:
    """
    Resolve *raw* to an absolute path and verify it is inside the library root.
    Returns the resolved path string on success, None if the path escapes the
    library root (path-traversal guard) or does not point to a regular file.

    Reads ``_LIBRARY_ROOT`` from the package each call so tests can patch it.
    """
    from . import _LIBRARY_ROOT

    try:
        resolved = Path(raw).resolve()
    except (TypeError, ValueError):
        return None
    if _LIBRARY_ROOT not in resolved.parents and resolved != _LIBRARY_ROOT:
        return None
    if not resolved.is_file():
        return None
    return str(resolved)


def _visible(db, q, user):
    """Drop the books ``user`` may not see from an archive query (issue #258).

    A bulk download is the easiest way to walk out with a restricted book, so
    every book-bearing archive builder routes its query through here. ``user`` is
    optional only so the builders stay directly callable from tests; a None user
    means "no filtering", which is why the *routers* always pass one.
    """
    if user is None:
        return q
    return access_control.visible_books(db, q, user)


def _can_see_explicit(db, user_id: str) -> bool:
    user = db.query(User).filter_by(id=user_id).first()
    return bool(user.allow_explicit) if user and user.allow_explicit is not None else True


def _stream_zip(files: list[tuple[str, str]]):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", allowZip64=True) as zf:
        for filepath, arcname in files:
            ext = Path(filepath).suffix.lower()
            compress = zipfile.ZIP_STORED if ext in _ZIP_STORED_EXTS else zipfile.ZIP_DEFLATED
            zf.write(filepath, arcname=arcname, compress_type=compress)
    buf.seek(0)
    yield from iter(lambda: buf.read(65536), b"")


def _stream_tar(files: list[tuple[str, str]], mode: str):
    """mode is one of: 'w' (uncompressed), 'w:gz', 'w:bz2'"""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode=mode) as tf:
        for filepath, arcname in files:
            tf.add(filepath, arcname=arcname)
    buf.seek(0)
    yield from iter(lambda: buf.read(65536), b"")


def _archive_response(
    files: list[tuple[str, str]],
    base_name: str,
    fmt: str,
) -> StreamingResponse:
    if not files:
        raise HTTPException(404, "No files found for the requested scope")
    if fmt not in _FORMATS:
        raise HTTPException(400, f"Unsupported format: {fmt!r}. Choose from: {', '.join(_FORMATS)}")

    info = _FORMATS[fmt]
    filename = base_name + info["ext"]

    if fmt == "zip":
        body = _stream_zip(files)
    elif fmt == "tar":
        body = _stream_tar(files, "w")
    elif fmt == "tar.gz":
        body = _stream_tar(files, "w:gz")
    elif fmt == "tar.bz2":
        body = _stream_tar(files, "w:bz2")

    return StreamingResponse(
        body,
        media_type=info["mime"],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _safe_name(s: str) -> str:
    """Sanitise a string for use as the archive's outer filename."""
    return s.replace(" ", "_").replace("/", "_")


def _safe_arcname(arcname: str) -> str:
    """
    Make a ZIP/tar entry path safe to extract on Windows, macOS, and Linux.

    Rules applied per path component:
    - Replace Windows-illegal characters  \\ : * ? " < > |  with '_'
    - Collapse any run of path separators and strip leading '/'
    - Strip leading/trailing dots and spaces from each component
      (Windows silently drops them; stripping avoids surprises)
    - Skip empty components that would create double-slashes
    - Clamp to 255 bytes per component (ext4 / APFS / NTFS limit)
    """
    arcname = arcname.replace("\\", "/")

    cleaned_parts = []
    for part in arcname.split("/"):
        if not part:
            continue

        part = "".join("_" if c in _WIN_ILLEGAL else c for c in part)

        part = part.strip(". ")
        if not part:
            part = "_"

        while len(part.encode("utf-8")) > 255:
            part = part[:-1]
        cleaned_parts.append(part)

    return "/".join(cleaned_parts) if cleaned_parts else "_"


# Bulk downloads deliberately include variants. A "download this whole system"
# archive should contain every file the user owns — the gridless map as well as
# the gridded one — so these helpers do not filter on variant_parent_id the way
# the browse endpoints do (issues #304, #306).
def _files_for_system(db, system_id: str, see_explicit: bool, user=None) -> tuple[list, str]:
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if not system:
        raise HTTPException(404, "System not found")
    if system.is_explicit and not see_explicit:
        raise HTTPException(403, "Explicit content disabled")
    if user is not None and not access_control.can_access_system(db, user, system):
        raise HTTPException(404, "System not found")

    q = db.query(Book).filter_by(game_system_id=system_id)
    if not see_explicit:
        q = q.filter(Book.is_explicit != True)
    q = _visible(db, q, user)

    files = [
        (safe, _safe_arcname(f"{b.category or 'misc'}/{b.filename}"))
        for b in q.all()
        if (safe := _safe_filepath(b.filepath))
    ]
    return files, _safe_name(system.name)


def _files_for_system_category(
    db, system_id: str, category: str, see_explicit: bool, user=None
) -> tuple[list, str]:
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if not system:
        raise HTTPException(404, "System not found")
    if system.is_explicit and not see_explicit:
        raise HTTPException(403, "Explicit content disabled")
    if user is not None and not access_control.can_access_system(db, user, system):
        raise HTTPException(404, "System not found")

    q = db.query(Book).filter_by(game_system_id=system_id, category=category)
    if not see_explicit:
        q = q.filter(Book.is_explicit != True)
    q = _visible(db, q, user)

    files = [
        (safe, _safe_arcname(b.filename))
        for b in q.all()
        if (safe := _safe_filepath(b.filepath))
    ]
    return files, f"{_safe_name(system.name)}_{_safe_name(category)}"


def _files_for_book_folder(
    db, system_id: str, folder: str, see_explicit: bool, user=None
) -> tuple[list, str]:
    """Books in a nested subfolder within any category.
    Path structure: books/{SystemName}/{categoryDir}/{folder...}/...
    ``folder`` is the '/'-joined path of segments after the category dir (index 3
    onward), so it matches arbitrarily deep nesting (e.g. "monsters/spelljammer").
    Books deeper than the requested folder are included; their archive paths keep
    the sub-hierarchy below ``folder`` so nesting is preserved on extraction.
    """
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if not system:
        raise HTTPException(404, "System not found")
    if user is not None and not access_control.can_access_system(db, user, system):
        raise HTTPException(404, "System not found")

    q = db.query(Book).filter_by(game_system_id=system_id)
    if not see_explicit:
        q = q.filter(Book.is_explicit != True)
    q = _visible(db, q, user)

    target = [seg for seg in folder.replace("\\", "/").split("/") if seg]

    def _subpath(b: Book) -> Optional[list[str]]:
        """Segments after the category dir (parts[3:]), or None when the book
        is not under ``folder``. Returns the arcname parts on a match."""
        parts = b.relative_path.replace("\\", "/").split("/")
        sub = parts[3:]
        if len(sub) <= len(target) or sub[: len(target)] != target:
            return None
        return sub[len(target):]

    files = [
        (safe, _safe_arcname("/".join(rel)))
        for b in q.all()
        if (rel := _subpath(b)) is not None and (safe := _safe_filepath(b.filepath))
    ]
    return files, f"{_safe_name(system.name)}_{_safe_name(folder)}"


def _files_for_map_folder(db, folder: str) -> tuple[list, str]:
    prefix = folder.strip("/") + "/"
    maps = db.query(GenericMap).all()

    def _arcname(m: GenericMap) -> str:
        rp = m.relative_path.replace("\\", "/")
        rel = rp.split("/", 1)[1] if "/" in rp else rp
        raw = rel[len(prefix):] if rel.startswith(prefix) else (rel or m.filename)
        return _safe_arcname(raw)

    files = [
        (safe, _arcname(m))
        for m in maps
        if m.relative_path.replace("\\", "/").lstrip("/").lower().startswith("maps/" + prefix.lower())
        and (safe := _safe_filepath(m.filepath))
    ]
    return files, f"maps_{_safe_name(folder)}"


def _files_for_token_folder(db, folder: str, see_explicit: bool) -> tuple[list, str]:
    prefix = folder.strip("/") + "/"
    q = db.query(Token)
    if not see_explicit:
        q = q.filter(Token.is_explicit != True)

    def _arcname(t: Token) -> str:
        rp = t.relative_path.replace("\\", "/")
        rel = rp.split("/", 1)[1] if "/" in rp else rp
        raw = rel[len(prefix):] if rel.startswith(prefix) else (rel or t.filename)
        return _safe_arcname(raw)

    files = [
        (safe, _arcname(t))
        for t in q.all()
        if t.relative_path.replace("\\", "/").lstrip("/").lower().startswith("tokens/" + prefix.lower())
        and (safe := _safe_filepath(t.filepath))
    ]
    return files, f"tokens_{_safe_name(folder)}"


def _files_for_audio_folder(db, folder: str) -> tuple[list, str]:
    prefix = folder.strip("/") + "/"
    tracks = db.query(Audio).all()

    def _arcname(a: Audio) -> str:
        rp = a.relative_path.replace("\\", "/")
        rel = rp.split("/", 1)[1] if "/" in rp else rp
        raw = rel[len(prefix):] if rel.startswith(prefix) else (rel or a.filename)
        return _safe_arcname(raw)

    files = [
        (safe, _arcname(a))
        for a in tracks
        if a.relative_path.replace("\\", "/").lstrip("/").lower().startswith("audio/" + prefix.lower())
        and (safe := _safe_filepath(a.filepath))
    ]
    return files, f"audio_{_safe_name(folder)}"


# A ceiling on what one library-folder archive will stream. The file manager can
# point at any folder, including the library root, and a request that walks
# hundreds of gigabytes ties up a worker for the whole transfer. Refusing up
# front with a clear message beats a download that stalls and dies half-written.
_MAX_FOLDER_FILES = 5000
_MAX_FOLDER_BYTES = 50 * 1024 * 1024 * 1024



def _files_for_model_folder(db, folder: str, see_explicit: bool) -> tuple[list, str]:
    prefix = folder.strip("/") + "/"
    q = db.query(Model3D)
    if not see_explicit:
        q = q.filter(Model3D.is_explicit != True)

    def _arcname(m: Model3D) -> str:
        rp = m.relative_path.replace("\\", "/")
        rel = rp.split("/", 1)[1] if "/" in rp else rp
        raw = rel[len(prefix):] if rel.startswith(prefix) else (rel or m.filename)
        return _safe_arcname(raw)

    files = [
        (safe, _arcname(m))
        for m in q.all()
        if m.relative_path.replace("\\", "/").lstrip("/").lower().startswith("models/" + prefix.lower())
        and (safe := _safe_filepath(m.filepath))
    ]
    return files, f"models_{_safe_name(folder)}"

def _files_for_library_folder(folder: str) -> tuple[list, str]:
    """Every real file under an arbitrary library folder, as it sits on disk.

    The file manager browses the *filesystem*, not the index, so this is the one
    archive builder that does not start from a query. A folder there may hold
    loose files the scanner ignored, unindexed formats, and sidecars, and the
    admin asking for "download this folder" means the folder — not the subset
    Grimoire happens to have rows for.

    That is also why it is admin-only at the router: no per-book access grant is
    consulted here because there is no book row to consult one for.
    """
    from ...services import library_fs as fs

    try:
        target = fs.safe_join(folder, must_exist=True)
    except fs.LibraryFSError as e:
        raise HTTPException(404 if e.code == "not_found" else 403, e.message) from e
    if not target.is_dir():
        raise HTTPException(400, "Not a folder")

    files: list[tuple[str, str]] = []
    total = 0
    # Sorted at each level so the archive's entry order is stable between runs;
    # an unordered os.walk makes two archives of the same folder differ.
    for dirpath, dirnames, filenames in os.walk(target):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            full = Path(dirpath) / name
            safe = _safe_filepath(str(full))
            if not safe:
                continue
            try:
                total += full.stat().st_size
            except OSError:
                continue
            files.append((safe, _safe_arcname(str(full.relative_to(target)))))
            if len(files) > _MAX_FOLDER_FILES or total > _MAX_FOLDER_BYTES:
                raise HTTPException(
                    413,
                    "That folder is too large to download as one archive "
                    f"(limit {_MAX_FOLDER_FILES} files / "
                    f"{_MAX_FOLDER_BYTES // (1024 ** 3)} GB). Download a subfolder instead.",
                )

    return files, _safe_name(target.name or "library")


# The tag browser groups a tag's items by resource type, so its archives do too:
# one top-level folder per type. Tags span collections — the same tag can sit on
# a book, a map and a token — and a flat archive would let a map and a token
# that share a filename overwrite each other. Systems are deliberately absent:
# a tagged *system* is a whole shelf rather than a file, and pulling it in would
# turn a four-item tag into a multi-gigabyte download. Its own page already has
# a download button (issue #401).
_TAG_ARCHIVE_TYPES = ("book", "map", "token", "audio", "model")


def _tag_items_by_type(
    db, refs: list[dict], see_explicit: bool, user=None
) -> dict[str, list]:
    """Resolve ``[{resource_type, resource_id}]`` refs to rows, keyed by type.

    The tags router enriches refs for *display* and filters only on explicit
    content; an archive additionally has to honour per-book access grants, so
    the rows are re-fetched here and run through the same guards every other
    builder uses rather than trusting the display list (issue #258).

    Collecting ids into a set per type also de-duplicates: an item that is both
    tagged directly and sitting in a tagged folder is archived once.
    """
    by_type: dict[str, list] = {}
    for rtype in _TAG_ARCHIVE_TYPES:
        ids = {r["resource_id"] for r in refs if r["resource_type"] == rtype}
        if not ids:
            continue
        spec = COLLECTIONS.get(rtype)
        if spec is None:
            continue
        model = spec.model
        q = db.query(model).filter(model.id.in_(ids))
        # Not every collection carries an explicit flag (maps and audio do not).
        if not see_explicit and hasattr(model, "is_explicit"):
            q = q.filter(model.is_explicit != True)  # noqa: E712
        if model is Book:
            q = _visible(db, q, user)
        rows = q.all()
        if rows:
            by_type[rtype] = rows
    return by_type


def _tag_refs(db, key: str, resource_type: Optional[str] = None) -> list[dict]:
    """Every ref a tag covers: directly tagged items plus tagged folders' contents.

    Matches what the tag browser renders for that scope, so the archive holds
    exactly what the user is looking at.
    """
    refs = list(tag_service.resources_for_tag(db, key, resource_type=resource_type))
    for group in tag_service.folders_for_tag(db, key, resource_type=resource_type):
        refs.extend(group["items"])
    return refs


def _flat_files(rows: list) -> list:
    """``(filepath, arcname)`` pairs keeping only each file's own name.

    A tag is a flat, curated selection, so preserving the library hierarchy
    would bury a handful of files under folders the user did not ask for.
    """
    return [
        (safe, _safe_arcname(row.filename))
        for row in rows
        if (safe := _safe_filepath(row.filepath))
    ]


def _files_for_tag(db, internal: str, see_explicit: bool, user=None) -> tuple[list, str]:
    """Everything carrying a tag, across every type — the browser's top level."""
    key = tag_service.normalize_internal(internal)
    refs = _tag_refs(db, key)
    if not refs:
        raise HTTPException(404, "Tag not found")

    by_type = _tag_items_by_type(db, refs, see_explicit, user)
    files = []
    for rtype, rows in by_type.items():
        section = COLLECTIONS[rtype].section
        for row in rows:
            safe = _safe_filepath(row.filepath)
            if safe:
                files.append((safe, _safe_arcname(f"{section}/{row.filename}")))
    return files, _safe_name(key)


def _files_for_tag_type(
    db, internal: str, resource_type: str, see_explicit: bool, user=None
) -> tuple[list, str]:
    """One resource type's slice of a tag — the browser's type section.

    Includes the folder groups nested under that section, since that is what
    the section actually renders.
    """
    if resource_type not in _TAG_ARCHIVE_TYPES:
        raise HTTPException(
            400,
            "resource_type must be one of: " + ", ".join(sorted(_TAG_ARCHIVE_TYPES)),
        )
    key = tag_service.normalize_internal(internal)
    refs = _tag_refs(db, key, resource_type)
    if not refs:
        raise HTTPException(404, "Tag not found")

    by_type = _tag_items_by_type(db, refs, see_explicit, user)
    # A single-type archive is already that type, so it needs no type folder.
    files = _flat_files(by_type.get(resource_type, []))
    return files, f"{_safe_name(key)}_{_safe_name(resource_type)}"


def _files_for_tag_folder(
    db, internal: str, resource_type: str, folder: str, see_explicit: bool, user=None
) -> tuple[list, str]:
    """One tagged folder's contents, as the browser's folder group shows it.

    ``folder`` is the group's ``path`` exactly as the tag items endpoint
    returned it, so the caller never has to know that book folders are addressed
    differently (``{system_id}/{category}/…``) from media folders.
    """
    key = tag_service.normalize_internal(internal)
    groups = [
        g
        for g in tag_service.folders_for_tag(db, key, resource_type=resource_type)
        if g["path"] == folder
    ]
    if not groups:
        raise HTTPException(404, "Tagged folder not found")

    refs = [item for g in groups for item in g["items"]]
    by_type = _tag_items_by_type(db, refs, see_explicit, user)
    files = _flat_files(by_type.get(resource_type, []))
    return files, f"{_safe_name(key)}_{_safe_name(folder)}"
