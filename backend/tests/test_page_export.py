"""Unit tests for the page export service (issue #207)."""
import io
import zipfile

import fitz
import pytest
from PIL import Image

from backend.services import page_export as pe
from backend.services.page_export.bundle import _unique
from backend.services.page_export.pdf import _runs, as_pdf, pages_pdf, region_pdf
from backend.services.page_export.render import composite_for, encode, render_region
from backend.services.page_export.spec import is_left_page, validate_region


def _png(size=(40, 40), color=(200, 30, 30, 255), round_mask=False) -> bytes:
    img = Image.new("RGBA", size, color)
    if round_mask:
        mask = Image.new("L", size, 0)
        from PIL import ImageDraw

        ImageDraw.Draw(mask).ellipse((0, 0, size[0] - 1, size[1] - 1), fill=255)
        img.putalpha(mask)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _doc(pages=4, width=200, height=300) -> fitz.Document:
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=width, height=height)
        page.insert_text((20, 40), f"Page {i + 1}", fontsize=14)
    return doc


class TestParsePageSpec:
    def test_single_ranges_and_lists(self):
        assert pe.parse_page_spec("3", 10) == [3]
        assert pe.parse_page_spec("2-4, 7", 10) == [2, 3, 4, 7]

    def test_keeps_written_order_and_drops_repeats(self):
        assert pe.parse_page_spec("7, 2-3, 3", 10) == [7, 2, 3]

    def test_backwards_range_is_read_forwards(self):
        assert pe.parse_page_spec("5-3", 10) == [3, 4, 5]

    def test_accepts_typographic_dashes(self):
        assert pe.parse_page_spec("1–2, 4—5", 10) == [1, 2, 4, 5]

    @pytest.mark.parametrize(
        "spec, message",
        [
            ("", "at least one"),
            (" , ", "at least one"),
            ("abc", "not a page"),
            ("0", "numbered from 1"),
            ("11", "past the end"),
        ],
    )
    def test_rejects_bad_input_with_a_readable_message(self, spec, message):
        with pytest.raises(pe.ExportError, match=message):
            pe.parse_page_spec(spec, 10)


class TestSpreads:
    def test_left_pages_follow_the_reader(self):
        assert not is_left_page(1, 0)
        assert is_left_page(2, 0)
        assert is_left_page(1, 1)
        assert not is_left_page(2, 1)

    def test_groups_facing_pages_with_cover_alone(self):
        assert pe.group_spreads([1, 2, 3, 4, 5], 0) == [(1,), (2, 3), (4, 5)]

    def test_groups_with_cover_paired(self):
        assert pe.group_spreads([1, 2, 3, 4, 5], 1) == [(1, 2), (3, 4), (5,)]

    def test_half_spread_at_the_edges_stays_alone(self):
        # 3 is the right half of 2-3; 6 opens a spread whose partner was not asked for.
        assert pe.group_spreads([3, 4, 5, 6], 0) == [(3,), (4, 5), (6,)]

    def test_page_label(self):
        assert pe.page_label([4]) == "p4"
        assert pe.page_label((9, 2, 5)) == "p2-9"


class TestValidateRegion:
    def test_clamps_into_the_page(self):
        r = validate_region(pe.Region((1,), "rect", 0.8, -0.1, 0.5, 0.5), 3)
        assert r.x == pytest.approx(0.8) and r.w == pytest.approx(0.2)
        assert r.y == 0 and r.h == pytest.approx(0.4)

    def test_rejects_empty_area(self):
        with pytest.raises(pe.ExportError, match="no area"):
            validate_region(pe.Region((1,), "rect", 1.0, 0.2, 0.3, 0.3), 3)

    def test_rejects_non_consecutive_spread(self):
        with pytest.raises(pe.ExportError, match="consecutive"):
            validate_region(pe.Region((1, 3), "rect", 0, 0, 1, 1), 5)

    def test_rejects_page_past_the_end(self):
        with pytest.raises(pe.ExportError, match="past the end"):
            validate_region(pe.Region((9,), "rect", 0, 0, 1, 1), 5)

    def test_rejects_too_many_pages(self):
        with pytest.raises(pe.ExportError, match="one page or two"):
            validate_region(pe.Region((1, 2, 3), "rect", 0, 0, 1, 1), 5)


