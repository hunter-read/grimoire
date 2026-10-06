"""Accepting an uploaded file into the library.

Uploads are the one path where the *content* is caller-supplied too, so the
filename is validated against what the destination collection actually accepts
before a byte is written. The write itself streams to a temporary file and is
promoted with a single rename, so a failed or aborted upload never leaves a
half-written file where the scanner would index it.
"""
import os
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from ...config import logger
from ...indexer.thumbnails import archive_ext
from ...indexer.models3d import MODEL_EXTS
from ...indexer.constants import (
    MEDIA_ARCHIVE_EXTS,
    ARCHIVE_EXTS,
    AUDIO_EXTS,
    DOC_EXTS,
    IMAGE_EXTS,
    MAP_IMAGE_EXTS,
)
from .constants import _UPLOAD_CHUNK, LibraryFSError
from .moves import _dest_for
from .paths import assert_writable, collection_of, safe_join, to_relative
from ...models import Book

def allowed_upload_exts(destination: Path) -> set[str]:
    """The file extensions worth uploading into ``destination``.

    Scoped to the collection, because an upload the scanner will never index is
    an upload that silently does nothing: an ``.mp3`` under ``books/`` is invisible
    to every view in the app. Restricting to what each tree indexes turns that
    into an error the user can act on at the moment they make it.

    Archives are accepted everywhere the scanner registers them (books, maps,
    tokens), matching ``ARCHIVE_EXTS``/``MEDIA_ARCHIVE_EXTS``.
    """
    section = collection_of(destination)
    if section == "books":
        return DOC_EXTS | IMAGE_EXTS | ARCHIVE_EXTS
    if section == "maps":
        return MAP_IMAGE_EXTS | ARCHIVE_EXTS
    if section == "tokens":
        return IMAGE_EXTS | ARCHIVE_EXTS
    if section == "audio":
        return AUDIO_EXTS
    if section == "models":
        return MODEL_EXTS | MEDIA_ARCHIVE_EXTS
    return set()


def _upload_ext(filename: str) -> str:
    """The extension an upload will be judged by, honouring two-part archives."""
    return archive_ext(filename) or Path(filename.lower()).suffix


def validate_upload_name(filename: str, destination: Path) -> str:
    """Return the safe base name for an upload, or raise.

    Browsers send whatever the client claims, so this is a trust boundary: the
    name is reduced to its final component (defeating ``../`` and absolute paths
    smuggled through the multipart body) before anything touches the filesystem.
    """
    raw = (filename or "").strip().replace("\\", "/")
    name = os.path.basename(raw)
    if not name or name in (".", ".."):
        raise LibraryFSError("That file has no usable name", code="invalid")
    if "\x00" in name:
        raise LibraryFSError("File name contains an invalid character", code="invalid")
    # Dotfiles are how folders declare their container kind and NSFW state;
    # letting an upload write one would reclassify a shelf without saying so.
    if name.startswith("."):
        raise LibraryFSError("Hidden files cannot be uploaded", code="invalid")

    allowed = allowed_upload_exts(destination)
    if not allowed:
        raise LibraryFSError(
            "Files can only be uploaded into books, maps, tokens, audio, or models",
            code="invalid",
        )
    ext = _upload_ext(name)
    if ext not in allowed:
        raise LibraryFSError(
            f"'{ext or name}' is not a file type this part of the library indexes",
            code="invalid",
        )
    return name


def save_upload(
    destination: str,
    filename: str,
    stream: Any,
    *,
    relative_dir: str = "",
    on_conflict: str = "skip",
    max_bytes: Optional[int] = None,
) -> dict:
    """Stream one uploaded file into the library.

    Written in chunks rather than read whole: library files are routinely
    hundreds of megabytes, and buffering one in memory per concurrent upload is
    the difference between a working import and an OOM.

    ``relative_dir`` carries the sub-path from a folder upload (the browser's
    ``webkitRelativePath`` minus the file name), so a dropped folder keeps its
    structure. It is validated exactly like any other caller-supplied path.

    The file lands under a temporary name and is renamed into place only once it
    is fully written, so an interrupted upload never leaves a truncated file for
    the scanner to index as a real book.
    """
    dest_dir = _upload_dir(destination, relative_dir, create=True)
    assert_writable(dest_dir)
    name = validate_upload_name(filename, dest_dir)
    target = _dest_for(dest_dir, name, on_conflict=on_conflict)
    written = _stream_into(target, stream, max_bytes)
    logger.info("Uploaded %s (%d bytes)", to_relative(target), written)
    return {"path": to_relative(target), "name": target.name, "size": written}


