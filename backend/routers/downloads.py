"""Archive download endpoint — stream a collection of files as zip, tar, tar.gz, or tar.bz2."""
import io
import tarfile
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..config import SessionLocal, LIBRARY_PATH
from ..models import Book, GameSystem, GenericMap, Token, User
from ..auth import get_current_user, CurrentUser

router = APIRouter(prefix="/downloads", tags=["downloads"])

_LIBRARY_ROOT = Path(LIBRARY_PATH).resolve()


def _safe_filepath(raw: str) -> Optional[str]:
    """
    Resolve *raw* to an absolute path and verify it is inside _LIBRARY_ROOT.
    Returns the resolved path string on success, None if the path escapes the
    library root (path-traversal guard) or does not point to a regular file.
    """
    try:
        resolved = Path(raw).resolve()
    except (TypeError, ValueError):
        return None
    if _LIBRARY_ROOT not in resolved.parents and resolved != _LIBRARY_ROOT:
        return None
    if not resolved.is_file():
        return None
    return str(resolved)

_FORMATS = {
    "zip":     {"ext": ".zip",     "mime": "application/zip"},
    "tar":     {"ext": ".tar",     "mime": "application/x-tar"},
    "tar.gz":  {"ext": ".tar.gz",  "mime": "application/gzip"},
    "tar.bz2": {"ext": ".tar.bz2", "mime": "application/x-bzip2"},
}

_ZIP_STORED_EXTS = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".zip"}

_WIN_ILLEGAL = set(':*?"<>|\\')

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


def _files_for_system(db, system_id: str, see_explicit: bool) -> tuple[list, str]:
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if not system:
        raise HTTPException(404, "System not found")
    if system.is_explicit and not see_explicit:
        raise HTTPException(403, "Explicit content disabled")

    q = db.query(Book).filter_by(game_system_id=system_id)
    if not see_explicit:
        q = q.filter(Book.is_explicit != True)

    files = [
        (safe, _safe_arcname(f"{b.category or 'misc'}/{b.filename}"))
        for b in q.all()
        if (safe := _safe_filepath(b.filepath))
    ]
    return files, _safe_name(system.name)


def _files_for_system_category(db, system_id: str, category: str, see_explicit: bool) -> tuple[list, str]:
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if not system:
        raise HTTPException(404, "System not found")
    if system.is_explicit and not see_explicit:
        raise HTTPException(403, "Explicit content disabled")

    q = db.query(Book).filter_by(game_system_id=system_id, category=category)
    if not see_explicit:
        q = q.filter(Book.is_explicit != True)

    files = [
        (safe, _safe_arcname(b.filename))
        for b in q.all()
        if (safe := _safe_filepath(b.filepath))
    ]
    return files, f"{_safe_name(system.name)}_{_safe_name(category)}"


def _files_for_book_folder(db, system_id: str, folder: str, see_explicit: bool) -> tuple[list, str]:
    """Books in a named subfolder within any category.
    Path structure: books/{SystemName}/{categoryDir}/{folder}/...
    The folder name is matched against path segment index 3 (0-based).
    """
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if not system:
        raise HTTPException(404, "System not found")

    q = db.query(Book).filter_by(game_system_id=system_id)
    if not see_explicit:
        q = q.filter(Book.is_explicit != True)

    def _in_folder(b: Book) -> bool:
        parts = b.relative_path.replace("\\", "/").split("/")
        return len(parts) > 4 and parts[3] == folder

    files = [
        (safe, _safe_arcname(b.filename))
        for b in q.all()
        if _in_folder(b) and (safe := _safe_filepath(b.filepath))
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
        if m.relative_path.replace("\\", "/").lstrip("/").startswith("maps/" + prefix)
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
        if t.relative_path.replace("\\", "/").lstrip("/").startswith("tokens/" + prefix)
        and (safe := _safe_filepath(t.filepath))
    ]
    return files, f"tokens_{_safe_name(folder)}"


@router.get(
    "/archive",
    summary="Download an archive of files",
    description=(
        "Stream a collection of files as a single archive. "
        "`fmt` controls the format: `zip` (default), `tar`, `tar.gz`, `tar.bz2`. "
        "`type` controls the scope: `system`, `system_category`, `map_folder`, `token_folder`."
    ),
)
def download_archive(
    type: str = Query(..., description="Scope: system | system_category | book_folder | map_folder | token_folder"),
    fmt: str = Query("zip", description="Archive format: zip | tar | tar.gz | tar.bz2"),
    id: Optional[str] = Query(None, description="System ID (system / system_category / book_folder)"),
    category: Optional[str] = Query(None, description="Book category slug (system_category)"),
    folder: Optional[str] = Query(None, description="Folder path (book_folder / map_folder / token_folder)"),
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        see_explicit = _can_see_explicit(db, current_user.id)

        if type == "system":
            if not id:
                raise HTTPException(400, "id is required for type=system")
            files, base = _files_for_system(db, id, see_explicit)

        elif type == "system_category":
            if not id:
                raise HTTPException(400, "id is required for type=system_category")
            if not category:
                raise HTTPException(400, "category is required for type=system_category")
            files, base = _files_for_system_category(db, id, category, see_explicit)

        elif type == "book_folder":
            if not id:
                raise HTTPException(400, "id is required for type=book_folder")
            if not folder:
                raise HTTPException(400, "folder is required for type=book_folder")
            files, base = _files_for_book_folder(db, id, folder, see_explicit)

        elif type == "map_folder":
            if not folder:
                raise HTTPException(400, "folder is required for type=map_folder")
            files, base = _files_for_map_folder(db, folder)

        elif type == "token_folder":
            if not folder:
                raise HTTPException(400, "folder is required for type=token_folder")
            files, base = _files_for_token_folder(db, folder, see_explicit)

        else:
            raise HTTPException(400, f"Unknown type: {type!r}")

        return _archive_response(files, base, fmt)

    finally:
        db.close()
