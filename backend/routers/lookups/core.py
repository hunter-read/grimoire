"""Genre and system-family lookup endpoint handlers (issue #202).

Reads are available to any authenticated user (they power editor dropdowns);
mutations are admin-only. Deleting a value that is still attached to a system or
book is blocked with 409 unless ``?force=true`` is passed, so the UI can warn
and confirm first.
"""
from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user, require_admin
from ...config import get_db
from ...models import DiceMaterial, Genre, License, ParentSystem, SystemFamily
from ._helpers import (
    count_dice_material_usage,
    count_family_usage,
    count_genre_usage,
    count_license_usage,
    count_parent_system_usage,
    serialize_dice_material,
    serialize_family,
    serialize_genre,
    serialize_license,
    serialize_parent_system,
)
from ._schemas import (
    DiceMaterialCreate,
    GenreCreate,
    LicenseCreate,
    ParentSystemCreate,
    SystemFamilyCreate,
)


# --- Genres -------------------------------------------------------------------


def list_genres(
    _: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return all genres, ordered for a tiered picker (parents then children)."""
    genres = (
        db.query(Genre).order_by(Genre.sort_order, Genre.name).all()
    )
    return {"genres": [serialize_genre(g) for g in genres]}


def create_genre(
    data: GenreCreate,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    name = data.name.strip()
    existing = db.query(Genre).filter(Genre.name.ilike(name)).first()
    if existing:
        raise HTTPException(409, "A genre with that name already exists")
    if data.parent_id:
        parent = db.query(Genre).filter_by(id=data.parent_id).first()
        if not parent:
            raise HTTPException(404, "Parent genre not found")
    max_order = db.query(Genre).count()
    genre = Genre(
        name=name, parent_id=data.parent_id, is_default=False, sort_order=max_order
    )
    db.add(genre)
    db.commit()
    return serialize_genre(genre)


def delete_genre(
    genre_id: str,
    force: bool = Query(False),
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    genre = db.query(Genre).filter_by(id=genre_id).first()
    if not genre:
        raise HTTPException(404, "Genre not found")
    usage = count_genre_usage(db, genre.name)
    if usage and not force:
        raise HTTPException(
            409,
            detail={
                "message": "Genre is in use",
                "usage_count": usage,
                "name": genre.name,
            },
        )
    # Children are removed by the cascade on the self-referential relationship.
    db.delete(genre)
    db.commit()
    return {"status": "ok", "removed_usage": usage}


# --- System families ----------------------------------------------------------


def list_system_families(
    _: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    families = (
        db.query(SystemFamily).order_by(SystemFamily.sort_order, SystemFamily.name).all()
    )
    return {"families": [serialize_family(f) for f in families]}


def create_system_family(
    data: SystemFamilyCreate,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    name = data.name.strip()
    existing = db.query(SystemFamily).filter(SystemFamily.name.ilike(name)).first()
    if existing:
        raise HTTPException(409, "A system family with that name already exists")
    max_order = db.query(SystemFamily).count()
    family = SystemFamily(name=name, is_default=False, sort_order=max_order)
    db.add(family)
    db.commit()
    return serialize_family(family)


def delete_system_family(
    family_id: str,
    force: bool = Query(False),
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    family = db.query(SystemFamily).filter_by(id=family_id).first()
    if not family:
        raise HTTPException(404, "System family not found")
    usage = count_family_usage(db, family.name)
    if usage and not force:
        raise HTTPException(
            409,
            detail={
                "message": "System family is in use",
                "usage_count": usage,
                "name": family.name,
            },
        )
    db.delete(family)
    db.commit()
    return {"status": "ok", "removed_usage": usage}


# --- Parent systems -----------------------------------------------------------


def list_parent_systems(
    _: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    parents = (
        db.query(ParentSystem).order_by(ParentSystem.sort_order, ParentSystem.name).all()
    )
    return {"parent_systems": [serialize_parent_system(p) for p in parents]}


def create_parent_system(
    data: ParentSystemCreate,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    name = data.name.strip()
    existing = db.query(ParentSystem).filter(ParentSystem.name.ilike(name)).first()
    if existing:
        raise HTTPException(409, "A parent system with that name already exists")
    max_order = db.query(ParentSystem).count()
    parent = ParentSystem(name=name, is_default=False, sort_order=max_order)
    db.add(parent)
    db.commit()
    return serialize_parent_system(parent)


def delete_parent_system(
    parent_id: str,
    force: bool = Query(False),
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    parent = db.query(ParentSystem).filter_by(id=parent_id).first()
    if not parent:
        raise HTTPException(404, "Parent system not found")
    usage = count_parent_system_usage(db, parent.name)
    if usage and not force:
        raise HTTPException(
            409,
            detail={
                "message": "Parent system is in use",
                "usage_count": usage,
                "name": parent.name,
            },
        )
    db.delete(parent)
    db.commit()
    return {"status": "ok", "removed_usage": usage}


# --- Licenses -----------------------------------------------------------------


def list_licenses(
    _: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    licenses = db.query(License).order_by(License.sort_order, License.name).all()
    return {"licenses": [serialize_license(lic) for lic in licenses]}


def create_license(
    data: LicenseCreate,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    name = data.name.strip()
    existing = db.query(License).filter(License.name.ilike(name)).first()
    if existing:
        raise HTTPException(409, "A license with that name already exists")
    max_order = db.query(License).count()
    lic = License(name=name, is_default=False, sort_order=max_order)
    db.add(lic)
    db.commit()
    return serialize_license(lic)


def delete_license(
    license_id: str,
    force: bool = Query(False),
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    lic = db.query(License).filter_by(id=license_id).first()
    if not lic:
        raise HTTPException(404, "License not found")
    usage = count_license_usage(db, lic.name)
    if usage and not force:
        raise HTTPException(
            409,
            detail={
                "message": "License is in use",
                "usage_count": usage,
                "name": lic.name,
            },
        )
    db.delete(lic)
    db.commit()
    return {"status": "ok", "removed_usage": usage}


# --- Dice / materials ---------------------------------------------------------


def list_dice_materials(
    _: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    materials = (
        db.query(DiceMaterial).order_by(DiceMaterial.sort_order, DiceMaterial.name).all()
    )
    return {"dice_materials": [serialize_dice_material(d) for d in materials]}


def create_dice_material(
    data: DiceMaterialCreate,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    name = data.name.strip()
    existing = db.query(DiceMaterial).filter(DiceMaterial.name.ilike(name)).first()
    if existing:
        raise HTTPException(409, "A dice/material with that name already exists")
    max_order = db.query(DiceMaterial).count()
    material = DiceMaterial(
        name=name,
        group=(data.group or "Custom").strip() or "Custom",
        is_default=False,
        sort_order=max_order,
    )
    db.add(material)
    db.commit()
    return serialize_dice_material(material)


def delete_dice_material(
    material_id: str,
    force: bool = Query(False),
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    material = db.query(DiceMaterial).filter_by(id=material_id).first()
    if not material:
        raise HTTPException(404, "Dice/material not found")
    usage = count_dice_material_usage(db, material.name)
    if usage and not force:
        raise HTTPException(
            409,
            detail={
                "message": "Dice/material is in use",
                "usage_count": usage,
                "name": material.name,
            },
        )
    db.delete(material)
    db.commit()
    return {"status": "ok", "removed_usage": usage}