def replace_upload(
    db: Session,
    destination: str,
    filename: str,
    stream: Any,
    *,
    relative_dir: str = "",
    max_bytes: Optional[int] = None,
) -> dict:
    """Overwrite an indexed book's file with an upload, keeping its record (#497).

    The one upload that is allowed to overwrite, and only a file Grimoire already
    tracks as a book: everything the user attached to it — tags, metadata edits,
    variant links, bookmarks, favorites, campaign links — is keyed by the row's
    id, and the row is keyed by path, so writing the new bytes to the same path
    keeps all of it. A path holding no indexed book is refused rather than
    treated as a plain upload, so a mistyped name cannot silently add a second
    copy of a book the caller meant to correct.

    Only the file is written here. Re-reading it (hash, pages, cover, search
    text) is the caller's job, because the caller owns the scan-status guard and
    the background queue the text indexing runs on.

    The new bytes land under a temporary name and replace the old file in one
    rename, so an interrupted upload leaves the original intact.
    """
    dest_dir = _upload_dir(destination, relative_dir, create=False)
    name = validate_upload_name(filename, dest_dir)
    target = dest_dir / name
    if target.is_dir():
        raise LibraryFSError(f"'{name}' is a folder, not a file", code="invalid")
    book = (
        db.query(Book).filter(Book.relative_path == to_relative(target)).first()
        if collection_of(target) == "books"
        else None
    )
    if book is None:
        raise LibraryFSError(
            f"There is no indexed book named '{name}' there to replace", code="conflict"
        )
    assert_writable(dest_dir)
    written = _stream_into(target, stream, max_bytes)
    logger.info("Replaced %s with an upload (%d bytes)", to_relative(target), written)
    return {
        "path": to_relative(target),
        "name": target.name,
        "size": written,
        "record_id": book.id,
        "replaced": True,
    }


def _upload_dir(destination: str, relative_dir: str, *, create: bool) -> Path:
    """Resolve the folder an upload lands in, creating a folder upload's tree."""
    dest_dir = safe_join(destination, must_exist=True)
    if not dest_dir.is_dir():
        raise LibraryFSError("Destination is not a folder", code="invalid")
    if not relative_dir:
        return dest_dir

    # Re-validated against the library root rather than trusted: this comes
    # from the browser, and a folder upload is the one place a client sends
    # a whole path.
    dest_dir = safe_join(f"{to_relative(dest_dir)}/{relative_dir}")
    if not dest_dir.exists():
        if not create:
            # A replace targets an existing book, so its folder must exist too.
            raise LibraryFSError(f"{relative_dir} does not exist", code="not_found")
        try:
            dest_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            raise LibraryFSError(f"Could not create {relative_dir}: {e}", code="io_error") from e
    return dest_dir


def _stream_into(target: Path, stream: Any, max_bytes: Optional[int]) -> int:
    """Write ``stream`` to ``target`` via a temporary file; return bytes written.

    The temporary file is promoted with ``os.replace``, which is atomic on one
    filesystem, so ``target`` holds either its old contents or the complete new
    ones — never a truncated mix the scanner could index.
    """
    tmp = target.with_name(f".{target.name}.part")
    written = 0
    try:
        with open(tmp, "wb") as out:
            while True:
                chunk = stream.read(_UPLOAD_CHUNK)
                if not chunk:
                    break
                written += len(chunk)
                if max_bytes is not None and written > max_bytes:
                    raise LibraryFSError("File is too large", code="too_large")
                out.write(chunk)
        if written == 0:
            raise LibraryFSError("File is empty", code="invalid")
        os.replace(tmp, target)
    except LibraryFSError:
        _cleanup_partial(tmp)
        raise
    except OSError as e:
        _cleanup_partial(tmp)
        if getattr(e, "errno", None) == 30:
            raise LibraryFSError(
                "The library is mounted read-only, so it cannot be modified.",
                code="read_only",
            ) from e
        if getattr(e, "errno", None) == 28:
            raise LibraryFSError("The disk is full", code="io_error") from e
        raise LibraryFSError(f"Could not save the file: {e}", code="io_error") from e
    return written


def _cleanup_partial(tmp: Path) -> None:
    """Remove a half-written upload so the scanner never sees it."""
    try:
        tmp.unlink()
    except FileNotFoundError:
        pass
    except OSError as e:
        logger.warning("Could not remove partial upload %s: %s", tmp, e)