class TestRender:
    def test_full_page_size_follows_dpi(self):
        doc = _doc()
        img = render_region(doc, pe.Region((1,), "rect", 0, 0, 1, 1), 144)
        assert img.size == (400, 600)
        assert img.mode == "RGB"

    def test_spread_is_both_pages_side_by_side(self):
        doc = _doc()
        img = render_region(doc, pe.Region((2, 3), "rect", 0, 0, 1, 1), 72)
        assert img.size == (400, 300)

    def test_spread_scales_a_shorter_page_to_match(self):
        doc = fitz.open()
        doc.new_page(width=200, height=300)
        doc.new_page(width=100, height=150)
        comp = composite_for(doc, (1, 2))
        assert comp.height == 300
        assert comp.width == pytest.approx(400)
        img = render_region(doc, pe.Region((1, 2), "rect", 0, 0, 1, 1), 72)
        assert img.size == (400, 300)

    def test_region_across_the_gutter(self):
        doc = fitz.open()
        left = doc.new_page(width=100, height=100)
        left.draw_rect(fitz.Rect(0, 0, 100, 100), color=None, fill=(1, 0, 0))
        right = doc.new_page(width=100, height=100)
        right.draw_rect(fitz.Rect(0, 0, 100, 100), color=None, fill=(0, 0, 1))
        img = render_region(doc, pe.Region((1, 2), "rect", 0.25, 0, 0.5, 1), 72)
        assert img.size == (100, 100)
        assert img.getpixel((10, 50))[0] > 200  # red half from the left page
        assert img.getpixel((90, 50))[2] > 200  # blue half from the right page

    def test_ellipse_is_transparent_outside_the_circle(self):
        doc = _doc()
        img = render_region(doc, pe.Region((1,), "ellipse", 0, 0, 0.5, 0.5), 72)
        assert img.mode == "RGBA"
        assert img.getpixel((0, 0))[3] == 0
        assert img.getpixel((img.width // 2, img.height // 2))[3] == 255

    def test_refuses_an_oversized_render(self, monkeypatch):
        monkeypatch.setattr("backend.services.page_export.render.MAX_OUTPUT_PIXELS", 100)
        with pytest.raises(pe.ExportError, match="too large"):
            render_region(_doc(), pe.Region((1,), "rect", 0, 0, 1, 1), 72)

    @pytest.mark.parametrize("fmt, magic", [("png", b"\x89PNG"), ("jpeg", b"\xff\xd8"), ("webp", b"RIFF")])
    def test_encode_formats(self, fmt, magic):
        img = render_region(_doc(), pe.Region((1,), "ellipse", 0, 0, 0.5, 0.5), 72)
        data = encode(img, fmt)
        assert data.startswith(magic)
        decoded = Image.open(io.BytesIO(data))
        if fmt == "jpeg":
            # No alpha in JPEG: the circle's corners are flattened onto white.
            assert decoded.mode == "RGB"
            assert decoded.getpixel((0, 0)) == pytest.approx((255, 255, 255), abs=3)


class TestPdf:
    def test_runs(self):
        assert _runs([3, 4, 5, 9, 1, 2]) == [(3, 5), (9, 9), (1, 2)]

    def test_pages_pdf_keeps_order_and_text(self):
        out = fitz.open("pdf", pages_pdf(_doc(6), [5, 6, 2]))
        assert len(out) == 3
        assert "Page 5" in out[0].get_text()
        assert "Page 2" in out[2].get_text()

    def test_region_pdf_is_the_region_size_and_vector(self):
        out = fitz.open("pdf", region_pdf(_doc(), pe.Region((1,), "rect", 0, 0, 0.5, 0.5)))
        assert len(out) == 1
        assert out[0].rect.width == pytest.approx(100)
        assert out[0].rect.height == pytest.approx(150)
        assert "Page 1" in out[0].get_text()

    def test_region_pdf_across_a_spread(self):
        out = fitz.open("pdf", region_pdf(_doc(), pe.Region((2, 3), "rect", 0, 0, 1, 1)))
        assert out[0].rect.width == pytest.approx(400)
        text = out[0].get_text()
        assert "Page 2" in text and "Page 3" in text

    def test_as_pdf_converts_other_formats(self):
        doc = _doc()
        assert as_pdf(doc) is doc
        xps_like = fitz.open("pdf", doc.tobytes())
        assert as_pdf(xps_like).is_pdf


class TestBundle:
    def test_safe_stem(self):
        assert pe.safe_stem('Mörk: Borg / "Core"?') == "Mörk Borg Core"
        assert pe.safe_stem("...") == "export"
        assert len(pe.safe_stem("x" * 400)) == 150

    def test_unique(self):
        assert _unique(["a.png", "A.png", "a.png", "b"]) == ["a.png", "A (2).png", "a (3).png", "b"]

    def test_pages_as_pdf(self):
        files = pe.export_pages(_doc(), "Book", [1, 2], "pdf", 150, False, 0)
        assert [f.name for f in files] == ["Book (p1-2).pdf"]
        assert files[0].media_type == "application/pdf"

    def test_pages_as_joined_images(self):
        files = pe.export_pages(_doc(5), "Book", [1, 2, 3], "png", 72, True, 0)
        assert [f.name for f in files] == ["Book (p1).png", "Book (p2-3).png"]
        assert Image.open(io.BytesIO(files[1].data)).size == (400, 300)

    def test_pages_rejects_unknown_format(self):
        with pytest.raises(pe.ExportError):
            pe.export_pages(_doc(), "Book", [1], "gif", 72, False, 0)

    def test_too_many_image_pages(self, monkeypatch):
        monkeypatch.setattr("backend.services.page_export.bundle.MAX_IMAGE_PAGES", 2)
        with pytest.raises(pe.ExportError, match="Save as PDF"):
            pe.export_pages(_doc(), "Book", [1, 2, 3], "png", 72, False, 0)

    def test_regions_named_by_user_or_page(self):
        regions = [
            pe.Region((2,), "rect", 0, 0, 0.5, 0.5),
            pe.Region((2,), "ellipse", 0.5, 0.5, 0.5, 0.5),
            pe.Region((3,), "rect", 0, 0, 1, 1, name="Goblin/Boss"),
        ]
        files = pe.export_regions(_doc(), "Book", regions, "png", 72)
        assert [f.name for f in files] == ["Book (p2) 1.png", "Book (p2) 2.png", "Goblin Boss.png"]

    def test_regions_duplicate_names_get_suffixes(self):
        regions = [pe.Region((1,), "rect", 0, 0, 1, 1, name="Orc")] * 2
        names = [f.name for f in pe.export_regions(_doc(), "Book", regions, "jpeg", 72)]
        assert names == ["Orc.jpg", "Orc (2).jpg"]

    def test_round_regions_cannot_be_pdf(self):
        with pytest.raises(pe.ExportError, match="PNG or WebP"):
            pe.export_regions(_doc(), "B", [pe.Region((1,), "ellipse", 0, 0, 1, 1)], "pdf", 72)

    def test_rectangular_regions_as_pdf(self):
        files = pe.export_regions(_doc(), "B", [pe.Region((1,), "rect", 0, 0, 1, 1)], "pdf", 72)
        assert files[0].name == "B (p1) 1.pdf"

    def test_regions_limits(self, monkeypatch):
        with pytest.raises(pe.ExportError, match="at least one"):
            pe.export_regions(_doc(), "B", [], "png", 72)
        with pytest.raises(pe.ExportError):
            pe.export_regions(_doc(), "B", [pe.Region((1,), "rect", 0, 0, 1, 1)], "gif", 72)
        monkeypatch.setattr("backend.services.page_export.bundle.MAX_REGIONS", 1)
        with pytest.raises(pe.ExportError, match="limited"):
            pe.export_regions(_doc(), "B", [pe.Region((1,), "rect", 0, 0, 1, 1)] * 2, "png", 72)

    def test_bundle_single_and_zip(self):
        one = pe.ExportFile("a.png", b"1", "image/png")
        assert pe.bundle_files([one], "x") is one
        zipped = pe.bundle_files([one, pe.ExportFile("a.png", b"2", "image/png")], "Book: cuts")
        assert zipped.name == "Book cuts.zip"
        with zipfile.ZipFile(io.BytesIO(zipped.data)) as zf:
            assert zf.namelist() == ["a.png", "a (2).png"]


class TestDetect:
    def _token_sheet(self) -> fitz.Document:
        doc = fitz.open()
        page = doc.new_page(width=600, height=800)
        # A full-page background - too big to be a piece.
        page.insert_image(fitz.Rect(0, 0, 600, 800), stream=_png((60, 80), (240, 240, 230, 255)))
        # Two round tokens stored as square images with transparent corners.
        page.insert_image(fitz.Rect(50, 50, 150, 150), stream=_png(round_mask=True))
        page.insert_image(fitz.Rect(200, 50, 300, 150), stream=_png(round_mask=True))
        # A square token.
        page.insert_image(fitz.Rect(350, 50, 450, 150), stream=_png())
        # A circular vector frame drawn around nothing.
        page.draw_circle(fitz.Point(100, 400), 60, color=(0, 0, 0), width=3)
        # A frame drawn around an opaque square image - one round piece.
        page.insert_image(fitz.Rect(250, 350, 350, 450), stream=_png())
        page.draw_circle(fitz.Point(300, 400), 52, color=(0, 0, 0), width=3)
        # A tiny ornament.
        page.insert_image(fitz.Rect(500, 700, 505, 705), stream=_png((4, 4)))
        return doc

    def test_finds_tokens_and_their_shapes(self):
        found = pe.detect_shapes(self._token_sheet(), 1)
        shapes = [(round(f.rect.x0), round(f.rect.y0), f.shape) for f in found]
        assert (50, 50, "ellipse") in shapes
        assert (200, 50, "ellipse") in shapes
        assert (350, 50, "rect") in shapes
        # A bare vector frame (r=60, 3pt stroke) is cut out to its outer edge.
        frame = [f for f in found if f.shape == "ellipse" and f.rect.x0 < 45 and f.rect.y0 > 300]
        assert len(frame) == 1
        assert frame[0].rect.x0 == pytest.approx(38.5)
        assert frame[0].rect.width == pytest.approx(123)
        framed = [f for f in found if 240 <= f.rect.x0 <= 250 and 340 <= f.rect.y0 <= 350]
        assert len(framed) == 1 and framed[0].shape == "ellipse"
        assert len(found) == 5

    def test_reading_order(self):
        found = pe.detect_shapes(self._token_sheet(), 1)
        tops = [f.rect.y0 for f in found]
        assert tops == sorted(tops) or tops[:3] == [50, 50, 50]
        assert [round(f.rect.x0) for f in found[:3]] == [50, 200, 350]

    def test_panel_holding_several_pieces_is_dropped(self):
        doc = fitz.open()
        page = doc.new_page(width=600, height=800)
        page.insert_image(fitz.Rect(10, 10, 400, 300), stream=_png())
        page.insert_image(fitz.Rect(50, 50, 150, 150), stream=_png())
        page.insert_image(fitz.Rect(200, 50, 300, 150), stream=_png())
        found = pe.detect_shapes(doc, 1)
        assert len(found) == 2

    def test_scanned_page_finds_nothing(self):
        doc = fitz.open()
        page = doc.new_page(width=600, height=800)
        page.insert_image(page.rect, stream=_png((60, 80)))
        assert pe.detect_shapes(doc, 1) == []


class TestDetectRaster:
    """Token sheets flattened into one page-sized picture (no structure to read)."""

    @staticmethod
    def _flat_sheet(background=(255, 255, 255)) -> fitz.Document:
        from PIL import ImageDraw

        scale = 4  # px per point in the embedded picture
        img = Image.new("RGB", (612 * scale, 792 * scale), background)
        d = ImageDraw.Draw(img)
        # A 3 x 3 grid of 90pt tokens printed edge to edge, as sheets often are:
        # each touches its neighbours, so they merge until split apart.
        for row in range(3):
            for col in range(3):
                x, y = (40 + col * 90) * scale, (40 + row * 90) * scale
                colour = (60 + row * 60, 90 + col * 50, 140)
                d.ellipse((x, y, x + 90 * scale - 1, y + 90 * scale - 1), fill=colour)
        # A token whose art is white inside: a thick ring. Still one round piece.
        d.ellipse((400 * scale, 60 * scale, 520 * scale, 180 * scale), fill=(150, 40, 40))
        d.ellipse((420 * scale, 80 * scale, 500 * scale, 160 * scale), fill=background)
        # A square card.
        d.rectangle((400 * scale, 400 * scale, 520 * scale, 520 * scale), fill=(40, 120, 60))
        doc = fitz.open()
        page = doc.new_page(width=612, height=792)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        page.insert_image(page.rect, stream=buf.getvalue())
        return doc

    def test_finds_every_token_on_a_flattened_sheet(self):
        found = pe.detect_shapes(self._flat_sheet(), 1)
        rounds = [f for f in found if f.shape == "ellipse"]
        squares = [f for f in found if f.shape == "rect"]
        assert len(rounds) == 10  # nine in the grid, plus the ring
        assert len(squares) == 1
        assert squares[0].rect.x0 == pytest.approx(400, abs=1.5)
        assert squares[0].rect.width == pytest.approx(120, abs=2)

    def test_touching_tokens_come_out_square_and_tight(self):
        found = pe.detect_shapes(self._flat_sheet(), 1)
        grid = sorted(
            (f for f in found if f.shape == "ellipse" and f.rect.x0 < 330),
            key=lambda f: (round(f.rect.y0 / 45), f.rect.x0),
        )
        assert len(grid) == 9
        for f in grid:
            assert f.rect.width == pytest.approx(90, abs=2)
            assert f.rect.height == pytest.approx(f.rect.width, abs=1)
        # The middle token, boxed in on all four sides, is still found where it is.
        assert grid[4].rect.x0 == pytest.approx(130, abs=1.5)
        assert grid[4].rect.y0 == pytest.approx(130, abs=1.5)

    def test_a_ring_with_white_inside_is_one_piece(self):
        found = pe.detect_shapes(self._flat_sheet(), 1)
        ring = [f for f in found if f.rect.x0 > 390 and f.rect.y0 < 200]
        assert len(ring) == 1
        assert ring[0].rect.width == pytest.approx(120, abs=2)

    def test_coloured_page_background(self):
        found = pe.detect_shapes(self._flat_sheet(background=(235, 225, 200)), 1)
        assert len(found) == 11

    def test_page_without_a_plain_background_finds_nothing(self):
        import random

        rnd = random.Random(3)
        img = Image.new("RGB", (300, 400))
        img.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)) for _ in range(300 * 400)])
        doc = fitz.open()
        page = doc.new_page(width=612, height=792)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        page.insert_image(page.rect, stream=buf.getvalue())
        assert pe.detect_shapes(doc, 1) == []

    def test_blank_page_finds_nothing(self):
        doc = fitz.open()
        doc.new_page(width=612, height=792)
        assert pe.detect_shapes(doc, 1) == []

    def test_an_irregular_piece_is_kept_whole(self):
        from PIL import ImageDraw

        from backend.services.page_export.detect_raster import _split

        mask = Image.new("L", (120, 120), 0)
        # An L shape: not a disc, not a solid box, and no erosion splits it in two.
        ImageDraw.Draw(mask).polygon([(10, 10), (40, 10), (40, 80), (110, 80), (110, 110), (10, 110)], fill=255)
        assert len(_split(mask, min_area=50)) == 1

    def test_background_needs_a_border(self):
        from backend.services.page_export.detect_raster import _background

        assert _background(Image.new("RGB", (6, 6), "white")) is None


