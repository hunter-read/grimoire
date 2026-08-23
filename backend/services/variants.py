"""Variant grouping: hiding a second copy without losing it (issues #304, #306).

A library holds several files of the same thing — a printer-friendly cut beside
the screen edition, a form-fillable sheet, a gridless battle map, a v1.0.0
superseded by v1.0.1. Each is a real file the user owns, so each keeps its own
row and id and stays fully readable. What changes is that one row is the
*parent* and the rest point at it, and only the parent appears in listings,
counts, and search.

The rules, all enforced here rather than in the schema:

* **Two levels only.** A variant may not itself have variants. This makes cycles
  impossible by construction and keeps the picker a flat list rather than a tree
  the user has to navigate.
* **Same collection.** A map cannot be a variant of a book. Enforced structurally
  by taking the model as a parameter — there is no cross-model call.
* **Nothing is hidden by default.** ``parents_only`` is opt-in per query site.

That last point is deliberate. A mapper-level default or ``with_loader_criteria``
would apply to *every* query, including the by-id lookups that must still resolve
a variant and the maintenance sweeps that must still see one — failing open in
the dangerous direction. One explicit, greppable call per browse site is the
point, not an inconvenience.
"""
from typing import Any, Iterable, Optional, Sequence

from sqlalchemy import func
from sqlalchemy.orm import Query, Session

from ..models.variants import VARIANT_KINDS


class VariantError(Exception):
    """A variant link was refused. Routers map this to a 400/409."""

    def __init__(self, message: str, code: str = "invalid") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def parent_filter(model: Any) -> Any:
    """The bare "is not a variant" clause.

    Separate from :func:`parents_only` for the aggregate sites, which select
    columns rather than entities and so have no ``Query`` worth wrapping —
    ``db.query(func.count(Book.id)).filter(parent_filter(Book))``.
    """
    return model.variant_parent_id.is_(None)


def parents_only(q: Query, model: Any) -> Query:
    """Restrict a browse query to variant parents.

    ``model`` is passed explicitly rather than inferred from the query, because
    the callers that need this most (counts, aggregates) do not select entities.
    """
    return q.filter(parent_filter(model))


def serialize_variant(record: Any) -> dict:
    """One row of a version picker.

    Shared across books, maps, tokens, and audio so the four viewers can render
    the same component. Book-only fields are included when present rather than
    branching per collection.
    """
    data = {
        "id": record.id,
        "kind": record.variant_kind or "",
        "label": record.variant_label or "",
        "filename": record.filename,
        "relative_path": record.relative_path,
        "file_size": record.file_size or 0,
        "is_missing": bool(getattr(record, "is_missing", False)),
    }
    title = getattr(record, "title", None)
    if title is not None:
        data["title"] = title
    page_count = getattr(record, "page_count", None)
    if page_count is not None:
        data["page_count"] = page_count
    mime_type = getattr(record, "mime_type", None)
    if mime_type is not None:
        data["mime_type"] = mime_type
    return data


def variants_of(db: Session, model: Any, parent_id: str) -> list[Any]:
    """Every variant of ``parent_id``, ordered for stable picker display."""
    return (
        db.query(model)
        .filter(model.variant_parent_id == parent_id)
        .order_by(model.variant_kind, model.variant_label, model.filename)
        .all()
    )


def variant_counts(db: Session, model: Any, parent_ids: Sequence[str]) -> dict[str, int]:
    """``{parent_id: variant count}`` for a page of list rows, in one query.

    List serializers call this once per page rather than per row, which is what
    keeps the badge from costing a query per book.
    """
    ids = [pid for pid in parent_ids if pid]
    if not ids:
        return {}
    rows = (
        db.query(model.variant_parent_id, func.count(model.id))
        .filter(model.variant_parent_id.in_(ids))
        .group_by(model.variant_parent_id)
        .all()
    )
    return {parent_id: count for parent_id, count in rows}


def family_for(db: Session, model: Any, record: Any) -> tuple[Any, list[Any]]:
    """The (parent, variants) pair a record belongs to, from either end.

    A viewer showing a variant needs the whole family to render its picker, and
    it does not know in advance whether the id it was handed is the parent or one
    of the variants.
    """
    parent = record
    if record.variant_parent_id:
        found = db.query(model).filter_by(id=record.variant_parent_id).first()
        # A dangling parent id (the parent was deleted outside the service layer)
        # leaves the record standing alone rather than showing an empty family.
        parent = found or record
    return parent, variants_of(db, model, parent.id)


def validate_kind(kind: str) -> str:
    """Normalise and check a variant kind against the closed vocabulary."""
    cleaned = (kind or "").strip().lower()
    if cleaned not in VARIANT_KINDS:
        raise VariantError(
            f"Unknown variant kind '{kind}'. Expected one of: "
            f"{', '.join(sorted(VARIANT_KINDS))}.",
            code="invalid",
        )
    return cleaned


