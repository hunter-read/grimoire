"""The render worker pool (issue #615): rendering out of process, crash isolation,
timeouts, idle retirement, and the in-process fallback (RENDER_WORKERS=0)."""
import io
import multiprocessing
import os
import signal
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import fitz  # type: ignore[import-untyped]
import pytest
from PIL import Image

from backend import config
from backend.render import ops, pool, worker


def _make_pdf(path, texts):
    doc = fitz.open()
    for text in texts:
        doc.new_page().insert_text((72, 72), text)
    doc.save(str(path))
    doc.close()
    return str(path)


@pytest.fixture
def pdf(tmp_path):
    return _make_pdf(tmp_path / "book.pdf", ["first page", "second page", "third page"])


@pytest.fixture
def workers(monkeypatch):
    """A fresh pool of the given size, shut down afterwards."""

    def use(size=1, idle_release=300):
        pool.shutdown()
        monkeypatch.setattr(config, "RENDER_WORKERS", size)
        monkeypatch.setattr(config, "PAGE_IDLE_RELEASE", idle_release)
        return pool._get_pool()

    yield use
    pool.shutdown()


def _worker_of(filepath):
    return pool._pool.slots[pool._pool.slot_for(filepath)]


def _webp_size(data):
    with Image.open(io.BytesIO(data)) as img:
        assert img.format == "WEBP"
        return img.size


class TestRenderingInWorkers:
    def test_page_tile_text_words_and_info(self, workers, pdf):
        workers(1)
        assert _webp_size(pool.render_page(pdf, 1, 600))[0] == 600
        assert _webp_size(pool.render_tile(pdf, 1, 1024, 0, 0)) == (1024, 1024)
        assert pool.page_text(pdf, 2) == "second page"
        words = pool.page_words(pdf, 3)
        assert [w["text"] for w in words["words"]] == ["third", "page"]
        assert pool.document_info(pdf) == {"page_count": 3, "width": 595.0, "height": 842.0}
        assert pool.document_metadata(pdf)["language"] == ""
        # The work happened in a worker, not here.
        assert _worker_of(pdf).proc.pid != os.getpid()

    def test_out_of_range_errors_cross_the_process_boundary(self, workers, pdf):
        workers(1)
        with pytest.raises(ops.PageOutOfRange) as page_err:
            pool.render_page(pdf, 4, 600)
        assert page_err.value.page_count == 3
        assert str(page_err.value) == "Page must be between 1 and 3"
        with pytest.raises(ops.TileOutOfRange, match="1x2 tiles at width 1024"):
            pool.render_tile(pdf, 1, 1024, 3, 0)

    def test_a_document_that_cannot_open_is_a_render_error(self, workers, tmp_path):
        workers(1)
        broken = tmp_path / "broken.pdf"
        broken.write_bytes(b"not a pdf at all")
        with pytest.raises(ops.RenderError):
            pool.render_page(str(broken), 1, 600)
        # The worker survives an ordinary failure.
        assert _worker_of(str(broken)).alive

    def test_a_book_always_goes_to_the_same_worker(self, workers, tmp_path):
        workers(4)
        paths = [_make_pdf(tmp_path / f"b{i}.pdf", ["x"]) for i in range(8)]
        for path in paths:
            pool.page_text(path, 1)
        first = {path: _worker_of(path).proc.pid for path in paths}
        for path in paths:
            pool.page_text(path, 1)
            assert _worker_of(path).proc.pid == first[path]
        # Eight paths over four slots: more than one worker was used.
        assert len(set(first.values())) > 1

    def test_evict_reaches_the_worker_holding_the_file(self, workers, tmp_path):
        workers(1)
        path = _make_pdf(tmp_path / "replaced.pdf", ["old text"])
        assert pool.page_text(path, 1) == "old text"
        os.unlink(path)  # replaced in place: the worker still holds the old inode
        _make_pdf(tmp_path / "replaced.pdf", ["new text"])
        assert pool.page_text(path, 1) == "old text"
        pool.evict(path)
        assert pool.page_text(path, 1) == "new text"

    def test_evict_never_starts_a_worker(self, workers, pdf):
        workers(1)
        pool.evict(pdf)
        assert pool._pool.slots == [None]