class TestDetectCards:
    """Print-and-play cards: each card is several images stacked in one place."""

    @staticmethod
    def _card_sheet(slots=4) -> fitz.Document:
        doc = fitz.open()
        page = doc.new_page(width=612, height=792)
        boxes = [(77, 30, 295, 388), (317, 30, 535, 388), (77, 399, 295, 757), (317, 399, 535, 757)]
        for x0, y0, x1, y1 in boxes[:slots]:
            # Art and frame layers, a point or two apart, plus the name banner
            # sitting inside the card near its foot.
            page.insert_image(fitz.Rect(x0, y0, x1, y1), stream=_png((60, 100), (90, 60, 40, 255)), keep_proportion=False)
            page.insert_image(
                fitz.Rect(x0, y0, x1 - 7, y1), stream=_png((60, 100), (20, 20, 20, 255)), keep_proportion=False
            )
            page.insert_image(
                fitz.Rect(x0 + 6, y1 - 58, x1 - 5, y1 - 3), stream=_png((60, 16)), keep_proportion=False
            )
            # Cut lines around the card, as the sheet prints them.
            page.draw_rect(fitz.Rect(x0 - 11, y0 - 12, x1 + 11, y1 + 12), color=(0, 0, 0), width=0.25)
        return doc

    def test_each_card_is_one_piece(self):
        found = pe.detect_shapes(self._card_sheet(), 1)
        assert [tuple(round(v) for v in f.rect) for f in found] == [
            (77, 30, 295, 388),
            (317, 30, 535, 388),
            (77, 399, 295, 757),
            (317, 399, 535, 757),
        ]
        assert all(f.shape == "rect" for f in found)

    def test_a_short_last_sheet(self):
        assert len(pe.detect_shapes(self._card_sheet(slots=3), 1)) == 3

    def test_a_letter_drawn_as_a_circle_is_not_a_token(self):
        doc = fitz.open()
        page = doc.new_page(width=612, height=792)
        # The O of a logo set as outlines: a small filled ring.
        page.draw_circle(fitz.Point(317, 66), 12.5, color=None, fill=(0, 0, 0))
        assert pe.detect_shapes(doc, 1) == []