def assert_can_parent(db: Session, model: Any, parent_id: str, child_id: str) -> tuple[Any, Any]:
    """Check that ``child_id`` may become a variant of ``parent_id``.

    Returns the two rows so the caller does not re-query them. Raises
    :class:`VariantError` with a message meant for the user, since every one of
    these is a thing they can see and fix in the UI.
    """
    if parent_id == child_id:
        raise VariantError("An item cannot be a variant of itself.", code="invalid")

    parent = db.query(model).filter_by(id=parent_id).first()
    if parent is None:
        raise VariantError("The item chosen as the main version no longer exists.", code="not_found")
    child = db.query(model).filter_by(id=child_id).first()
    if child is None:
        raise VariantError("The item chosen as a variant no longer exists.", code="not_found")

    # Two levels only. Linking under a variant would build a chain nobody can see
    # the top of, and is almost always a mis-click for "link to its parent".
    if parent.variant_parent_id:
        raise VariantError(
            "That item is already a variant of something else. "
            "Link to its main version instead.",
            code="conflict",
        )
    child_count = db.query(func.count(model.id)).filter(
        model.variant_parent_id == child_id
    ).scalar()
    if child_count:
        raise VariantError(
            f"That item has {child_count} variant(s) of its own. Unlink them first.",
            code="conflict",
        )
    # Redundant given the two rules above — a two-level tree cannot cycle — but
    # cheap, and it documents the invariant for anyone relaxing those rules.
    if parent.variant_parent_id == child_id:
        raise VariantError("That would create a loop.", code="conflict")

    return parent, child


def link(
    db: Session, model: Any, parent_id: str, child_id: str, kind: str, label: str = ""
) -> Any:
    """Make ``child_id`` a variant of ``parent_id``. Does not commit."""
    parent, child = assert_can_parent(db, model, parent_id, child_id)
    child.variant_parent_id = parent.id
    child.variant_kind = validate_kind(kind)
    child.variant_label = (label or "").strip()[:120]
    return child


def unlink(db: Session, model: Any, ids: Iterable[str]) -> list[str]:
    """Promote variants back to standalone entries. Does not commit."""
    wanted = [i for i in ids if i]
    if not wanted:
        return []
    unlinked = []
    for record in db.query(model).filter(model.id.in_(wanted)).all():
        if record.variant_parent_id is None:
            continue
        record.variant_parent_id = None
        record.variant_kind = ""
        record.variant_label = ""
        unlinked.append(record.id)
    return unlinked


def unlink_children(db: Session, model: Any, parent_id: str) -> int:
    """Promote every variant of ``parent_id``. Does not commit.

    Used when a parent is deleted: a variant is a real file that still exists, so
    orphaning it into permanent invisibility would be silent data loss.
    """
    children = variants_of(db, model, parent_id)
    for child in children:
        child.variant_parent_id = None
        child.variant_kind = ""
        child.variant_label = ""
    return len(children)


def promote(
    db: Session, model: Any, new_parent_id: str, old_parent_id: str, kind: str, label: str = ""
) -> int:
    """Make ``new_parent_id`` the main version of ``old_parent_id``'s family.

    The case this exists for: a user linked a printable copy under a
    form-fillable one, then met a third copy they consider the real edition.
    Plain :func:`link` cannot express that — it refuses to put a parent under
    something else ("that item has variants of its own"), which leaves the user
    stuck with whichever copy they happened to review first.

    So the whole family moves at once. ``old_parent_id`` becomes a variant of
    ``new_parent_id`` carrying ``kind``/``label``, and its existing children
    re-home onto the new parent rather than dangling under a row that is now
    itself a variant — that would be the three-level tree
    :func:`assert_can_parent` exists to prevent.

    Returns the number of rows re-homed, the old parent included. Does not
    commit.
    """
    if new_parent_id == old_parent_id:
        raise VariantError("An item cannot be a variant of itself.", code="invalid")

    new_parent = db.query(model).filter_by(id=new_parent_id).first()
    if new_parent is None:
        raise VariantError("The item chosen as the main version no longer exists.", code="not_found")
    old_parent = db.query(model).filter_by(id=old_parent_id).first()
    if old_parent is None:
        raise VariantError("The item being replaced no longer exists.", code="not_found")

    # The new parent may itself be a variant of the old one (the common path:
    # the user is promoting a copy they already linked). Detaching it first is
    # what makes that case legal rather than a loop.
    if new_parent.variant_parent_id and new_parent.variant_parent_id != old_parent_id:
        raise VariantError(
            "That item is already a variant of something else. "
            "Link to its main version instead.",
            code="conflict",
        )
    if old_parent.variant_parent_id:
        raise VariantError(
            "The item being replaced is itself a variant. Promote its main version instead.",
            code="conflict",
        )

    new_parent.variant_parent_id = None
    new_parent.variant_kind = ""
    new_parent.variant_label = ""

    moved = 0
    for child in variants_of(db, model, old_parent_id):
        if child.id == new_parent_id:
            continue
        child.variant_parent_id = new_parent_id
        moved += 1

    old_parent.variant_parent_id = new_parent_id
    old_parent.variant_kind = validate_kind(kind)
    old_parent.variant_label = (label or "").strip()[:120]
    return moved + 1


def reparent_children(
    db: Session, model: Any, parent_id: str, new_parent_id: Optional[str]
) -> int:
    """Move a parent's variants onto ``new_parent_id``, or promote them all.

    ``new_parent_id`` must already be one of the variants — the caller is
    replacing a deleted parent with one of its own family, which is the only
    reparenting that keeps the two-level rule intact for free.
    """
    if not new_parent_id:
        return unlink_children(db, model, parent_id)

    children = variants_of(db, model, parent_id)
    ids = {c.id for c in children}
    if new_parent_id not in ids:
        raise VariantError(
            "The replacement main version must be one of this item's variants.",
            code="invalid",
        )
    moved = 0
    for child in children:
        if child.id == new_parent_id:
            # Promoted to parent: it can no longer describe itself as a variant.
            child.variant_parent_id = None
            child.variant_kind = ""
            child.variant_label = ""
            continue
        child.variant_parent_id = new_parent_id
        moved += 1
    return moved
