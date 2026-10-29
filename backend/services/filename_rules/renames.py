"""Previewing and applying a folder's naming pattern to the books already there.

New books pick a pattern up on their own when the scanner registers them. Books
indexed before the pattern existed - or before it last changed - need a
deliberate pass, and both directions get one here:

* **Titles from filenames** (issue #521) overwrites each selected book's title
  with the one its filename carries, and fills publisher, version and the rest
  only where the book has none yet: those are more often typed in by hand, and
  a pattern should not undo that.
* **Filenames from metadata** (issue #522) renames each selected file to what
  the pattern writes for it, through ``library_fs.rename_path`` so the record
  keeps its id, tags, progress and sidecars.

Both are preview-first. The preview is computed by the same function the apply
step re-runs per book, so what is applied is what was shown, and the client
never gets to name the destination itself.
"""
import os
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session, joinedload

from ...metadata import export as sidecar_export
from ...models import Book, FolderNamingRule
from ...sql_paths import path_under
from .. import library_fs as fs
from .folders import SECTION, RuleSet, in_section, normalise_path, rule_set
from .pattern import MAX_NAME_BYTES, READ_FIELDS, Pattern, PatternError, clean_value, parse

# Rows returned by one preview. Past a few hundred a table stops being something
# anyone reviews line by line; the response says how many it left out.
PREVIEW_LIMIT = 1000

# Windows refuses most paths longer than this, and so do a good many sync tools
# and archive formats on every OS. Exceeding it is a warning rather than an
# error - the server Grimoire runs on may cope fine - since the person most
# likely to be bitten is whoever copies the library somewhere else later.
LONG_PATH = 259


def _book_values(book: Book) -> dict[str, str]:
    """Every field a pattern can write, as text."""
    category = book.category or ""
    date = ""
    if book.year:
        date = f"{book.year:04d}"
        if book.month:
            date += f"-{book.month:02d}"
            if book.day:
                date += f"-{book.day:02d}"
    return {
        "title": book.title or "",
        "system": book.game_system.name if book.game_system else "",
        "publisher": book.publisher or "",
        "authors": ", ".join(a for a in (book.authors or []) if isinstance(a, str) and a),
        "year": str(book.year) if book.year else "",
        "date": date,
        "version": book.version or "",
        "isbn": book.isbn or "",
        "product_code": book.product_code or "",
        "category": fs.CATEGORY_FOLDER_NAMES.get(category) or category.replace("-", " ").title(),
        "language": book.language or "",
    }


def _title_status(book: Book, read: Optional[dict]) -> str:
    if read is None:
        return "no_match"
    return "same" if read["title"] == (book.title or "") else "change"


def _rename_row(
    book: Book, pattern: Pattern, claimed: dict[str, str]
) -> dict[str, Any]:
    """What renaming ``book`` onto ``pattern`` would do, without doing it.

    ``claimed`` maps each destination already promised to an earlier row in the
    same batch (case-folded, since two names differing only in case are one file
    on macOS and Windows) so the second of two books that render alike is
    reported as a conflict rather than discovered as one halfway through.
    """
    out: dict[str, Any] = {
        "proposed": None,
        "rename_status": "unavailable",
        "missing": [],
        "path_length": 0,
        "long_path": False,
        "reads_back": True,
    }
    if not pattern.renderable:
        return out

    ext = Path(book.filename).suffix
    name, missing = pattern.render(_book_values(book), ext)
    if name is None:
        out.update(rename_status="missing", missing=missing)
        return out

    rel = (book.relative_path or "").replace("\\", "/")
    folder = rel.rsplit("/", 1)[0] if "/" in rel else ""
    target_rel = f"{folder}/{name}" if folder else name
    source = Path(book.filepath)
    target = source.parent / name
    out.update(
        proposed=name,
        path_length=len(str(target)),
        long_path=len(str(target)) > LONG_PATH,
    )

    read = pattern.read(name)
    out["reads_back"] = read is not None and read["title"] == clean_value(book.title)

    if name == book.filename:
        out["rename_status"] = "same"
        return out
    if len(name.encode("utf-8")) > MAX_NAME_BYTES:
        out["rename_status"] = "too_long"
        return out
    key = target_rel.casefold()
    holder = claimed.get(key)
    on_disk = target.exists() and not (source.exists() and os.path.samefile(source, target))
    if (holder and holder != book.id) or on_disk:
        out["rename_status"] = "conflict"
        return out
    claimed[key] = book.id
    out["rename_status"] = "ok"
    return out


