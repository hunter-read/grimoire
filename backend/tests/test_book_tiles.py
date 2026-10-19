"""Zoom tiles: squares of a page rendered at high zoom (issue #574)."""
import io
import os
import tempfile
import uuid

import fitz  # type: ignore[import-untyped]
import pytest
from PIL import Image, ImageChops, ImageStat

from backend.routers.books import tiles
from backend.tests.conftest import make_book, make_game_system

WIDTH = 2048  # two tiles across


@pytest.fixture(scope="module")
def sys_row():
    return make_game_system()


@pytest.fixture(scope="module")
def tmpdir_mod():
    return tempfile.mkdtemp()


def _pdf_book(system_id, tmp, *, rotation=0, cropbox=None, mime="application/pdf"):
    """A one-page PDF of distinct coloured blocks, so a misplaced tile shows."""
    path = os.path.join(tmp, f"tiles-{uuid.uuid4().hex[:8]}.pdf")
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    colours = [(1, 0, 0), (0, 0.6, 0), (0, 0, 1), (0.9, 0.7, 0), (0.5, 0, 0.5), (0, 0.6, 0.6)]
    for i in range(6):
        for j in range(8):
            rect = fitz.Rect(i * 102, j * 99, i * 102 + 90, j * 99 + 90)
            page.draw_rect(rect, color=None, fill=colours[(i + j) % len(colours)])
    page.insert_text((40, 60), "Zorbulax", fontsize=36, color=(1, 1, 1))
    if cropbox:
        page.set_cropbox(fitz.Rect(*cropbox))
    if rotation:
        page.set_rotation(rotation)
    doc.save(path)
    doc.close()
    return make_book(
        system_id=system_id,
        filename=os.path.basename(path),
        filepath=path,
        mime_type=mime,
        page_count=1,
    )


def _tile(client, headers, book, col, row, width=WIDTH, page=1):
    return client.get(
        f"/api/books/{book.id}/page/{page}/tile",
        params={"width": width, "col": col, "row": row},
        headers=headers,
    )


def _reference(book, width):
    """The whole page rendered directly at ``width``, to cut the expected tiles from."""
    doc = fitz.open(book.filepath)
    page = doc[0]
    scale = width / page.rect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    doc.close()
    return image


def _difference(a, b):
    return max(ImageStat.Stat(ImageChops.difference(a, b)).mean)


class TestTileContent:
    @pytest.mark.parametrize(
        "kwargs",
        [{}, {"rotation": 90}, {"cropbox": (50, 40, 562, 752)}],
        ids=["plain", "rotated", "cropped"],
    )
    def test_tiles_reassemble_the_page(self, client, admin_headers, sys_row, tmpdir_mod, kwargs):
        book = _pdf_book(sys_row.id, tmpdir_mod, **kwargs)
        reference = _reference(book, WIDTH)
        doc = fitz.open(book.filepath)
        cols, rows = tiles.tile_grid(doc[0].rect, WIDTH)
        doc.close()
        for col in range(cols):
            for row in range(rows):
                resp = _tile(client, admin_headers, book, col, row)
                assert resp.status_code == 200, resp.text
                assert resp.headers["content-type"] == "image/webp"
                got = Image.open(io.BytesIO(resp.content)).convert("RGB")
                x, y = col * tiles.TILE_SIZE, row * tiles.TILE_SIZE
                expected = reference.crop((x, y, x + got.width, y + got.height))
                assert abs(got.width - min(tiles.TILE_SIZE, reference.width - x)) <= 1
                assert abs(got.height - min(tiles.TILE_SIZE, reference.height - y)) <= 1
                assert _difference(got, expected) < 8, (col, row)

    def test_edge_tiles_are_cut_to_the_page(self, client, admin_headers, sys_row, tmpdir_mod):
        book = _pdf_book(sys_row.id, tmpdir_mod)
        resp = _tile(client, admin_headers, book, 1, 1, width=1280)
        assert resp.status_code == 200
        got = Image.open(io.BytesIO(resp.content))
        # 1280 wide: the second column is 256px; 1656 tall: the second row is 632px.
        assert abs(got.width - 256) <= 1 and abs(got.height - 632) <= 1


