"""In-process rendering takes turns with the rest of the process (issue #975).

PyMuPDF holds the GIL for the whole of a rasterise, so with RENDER_WORKERS=0 a
render used to stop the event loop and every request thread until it was done.
Two halves here: ``ops`` draws a page or tile in bands with a callback between
them, and ``pool._InProcessRaster`` runs one rasterise at a time, making way
for other threads before each turn and between its bands. The opt-in burst
probe (test_render_burst_probe.py) measures the whole effect on a real server.
"""
import io
import threading
import time

import pymupdf
import pytest
from PIL import Image, ImageChops

from backend import config
from backend.render import ops, pool

BAND = 64 * 1024


def _doc(rotate=0, width=612, height=792):
    """A page of text and shapes, which bands exactly as it renders whole."""
    doc = pymupdf.open()
    page = doc.new_page(width=width, height=height)
    page.insert_text((72, 72), "Banded rendering", fontsize=28)
    shape = page.new_shape()
    for i in range(12):
        shape.draw_rect(pymupdf.Rect(40 + i * 40, 120 + i * 50, 90 + i * 40, 160 + i * 50))
        shape.finish(color=(0, 0, 0), fill=(i / 12, 0.4, 0.6))
    shape.commit()
    page.set_rotation(rotate)
    return doc


def _differing(a: Image.Image, b: Image.Image) -> float:
    """The share of pixels that differ at all between two same-sized images."""
    diff = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v else 0)
    return diff.histogram()[255] / (a.width * a.height)