def _books_under(db: Session, path: str, rules: RuleSet) -> list[Book]:
    """The books ``path``'s rule governs: under it, and not under a nearer rule."""
    rows = (
        db.query(Book)
        .options(joinedload(Book.game_system))
        # Not LIKE: the `_` in a folder like `D&D_5e` would be a wildcard, and
        # `core` would match `Core`, sweeping in a sibling folder's books.
        .filter(path_under(Book.relative_path, path + "/"))
        .filter(Book.is_missing.isnot(True))
        .order_by(Book.relative_path)
        .all()
    )
    out = []
    for book in rows:
        rule = rules.for_book(book.relative_path or "")
        if rule is None or rule.path == path:
            out.append(book)
    return out


def _resolve(db: Session, path: str, pattern_source: Optional[str]) -> tuple[str, Pattern, RuleSet]:
    """The folder, its pattern (the saved one unless one is supplied), and every rule."""
    path = normalise_path(path)
    if not in_section(path):
        raise PatternError(f"Naming patterns apply to folders under '{SECTION}/'.")
    rules = rule_set(db)
    if pattern_source is not None:
        return path, parse(pattern_source), rules
    row = db.query(FolderNamingRule).filter_by(path=path).first()
    if row is None:
        raise PatternError("That folder has no naming pattern.")
    return path, parse(row.pattern), rules


def preview(db: Session, path: str, pattern_source: Optional[str] = None) -> dict[str, Any]:
    """Every book the pattern governs, with what each action would change.

    ``pattern_source`` previews a pattern that has not been saved yet, so the
    editor can show its effect while the admin types; applying always uses the
    saved one.
    """
    path, pattern, rules = _resolve(db, path, pattern_source)
    books = _books_under(db, path, rules)
    claimed: dict[str, str] = {}
    rows = []
    for book in books[:PREVIEW_LIMIT]:
        read = pattern.read(book.filename)
        rows.append(
            {
                "id": book.id,
                "filename": book.filename,
                "relative_path": book.relative_path,
                "title": book.title,
                "read": read,
                "title_status": _title_status(book, read),
                **_rename_row(book, pattern, claimed),
            }
        )
    return {
        "path": path,
        "pattern": pattern.source,
        "renderable": pattern.renderable,
        "writable": fs.library_writable(),
        "total": len(books),
        "truncated": len(books) > PREVIEW_LIMIT,
        "rows": rows,
    }


def _selected(db: Session, path: str, rules: RuleSet, ids: list[str]) -> list[Book]:
    wanted = set(ids)
    return [b for b in _books_under(db, path, rules) if b.id in wanted]


def apply_titles(db: Session, path: str, ids: list[str]) -> dict[str, Any]:
    """Re-read the selected books' titles (and blank fields) from their filenames."""
    path, pattern, rules = _resolve(db, path, None)
    updated: list[str] = []
    skipped: list[dict] = []
    books = _selected(db, path, rules, ids)
    for book in books:
        read = pattern.read(book.filename)
        if read is None:
            skipped.append({"id": book.id, "reason": "no_match"})
            continue
        changed = False
        for field in READ_FIELDS:
            if field not in read:
                continue
            current = getattr(book, field)
            if field != "title" and current not in (None, "", []):
                continue
            if current != read[field]:
                setattr(book, field, read[field])
                changed = True
        if changed:
            updated.append(book.id)
        else:
            skipped.append({"id": book.id, "reason": "same"})
    db.commit()
    # After the commit, as the book editor does, so a rollback can never leave
    # a sidecar describing metadata that was not saved.
    for book in books:
        if book.id in updated:
            sidecar_export.refresh_existing_safe(db, book)
    return {"updated": updated, "skipped": skipped}


def apply_renames(db: Session, path: str, ids: list[str]) -> dict[str, Any]:
    """Rename the selected books' files onto the folder's pattern.

    Each file is renamed and committed on its own, so the one that fails (a
    permission error, a name a filesystem refuses) is reported without undoing
    the forty that worked.
    """
    path, pattern, rules = _resolve(db, path, None)
    if not pattern.renderable:
        raise PatternError("A pattern with {*} can read filenames but not write them.")
    renamed: list[dict] = []
    skipped: list[dict] = []
    claimed: dict[str, str] = {}
    for book in _selected(db, path, rules, ids):
        plan = _rename_row(book, pattern, claimed)
        if plan["rename_status"] != "ok":
            skipped.append({"id": book.id, "reason": plan["rename_status"]})
            continue
        source = (book.relative_path or "").replace("\\", "/")
        try:
            result = fs.rename_path(db, source, plan["proposed"])
        except fs.LibraryFSError as e:
            skipped.append({"id": book.id, "reason": e.code, "detail": e.message})
            continue
        except OSError as e:
            skipped.append({"id": book.id, "reason": "io_error", "detail": str(e)})
            continue
        renamed.append({"id": book.id, "from": result["from"], "to": result["to"]})
    return {"renamed": renamed, "skipped": skipped}
