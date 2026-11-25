"""In-process rendering takes turns with the rest of the process (issue #975).

PyMuPDF holds the GIL for the whole of a rasterise, so with RENDER_WORKERS=0 a
render used to stop the event loop and every request thread until it was done.
Two halves here: ``ops`` draws a page or tile in as many bands as its pace asks
for, telling it between them, and ``pool._InProcessRaster`` is that pace. It
runs one rasterise at a time, cuts into bands only a render it expects to take
long, and makes way for other threads before each turn and between bands. The
opt-in burst probe (test_render_burst_probe.py) measures the whole effect on a
real server.
"""
import io
import threading
import time

import pymupdf
import pytest
from PIL import Image, ImageChops

from backend import config
from backend.render import ops, pool



class _Pace:
    """Asks for ``count`` bands and notes what it was asked and told."""

    def __init__(self, count):
        self.count = count
        self.pixels = []
        self.between = 0

    def bands(self, pixels):
        self.pixels.append(pixels)
        return self.count

    def between_bands(self):
        self.between += 1


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
    @pytest.mark.parametrize("count", [2, 5, ops.MAX_BANDS])
    def test_a_banded_page_matches_one_drawn_whole(self, count):
        doc = _doc()
        pace = _Pace(count)
        whole = ops.rasterize_page(doc, 1, 1200)
        banded = ops.rasterize_page(doc, 1, 1200, pace=pace)
        assert banded.size == whole.size == (1200, 1553)
        # Anti-aliasing where a shape crosses a band edge can differ by a shade.
        assert _differing(whole, banded) < 0.001
        assert pace.pixels == [1200 * 1553]
        assert pace.between == count - 1  # between bands, not after the last

    def test_a_banded_tile_matches_one_drawn_whole(self):
        doc = _doc()
        for col, row in ((0, 0), (1, 1), (2, 3)):  # (2, 3) is cut short at the bottom
            whole = ops.rasterize_tile(doc, 1, 2560, col, row)
            pace = _Pace(3)
            banded = ops.rasterize_tile(doc, 1, 2560, col, row, pace=pace)
            assert banded.size == whole.size
            assert _differing(whole, banded) < 0.001
            assert pace.pixels == [whole.width * whole.height]
        assert ops.rasterize_tile(doc, 1, 2560, 2, 3).size == (512, 241)

    def test_a_rotated_page_bands_the_way_it_is_shown(self):
        doc = _doc(rotate=90)
        whole = ops.rasterize_page(doc, 1, 900)
        banded = ops.rasterize_page(doc, 1, 900, pace=_Pace(4))
        assert banded.size == whole.size
        assert whole.width == 900 and whole.height < whole.width  # shown landscape
        assert _differing(whole, banded) < 0.001

    def test_one_band_draws_it_in_one_go(self, monkeypatch):
        doc = _doc()
        lists = []
        real = pymupdf.Page.get_displaylist
        monkeypatch.setattr(
            pymupdf.Page, "get_displaylist", lambda self, *a, **k: lists.append(1) or real(self)
        )
        ops.rasterize_page(doc, 1, 800)
        paces = [_Pace(1), _Pace(0), _Pace(-3)]  # fewer than one band is one
        ops.rasterize_page(doc, 1, 800, pace=paces[0])
        ops.rasterize_page(doc, 1, 800, pace=paces[1])
        ops.rasterize_tile(doc, 1, 1024, 0, 0, pace=paces[2])
        assert [pace.between for pace in paces] == [0, 0, 0]
        # get_pixmap builds its own display list; the banded path's would be extra.
        assert len(lists) == 4

    def test_never_more_bands_than_the_most(self):
        doc = _doc()
        pace = _Pace(10_000)
        img = ops.rasterize_page(doc, 1, 1200, pace=pace)
        assert img.size == (1200, 1553)
        assert pace.between == ops.MAX_BANDS - 1

    def test_never_more_bands_than_rows(self):
        doc = _doc(width=612, height=3)  # 3 rows tall at this width
        pace = _Pace(ops.MAX_BANDS)
        img = ops.rasterize_page(doc, 1, 612, pace=pace)
        assert img.size == (612, 3)
        assert pace.between == 2

    def test_bands_still_refuse_what_cannot_be_drawn(self):
        doc = _doc()
        with pytest.raises(ops.PageOutOfRange):
            ops.rasterize_page(doc, 2, 800, pace=_Pace(4))
        with pytest.raises(ops.TileOutOfRange):
            ops.rasterize_tile(doc, 1, 1024, 5, 0, pace=_Pace(4))
        with pytest.raises(ops.WidthOutOfRange):
            ops.rasterize_tile(doc, 1, ops.MAX_RENDER_WIDTH + 1, 0, 0, pace=_Pace(4))


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

    def test_after_a_late_nap_it_waits_for_a_quiet_spell(self, clock):
        late = iter([0.01, 0.01, 0.01])
        fake = clock(lambda _s: next(late, pool._NAP))
        pool._InProcessRaster().make_way(10.0)
        assert fake.naps == 3 + pool._QUIET_NAPS

    def test_a_late_nap_starts_the_quiet_spell_again(self, clock):
        # A request that pauses and carries on: late, two on time, late again.
        naps = iter([0.01, pool._NAP, pool._NAP, 0.01])
        fake = clock(lambda _s: next(naps, pool._NAP))
        pool._InProcessRaster().make_way(10.0)
        assert fake.naps == 4 + pool._QUIET_NAPS

    def test_a_quiet_spell_ends_with_the_time_allowed(self, clock):
        late = iter([0.01])
        fake = clock(lambda _s: next(late, pool._NAP))
        pool._InProcessRaster().make_way(0.01 + 2 * pool._NAP)
        assert fake.naps == 3

    def test_nothing_held_means_one_nap_however_busy(self, clock):
        fake = clock(0.01)
        pool._InProcessRaster().make_way(0.0)
        assert fake.naps == 1

    def test_a_turn_makes_way_for_as_long_as_the_last_one_held(self, monkeypatch):
        raster = pool._InProcessRaster()
        waits = []
        monkeypatch.setattr(raster, "make_way", waits.append)
        with raster.turn() as pace:
            assert pace is raster
            time.sleep(0.02)
            pace.between_bands()
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


