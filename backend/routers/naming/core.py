"""Filename rules: folder naming patterns and variant markers. Admin only.

Thin by design - parsing, matching and renaming live in
``services/filename_rules`` so the scanner and the duplicate scan use exactly
what these endpoints configure. This module validates, maps errors to status
codes, and nothing more.
"""
from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...auth import CurrentUser, require_admin
from ...config import get_db
from ...models import FolderNamingRule
from ...services import library_fs as fs
from ...services.filename_rules import renames, variant_rules
from ...services.filename_rules.folders import SECTION, in_section, normalise_path
from ...services.filename_rules.pattern import FIELDS, READ_FIELDS, PatternError, parse
from ._schemas import ApplyRequest, FolderRuleIn, PreviewRequest, VariantRulesIn


def _bad(e: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail=str(e))


def _folder_exists(path: str) -> bool:
    try:
        return fs.safe_join(path, must_exist=True).is_dir()
    except fs.LibraryFSError:
        return False


def _rule_out(row: FolderNamingRule) -> dict:
    error = None
    renderable = False
    try:
        renderable = parse(row.pattern).renderable
    except PatternError as e:
        error = str(e)
    return {
        "path": row.path,
        "pattern": row.pattern,
        "exists": _folder_exists(row.path),
        "renderable": renderable,
        "error": error,
    }


def list_folder_rules(
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Every folder with a naming pattern, and the fields a pattern may use."""
    rows = db.query(FolderNamingRule).order_by(FolderNamingRule.path).all()
    return {
        "rules": [_rule_out(r) for r in rows],
        "fields": list(FIELDS),
        "read_fields": list(READ_FIELDS),
    }


def save_folder_rule(
    data: FolderRuleIn,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Set a folder's naming pattern, replacing any it had."""
    try:
        path = normalise_path(data.path)
        pattern = parse(data.pattern)
    except PatternError as e:
        raise _bad(e) from e
    if not in_section(path):
        raise HTTPException(400, f"Naming patterns apply to folders under '{SECTION}/'.")
    if not _folder_exists(path):
        raise HTTPException(404, "That folder does not exist.")

    row = db.query(FolderNamingRule).filter_by(path=path).first()
    if row is None:
        row = FolderNamingRule(path=path, pattern=pattern.source)
        db.add(row)
    else:
        row.pattern = pattern.source
    db.commit()
    return _rule_out(row)


def delete_folder_rule(
    path: str = Query(..., max_length=1000),
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Remove a folder's naming pattern. Titles and filenames already set stay."""
    try:
        clean = normalise_path(path)
    except PatternError as e:
        raise _bad(e) from e
    deleted = db.query(FolderNamingRule).filter_by(path=clean).delete()
    db.commit()
    if not deleted:
        raise HTTPException(404, "That folder has no naming pattern.")
    return {"status": "ok"}


def preview_folder_rule(
    data: PreviewRequest,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """What a pattern would do to the books it governs, changing nothing."""
    try:
        return renames.preview(db, data.path, data.pattern)
    except PatternError as e:
        raise _bad(e) from e


def apply_titles(
    data: ApplyRequest,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Set the selected books' titles from their filenames, using the saved pattern."""
    try:
        return renames.apply_titles(db, data.path, data.ids)
    except PatternError as e:
        raise _bad(e) from e


def apply_renames(
    data: ApplyRequest,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Rename the selected books' files onto the saved pattern."""
    try:
        return renames.apply_renames(db, data.path, data.ids)
    except PatternError as e:
        raise _bad(e) from e


def get_variant_rules(
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """The library's own variant markers, in the order they are checked."""
    return {"rules": variant_rules.load_rules(db)}


def save_variant_rules(
    data: VariantRulesIn,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Replace the whole rule list; its order is the order rules are checked."""
    try:
        rules = variant_rules.save_rules(db, [r.model_dump() for r in data.rules])
    except variant_rules.RuleError as e:
        raise _bad(e) from e
    return {"rules": rules}
