"""The re-index queue behind replace uploads, and the per-book claims (issue #657).

A batch of replace uploads used to fail on the re-index the previous replace had
just started. Each replace now queues its book for one shared drain, and only a
claim on the very same book holds a replace back. What matters here: every
queued book is indexed exactly once, including books queued while the drain
runs; a claimed book is never read; and nothing is left claimed or running.
"""
from unittest.mock import MagicMock, patch

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from backend import config
from backend.config import SessionLocal
from backend.models import Book
from backend.routers.library import _claims, _helpers, _reindex_queue

from .conftest import live_scan_status, make_book, make_game_system


class FakeValkey:
    """Just enough of a Valkey client for the status, claims and queue."""

    def __init__(self) -> None:
        self.kv: dict = {}
        self.sets: dict = {}

    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.kv:
            return None
        self.kv[key] = value
        return True

    def get(self, key):
        return self.kv.get(key)

    def delete(self, key):
        self.kv.pop(key, None)
        self.sets.pop(key, None)

    def exists(self, key):
        return key in self.kv

    def sadd(self, key, value):
        self.sets.setdefault(key, set()).add(value)

    def expire(self, key, seconds):
        pass

    def spop(self, key):
        members = self.sets.get(key)
        return members.pop().encode() if members else None

    def scard(self, key):
        return len(self.sets.get(key, ()))

    def srem(self, key, value):
        members = self.sets.get(key, set())
        if value in members:
            members.discard(value)
            return 1
        return 0


def _broken_valkey() -> MagicMock:
    fake = MagicMock()
    for name in ("set", "get", "delete", "exists", "sadd", "expire", "spop", "scard", "srem"):
        getattr(fake, name).side_effect = RedisConnectionError("down")
    return fake


@pytest.fixture(autouse=True)
def _clean_state():
    def reset():
        _helpers.clear_stop()
        # Cleared, not just reset: a live status carries a heartbeat key too.
        _helpers.SCAN_JOB._status.clear()
        _helpers._set_status({**_helpers._DEFAULT_STATUS})
        _reindex_queue._queue.clear()
        _reindex_queue._refresh.clear()
        _claims._claims.clear()

    reset()
    yield
    reset()


@pytest.fixture(scope="module")
def system():
    return make_game_system()


def _book(system, **fields) -> Book:
    return make_book(system.id, **fields)


def _row(book_id: str) -> Book:
    db = SessionLocal()
    try:
        return db.get(Book, book_id)
    finally:
        db.close()


class TestClaims:
    def test_a_claim_is_held_until_released(self):
        assert _claims.claim_book("b1") is True
        assert _claims.claim_book("b1") is False
        _claims.release_book("b1")
        assert _claims.claim_book("b1") is True

    def test_force_takes_a_held_claim(self):
        assert _claims.claim_book("b1") is True
        assert _claims.claim_book("b1", force=True) is True

    def test_claims_are_per_book(self):
        assert _claims.claim_book("b1") is True
        assert _claims.claim_book("b2") is True

    def test_shared_through_valkey(self):
        fake = FakeValkey()
        with patch.object(config, "_valkey", fake):
            assert _claims.claim_book("b1") is True
            assert _claims.claim_book("b1") is False
            assert _claims.claim_book("b1", force=True) is True
            _claims.release_book("b1")
            assert fake.kv == {}
        assert _claims._claims == set()

    def test_falls_back_in_process_when_valkey_fails(self):
        with patch.object(config, "_valkey", _broken_valkey()):
            assert _claims.claim_book("b1") is True
            assert _claims.claim_book("b1") is False
            _claims.release_book("b1")
            assert _claims.claim_book("b1") is True