class TestCrashIsolation:
    def test_a_crashed_worker_fails_its_requests_and_is_replaced(self, workers, pdf):
        workers(1)
        pool.page_text(pdf, 1)
        crashed = _worker_of(pdf)
        # Freeze it so the next request is certainly in flight when it dies.
        os.kill(crashed.proc.pid, signal.SIGSTOP)
        with ThreadPoolExecutor(1) as ex:
            in_flight = ex.submit(pool.render_page, pdf, 1, 600)
            deadline = time.monotonic() + 10
            while not crashed.pending and time.monotonic() < deadline:
                time.sleep(0.01)
            os.kill(crashed.proc.pid, signal.SIGKILL)
            with pytest.raises(ops.RenderCrashError, match="killed by signal 9"):
                in_flight.result(timeout=30)
        # The next request gets a fresh worker and succeeds.
        assert pool.page_text(pdf, 2) == "second page"
        assert _worker_of(pdf).proc.pid != crashed.proc.pid

    def test_a_hung_worker_times_out_and_is_stopped(self, workers, pdf, monkeypatch):
        workers(1)
        pool.page_text(pdf, 1)
        hung = _worker_of(pdf)
        os.kill(hung.proc.pid, signal.SIGSTOP)
        monkeypatch.setattr(pool, "REQUEST_TIMEOUT", 0.5)
        with pytest.raises(ops.RenderTimeoutError):
            pool.page_text(pdf, 1)
        hung.proc.join(10)
        assert not hung.proc.is_alive()
        assert pool.page_text(pdf, 3) == "third page"

    def test_a_dead_worker_is_reaped_one_thread_at_a_time(self, workers, pdf):
        """Concurrent waits on one child race in waitpid, and the loser saw it alive.

        The killer and the reader both wait on a killed worker. The thread that
        loses the waitpid race gets ECHILD, which multiprocessing turns into "no
        exit code yet", so ``is_alive()`` reported a dead worker as running. The
        stand-in join holds each wait open long enough that, unserialised, the
        threads would overlap every time.
        """
        workers(1)
        pool.page_text(pdf, 1)
        current = _worker_of(pdf)
        real_join = current.proc.join
        guard = threading.Lock()
        inside = []
        most = []

        def slow_join(timeout=None):
            with guard:
                inside.append(1)
                most.append(len(inside))
            try:
                time.sleep(0.05)
                real_join(timeout)
            finally:
                with guard:
                    inside.pop()

        current.proc.join = slow_join
        os.kill(current.proc.pid, signal.SIGKILL)

        def wait_then_check(_):
            current._join(10)
            return current.proc.is_alive()

        with ThreadPoolExecutor(4) as ex:
            alive = list(ex.map(wait_then_check, range(4)))
        assert max(most) == 1
        assert alive == [False] * 4

    def test_a_worker_gone_before_the_send_is_retried_on_a_fresh_one(self, workers, pdf):
        workers(1)
        pool.page_text(pdf, 1)
        gone = _worker_of(pdf)
        real_worker_for = pool._pool.worker_for
        calls = []

        def stale_then_fresh(path):
            calls.append(path)
            if len(calls) == 1:
                with gone.lock:
                    gone.alive = False  # retired after being chosen
                return gone
            return real_worker_for(path)

        pool._pool.worker_for = stale_then_fresh
        assert pool.page_text(pdf, 2) == "second page"
        assert len(calls) == 2
        gone.stop()

    def test_a_worker_gone_twice_is_a_crash(self, workers, pdf):
        workers(1)
        pool.page_text(pdf, 1)
        gone = _worker_of(pdf)
        gone.stop()
        pool._pool.worker_for = lambda _path: gone
        with pytest.raises(ops.RenderCrashError):
            pool.page_text(pdf, 1)


