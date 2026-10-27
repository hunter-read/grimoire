"""Page and map renders refuse a width outside the renderable range.

MuPDF renders a negative zoom at its absolute size, so a negative width used to
render (and cache) an enormous page. The routes bound the width, and the
rasterizer refuses one outside the range whatever its caller checked.
"""
import fitz  # type: ignore[import-untyped]
import pytest

from backend.render import ops, pool, worker
from backend.routers._render_errors import render_errors
from backend.services.media.maps import render_map_pdf_page
from backend.tests.conftest import make_book, make_game_system, make_map


def _pdf(path):
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "page")
    doc.save(str(path))
    doc.close()
    return str(path)


@pytest.fixture
def in_process(monkeypatch):
    from backend import config

    pool.shutdown()
    monkeypatch.setattr(config, "RENDER_WORKERS", 0)
    yield
    pool.shutdown()


@pytest.mark.parametrize("width", [-1, 0, -12000])
def test_book_page_rejects_a_non_positive_width(client, admin_headers, tmp_path, width):
    path = _pdf(tmp_path / "b.pdf")
    book = make_book(
        system_id=make_game_system().id,
        filename="b.pdf",
        filepath=path,
        mime_type="application/pdf",
        page_count=1,
    )
    resp = client.get(f"/api/books/{book.id}/page/1?width={width}", headers=admin_headers)
    assert resp.status_code == 422


@pytest.mark.parametrize("width", [-1, 0, -12000])
def test_map_page_rejects_a_non_positive_width(client, admin_headers, tmp_path, width):
    path = _pdf(tmp_path / "m.pdf")
    m = make_map(filename="m.pdf", filepath=path)
    resp = client.get(f"/api/maps/{m.id}/page/1?width={width}", headers=admin_headers)
    assert resp.status_code == 422


def test_the_smallest_allowed_width_still_renders(client, admin_headers, tmp_path, in_process):
    path = _pdf(tmp_path / "small.pdf")
    book = make_book(
        system_id=make_game_system().id,
        filename="small.pdf",
        filepath=path,
        mime_type="application/pdf",
        page_count=1,
    )
    url = f"/api/books/{book.id}/page/1?width={ops.MIN_RENDER_WIDTH}"
    assert client.get(url, headers=admin_headers).status_code == 200


@pytest.mark.parametrize("width", [-5, 0, ops.MIN_RENDER_WIDTH - 1, ops.MAX_RENDER_WIDTH + 1])
def test_the_rasterizer_refuses_a_width_out_of_range(tmp_path, width):
    doc = fitz.open(_pdf(tmp_path / "r.pdf"))
    try:
        with pytest.raises(ops.WidthOutOfRange) as err:
            ops.rasterize_page(doc, 1, width)
        assert err.value.width == width
        assert str(err.value) == (
            f"Width must be between {ops.MIN_RENDER_WIDTH} and {ops.MAX_RENDER_WIDTH}"
        )
        with pytest.raises(ops.WidthOutOfRange):
            ops.rasterize_tile(doc, 1, width, 0, 0)
    finally:
        doc.close()


def test_the_width_error_crosses_the_process_boundary():
    err = ops.WidthOutOfRange(-3)
    assert worker.portable(err) is err


def test_a_width_error_from_any_caller_is_a_400():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        with render_errors():
            raise ops.WidthOutOfRange(-1)
    assert exc.value.status_code == 400


def test_a_map_render_turns_a_width_error_into_a_value_error(tmp_path, in_process):
    path = _pdf(tmp_path / "direct.pdf")
    with pytest.raises(ValueError, match="Width must be between"):
        render_map_pdf_page(path, 1, -10)
