"""Tests for the deferred model-thumbnail queue.

Rasterising a mesh is CPU-bound in Python and its cost varies by orders of
magnitude, so a heavy model is flagged during the scan and rendered afterwards —
the visual counterpart of the deferred-OCR queue, and deferred for the same
reason: none of that work belongs between the user and a finished library walk.
"""
import inspect
import os
import struct

import pytest

from backend.config import SessionLocal
from backend.indexer.media import _enrich_model
from backend.indexer import stl_render
from backend.indexer.stl_render import INLINE_TRIANGLE_BUDGET, MAX_TRIANGLES
from backend.models import Model3D
from backend.routers.library import _helpers
from backend.tests.conftest import make_model3d


class _Row:
    """Stand-in for a freshly built Model3D row, as _scan_media hands it over."""

    def __init__(self, relative_path="models/a.stl"):
        self.relative_path = relative_path
        self.triangle_count = 0
        self.is_supported = None
        self.thumbnail_pending = False


def _write_stl_header(path, triangles):
    """An STL whose *header* claims a triangle count, without the body.

    The deferral decision reads only the header, so this is all it takes to
    exercise it — and writing 4M real triangles would make the test unusable.
    """
    with open(path, "wb") as f:
        f.write(b"\0" * 80)
        f.write(struct.pack("<I", triangles))
        f.write(b"\0" * (triangles * 50))


class TestDeferralDecision:
    def test_light_mesh_renders_inline(self, tmp_path):
        p = tmp_path / "light.stl"
        _write_stl_header(str(p), 100)
        row = _Row()
        _enrich_model(row, str(p))
        assert row.triangle_count == 100
        assert row.thumbnail_pending is False

    def test_heavy_mesh_is_deferred(self, tmp_path):
        p = tmp_path / "heavy.stl"
        _write_stl_header(str(p), INLINE_TRIANGLE_BUDGET + 1)
        row = _Row()
        _enrich_model(row, str(p))
        assert row.thumbnail_pending is True

    def test_mesh_at_the_budget_still_renders_inline(self, tmp_path):
        """The budget is inclusive — a boundary slip would defer everything."""
        p = tmp_path / "edge.stl"
        _write_stl_header(str(p), INLINE_TRIANGLE_BUDGET)
        row = _Row()
        _enrich_model(row, str(p))
        assert row.thumbnail_pending is False

    def test_mesh_past_the_hard_cap_is_not_queued(self, tmp_path):
        """Past MAX_TRIANGLES nothing will render it, so queueing only churns.

        Left unflagged rather than pending, or the queue would pick it up on
        every run, spend its whole budget, and fail again forever.
        """
        p = tmp_path / "huge.stl"
        _write_stl_header(str(p), MAX_TRIANGLES + 1)
        row = _Row()
        _enrich_model(row, str(p))
        assert row.thumbnail_pending is False

    def test_unknown_triangle_count_is_not_deferred(self, tmp_path):
        """0 means "not a binary STL", which says nothing about weight."""
        p = tmp_path / "ascii.stl"
        p.write_text("solid x\nendsolid x\n")
        row = _Row()
        _enrich_model(row, str(p))
        assert row.triangle_count == 0
        assert row.thumbnail_pending is False