class TestIdleRetirement:
    def test_an_idle_worker_is_stopped(self, workers, pdf):
        workers(1, idle_release=300)
        pool.page_text(pdf, 1)
        idle = _worker_of(pdf)
        assert pool.retire_idle_workers(now=idle.last_used + 299) == 0
        assert pool.retire_idle_workers(now=idle.last_used + 301) == 1
        assert not idle.proc.is_alive()
        assert pool._pool.slots == [None]
        # Reading again starts a new one.
        assert pool.page_text(pdf, 1) == "first page"

    def test_a_busy_worker_is_not_stopped(self, workers, pdf):
        workers(1)
        pool.page_text(pdf, 1)
        busy = _worker_of(pdf)
        with busy.lock:
            busy.pending[999] = None  # a request in flight
        assert busy.idle_since() is None
        assert pool.retire_idle_workers(now=time.monotonic() + 10_000) == 0
        with busy.lock:
            del busy.pending[999]

    def test_a_crashed_worker_is_cleared_from_its_slot(self, workers, pdf):
        workers(1)
        pool.page_text(pdf, 1)
        dead = _worker_of(pdf)
        dead.kill()
        assert pool.retire_idle_workers() == 0
        assert pool._pool.slots == [None]

    def test_the_sweeper_retires_workers_and_then_exits(self, workers, pdf):
        # A one-second window: the sweeper wakes each second (its floor).
        p = workers(1, idle_release=1)
        pool.page_text(pdf, 1)
        sweeper = p.sweeper
        assert sweeper is not None
        sweeper.join(15)
        assert not sweeper.is_alive()
        assert p.slots == [None]
        assert p.sweeper is None

    def test_no_sweeper_when_idle_release_is_off(self, workers, pdf):
        workers(1, idle_release=0)
        pool.page_text(pdf, 1)
        assert pool._pool.sweeper is None


class TestShutdown:
    def test_shutdown_stops_workers_and_a_new_pool_starts_on_demand(self, workers, pdf):
        workers(1)
        pool.page_text(pdf, 1)
        proc = _worker_of(pdf).proc
        pool.shutdown()
        assert not proc.is_alive()
        assert pool.page_text(pdf, 1) == "first page"

    def test_requests_in_flight_at_shutdown_fail_without_a_crash_report(self, workers, pdf):
        workers(1)
        pool.page_text(pdf, 1)
        stopping = _worker_of(pdf)
        os.kill(stopping.proc.pid, signal.SIGSTOP)
        with ThreadPoolExecutor(1) as ex:
            in_flight = ex.submit(pool.page_text, pdf, 2)
            deadline = time.monotonic() + 10
            while not stopping.pending and time.monotonic() < deadline:
                time.sleep(0.01)
            stopping.stopping = True
            stopping.kill()
            with pytest.raises(ops.RenderError) as err:
                in_flight.result(timeout=30)
        assert not isinstance(err.value, ops.RenderCrashError)

    def test_a_closed_pool_refuses_work(self, workers, pdf):
        p = workers(1)
        p.shutdown()
        with pytest.raises(ops.RenderError, match="shutting down"):
            p.call("text", pdf, 1)


