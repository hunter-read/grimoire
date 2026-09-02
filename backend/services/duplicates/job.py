"""The duplicate-detection scan: an explicit, cancellable, admin-run job.

Hashing and comparing a whole library is expensive, so this never runs on
startup or as part of a rescan - issue #304 asks for a triggered scan with
progress, and that is what this is.

The status plumbing deliberately mirrors ``routers/library/_helpers`` (Valkey
when available, an in-process dict otherwise) but keeps its **own** keys.
Sharing ``_SCAN_KEY`` would be a bug in both directions: ``run_rescan_sync``
replaces the whole status dict when it starts, which would erase a duplicate
scan mid-run, and ``/cancel-scan`` would stop whichever job happened to be
listening. Two jobs, two keys, two cancel buttons.

The ~60 lines of status handling here are near-identical to the library
helper's. Extracting a shared ``JobStatus`` is worth doing, but it would mean
touching the scan path that every install depends on, so it is left as a
follow-up rather than bundled into this feature.
"""
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Optional, Sequence

from sqlalchemy.orm import Session

from ...config import SessionLocal, _valkey
from ...models import Audio, Book, GenericMap, Token
from ...models.duplicates import DuplicateGroup
from . import dismissals, scoring, signals
from .grid import is_grid_pair
from .grouping import Edge, build_groups

logger = logging.getLogger("grimoire.duplicates")

try:
    from redis.exceptions import RedisError as _RedisError

    _VALKEY_ERRORS: tuple = (_RedisError,)
except ImportError:  # redis not installed - _valkey is always None
    _VALKEY_ERRORS = ()

_DUP_KEY = "grimoire:duplicate_scan_status"
_DUP_STOP = "grimoire:duplicate_scan_stop"

RESOURCE_MODELS: dict[str, Any] = {
    "book": Book,
    "map": GenericMap,
    "token": Token,
    "audio": Audio,
}

DEFAULT_STATUS: dict = {
    "running": False,
    "phase": None,          # hashing | metadata | text | grouping
    "accuracy": None,       # which search accuracy this run used
    "resource_type": None,
    "scanned": 0,
    "total": 0,
    "groups_found": 0,
    "scan_id": None,
    "started_at": None,
    "finished_at": None,
    "error": None,
}

_status: dict = dict(DEFAULT_STATUS)
_stop_requested: bool = False

# How often the comparison loops check for a cancel request. Small enough that
# Stop feels immediate, large enough not to hammer Valkey.
_STOP_CHECK_INTERVAL = 100

# Progress is reported far more often than the stop flag is polled: checking for
# cancellation touches shared state, while reporting only updates a status dict.
# Tying the two together left the bar frozen for any library with fewer than
# _STOP_CHECK_INTERVAL comparisons to make.
_PROGRESS_INTERVAL = 5


def request_stop() -> None:
    global _stop_requested
    _stop_requested = True
    if _valkey:
        try:
            _valkey.set(_DUP_STOP, "1", ex=3600)
        except _VALKEY_ERRORS as e:
            logger.warning("Valkey set(dup stop) failed, using in-process flag: %s", e)


def clear_stop() -> None:
    global _stop_requested
    _stop_requested = False
    if _valkey:
        try:
            _valkey.delete(_DUP_STOP)
        except _VALKEY_ERRORS as e:
            logger.warning("Valkey delete(dup stop) failed, using in-process flag: %s", e)


def is_stop_requested() -> bool:
    if _valkey:
        try:
            return bool(_valkey.exists(_DUP_STOP))
        except _VALKEY_ERRORS as e:
            logger.warning("Valkey exists(dup stop) failed, using in-process flag: %s", e)
    return _stop_requested


def get_status() -> dict:
    if _valkey:
        try:
            raw = _valkey.get(_DUP_KEY)
            if raw:
                return json.loads(raw)
        except (*_VALKEY_ERRORS, ValueError) as e:
            logger.warning("Valkey get(dup status) failed, using in-process: %s", e)
    return dict(_status)


def set_status(updates: dict) -> None:
    global _status
    if _valkey:
        try:
            current = get_status()
            current.update(updates)
            _valkey.set(_DUP_KEY, json.dumps(current), ex=86400)
            return
        except _VALKEY_ERRORS as e:
            logger.warning("Valkey set(dup status) failed, using in-process: %s", e)
    _status.update(updates)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _candidates(db: Session, model: Any) -> list:
    """Rows worth comparing: present, and not already resolved into a variant."""
    return (
        db.query(model)
        .filter(model.variant_parent_id.is_(None), model.is_missing.isnot(True))
        .all()
    )