class TestQueueDrain:
    @pytest.fixture(autouse=True)
    def _clear_stop(self):
        """Start each drain from a clean stop flag.

        The flag is process-global and another suite may have left it set; a
        drain that sees it aborts before rendering anything, which would fail
        these tests for a reason that has nothing to do with the queue. The
        production entry points clear it the same way before starting a run.
        """
        _helpers.clear_stop()
        yield
        _helpers.clear_stop()

    def test_empty_queue_is_a_no_op(self):
        assert _helpers.run_model_thumbnail_queue() == 0

    def test_renders_a_pending_model(self, tmp_path, monkeypatch):
        src = tmp_path / "mini.stl"
        # One real triangle: enough to rasterise, trivial to write.
        with open(src, "wb") as f:
            f.write(b"\0" * 80)
            f.write(struct.pack("<I", 1))
            f.write(struct.pack("<3f", 0, 0, 1))
            for v in ((0, 0, 0), (10, 0, 0), (0, 10, 0)):
                f.write(struct.pack("<3f", *v))
            f.write(b"\0\0")
        m = make_model3d(filename="mini.stl", filepath=str(src), thumbnail_pending=True)

        assert _helpers.run_model_thumbnail_queue() == 1

        db = SessionLocal()
        try:
            row = db.query(Model3D).filter_by(id=m.id).first()
            assert row.has_thumbnail is True
            # Cleared either way, so the queue does not revisit it every scan.
            assert not row.thumbnail_pending
        finally:
            db.close()

    def test_writes_where_the_serving_route_looks(self, tmp_path):
        """A second spelling of the filename rule would strand every thumbnail."""
        import hashlib
        from pathlib import Path

        from backend.config import THUMB_DIR
        from backend.indexer import slugify

        src = tmp_path / "Dragon_Scan-01.stl"
        with open(src, "wb") as f:
            f.write(b"\0" * 80)
            f.write(struct.pack("<I", 1))
            f.write(struct.pack("<3f", 0, 0, 1))
            for v in ((0, 0, 0), (10, 0, 0), (0, 10, 0)):
                f.write(struct.pack("<3f", *v))
            f.write(b"\0\0")
        make_model3d(
            filename="Dragon_Scan-01.stl", filepath=str(src), thumbnail_pending=True
        )
        _helpers.run_model_thumbnail_queue()

        title = Path("Dragon_Scan-01.stl").stem.replace("_", " ").replace("-", " ")
        served = os.path.join(
            THUMB_DIR,
            "models",
            f"{slugify(title)}_{hashlib.md5(str(src).encode()).hexdigest()[:8]}.webp",
        )
        assert os.path.exists(served)

    def test_unreadable_mesh_clears_the_flag(self, tmp_path):
        """One bad file must not be retried on every scan forever."""
        src = tmp_path / "broken.stl"
        src.write_bytes(b"not a mesh")
        m = make_model3d(filename="broken.stl", filepath=str(src), thumbnail_pending=True)

        _helpers.run_model_thumbnail_queue()

        db = SessionLocal()
        try:
            row = db.query(Model3D).filter_by(id=m.id).first()
            assert not row.thumbnail_pending
            assert not row.has_thumbnail
        finally:
            db.close()

    def test_missing_file_does_not_stall_the_drain(self, tmp_path):
        make_model3d(filepath="/tmp/definitely-absent.stl", thumbnail_pending=True)
        # The point is that it returns at all rather than raising.
        assert _helpers.run_model_thumbnail_queue() == 0

    def test_lightest_first(self, tmp_path, monkeypatch):
        """An interrupted drain should have produced as many previews as it could."""
        seen = []
        monkeypatch.setattr(
            _helpers, "_thumbnail_one_model", lambda mid: seen.append(mid) or "done"
        )
        heavy = make_model3d(triangle_count=900_000, thumbnail_pending=True)
        light = make_model3d(triangle_count=1_200, thumbnail_pending=True)
        _helpers.run_model_thumbnail_queue()
        assert seen.index(light.id) < seen.index(heavy.id)

    def test_stop_request_leaves_the_rest_pending(self, monkeypatch):
        """A stop must be resumable — the flag is what makes the next run continue."""
        make_model3d(thumbnail_pending=True)
        make_model3d(thumbnail_pending=True)
        monkeypatch.setattr(_helpers, "is_stop_requested", lambda: True)
        assert _helpers.run_model_thumbnail_queue() == 0

        db = SessionLocal()
        try:
            assert db.query(Model3D).filter_by(thumbnail_pending=True).count() >= 2
        finally:
            db.close()


class TestQueueTimeout:
    def test_budget_is_longer_than_the_scan_time_one(self):
        from backend.indexer.constants import _THUMBNAIL_TIMEOUT

        # The whole point of deferring: work refused inline gets a real chance.
        assert _helpers.MODEL_THUMBNAIL_TIMEOUT > _THUMBNAIL_TIMEOUT

    def test_budget_covers_the_largest_allowed_mesh(self):
        """The timeout must clear the worst case the caps actually permit.

        Asserted as a relationship rather than a literal: pinning the number
        only restated the constant, so raising MAX_TRIANGLES could leave the
        budget too small without any test objecting — and the symptom of that is
        a silently missing preview.

        ~350k triangles/sec measured on the streaming path of a fast desktop.

        The 4x is a hardware ratio, not a safety fudge: Grimoire's usual home is
        a NAS or mini-PC, and this rasteriser is single-threaded pure Python, so
        a host several times slower per core is the ordinary case rather than
        the pathological one. The budget has to clear the worst allowed mesh
        *there*, because the failure is silent — no preview, no error, and the
        pending flag cleared so it is never retried.
        """
        measured_rate = 350_000
        slow_host_factor = 4
        worst_case = stl_render.MAX_TRIANGLES / measured_rate
        assert _helpers.MODEL_THUMBNAIL_TIMEOUT >= worst_case * slow_host_factor