class TestInProcess:
    """RENDER_WORKERS=0: the same API, run here through open_pdf()."""

    def test_everything_runs_in_this_process(self, workers, pdf, monkeypatch):
        workers(0)
        monkeypatch.setattr(pool._MP_CONTEXT, "Process", None)  # would fail if used
        assert _webp_size(pool.render_page(pdf, 2, 400))[0] == 400
        assert _webp_size(pool.render_page(pdf, 2, 400, count=False))[0] == 400
        assert _webp_size(pool.render_tile(pdf, 1, 1024, 0, 1))[0] == 1024
        assert pool.page_text(pdf, 1) == "first page"
        assert len(pool.page_words(pdf, 1)["words"]) == 2
        assert pool.document_info(pdf)["page_count"] == 3
        assert pool.document_metadata(pdf)["format"].startswith("PDF")
        with pytest.raises(ops.PageOutOfRange):
            pool.page_text(pdf, 9)
        pool.evict(pdf)
        assert pool._pool is None
        assert pool.retire_idle_workers() == 0


class TestWorkerProcess:
    """backend.render.worker, driven in a thread so coverage sees it."""

    @pytest.fixture
    def served(self):
        parent, child = multiprocessing.Pipe()
        thread = threading.Thread(target=worker.serve, args=(child, 2), daemon=True)
        thread.start()
        ids = iter(range(1_000_000))

        def ask(op, *args):
            request_id = next(ids)
            parent.send((request_id, op, args))
            got_id, ok, payload = parent.recv()
            assert got_id == request_id
            return ok, payload

        yield ask
        parent.close()
        thread.join(10)
        assert not thread.is_alive()

    def test_answers_each_operation(self, served, pdf, monkeypatch):
        reclaims = []
        monkeypatch.setattr(worker, "reclaim_render_memory", lambda: reclaims.append(1))
        ok, data = served("page", pdf, 1, 300, 85, 0, True)
        assert ok and _webp_size(data)[0] == 300
        ok, data = served("tile", pdf, 1, 1024, 0, 0)
        assert ok and _webp_size(data) == (1024, 1024)
        assert served("text", pdf, 1) == (True, "first page")
        assert served("words", pdf, 1)[1]["width"] == 595.0
        assert served("info", pdf)[1]["page_count"] == 3
        assert served("metadata", pdf)[1]["language"] == ""
        # Two counted page renders reach the interval of 2; tiles don't count.
        served("page", pdf, 2, 300, 85, 0, True)
        assert reclaims == [1]
        served("page", pdf, 2, 300, 85, 0, False)
        assert reclaims == [1]
        assert served("evict", pdf) == (True, True)
        assert served("evict", pdf) == (True, False)

    def test_sends_errors_back(self, served, pdf, tmp_path):
        ok, err = served("page", pdf, 7, 300, 85, 0, True)
        assert not ok and isinstance(err, ops.PageOutOfRange) and err.page_count == 3
        ok, err = served("text", str(tmp_path / "missing.pdf"), 1)
        assert not ok and isinstance(err, ops.RenderError)
        assert "FileNotFoundError" in str(err)
        ok, err = served("nonsense", pdf)
        assert not ok and "Unknown render operation" in str(err)

    def test_documents_are_an_lru(self, tmp_path):
        docs = worker.Documents(limit=2)
        paths = [_make_pdf(tmp_path / f"d{i}.pdf", ["x"]) for i in range(3)]
        first = docs.get(paths[0])
        assert docs.get(paths[0]) is first
        docs.get(paths[1])
        docs.get(paths[0])  # most recently used again
        docs.get(paths[2])  # evicts paths[1], the least recently used
        assert len(docs) == 2
        assert docs.evict(paths[1]) is False
        assert docs.evict(paths[0]) is True
        docs.close_all()
        assert len(docs) == 0

    def test_portable_flattens_other_exceptions(self):
        assert isinstance(worker.portable(ops.TileOutOfRange(1, 2, 3)), ops.TileOutOfRange)
        flat = worker.portable(KeyError("x"))
        assert type(flat) is ops.RenderError and str(flat) == "KeyError: 'x'"

    def test_main_ignores_ctrl_c(self, monkeypatch):
        seen = {}
        monkeypatch.setattr(worker.signal, "signal", lambda sig, handler: seen.update({sig: handler}))
        monkeypatch.setattr(worker, "serve", lambda conn, interval: seen.update(served=interval))
        worker.main(None, 7)
        assert seen == {signal.SIGINT: signal.SIG_IGN, "served": 7}


