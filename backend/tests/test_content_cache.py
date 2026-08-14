"""Cache invalidation, content-addressed keys, and the on-disk page-cache sweep."""
from __future__ import annotations

import os
import tempfile
from unittest.mock import patch

from backend.services import content_cache


class TestContentToken:
    def test_uses_content_hash_when_present(self):
        token = content_cache.content_token("a" * 64, "/library/book.pdf")
        assert token == "a" * 8

    def test_falls_back_to_path_digest_when_unhashed(self):
        """Pre-upgrade rows have no hash; they keep the previous path-keyed behaviour."""
        token = content_cache.content_token(None, "/library/book.pdf")
        assert len(token) == 8
        assert token == content_cache.content_token(None, "/library/book.pdf")

    def test_different_contents_give_different_tokens(self):
        path = "/library/book.pdf"
        assert content_cache.content_token("a" * 64, path) != content_cache.content_token(
            "b" * 64, path
        )


class TestPurgeDiskPages:
    def test_removes_only_the_targeted_book_renders(self):
        tmp = tempfile.mkdtemp()
        target = "/library/target.pdf"
        other = "/library/other.pdf"
        keep_prefix = content_cache.page_cache_prefix(other)
        drop_prefix = content_cache.page_cache_prefix(target)

        with patch.object(content_cache, "PAGE_CACHE_DIR", tmp):
            # Two widths and two content tokens for the target, one for the other book.
            for name in (
                f"{drop_prefix}_aaaaaaaa_1_1200.webp",
                f"{drop_prefix}_aaaaaaaa_2_1200.webp",
                f"{drop_prefix}_bbbbbbbb_1_800.webp",
                f"{keep_prefix}_cccccccc_1_1200.webp",
            ):
                open(os.path.join(tmp, name), "wb").close()

            removed = content_cache.purge_disk_pages(target)

        assert removed == 3
        remaining = os.listdir(tmp)
        assert remaining == [f"{keep_prefix}_cccccccc_1_1200.webp"]

    def test_missing_cache_dir_is_not_an_error(self):
        with patch.object(content_cache, "PAGE_CACHE_DIR", "/nonexistent/page_cache"):
            assert content_cache.purge_disk_pages("/library/x.pdf") == 0


class TestSweepPageCache:
    def _fill(self, tmp: str, count: int, size: int) -> list[str]:
        paths = []
        for i in range(count):
            p = os.path.join(tmp, f"f{i}.webp")
            with open(p, "wb") as fh:
                fh.write(b"\0" * size)
            # Stagger timestamps so eviction order is deterministic: f0 oldest.
            os.utime(p, (1_000_000 + i, 1_000_000 + i))
            paths.append(p)
        return paths

    def test_evicts_oldest_first_until_under_cap(self):
        tmp = tempfile.mkdtemp()
        self._fill(tmp, count=10, size=1024 * 1024)  # 10 MiB total

        with patch.object(content_cache, "PAGE_CACHE_DIR", tmp):
            removed = content_cache.sweep_page_cache(max_mb=6)

        assert removed == 4
        survivors = sorted(os.listdir(tmp))
        # The four oldest are gone; the six newest remain.
        assert survivors == sorted(f"f{i}.webp" for i in range(4, 10))

    def test_no_op_when_already_under_cap(self):
        tmp = tempfile.mkdtemp()
        self._fill(tmp, count=2, size=1024)

        with patch.object(content_cache, "PAGE_CACHE_DIR", tmp):
            assert content_cache.sweep_page_cache(max_mb=100) == 0
        assert len(os.listdir(tmp)) == 2

    def test_cap_of_zero_disables_the_sweep(self):
        tmp = tempfile.mkdtemp()
        self._fill(tmp, count=4, size=1024 * 1024)

        with patch.object(content_cache, "PAGE_CACHE_DIR", tmp):
            assert content_cache.sweep_page_cache(max_mb=0) == 0
        assert len(os.listdir(tmp)) == 4

    def test_missing_dir_is_not_an_error(self):
        with patch.object(content_cache, "PAGE_CACHE_DIR", "/nonexistent/page_cache"):
            assert content_cache.sweep_page_cache(max_mb=10) == 0