class TestTileRequests:
    def test_tile_outside_the_page_is_400(self, client, admin_headers, sys_row, tmpdir_mod):
        book = _pdf_book(sys_row.id, tmpdir_mod)
        assert _tile(client, admin_headers, book, 2, 0).status_code == 400
        assert _tile(client, admin_headers, book, 0, 3).status_code == 400

    def test_width_must_be_a_step(self, client, admin_headers, sys_row, tmpdir_mod):
        book = _pdf_book(sys_row.id, tmpdir_mod)
        assert _tile(client, admin_headers, book, 0, 0, width=1000).status_code == 400

    @pytest.mark.parametrize("width", [0, tiles.MAX_WIDTH + tiles.WIDTH_STEP])
    def test_width_is_bounded(self, client, admin_headers, sys_row, tmpdir_mod, width):
        book = _pdf_book(sys_row.id, tmpdir_mod)
        assert _tile(client, admin_headers, book, 0, 0, width=width).status_code == 422

    def test_page_past_the_end_is_400(self, client, admin_headers, sys_row, tmpdir_mod):
        book = _pdf_book(sys_row.id, tmpdir_mod)
        assert _tile(client, admin_headers, book, 0, 0, page=5).status_code == 400

    def test_unknown_book_is_404(self, client, admin_headers):
        resp = client.get(
            "/api/books/nope/page/1/tile",
            params={"width": WIDTH, "col": 0, "row": 0},
            headers=admin_headers,
        )
        assert resp.status_code == 404

    def test_formats_without_rendered_pages_have_no_tiles(
        self, client, admin_headers, sys_row, tmpdir_mod
    ):
        book = _pdf_book(sys_row.id, tmpdir_mod, mime="image/png")
        assert _tile(client, admin_headers, book, 0, 0).status_code == 404

    def test_missing_file_is_404_and_flagged(self, client, admin_headers, sys_row):
        book = make_book(
            system_id=sys_row.id,
            filepath=f"/nonexistent/{uuid.uuid4().hex}.pdf",
            mime_type="application/pdf",
        )
        assert _tile(client, admin_headers, book, 0, 0).status_code == 404
        detail = client.get(f"/api/books/{book.id}", headers=admin_headers).json()
        assert detail["is_missing"] is True

    def test_players_cannot_tile_a_book_they_cannot_read(
        self, client, admin_headers, player_headers, sys_row, tmpdir_mod
    ):
        book = _pdf_book(sys_row.id, tmpdir_mod)
        resp = client.patch(
            f"/api/books/{book.id}", json={"access_level": "admin"}, headers=admin_headers
        )
        assert resp.status_code == 200, resp.text
        page = client.get(f"/api/books/{book.id}/page/1", headers=player_headers)
        assert page.status_code in (403, 404)
        # Refused exactly as the page itself is.
        assert _tile(client, player_headers, book, 0, 0).status_code == page.status_code


class TestTileCaching:
    def test_second_request_is_served_from_the_cache(
        self, client, admin_headers, sys_row, tmpdir_mod, monkeypatch
    ):
        book = _pdf_book(sys_row.id, tmpdir_mod)
        first = _tile(client, admin_headers, book, 0, 0)
        assert first.status_code == 200

        def no_render(*_a, **_k):  # pragma: no cover - the failure being tested
            raise AssertionError("rendered again instead of using the cache")

        monkeypatch.setattr(tiles.render_pool, "render_tile", no_render)
        second = _tile(client, admin_headers, book, 0, 0)
        assert second.status_code == 200
        assert second.content == first.content

    def test_etag_revalidates(self, client, admin_headers, sys_row, tmpdir_mod):
        book = _pdf_book(sys_row.id, tmpdir_mod)
        etag = _tile(client, admin_headers, book, 0, 1).headers["etag"]
        resp = client.get(
            f"/api/books/{book.id}/page/1/tile",
            params={"width": WIDTH, "col": 0, "row": 1},
            headers={**admin_headers, "If-None-Match": etag},
        )
        assert resp.status_code == 304
        assert "immutable" in resp.headers["cache-control"]
