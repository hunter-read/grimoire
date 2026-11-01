"""The scan's PyMuPDF work in a helper process (issue #762).

PyMuPDF holds the GIL while it opens or renders, so doing that on the scan's
thread froze the server, and with several workers got one killed by uvicorn's
health check and the scan restarted on the same file forever. These cover the
helper the scan now hands that work to, and the child side it runs.
"""
import logging
import threading
import time
from multiprocessing import Pipe
from types import SimpleNamespace

import fitz
import pytest
from PIL import Image

from backend import indexer
from backend.indexer import isolation, thumbnails
from backend.render import scan_worker
from backend.render.ops import RenderError
from backend.tests import _scan_helper_stubs as stubs


def _pdf(path, pages=1):
    doc = fitz.open()
    for _ in range(pages):
        doc.new_page(width=300, height=400).insert_text((40, 60), "Grimoire")
    doc.save(str(path))
    doc.close()
    return str(path)


@pytest.fixture(autouse=True)
def _fresh_helper():
    isolation.shutdown()
    yield
    isolation.shutdown()


def _stub(monkeypatch, main):
    monkeypatch.setattr(isolation, "scan_worker", SimpleNamespace(main=main))


class TestHelper:
    def test_renders_a_thumbnail_and_counts_pages(self, tmp_path):
        pdf = _pdf(tmp_path / "book.pdf", pages=3)
        out = tmp_path / "thumbs" / "book.webp"
        assert isolation.render_thumbnail(pdf, str(out), (150, 200), timeout=30) is True
        with Image.open(out) as img:
            assert img.format == "WEBP"
            assert img.width <= 150 and img.height <= 200
        assert isolation.document_page_count(pdf) == 3

    def test_keeps_one_helper_for_the_calls_that_follow(self, tmp_path):
        pdf = _pdf(tmp_path / "book.pdf")
        isolation.document_page_count(pdf)
        first = isolation._helper
        isolation.document_page_count(pdf)
        assert isolation._helper is first
        assert first is not None and first.proc.is_alive()

    def test_a_file_mupdf_cannot_open_raises_and_keeps_the_helper(self, tmp_path):
        bad = tmp_path / "bad.pdf"
        bad.write_bytes(b"not a pdf")
        with pytest.raises(RenderError):
            isolation.document_page_count(str(bad))
        assert isolation._helper is not None and isolation._helper.proc.is_alive()

    def test_a_hang_is_killed_at_the_timeout(self, monkeypatch):
        _stub(monkeypatch, stubs.hang_main)
        started = time.monotonic()
        with pytest.raises(TimeoutError, match="no answer within 1s"):
            isolation._call("thumbnail", (), timeout=1)
        assert time.monotonic() - started < 10
        assert isolation._helper is None

    def test_a_stop_request_kills_the_helper(self, monkeypatch):
        _stub(monkeypatch, stubs.hang_main)
        with pytest.raises(TimeoutError, match="stop request"):
            isolation._call("thumbnail", (), timeout=30, should_stop=lambda: True)
        assert isolation._helper is None

    def test_a_crash_is_reported_with_its_exit_code(self, monkeypatch):
        _stub(monkeypatch, stubs.crash_main)
        with pytest.raises(isolation.HelperCrashError, match="exit code 3"):
            isolation._call("thumbnail", (), timeout=30)
        assert isolation._helper is None

    def test_the_next_call_after_a_crash_starts_a_fresh_helper(self, monkeypatch, tmp_path):
        _stub(monkeypatch, stubs.crash_main)
        with pytest.raises(isolation.HelperCrashError):
            isolation._call("thumbnail", (), timeout=30)
        monkeypatch.undo()
        assert isolation.document_page_count(_pdf(tmp_path / "book.pdf", pages=2)) == 2

    def test_the_waiting_thread_does_not_hold_up_the_rest_of_the_process(self, monkeypatch):
        """The point of the helper: other threads run while a document is read."""
        _stub(monkeypatch, stubs.busy_main)
        gaps = []
        done = threading.Event()

        def ticker():
            last = time.monotonic()
            while not done.is_set():
                time.sleep(0.02)
                now = time.monotonic()
                gaps.append(now - last)
                last = now

        thread = threading.Thread(target=ticker)
        thread.start()
        try:
            assert isolation._call("page_count", (), timeout=30) == 7
        finally:
            done.set()
            thread.join()
        assert max(gaps) < 0.5

    def test_a_failed_send_is_a_crash(self, monkeypatch, tmp_path):
        isolation.document_page_count(_pdf(tmp_path / "book.pdf"))
        isolation._helper.conn.close()
        with pytest.raises(isolation.HelperCrashError, match="before taking the request"):
            isolation._call("page_count", ("x",), timeout=5)
        assert isolation._helper is None