class TestQueue:
    def test_queuing_twice_queues_once(self):
        _reindex_queue.queue_reindex("b1")
        _reindex_queue.queue_reindex("b1")
        assert _reindex_queue.queued_count() == 1
        assert _reindex_queue._pop_queued() == "b1"
        assert _reindex_queue._pop_queued() is None

    def test_shared_through_valkey(self):
        fake = FakeValkey()
        with patch.object(config, "_valkey", fake):
            _reindex_queue.queue_reindex("b1")
            assert _reindex_queue.queued_count() == 1
            assert _reindex_queue._pop_queued() == "b1"
            assert _reindex_queue.queued_count() == 0
        assert _reindex_queue._queue == set()

    def test_falls_back_in_process_when_valkey_fails(self):
        with patch.object(config, "_valkey", _broken_valkey()):
            _reindex_queue.queue_reindex("b1")
            assert _reindex_queue.queued_count() == 1
            assert _reindex_queue._pop_queued() == "b1"

    def test_a_book_queued_in_process_is_still_drained_once_valkey_is_back(self):
        _reindex_queue.queue_reindex("b1")
        with patch.object(config, "_valkey", FakeValkey()):
            assert _reindex_queue.queued_count() == 1
            assert _reindex_queue._pop_queued() == "b1"


class TestRefreshFlag:
    def test_taken_once(self):
        _reindex_queue.queue_reindex("b1", refresh_file=True)
        assert _reindex_queue._take_refresh("b1") is True
        assert _reindex_queue._take_refresh("b1") is False

    def test_a_plain_queue_does_not_refresh(self):
        _reindex_queue.queue_reindex("b1")
        assert _reindex_queue._take_refresh("b1") is False

    def test_shared_through_valkey(self):
        fake = FakeValkey()
        with patch.object(config, "_valkey", fake):
            _reindex_queue.queue_reindex("b1", refresh_file=True)
            assert _reindex_queue._take_refresh("b1") is True
            assert _reindex_queue._take_refresh("b1") is False
        assert _reindex_queue._refresh == set()

    def test_falls_back_in_process_when_valkey_fails(self):
        with patch.object(config, "_valkey", _broken_valkey()):
            _reindex_queue.queue_reindex("b1", refresh_file=True)
            assert _reindex_queue._take_refresh("b1") is True


class TestReindexRunning:
    def test_only_a_live_drain_counts(self):
        assert _reindex_queue.reindex_running() is False
        _helpers._set_status(live_scan_status(kind=_reindex_queue.REINDEX_KIND))
        assert _reindex_queue.reindex_running() is True

    def test_another_job_does_not(self):
        _helpers._set_status(live_scan_status(phase="scanning"))
        assert _reindex_queue.reindex_running() is False