class TestScanStatus:
    def test_queue_counters_are_exposed(self, client, admin_headers):
        """Strict response model: a counter it omits never reaches the UI."""
        body = client.get("/api/scan-status", headers=admin_headers).json()
        for field in ("total_thumbs", "thumbs_done", "thumbs_current"):
            assert field in body, f"missing field: {field}"


class TestStartupRecovery:
    """A restart mid-drain must not strand the queue.

    The flag lives in the database precisely so an interrupted run resumes. The
    pass that picks it back up at boot is the startup scan itself — main.py runs
    run_rescan_sync in a thread — rather than a separate recovery worker, so
    what matters is that a rescan always reaches the drain.
    """

    def test_startup_scan_drains_pending_models(self, monkeypatch):
        _helpers.clear_stop()
        _helpers._set_status({**_helpers._DEFAULT_STATUS})
        calls = []
        monkeypatch.setattr(_helpers, "scan_library", lambda *a, **k: {})
        monkeypatch.setattr(_helpers, "run_model_thumbnail_queue", lambda: calls.append("thumbs"))
        monkeypatch.setattr(_helpers, "run_ocr_queue", lambda: calls.append("ocr"))
        _helpers.run_rescan_sync()
        # Thumbnails first: bounded and quick, where OCR of a scanned library
        # can run for hours.
        assert calls == ["thumbs", "ocr"]

    def test_rescan_defers_to_a_run_already_in_progress(self, monkeypatch):
        called = []
        monkeypatch.setattr(_helpers, "run_model_thumbnail_queue", lambda: called.append(1))
        monkeypatch.setattr(
            _helpers, "_get_status", lambda: {"running": True, "phase": "scanning"}
        )
        _helpers.run_rescan_sync()
        assert called == []

    def test_startup_wires_the_scan_that_drains(self):
        """main.py must call the worker the drain actually lives in.

        Pins the wiring itself: the queue was previously drained only by
        functions main.py did not call, which is invisible to any test that
        invokes those functions directly.
        """
        import backend.main as main

        assert hasattr(main, "run_rescan_sync")
        src = inspect.getsource(main)
        assert "run_rescan_sync()" in src


class TestThumbnailOneModel:
    def test_unknown_id_is_skipped(self):
        _helpers.clear_stop()
        assert _helpers._thumbnail_one_model("no-such-id") == "skipped"

    def test_a_model_not_flagged_is_skipped(self):
        """Guards a double-drain: two passes must not re-render the same row."""
        _helpers.clear_stop()
        m = make_model3d(thumbnail_pending=False)
        assert _helpers._thumbnail_one_model(m.id) == "skipped"


class TestModelThumbnailRequeue:
    """Existing rows must be able to recover a missing preview.

    A model registered while the renderer refused it sits at has_thumbnail=0 and
    thumbnail_pending=0 — a state no code path revisits, so without this the
    library would stay preview-less through every future rescan.
    """

    def _row(self, has_thumb=False, pending=False):
        class R:
            has_thumbnail = has_thumb
            thumbnail_pending = pending

        return R()

    def test_stale_model_is_requeued(self):
        from backend.indexer.media import _needs_model_thumbnail_requeue

        assert _needs_model_thumbnail_requeue(self._row(), ".stl") is True

    def test_model_with_a_preview_is_left_alone(self):
        from backend.indexer.media import _needs_model_thumbnail_requeue

        assert _needs_model_thumbnail_requeue(self._row(has_thumb=True), ".stl") is False

    def test_already_pending_is_not_requeued(self):
        """It is already on the queue; re-flagging would just churn."""
        from backend.indexer.media import _needs_model_thumbnail_requeue

        assert _needs_model_thumbnail_requeue(self._row(pending=True), ".stl") is False

    def test_non_model_extension_is_ignored(self):
        from backend.indexer.media import _needs_model_thumbnail_requeue

        assert _needs_model_thumbnail_requeue(self._row(), ".png") is False
