"""Persisted output and memory of the duplicate-detection scan (issue #304).

Two tables, for two different lifetimes. :class:`DuplicateGroup` is *this run's*
findings — recomputed from scratch each scan and swapped in at the end, so the
review UI can page thousands of groups without holding them in a status blob.
:class:`DuplicateDismissal` is the opposite: a user's judgement that a set of
look-alikes are not duplicates, which has to outlive every future scan or the
tool re-proposes the same false positive forever.
"""
import datetime
from typing import Any, Optional

from sqlalchemy import DateTime, Float, Index, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow, _uuid


class DuplicateGroup(Base):
    """One cluster of look-alikes found by a detection run.

    Rows are keyed by ``scan_id`` and replaced wholesale: a new run writes its
    groups and only then deletes the previous run's, so the UI keeps showing the
    last complete result while a rescan is in flight rather than blanking out.
    """

    __tablename__ = "duplicate_groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # Which run produced this row. Lets a completed run replace its predecessor
    # atomically, and a cancelled run delete only its own partial output.
    scan_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)  # book | map | token | audio
    # sha256 of the sorted member ids — stable across re-runs, so a group keeps
    # its identity even as its confidence or reasons change.
    group_key: Mapped[str] = mapped_column(String(64), nullable=False)
    member_ids: Mapped[Optional[list[Any]]] = mapped_column(JSON, default=list)
    confidence: Mapped[Optional[float]] = mapped_column(Float, default=0.0)
    # Which signals fired: any of "hash", "metadata", "text", "grid".
    reasons: Mapped[Optional[list[Any]]] = mapped_column(JSON, default=list)
    # The pairwise matches this cluster was built from, as
    # ``[{"a": id, "b": id, "reason": str, "score": float}, ...]``.
    #
    # Kept because the cluster alone loses information the reviewer needs.
    # Union-find merges transitively: if D resembles A, B, and C, all four land
    # in one group even when the only real duplicate is A-B. Reviewing that
    # group as "D versus everything" both invents pairs that never matched and
    # hides the pair that did. The edges say which comparisons actually fired,
    # so review can show those and nothing else.
    edges: Mapped[Optional[list[Any]]] = mapped_column(JSON, default=list)
    # Advisory only — the user always picks. Highest page count, then largest
    # file, then oldest row.
    suggested_parent_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    suggested_kinds: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=dict)  # {member_id: variant_kind}
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)

    __table_args__ = (Index("ix_duplicate_groups_scan_type", "scan_id", "resource_type"),)


class DuplicateDismissal(Base):
    """A set of look-alikes a user has declared *not* duplicates.

    Detection is heuristic, so without this it proposes the same false positive
    on every scan and the tool becomes unusable on a library holding deliberate
    duplicates. The key is derived from member ids rather than from titles or
    hashes, so a dismissal survives the user renaming or re-hashing the files.

    Matching is done pair-wise rather than on the whole key (see
    ``services/duplicates/dismissals.py``): dismissing {A,B} must also suppress
    {A,B} inside a later {A,B,C}, while still letting C surface on its own.
    """

    __tablename__ = "duplicate_dismissals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)
    group_key: Mapped[str] = mapped_column(String(64), nullable=False)
    member_ids: Mapped[Optional[list[Any]]] = mapped_column(JSON, default=list)
    # No foreign key: the dismissal outlives the account that made it, and
    # losing a user should not resurrect every group they dismissed.
    dismissed_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, default="")
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)

    __table_args__ = (
        UniqueConstraint("resource_type", "group_key", name="uq_dismissal_group"),
        Index("ix_duplicate_dismissals_type", "resource_type"),
    )