class TestDrain:
    def test_indexes_every_queued_book_and_goes_idle(self, system):
        books = [_book(system, title=f"Queued {i}") for i in range(3)]
        for b in books:
            _reindex_queue.queue_reindex(b.id)
        with patch.object(_reindex_queue, "index_book_text") as index, patch.object(
            _helpers, "run_ocr_queue"
        ) as ocr:
            _reindex_queue.drain_reindex_queue()
        assert sorted(c.args[0].id for c in index.call_args_list) == sorted(b.id for b in books)
        assert ocr.called
        status = _helpers._get_status()
        assert (status["running"], status["phase"], status["kind"]) == (False, None, None)
        assert status["indexed"] == 3
        assert _reindex_queue.queued_count() == 0
        assert _claims._claims == set()

    def test_runs_as_a_reindex_job(self, system):
        book = _book(system)
        _reindex_queue.queue_reindex(book.id)
        seen = []

        def index(*args, **kwargs):
            seen.append(_reindex_queue.reindex_running())

        with patch.object(_reindex_queue, "index_book_text", side_effect=index), patch.object(
            _helpers, "run_ocr_queue"
        ):
            _reindex_queue.drain_reindex_queue()
        assert seen == [True]

    def test_picks_up_a_book_queued_while_it_runs(self, system):
        """The batch case: the next replace lands while the first is indexed."""
        first, second = _book(system, title="First"), _book(system, title="Second")
        _reindex_queue.queue_reindex(first.id)
        order = []

        def index(book, *args, **kwargs):
            order.append(book.id)
            if book.id == first.id:
                _reindex_queue.queue_reindex(second.id)

        with patch.object(_reindex_queue, "index_book_text", side_effect=index), patch.object(
            _helpers, "run_ocr_queue"
        ):
            _reindex_queue.drain_reindex_queue()
        assert order == [first.id, second.id]

    def test_goes_back_to_indexing_for_a_book_queued_during_ocr(self, system):
        first, second = _book(system, title="First"), _book(system, title="Second")
        _reindex_queue.queue_reindex(first.id)
        ocr_rounds = []

        def ocr():
            ocr_rounds.append(1)
            if len(ocr_rounds) == 1:
                _reindex_queue.queue_reindex(second.id)
            return 0

        with patch.object(_reindex_queue, "index_book_text") as index, patch.object(
            _helpers, "run_ocr_queue", side_effect=ocr
        ):
            _reindex_queue.drain_reindex_queue()
        assert [c.args[0].id for c in index.call_args_list] == [first.id, second.id]
        assert len(ocr_rounds) == 2

    def test_a_book_queued_after_the_run_lets_go_is_drained_again(self, system):
        """The window between the last pop and clearing the status."""
        first, second = _book(system, title="First"), _book(system, title="Second")
        _reindex_queue.queue_reindex(first.id)
        runs = []
        real_drain_once = _reindex_queue._drain_once

        def drain_once():
            runs.append(1)
            result = real_drain_once()
            if len(runs) == 1:
                _reindex_queue.queue_reindex(second.id)
            return result

        with patch.object(_reindex_queue, "_drain_once", side_effect=drain_once), patch.object(
            _reindex_queue, "index_book_text"
        ) as index, patch.object(_helpers, "run_ocr_queue"):
            _reindex_queue.drain_reindex_queue()
        assert [c.args[0].id for c in index.call_args_list] == [first.id, second.id]
        assert len(runs) == 2

    def test_leaves_the_queue_to_a_live_job(self, system):
        book = _book(system)
        _reindex_queue.queue_reindex(book.id)
        _helpers._set_status(live_scan_status(phase="scanning"))
        with patch.object(_reindex_queue, "index_book_text") as index:
            _reindex_queue.drain_reindex_queue()
        assert not index.called
        assert _reindex_queue.queued_count() == 1

    def test_an_empty_queue_does_nothing(self):
        with patch.object(_helpers, "run_ocr_queue") as ocr:
            _reindex_queue.drain_reindex_queue()
        assert not ocr.called
        assert _helpers._get_status()["running"] is False

    def test_stop_leaves_the_rest_queued(self, system):
        first, second = _book(system, title="First"), _book(system, title="Second")
        _reindex_queue.queue_reindex(first.id)
        _reindex_queue.queue_reindex(second.id)

        with patch.object(
            _reindex_queue, "index_book_text", side_effect=lambda *a, **k: _helpers.request_stop()
        ) as index, patch.object(_helpers, "run_ocr_queue") as ocr:
            _reindex_queue.drain_reindex_queue()
        assert index.call_count == 1
        assert not ocr.called
        assert _reindex_queue.queued_count() == 1
        assert _helpers._get_status()["running"] is False

    def test_skips_a_book_a_replace_has_claimed(self, system):
        """The replace is mid-write; it queues the book again when it is done."""
        book = _book(system)
        _reindex_queue.queue_reindex(book.id)
        _claims.claim_book(book.id)
        with patch.object(_reindex_queue, "index_book_text") as index, patch.object(
            _helpers, "run_ocr_queue"
        ):
            _reindex_queue.drain_reindex_queue()
        assert not index.called
        # Still the replace's claim, not released by the drain.
        assert _claims.claim_book(book.id) is False

    @pytest.mark.parametrize(
        "fields", [{"indexed": True}, {"ocr_pending": True}, {"index_failed": True}]
    )
    def test_skips_a_book_with_nothing_left_to_index(self, system, fields):
        book = _book(system, **fields)
        _reindex_queue.queue_reindex(book.id)
        with patch.object(_reindex_queue, "index_book_text") as index, patch.object(
            _helpers, "run_ocr_queue"
        ):
            _reindex_queue.drain_reindex_queue()
        assert not index.called

    def test_skips_a_deleted_book(self):
        _reindex_queue.queue_reindex("no-such-book")
        with patch.object(_reindex_queue, "index_book_text") as index, patch.object(
            _helpers, "run_ocr_queue"
        ):
            _reindex_queue.drain_reindex_queue()
        assert not index.called
        assert _claims._claims == set()

    def test_a_failed_index_is_recorded_and_the_drain_goes_on(self, system):
        bad, good = _book(system, title="Bad"), _book(system, title="Good")
        _reindex_queue.queue_reindex(bad.id)
        _reindex_queue.queue_reindex(good.id)
        indexed = []

        def index(book, *args, **kwargs):
            if book.id == bad.id:
                raise RuntimeError("unreadable")
            indexed.append(book.id)

        with patch.object(_reindex_queue, "index_book_text", side_effect=index), patch.object(
            _helpers, "run_ocr_queue"
        ):
            _reindex_queue.drain_reindex_queue()
        assert indexed == [good.id]
        row = _row(bad.id)
        assert row.index_failed is True
        assert row.index_error == "unreadable"
        assert _claims._claims == set()