class TestThroughTheApi:
    """The acceptance case: a crashing render fails that request only."""

    def test_a_worker_crash_is_a_500_and_the_server_carries_on(
        self, workers, client, admin_headers, tmp_path
    ):
        from backend.tests.conftest import make_book, make_game_system

        workers(1)
        path = _make_pdf(tmp_path / "crashy.pdf", ["one", "two"])
        book = make_book(
            system_id=make_game_system().id,
            filename="crashy.pdf",
            filepath=path,
            mime_type="application/pdf",
            page_count=2,
        )
        # Distinct widths, so neither request can come from the render cache.
        ok = client.get(f"/api/books/{book.id}/page/1?width=301", headers=admin_headers)
        assert ok.status_code == 200
        crashed = _worker_of(path)
        os.kill(crashed.proc.pid, signal.SIGSTOP)
        with ThreadPoolExecutor(1) as ex:
            in_flight = ex.submit(
                client.get, f"/api/books/{book.id}/page/2?width=302", headers=admin_headers
            )
            deadline = time.monotonic() + 10
            while not crashed.pending and time.monotonic() < deadline:
                time.sleep(0.01)
            os.kill(crashed.proc.pid, signal.SIGKILL)
            failed = in_flight.result(timeout=30)
        assert failed.status_code == 500
        assert failed.json()["detail"] == "This page could not be rendered"
        again = client.get(f"/api/books/{book.id}/page/2?width=303", headers=admin_headers)
        assert again.status_code == 200
        text = client.get(f"/api/books/{book.id}/page/2/text", headers=admin_headers)
        assert text.json() == {"text": "two"}
        too_far = client.get(f"/api/books/{book.id}/page/3?width=304", headers=admin_headers)
        assert too_far.status_code == 400


def _toc_pdf(path):
    doc = fitz.open()
    for i in range(3):
        doc.new_page().insert_text((72, 72), f"chapter {i + 1}")
    doc.set_toc([[1, "One", 1], [2, "One point five", 2], [1, "Two", 3]])
    doc.save(str(path))
    doc.close()
    return str(path)


_PAGES_SPEC = {
    "kind": "pages",
    "format": "png",
    "dpi": 72,
    "pages": "1-2",
    "join_spreads": False,
    "spread_offset": 0,
    "regions": [],
}


class TestTocAndExportHelpers:
    @pytest.mark.parametrize("size", [0, 1])
    def test_toc_page_size_and_detect(self, workers, tmp_path, size):
        workers(size)
        path = _toc_pdf(tmp_path / "toc.pdf")
        assert pool.document_toc(path) == [[1, "One", 1], [2, "One point five", 2], [1, "Two", 3]]
        assert pool.export_page_size(path, 2) == {"width": 595.0, "height": 842.0}
        assert pool.detect_shapes(path, 1) == []
        with pytest.raises(ops.PageOutOfRange):
            pool.export_page_size(path, 4)
        with pytest.raises(ops.PageOutOfRange):
            pool.detect_shapes(path, 0)


