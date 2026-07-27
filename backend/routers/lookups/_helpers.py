"""Shared helpers for the lookups router."""
from typing import Any

from sqlalchemy.orm import Session

from ...models import (
    Book,
    DiceMaterial,
    GameSystem,
    Genre,
    License,
    ParentSystem,
    SystemFamily,
)


def serialize_genre(g: Genre) -> dict[str, Any]:
    return {
        "id": g.id,
        "name": g.name,
        "parent_id": g.parent_id,
        "is_default": bool(g.is_default),
        "sort_order": g.sort_order or 0,
    }


def serialize_family(f: SystemFamily) -> dict[str, Any]:
    return {
        "id": f.id,
        "name": f.name,
        "is_default": bool(f.is_default),
        "sort_order": f.sort_order or 0,
    }


def serialize_parent_system(p: ParentSystem) -> dict[str, Any]:
    return {
        "id": p.id,
        "name": p.name,
        "is_default": bool(p.is_default),
        "sort_order": p.sort_order or 0,
    }


def serialize_license(lic: License) -> dict[str, Any]:
    return {
        "id": lic.id,
        "name": lic.name,
        "is_default": bool(lic.is_default),
        "sort_order": lic.sort_order or 0,
    }


def serialize_dice_material(d: DiceMaterial) -> dict[str, Any]:
    return {
        "id": d.id,
        "name": d.name,
        "group": d.group or "Custom",
        "is_default": bool(d.is_default),
        "sort_order": d.sort_order or 0,
    }


def _matches(field: Any, name: str) -> bool:
    """Case-insensitive test whether a JSON list / scalar column holds ``name``."""
    if field is None:
        return False
    wanted = name.strip().lower()
    if isinstance(field, list):
        return any(str(v).strip().lower() == wanted for v in field)
    return str(field).strip().lower() == wanted


def count_genre_usage(db: Session, name: str) -> int:
    """Count systems + books whose ``genres`` list contains ``name``.

    JSON membership isn't portable in SQLite without json1 filtering, so this
    loads the (small) candidate columns and checks in Python. Genre lists are
    tiny and the lookup-management screens are admin-only, so the cost is fine.
    """
    count = 0
    for (genres,) in db.query(GameSystem.genres).all():
        if _matches(genres, name):
            count += 1
    for (genres,) in db.query(Book.genres).all():
        if _matches(genres, name):
            count += 1
    return count


def count_family_usage(db: Session, name: str) -> int:
    """Count systems whose ``system_family`` equals ``name`` (case-insensitive)."""
    count = 0
    for (fam,) in db.query(GameSystem.system_family).all():
        if _matches(fam, name):
            count += 1
    return count


def count_parent_system_usage(db: Session, name: str) -> int:
    """Count systems whose ``parent_system`` equals ``name`` (case-insensitive)."""
    count = 0
    for (parent,) in db.query(GameSystem.parent_system).all():
        if _matches(parent, name):
            count += 1
    return count


def count_license_usage(db: Session, name: str) -> int:
    """Count systems + books whose ``license`` equals ``name`` (case-insensitive)."""
    count = 0
    for (lic,) in db.query(GameSystem.license).all():
        if _matches(lic, name):
            count += 1
    for (lic,) in db.query(Book.license).all():
        if _matches(lic, name):
            count += 1
    return count


def count_dice_material_usage(db: Session, name: str) -> int:
    """Count systems whose ``dice_materials`` list contains ``name``."""
    count = 0
    for (materials,) in db.query(GameSystem.dice_materials).all():
        if _matches(materials, name):
            count += 1
    return count