class TestOcrRespectsClaims:
    def test_a_claimed_book_is_not_read(self, system):
        book = _book(system, ocr_pending=True)
        _claims.claim_book(book.id)
        with patch.object(_helpers, "ocr_book") as ocr:
            assert _helpers._ocr_one_book(book.id) == "busy"
        assert not ocr.called

    def test_the_claim_is_held_while_reading_and_released_after(self, system):
        book = _book(system, ocr_pending=True)
        held = []

        def ocr(*args, **kwargs):
            held.append(_claims.claim_book(book.id))
            return "done"

        with patch.object(_helpers, "ocr_book", side_effect=ocr):
            assert _helpers._ocr_one_book(book.id) == "done"
        assert held == [False]
        assert _claims.claim_book(book.id) is True


class TestSingleBookRescan:
    """``POST /api/books/:id/rescan`` runs on the same queue as replaces."""

    def test_re_reads_the_file_even_when_already_indexed(self, system):
        book = _book(system, indexed=True)
        with patch.object(_reindex_queue, "reindex_single_book") as reread, patch.object(
            _reindex_queue, "index_book_text"
        ) as index, patch.object(_reindex_queue, "_invalidate_book_cache") as invalidate, patch.object(
            _helpers, "run_ocr_queue"
        ):
            _helpers.rescan_single_book(book.id)
        assert reread.call_args.args[0].id == book.id
        assert not index.called
        assert invalidate.called
        status = _helpers._get_status()
        assert (status["running"], status["kind"]) == (False, None)

    def test_joins_a_running_re_index_instead_of_being_dropped(self, system):
        book = _book(system)
        _helpers._set_status(live_scan_status(kind=_reindex_queue.REINDEX_KIND))
        with patch.object(_reindex_queue, "reindex_single_book") as reread:
            _helpers.rescan_single_book(book.id)
        # Left to the running drain, flagged to re-read the file.
        assert not reread.called
        assert _reindex_queue._pop_queued() == book.id
        assert _reindex_queue._take_refresh(book.id) is True

    def test_skipped_while_a_library_scan_runs(self, system):
        book = _book(system)
        _helpers._set_status(live_scan_status(phase="scanning"))
        _helpers.rescan_single_book(book.id)
        assert _reindex_queue.queued_count() == 0

    def test_a_replace_mid_write_takes_over_the_re_read(self, system):
        """The replace re-reads the file itself and queues the book again."""
        book = _book(system, indexed=True)
        _claims.claim_book(book.id)
        with patch.object(_reindex_queue, "reindex_single_book") as reread, patch.object(
            _helpers, "run_ocr_queue"
        ):
            _helpers.rescan_single_book(book.id)
        assert not reread.called
        assert _reindex_queue._take_refresh(book.id) is False

    def test_a_failed_re_read_is_recorded(self, system):
        book = _book(system, indexed=True)
        with patch.object(
            _reindex_queue, "reindex_single_book", side_effect=RuntimeError("corrupt")
        ), patch.object(_helpers, "run_ocr_queue"):
            _helpers.rescan_single_book(book.id)
        row = _row(book.id)
        assert (row.index_failed, row.index_error) == (True, "corrupt")
        assert _claims._claims == set()