class TestExport:
    @pytest.mark.parametrize("size", [0, 1])
    def test_exports_pages(self, workers, pdf, size):
        workers(size)
        files, zip_stem = pool.export(pdf, "My Book", _PAGES_SPEC)
        assert [f.name for f in files] == ["My Book (p1).png", "My Book (p2).png"]
        assert zip_stem == "My Book (p1-2)"
        assert all(f.data.startswith(b"\x89PNG") for f in files)

    @pytest.mark.parametrize("size", [0, 1])
    def test_exports_cut_outs(self, workers, pdf, size):
        workers(size)
        region = {"pages": [1], "shape": "ellipse", "x": 0.1, "y": 0.1, "w": 0.3, "h": 0.2, "name": "Orc"}
        files, zip_stem = pool.export(pdf, "My Book", {**_PAGES_SPEC, "kind": "regions", "regions": [region]})
        assert [f.name for f in files] == ["Orc.png"]
        assert zip_stem == "My Book (cut-outs)"

    def test_an_impossible_request_is_an_export_error(self, workers, pdf):
        from backend.services.page_export import ExportError

        workers(1)
        with pytest.raises(ExportError):
            pool.export(pdf, "My Book", {**_PAGES_SPEC, "pages": "9"})

    def test_a_file_that_cannot_open_is_a_render_error(self, workers, tmp_path):
        workers(1)
        broken = tmp_path / "broken.pdf"
        broken.write_bytes(b"nope")
        with pytest.raises(ops.RenderError):
            pool.export(str(broken), "Broken", _PAGES_SPEC)

    def _fake_process(self, monkeypatch, *, alive, exitcode):
        killed = []

        class FakeProcess:
            def __init__(self, target, args, name, daemon):
                pass

            def start(self):
                pass

            def join(self, _timeout=None):
                pass

            def is_alive(self):
                return alive and not killed

            def kill(self):
                killed.append(True)

            @property
            def exitcode(self):
                return exitcode

        monkeypatch.setattr(pool._MP_CONTEXT, "Process", FakeProcess)
        return killed

    def test_a_crashed_export_is_reported(self, workers, pdf, monkeypatch):
        workers(1)
        self._fake_process(monkeypatch, alive=False, exitcode=-11)
        with pytest.raises(ops.RenderCrashError, match="killed by signal 11"):
            pool.export(pdf, "My Book", _PAGES_SPEC)

    def test_an_export_that_runs_too_long_is_stopped(self, workers, pdf, monkeypatch):
        workers(1)
        killed = self._fake_process(monkeypatch, alive=True, exitcode=None)
        with pytest.raises(ops.RenderTimeoutError):
            pool.export(pdf, "My Book", _PAGES_SPEC)
        assert killed

    def test_export_main_writes_its_outcome(self, pdf, tmp_path, monkeypatch):
        import pickle

        monkeypatch.setattr(worker.signal, "signal", lambda *_a: None)
        result = tmp_path / "result.pkl"
        worker.export_main(pdf, "Book", _PAGES_SPEC, str(result))
        ok, (files, zip_stem) = pickle.loads(result.read_bytes())
        assert ok and len(files) == 2 and zip_stem == "Book (p1-2)"
        worker.export_main(pdf, "Book", {**_PAGES_SPEC, "pages": "9"}, str(result))
        ok, error = pickle.loads(result.read_bytes())
        assert not ok and type(error).__name__ == "ExportError"
        worker.export_main(str(tmp_path / "missing.pdf"), "Book", _PAGES_SPEC, str(result))
        ok, error = pickle.loads(result.read_bytes())
        assert not ok and isinstance(error, ops.RenderError)


class TestWorkerExportOps:
    def test_toc_page_size_and_detect_in_the_serve_loop(self, tmp_path):
        parent, child = multiprocessing.Pipe()
        thread = threading.Thread(target=worker.serve, args=(child, 0), daemon=True)
        thread.start()
        path = _toc_pdf(tmp_path / "toc.pdf")
        for request_id, op, args, expected in [
            (1, "toc", (path,), [[1, "One", 1], [2, "One point five", 2], [1, "Two", 3]]),
            (2, "page_size", (path, 1), {"width": 595.0, "height": 842.0}),
            (3, "detect", (path, 1), []),
        ]:
            parent.send((request_id, op, args))
            assert parent.recv() == (request_id, True, expected)
        parent.close()
        thread.join(10)

    def test_portable_keeps_export_errors(self):
        from backend.services.page_export import ExportError

        err = ExportError("Page 9 is past the end")
        assert worker.portable(err) is err