class TestShutdown:
    def test_stops_an_idle_helper(self, tmp_path):
        isolation.document_page_count(_pdf(tmp_path / "book.pdf"))
        proc = isolation._helper.proc
        isolation.shutdown()
        assert isolation._helper is None
        assert not proc.is_alive()

    def test_without_a_helper_does_nothing(self):
        isolation.shutdown()
        assert isolation._helper is None

    def test_leaves_a_busy_helper_to_its_caller(self, monkeypatch):
        _stub(monkeypatch, stubs.busy_main)
        result = []
        thread = threading.Thread(
            target=lambda: result.append(isolation._call("page_count", (), timeout=30))
        )
        thread.start()
        while isolation._helper is None:
            time.sleep(0.01)
        time.sleep(0.2)
        isolation.shutdown()
        thread.join()
        assert result == [7]

    def test_kills_a_busy_helper_when_told_to(self, monkeypatch):
        _stub(monkeypatch, stubs.hang_main)
        errors = []

        def call():
            try:
                isolation._call("thumbnail", (), timeout=30)
            except Exception as e:  # noqa: BLE001 - the error is the assertion
                errors.append(e)

        thread = threading.Thread(target=call)
        thread.start()
        while isolation._helper is None:
            time.sleep(0.01)
        time.sleep(0.2)
        isolation.shutdown(kill_busy=True)
        thread.join(10)
        assert not thread.is_alive()
        assert isinstance(errors[0], isolation.HelperCrashError)

    def test_kills_a_helper_that_will_not_exit(self, monkeypatch):
        _stub(monkeypatch, stubs.hang_main)
        helper = isolation._Helper()
        helper.conn.send(("thumbnail", ()))
        monkeypatch.setattr(isolation, "_STOP_GRACE", 0.2)
        helper.stop()
        assert not helper.proc.is_alive()
        assert helper.exit_reason().startswith("killed by signal")


class TestGenerateThumbnail:
    def test_documents_go_to_the_helper(self, tmp_path):
        pdf = _pdf(tmp_path / "book.pdf")
        out = tmp_path / "book.webp"
        assert thumbnails.generate_thumbnail(pdf, str(out)) is True
        assert out.exists()
        assert isolation._helper is not None

    @pytest.mark.parametrize(
        "error, message",
        [
            (TimeoutError("slow"), "timed out after 30s"),
            (isolation.HelperCrashError("scan helper exited (killed by signal 9)"), "crashed"),
            (RenderError("FileDataError: bad"), "failed"),
        ],
    )
    def test_failures_are_logged_and_return_false(self, monkeypatch, caplog, error, message):
        def fail(*args, **kwargs):
            raise error

        monkeypatch.setattr(isolation, "render_thumbnail", fail)
        with caplog.at_level(logging.ERROR, logger="grimoire.indexer"):
            assert thumbnails.generate_thumbnail("/x/book.pdf", "/x/out.webp") is False
        assert f"Thumbnail generation {message}" in caplog.text

    def test_a_stop_request_is_logged_as_one(self, monkeypatch, caplog):
        def stopped(*args, **kwargs):
            raise TimeoutError("aborted by stop request")

        monkeypatch.setattr(isolation, "render_thumbnail", stopped)
        with caplog.at_level(logging.WARNING, logger="grimoire.indexer"):
            ok = thumbnails.generate_thumbnail(
                "/x/book.epub", "/x/out.webp", should_stop=lambda: True
            )
        assert ok is False
        assert "aborted by stop request" in caplog.text


class TestPageCount:
    def test_book_page_count_reads_documents_in_the_helper(self, tmp_path):
        assert indexer._book_page_count(_pdf(tmp_path / "book.pdf", pages=4)) == 4
        assert isolation._helper is not None


class TestChildSide:
    """``scan_worker`` run in this process, where coverage can see it."""

    def test_thumbnail_and_page_count(self, tmp_path):
        pdf = _pdf(tmp_path / "book.pdf", pages=2)
        out = tmp_path / "out" / "book.webp"
        assert scan_worker.thumbnail(pdf, str(out), (100, 100)) is True
        assert out.exists()
        assert scan_worker.page_count(pdf) == 2

    def test_a_document_with_no_pages_has_no_thumbnail(self, monkeypatch, tmp_path):
        class Empty:
            def __len__(self):
                return 0

            def close(self):
                pass

        monkeypatch.setattr(scan_worker, "open_document", lambda _path: Empty())
        assert scan_worker.thumbnail("x.pdf", str(tmp_path / "x.webp"), (100, 100)) is False

    def test_unknown_op(self):
        with pytest.raises(ValueError, match="unknown scan helper op"):
            scan_worker.handle("nope", ())

    def test_serve_answers_until_the_pipe_closes(self, tmp_path):
        pdf = _pdf(tmp_path / "book.pdf", pages=5)
        parent, child = Pipe()
        thread = threading.Thread(target=scan_worker.serve, args=(child,))
        thread.start()
        try:
            parent.send(("page_count", (pdf,)))
            assert parent.recv() == (True, 5)
            parent.send(("nope", ()))
            ok, error = parent.recv()
            assert ok is False and isinstance(error, RenderError)
        finally:
            parent.close()
            thread.join(5)
        assert not thread.is_alive()

    def test_serve_returns_when_the_parent_is_gone(self, tmp_path):
        pdf = _pdf(tmp_path / "book.pdf")
        parent, child = Pipe()

        class GoneOnSend:
            def recv(self):
                return child.recv()

            def send(self, _reply):
                raise OSError("broken pipe")

        thread = threading.Thread(target=scan_worker.serve, args=(GoneOnSend(),))
        thread.start()
        parent.send(("page_count", (pdf,)))
        thread.join(5)
        assert not thread.is_alive()

    def test_main_ignores_ctrl_c_and_serves(self, monkeypatch):
        import signal

        served = []
        monkeypatch.setattr(scan_worker, "serve", served.append)
        previous = signal.getsignal(signal.SIGINT)
        try:
            scan_worker.main("conn")
            assert signal.getsignal(signal.SIGINT) is signal.SIG_IGN
        finally:
            signal.signal(signal.SIGINT, previous)
        assert served == ["conn"]