class TestBandsByTheClock:
    @pytest.fixture
    def raster(self, monkeypatch):
        raster = pool._InProcessRaster()
        monkeypatch.setattr(raster, "make_way", lambda held: None)
        monkeypatch.setattr(pool, "IN_PROCESS_BAND_SECONDS", 0.1)
        return raster

    @staticmethod
    def _draw(raster, monkeypatch, pixels, seconds, bands=None):
        """One turn drawing ``pixels`` in ``seconds`` of fake time; the bands it asked for."""
        fake = _Clock(0.0)
        monkeypatch.setattr(pool, "time", fake)
        with raster.turn() as pace:
            asked = pace.bands(pixels)
            for band in range(bands or max(1, asked)):
                if band:
                    pace.between_bands()
                fake.now += seconds / (bands or max(1, asked))
        return asked

    def test_the_first_render_is_drawn_whole(self, raster, monkeypatch):
        assert raster.rate is None
        assert self._draw(raster, monkeypatch, 4_000_000, 2.0) == 1
        assert raster.rate == pytest.approx(2.0 / 4_000_000)

    def test_a_render_that_about_fits_is_drawn_whole(self, raster, monkeypatch):
        self._draw(raster, monkeypatch, 1_000_000, 0.05)
        assert self._draw(raster, monkeypatch, 1_000_000, 0.05) == 0  # ops draws it whole
        assert self._draw(raster, monkeypatch, 2_000_000, 0.1, bands=1) == 1
        # A little over is still whole: bands would only make it slower.
        assert self._draw(raster, monkeypatch, 2_800_000, 0.14, bands=1) == 1

    def test_a_slow_render_is_cut_into_bands_of_about_the_time(self, raster, monkeypatch):
        self._draw(raster, monkeypatch, 1_000_000, 0.26)
        assert self._draw(raster, monkeypatch, 1_000_000, 0.26) == 3
        # Twice the pixels at the same pace is twice the time; ops caps the bands.
        assert self._draw(raster, monkeypatch, 2_000_000, 0.52) == 5
        assert self._draw(raster, monkeypatch, 40_000_000, 10.4) > ops.MAX_BANDS

    def test_the_time_between_bands_counts_only_the_drawing(self, raster, monkeypatch):
        # Three bands with a long wait between each: the waits are not drawing.
        def wait(held):
            pool.time.now += 5

        monkeypatch.setattr(raster, "make_way", wait)
        self._draw(raster, monkeypatch, 1_000_000, 0.3, bands=3)
        assert raster.rate == pytest.approx(0.3 / 1_000_000)

    def test_the_pace_follows_the_renders(self, raster, monkeypatch):
        self._draw(raster, monkeypatch, 1_000_000, 0.4)
        # Fast pages after a slow one: halfway there each time, so it is back
        # to drawing whole within a few.
        asked = [self._draw(raster, monkeypatch, 1_000_000, 0.02, bands=1) for _ in range(3)]
        assert asked == [4, 2, 1]
        self._draw(raster, monkeypatch, 1_000_000, 0.4, bands=1)
        assert self._draw(raster, monkeypatch, 1_000_000, 0.4) == 2

    def test_a_render_that_drew_nothing_teaches_nothing(self, raster, monkeypatch):
        self._draw(raster, monkeypatch, 1_000_000, 0.25)
        rate = raster.rate
        with pytest.raises(ops.PageOutOfRange):
            with raster.turn():
                raise ops.PageOutOfRange(3)
        assert raster.rate == rate


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

    def test_pages_and_tiles_are_paced_and_take_turns(self, pdf, monkeypatch):
        seen = []
        real_page, real_tile = ops.rasterize_page, ops.rasterize_tile

        def page(*args, **kwargs):
            seen.append(("page", kwargs["pace"], pool._in_process.lock.locked()))
            return real_page(*args, **kwargs)

        def tile(*args, **kwargs):
            seen.append(("tile", kwargs["pace"], pool._in_process.lock.locked()))
            return real_tile(*args, **kwargs)

        monkeypatch.setattr(ops, "rasterize_page", page)
        monkeypatch.setattr(ops, "rasterize_tile", tile)
        assert self._size(pool.render_page(pdf, 1, 1200, count=False)) == (1200, 1553)
        assert self._size(pool.render_tile(pdf, 1, 2048, 1, 0)) == (1024, 1024)
        assert seen == [("page", pool._in_process, True), ("tile", pool._in_process, True)]
        assert not pool._in_process.lock.locked()
        assert pool._in_process.rate is not None

    def test_a_slow_host_gets_its_pages_in_bands(self, pdf, monkeypatch):
        raster = pool._InProcessRaster()
        raster.rate = 1.0  # a second a pixel: every render wants the most bands
        ways = []
        monkeypatch.setattr(raster, "make_way", ways.append)
        monkeypatch.setattr(pool, "_in_process", raster)
        assert self._size(pool.render_page(pdf, 1, 600, count=False)) == (600, 777)
        assert len(ways) == ops.MAX_BANDS  # before the turn, and between its bands

    def test_a_failed_render_gives_up_its_turn(self, pdf):
        with pytest.raises(ops.PageOutOfRange):
            pool.render_page(pdf, 9, 800)
        assert not pool._in_process.lock.locked()
        assert self._size(pool.render_page(pdf, 1, 800, count=False))[0] == 800
