"""Unit tests for map metadata + PDF page rendering helpers."""
import fitz
from PIL import Image

from backend.routers.maps._helpers import (
    _estimate_grid,
    _is_pdf,
    _map_image_info,
    _parse_grid_dims,
    render_map_pdf_page,
)


def _png(path, w, h, dpi=None):
    img = Image.new("RGB", (w, h), "white")
    img.save(str(path), dpi=(dpi, dpi) if dpi else None)


def _pdf(path, pages=1, w=612, h=792):
    doc = fitz.open()
    for _ in range(pages):
        doc.new_page(width=w, height=h)
    doc.save(str(path))
    doc.close()


class TestParseGridDims:
    def test_parses_x_notation(self):
        assert _parse_grid_dims("Cavern (20x25)") == (20, 25)

    def test_parses_by_notation(self):
        assert _parse_grid_dims("Cavern 30 by 40") == (30, 40)

    def test_rejects_out_of_range(self):
        assert _parse_grid_dims("999x999") is None

    def test_none_when_no_match(self):
        assert _parse_grid_dims("just a name") is None


class TestEstimateGrid:
    def test_finds_clean_multiple(self):
        # 700x1400 is a clean multiple of the smallest candidate cell (50px).
        assert _estimate_grid(700, 1400) == (14, 28, 50)

    def test_none_when_no_cell_fits(self):
        # Dimensions that don't align near any candidate cell size or fall below
        # the 2-cell minimum yield no estimate.
        assert _estimate_grid(37, 200) is None


class TestIsPdf:
    def test_true_for_pdf(self):
        assert _is_pdf("/x/atlas.PDF") is True

    def test_false_for_png(self):
        assert _is_pdf("/x/battle.png") is False


class TestMapImageInfo:
    def test_grid_from_filename(self, tmp_path):
        f = tmp_path / "cave.png"
        _png(f, 500, 500)
        info = _map_image_info(str(f), "DnD/Maps/cave (12x15).png")
        assert info["grid"] == {"width": 12, "height": 15, "source": "filename"}
        assert info["is_pdf"] is False
        assert info["pixel_width"] == 500

    def test_grid_from_dpi(self, tmp_path):
        f = tmp_path / "grid.png"
        # 700x1050 at 70 DPI → 10x15 cells with 1 inch = 1 cell.
        _png(f, 700, 1050, dpi=70)
        info = _map_image_info(str(f), "DnD/Maps/grid.png")
        assert info["dpi"] == 70
        assert info["grid"]["source"] == "dpi"
        assert (info["grid"]["width"], info["grid"]["height"]) == (10, 15)

    def test_grid_computed(self, tmp_path):
        f = tmp_path / "plain.png"
        _png(f, 700, 1400)  # no dpi, no filename dims → estimated
        info = _map_image_info(str(f), "DnD/Maps/plain.png")
        assert info["grid"]["source"] == "computed"

    def test_unreadable_file_returns_nulls(self, tmp_path):
        info = _map_image_info(str(tmp_path / "missing.png"), "DnD/Maps/missing.png")
        assert info["pixel_width"] is None
        assert info["grid"] is None

    def test_pdf_reports_page_count_without_raster_fields(self, tmp_path):
        f = tmp_path / "atlas.pdf"
        _pdf(f, pages=3)
        info = _map_image_info(str(f), "DnD/Maps/atlas.pdf")
        assert info["is_pdf"] is True
        assert info["page_count"] == 3
        assert info["pixel_width"] is None
        assert info["dpi"] is None

    def test_pdf_grid_from_filename(self, tmp_path):
        f = tmp_path / "battlemap.pdf"
        _pdf(f, pages=1)
        info = _map_image_info(str(f), "DnD/Maps/battlemap (24x18).pdf")
        assert info["grid"] == {"width": 24, "height": 18, "source": "filename"}
        # cell_px must be stripped for PDFs even when grid is detected.
        assert "cell_px" not in info["grid"]

    def test_broken_pdf_returns_nulls(self, tmp_path):
        f = tmp_path / "broken.pdf"
        f.write_bytes(b"not really a pdf")
        info = _map_image_info(str(f), "DnD/Maps/broken.pdf")
        assert info["is_pdf"] is True
        assert info["page_count"] is None


class TestRenderMapPdfPage:
    def test_renders_webp_bytes(self, tmp_path, monkeypatch):
        import backend.routers.maps._helpers as helpers

        monkeypatch.setattr(helpers, "PAGE_CACHE_DIR", str(tmp_path))
        f = tmp_path / "map.pdf"
        _pdf(f, pages=2)
        data = render_map_pdf_page(str(f), 1, 400)
        assert data[:4] == b"RIFF"

    def test_second_call_hits_disk_cache(self, tmp_path, monkeypatch):
        import backend.routers.maps._helpers as helpers

        cache = tmp_path / "cache"
        cache.mkdir()
        monkeypatch.setattr(helpers, "PAGE_CACHE_DIR", str(cache))
        f = tmp_path / "map.pdf"
        _pdf(f, pages=1)
        first = render_map_pdf_page(str(f), 1, 400)
        # A file should now exist in the cache dir; the second call reads it back.
        assert any(cache.iterdir())
        second = render_map_pdf_page(str(f), 1, 400)
        assert first == second

    def test_out_of_range_raises_value_error(self, tmp_path, monkeypatch):
        import backend.routers.maps._helpers as helpers

        monkeypatch.setattr(helpers, "PAGE_CACHE_DIR", str(tmp_path))
        f = tmp_path / "map.pdf"
        _pdf(f, pages=1)
        try:
            render_map_pdf_page(str(f), 9, 400)
            raise AssertionError("expected ValueError")
        except ValueError:
            pass