class TestBandedRaster:
    def test_a_banded_page_matches_one_drawn_whole(self):
        doc = _doc()
        calls = []
        whole = ops.rasterize_page(doc, 1, 1200)
        banded = ops.rasterize_page(
            doc, 1, 1200, band_pixels=BAND, between_bands=lambda: calls.append(1)
        )
        assert banded.size == whole.size == (1200, 1553)
        # Anti-aliasing where a shape crosses a band edge can differ by a shade.
        assert _differing(whole, banded) < 0.001
        rows = BAND // 1200
        assert len(calls) == -(-1553 // rows) - 1  # between bands, not after the last

    def test_a_banded_tile_matches_one_drawn_whole(self):
        doc = _doc()
        for col, row in ((0, 0), (1, 1), (2, 3)):  # (2, 3) is cut short at the bottom
            whole = ops.rasterize_tile(doc, 1, 2560, col, row)
            banded = ops.rasterize_tile(doc, 1, 2560, col, row, band_pixels=BAND)
            assert banded.size == whole.size
            assert _differing(whole, banded) < 0.001
        assert ops.rasterize_tile(doc, 1, 2560, 2, 3).size == (512, 241)

    def test_a_rotated_page_bands_the_way_it_is_shown(self):
        doc = _doc(rotate=90)
        whole = ops.rasterize_page(doc, 1, 900)
        banded = ops.rasterize_page(doc, 1, 900, band_pixels=BAND)
        assert banded.size == whole.size
        assert whole.width == 900 and whole.height < whole.width  # shown landscape
        assert _differing(whole, banded) < 0.001

    def test_without_bands_it_draws_in_one_go(self, monkeypatch):
        doc = _doc()
        lists = []
        real = pymupdf.Page.get_displaylist
        monkeypatch.setattr(
            pymupdf.Page, "get_displaylist", lambda self, *a, **k: lists.append(1) or real(self)
        )
        calls = []
        ops.rasterize_page(doc, 1, 800, between_bands=lambda: calls.append(1))
        # A band at least as tall as the image is no band at all.
        ops.rasterize_page(doc, 1, 800, band_pixels=10**9, between_bands=lambda: calls.append(1))
        ops.rasterize_tile(doc, 1, 1024, 0, 0, band_pixels=10**9)
        assert calls == []
        # get_pixmap builds its own display list; the banded path's would be extra.
        assert len(lists) == 3

    def test_a_band_is_never_thinner_than_the_minimum(self):
        doc = _doc()
        calls = []
        img = ops.rasterize_page(doc, 1, 1200, band_pixels=1, between_bands=lambda: calls.append(1))
        assert img.size == (1200, 1553)
        assert len(calls) == -(-1553 // ops.MIN_BAND_ROWS) - 1

    def test_bands_still_refuse_what_cannot_be_drawn(self):
        doc = _doc()
        with pytest.raises(ops.PageOutOfRange):
            ops.rasterize_page(doc, 2, 800, band_pixels=BAND)
        with pytest.raises(ops.TileOutOfRange):
            ops.rasterize_tile(doc, 1, 1024, 5, 0, band_pixels=BAND)
        with pytest.raises(ops.WidthOutOfRange):
            ops.rasterize_tile(doc, 1, ops.MAX_RENDER_WIDTH + 1, 0, 0, band_pixels=BAND)


class _Clock:
    """Stands in for ``time`` in pool: each nap takes ``nap`` seconds of fake time."""

    def __init__(self, nap):
        self.now = 1000.0
        self.nap = nap
        self.naps = 0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.naps += 1
        self.now += self.nap(seconds) if callable(self.nap) else self.nap


class TestMakingWay:
    @pytest.fixture
    def clock(self, monkeypatch):
        def use(nap):
            fake = _Clock(nap)
            monkeypatch.setattr(pool, "time", fake)
            return fake

        return use

    def test_a_quiet_process_costs_one_nap(self, clock):
        fake = clock(pool._NAP)
        pool._InProcessRaster().make_way(5.0)
        assert fake.naps == 1

    def test_a_busy_one_gets_as_long_as_the_render_held_it(self, clock):
        # Every nap comes back late: another thread had the interpreter.
        fake = clock(0.01)
        pool._InProcessRaster().make_way(0.205)
        assert fake.naps == 21  # until the 0.205 s it held has gone by

    def test_it_stops_making_way_once_the_others_are_done(self, clock):
        late = iter([0.01, 0.01, 0.01])
        fake = clock(lambda _s: next(late, pool._NAP))
        pool._InProcessRaster().make_way(10.0)
        assert fake.naps == 4

    def test_nothing_held_means_one_nap_however_busy(self, clock):
        fake = clock(0.01)
        pool._InProcessRaster().make_way(0.0)
        assert fake.naps == 1

    def test_a_turn_makes_way_for_as_long_as_the_last_one_held(self, monkeypatch):
        raster = pool._InProcessRaster()
        waits = []
        monkeypatch.setattr(raster, "make_way", waits.append)
        with raster.turn() as between:
            time.sleep(0.02)
            between()
            time.sleep(0.01)
        assert waits[0] == 0.0  # the first turn of all has nothing to make way for
        assert waits[1] >= 0.02  # the first band
        held = raster.held
        assert held >= 0.01  # the last stretch, which the next turn makes way for
        with raster.turn():
            pass
        assert waits[2] == held

    def test_one_rasterise_at_a_time(self, monkeypatch):
        raster = pool._InProcessRaster()
        monkeypatch.setattr(raster, "make_way", lambda held: None)
        inside, most = [0], [0]
        guard = threading.Lock()

        def rasterise():
            with raster.turn():
                with guard:
                    inside[0] += 1
                    most[0] = max(most[0], inside[0])
                time.sleep(0.02)
                with guard:
                    inside[0] -= 1

        threads = [threading.Thread(target=rasterise) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(10)
        assert most[0] == 1

    def test_a_real_nap_with_nothing_else_running_comes_back_at_once(self):
        started = time.monotonic()
        pool._InProcessRaster().make_way(2.0)
        # One nap, give or take a busy machine: nowhere near the 2 s allowed.
        assert time.monotonic() - started < 1.5


class TestInProcessRenders:
    @pytest.fixture
    def pdf(self, tmp_path):
        path = str(tmp_path / "banded.pdf")
        _doc().save(path)
        return path

    @pytest.fixture(autouse=True)
    def in_process(self, monkeypatch):
        pool.shutdown()
        monkeypatch.setattr(config, "RENDER_WORKERS", 0)
        yield
        pool.shutdown()

    @staticmethod
    def _size(data):
        return Image.open(io.BytesIO(data)).size

    def test_pages_and_tiles_are_banded_and_take_turns(self, pdf, monkeypatch):
        seen = []
        real_page, real_tile = ops.rasterize_page, ops.rasterize_tile

        def page(*args, **kwargs):
            seen.append(("page", kwargs["band_pixels"], pool._in_process.lock.locked()))
            return real_page(*args, **kwargs)

        def tile(*args, **kwargs):
            seen.append(("tile", kwargs["band_pixels"], pool._in_process.lock.locked()))
            return real_tile(*args, **kwargs)

        monkeypatch.setattr(ops, "rasterize_page", page)
        monkeypatch.setattr(ops, "rasterize_tile", tile)
        monkeypatch.setattr(pool, "IN_PROCESS_BAND_PIXELS", BAND)
        assert self._size(pool.render_page(pdf, 1, 1200, count=False)) == (1200, 1553)
        assert self._size(pool.render_tile(pdf, 1, 2048, 1, 0)) == (1024, 1024)
        assert seen == [("page", BAND, True), ("tile", BAND, True)]
        assert not pool._in_process.lock.locked()

    def test_a_failed_render_gives_up_its_turn(self, pdf):
        with pytest.raises(ops.PageOutOfRange):
            pool.render_page(pdf, 9, 800)
        assert not pool._in_process.lock.locked()
        assert self._size(pool.render_page(pdf, 1, 800, count=False))[0] == 800