def detect_edges(
    db: Session,
    resource_type: str,
    records: Optional[list] = None,
    accuracy: str = signals.DEFAULT_ACCURACY,
    on_progress: Optional[Callable[[int, int], None]] = None,
) -> list[Edge]:
    """Run all three signals over one collection and return the raw edges.

    Split out from the job so it can be tested directly, without background
    tasks or status plumbing.

    ``accuracy`` selects how hard to look: ``exact`` runs only the byte-identical
    pass, while the fuzzier levels loosen the metadata/text cutoffs.

    ``on_progress(done, total)`` is called as the comparison passes advance.
    Without it a large library sits at 0% for the whole scan and then jumps to
    100%, because every expensive step happens inside this one call.
    """
    model = RESOURCE_MODELS[resource_type]
    rows = _candidates(db, model) if records is None else records
    cutoffs = signals.thresholds_for(accuracy)
    by_id = {r.id: r for r in rows}
    edges: list[Edge] = []
    seen_pairs: set = set()

    def add(a: str, b: str, reason: str, score: float) -> None:
        pair = frozenset((a, b))
        marker = (pair, reason)
        if a == b or marker in seen_pairs:
            return
        seen_pairs.add(marker)
        edges.append(Edge(a=a, b=b, reason=reason, score=score))

    # 1. Byte-identical files. Indexed lookup, no file reads.
    for ids in signals.hash_groups(db, model):
        present = [i for i in ids if i in by_id]
        for i, a in enumerate(present):
            for b in present[i + 1:]:
                add(a, b, "hash", 1.0)

    # 2. Name/author similarity, blocked so this stays sub-quadratic.
    blocks: dict[str, list] = {}
    for record in rows:
        key = signals.name_key(record)
        if key:
            blocks.setdefault(signals.block_key(key), []).append(record)

    metadata_cutoff = cutoffs["metadata"]
    if metadata_cutoff is not None:
        # Total comparisons up front, so progress is a real fraction rather than
        # a bar that fills at an unknown rate.
        total_pairs = sum(len(b) * (len(b) - 1) // 2 for b in blocks.values() if len(b) > 1)
        checked = 0
        for bucket in blocks.values():
            if len(bucket) < 2:
                continue
            for i, a in enumerate(bucket):
                for b in bucket[i + 1:]:
                    checked += 1
                    if checked % _STOP_CHECK_INTERVAL == 0 and is_stop_requested():
                        return edges
                    if on_progress and checked % _PROGRESS_INTERVAL == 0:
                        on_progress(checked, total_pairs)
                    score = signals.metadata_score(a, b)
                    if score >= metadata_cutoff:
                        add(a.id, b.id, "metadata", round(score, 3))
        if on_progress:
            on_progress(total_pairs, total_pairs)

    # 3. Gridded / gridless maps, which share neither bytes nor text.
    if resource_type == "map":
        for bucket in blocks.values():
            for i, a in enumerate(bucket):
                for b in bucket[i + 1:]:
                    if is_grid_pair(a.filename, a.file_size or 0, b.filename, b.file_size or 0):
                        add(a.id, b.id, "grid", 0.75)

    # 4. Text overlap, only for pairs something cheaper already flagged - the
    #    cross-product would mean a fingerprint for every book in the library.
    text_cutoff = cutoffs["text"]
    if resource_type == "book" and text_cutoff is not None:
        fingerprints: dict[str, frozenset] = {}

        def fingerprint(book_id: str) -> frozenset:
            if book_id not in fingerprints:
                fingerprints[book_id] = signals.text_fingerprint(db, book_id)
            return fingerprints[book_id]

        candidates = [e for e in list(edges) if e.reason == "metadata"]
        for done, edge in enumerate(candidates, start=1):
            if is_stop_requested():
                break
            # Reported per edge rather than in batches: each one may read and
            # fingerprint two books, so this is the slowest thing the scan does
            # and the part most worth watching.
            if on_progress:
                on_progress(done, len(candidates))
            score = signals.text_score(fingerprint(edge.a), fingerprint(edge.b))
            if score >= text_cutoff:
                add(edge.a, edge.b, "text", round(score, 3))

    return edges


def _persist(db: Session, scan_id: str, resource_type: str, groups: list, by_id: dict) -> int:
    """Write this run's groups. Prior runs are cleared by the caller, at the end."""
    written = 0
    for group in groups:
        members = [by_id[i] for i in group.member_ids if i in by_id]
        if len(members) < 2:
            continue
        kinds = {}
        for record in members:
            other = next(m for m in members if m.id != record.id)
            kind, label = scoring.suggest_kind(record, other, resource_type)
            kinds[record.id] = {"kind": kind, "label": label}
        db.add(
            DuplicateGroup(
                scan_id=scan_id,
                resource_type=resource_type,
                group_key=group.key,
                member_ids=[m.id for m in members],
                confidence=group.confidence,
                reasons=group.reasons,
                edges=[
                    {"a": e.a, "b": e.b, "reason": e.reason, "score": e.score}
                    for e in group.edges
                    if e.a in by_id and e.b in by_id
                ],
                suggested_parent_id=scoring.suggest_parent(members),
                suggested_kinds=kinds,
            )
        )
        written += 1
    return written


def run_detection_sync(
    resource_types: Optional[Sequence[str]] = None,
    accuracy: str = signals.DEFAULT_ACCURACY,
) -> dict:
    """Scan for duplicates across the requested collections.

    Returns the final status. Safe to call directly (tests do); the router runs
    it through ``BackgroundTasks``.
    """
    if get_status().get("running"):
        logger.info("A duplicate scan is already running - ignoring this request.")
        return get_status()

    wanted = [t for t in (resource_types or RESOURCE_MODELS.keys()) if t in RESOURCE_MODELS]
    if not wanted:
        wanted = list(RESOURCE_MODELS.keys())

    scan_id = str(uuid.uuid4())
    clear_stop()
    set_status(
        {
            **DEFAULT_STATUS,
            "running": True,
            "phase": "hashing",
            "accuracy": accuracy,
            "scan_id": scan_id,
            "started_at": _now(),
        }
    )

    db = SessionLocal()
    total_groups = 0
    cancelled = False
    try:
        dismissals.sweep_stale(db)
        db.commit()

        for resource_type in wanted:
            if is_stop_requested():
                cancelled = True
                break
            model = RESOURCE_MODELS[resource_type]
            rows = _candidates(db, model)
            set_status(
                {
                    "phase": "metadata",
                    "resource_type": resource_type,
                    "total": len(rows),
                    "scanned": 0,
                }
            )
            if len(rows) < 2:
                continue

            def report(done: int, total: int, _rt: str = resource_type) -> None:
                # `total` is comparisons, not rows: the bar tracks the work
                # actually being done rather than a row count that would sit
                # still through the expensive passes.
                set_status({"resource_type": _rt, "scanned": done, "total": max(total, done)})

            edges = detect_edges(db, resource_type, rows, accuracy=accuracy, on_progress=report)
            set_status({"phase": "grouping"})

            groups = build_groups(edges, dismissals.dismissed_pairs(db, resource_type))
            written = _persist(db, scan_id, resource_type, groups, {r.id: r for r in rows})
            db.commit()
            total_groups += written
            set_status({"groups_found": total_groups})
            logger.info(
                "Duplicate scan: %s - %d candidate group(s) from %d item(s)",
                resource_type,
                written,
                len(rows),
            )

        if is_stop_requested():
            cancelled = True

        if cancelled:
            # A partial result is worse than none: it reads as "nothing else was
            # found" when the scan simply stopped early.
            db.query(DuplicateGroup).filter_by(scan_id=scan_id).delete()
            db.commit()
            logger.info("Duplicate scan cancelled - discarded partial results.")
        else:
            # Swap in the new results only now, so the UI keeps showing the last
            # complete scan for the whole time this one was running.
            db.query(DuplicateGroup).filter(DuplicateGroup.scan_id != scan_id).delete(
                synchronize_session=False
            )
            db.commit()
    except Exception as exc:  # noqa: BLE001 - a failed scan must not kill the worker
        db.rollback()
        logger.exception("Duplicate scan failed")
        set_status({"error": str(exc)[:300]})
    finally:
        db.close()
        set_status(
            {
                "running": False,
                "phase": None,
                "resource_type": None,
                "finished_at": _now(),
            }
        )
        clear_stop()
    return get_status()