class TestInvalidateBookContent:
    def test_clears_valkey_disk_and_search_rows(self):
        tmp = tempfile.mkdtemp()
        filepath = "/library/replaced.pdf"
        prefix = content_cache.page_cache_prefix(filepath)
        open(os.path.join(tmp, f"{prefix}_aaaaaaaa_1_1200.webp"), "wb").close()

        class FakeDb:
            def __init__(self):
                self.statements = []

            def execute(self, stmt, params=None):
                self.statements.append(params)

        db = FakeDb()
        with (
            patch.object(content_cache, "PAGE_CACHE_DIR", tmp),
            patch.object(content_cache, "purge_valkey_keys", return_value=3) as purge,
            patch("backend.routers.books._helpers.evict_pdf") as evict,
        ):
            content_cache.invalidate_book_content("book-123", filepath, db=db)

        purge.assert_called_once_with("page:book-123:*")
        evict.assert_called_once_with(filepath)
        assert db.statements == [{"bid": "book-123"}]
        assert os.listdir(tmp) == []

    def test_removes_stale_thumbnail(self):
        tmp = tempfile.mkdtemp()
        thumb = os.path.join(tmp, "cover.webp")
        open(thumb, "wb").close()

        with (
            patch.object(content_cache, "PAGE_CACHE_DIR", tmp),
            patch.object(content_cache, "purge_valkey_keys", return_value=0),
            patch("backend.routers.books._helpers.evict_pdf"),
        ):
            content_cache.invalidate_book_content("b", "/library/x.pdf", thumb_path=thumb)

        assert not os.path.exists(thumb)

    def test_survives_a_valkey_outage(self):
        """Cache clearing is best-effort per layer — one failure must not skip the rest."""
        tmp = tempfile.mkdtemp()
        filepath = "/library/x.pdf"
        prefix = content_cache.page_cache_prefix(filepath)
        open(os.path.join(tmp, f"{prefix}_tok_1_1200.webp"), "wb").close()

        with (
            patch.object(content_cache, "PAGE_CACHE_DIR", tmp),
            patch.object(content_cache, "purge_valkey_keys", side_effect=Exception("down")),
            patch("backend.routers.books._helpers.evict_pdf"),
        ):
            try:
                content_cache.invalidate_book_content("b", filepath)
            except Exception:  # pragma: no cover - the point is that it doesn't raise
                raise AssertionError("a Valkey outage must not propagate")

        # The later layers still ran despite the Valkey failure.
        assert os.listdir(tmp) == []

    def test_one_failing_layer_does_not_skip_the_others(self):
        """A failure in an early layer must not leave the search index stale.

        Partial invalidation is the failure mode this whole module exists to
        prevent, so each layer is independently guarded.
        """

        class FakeDb:
            def __init__(self):
                self.statements = []

            def execute(self, stmt, params=None):
                self.statements.append(params)

        db = FakeDb()
        thumb_dir = tempfile.mkdtemp()
        thumb = os.path.join(thumb_dir, "cover.webp")
        open(thumb, "wb").close()

        with (
            patch.object(content_cache, "purge_valkey_keys", side_effect=Exception("down")),
            patch.object(content_cache, "purge_disk_pages", side_effect=OSError("disk gone")),
            patch("backend.routers.books._helpers.evict_pdf", side_effect=Exception("boom")),
        ):
            content_cache.invalidate_book_content("b", "/library/x.pdf", db=db, thumb_path=thumb)

        # FTS rows and the thumbnail were still cleared.
        assert db.statements == [{"bid": "b"}]
        assert not os.path.exists(thumb)
