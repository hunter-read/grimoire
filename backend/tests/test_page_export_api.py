"""API tests for page export on books and PDF maps (issue #207)."""
import io
import os
import uuid
import zipfile

import fitz
import pytest
from PIL import Image

from backend.config import LIBRARY_PATH
from backend.routers._page_export import _content_disposition
from backend.tests.conftest import make_book, make_game_system, make_map


def _write_pdf(path: str, pages: int = 4) -> str:
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=200, height=300)
        page.insert_text((20, 40), f"Page {i + 1}", fontsize=14)
    doc.save(path)
    doc.close()
    return path


@pytest.fixture(scope="module")
def sys_row():
    return make_game_system()


@pytest.fixture()
def pdf_book(sys_row, tmp_path):
    path = _write_pdf(str(tmp_path / f"export-{uuid.uuid4().hex[:8]}.pdf"))
    return make_book(
        system_id=sys_row.id,
        title="Mörk Borg",
        filename=os.path.basename(path),
        filepath=path,
        mime_type="application/pdf",
        page_count=4,
    )


@pytest.fixture()
def pdf_map(tmp_path):
    path = _write_pdf(str(tmp_path / f"atlas-{uuid.uuid4().hex[:8]}.pdf"), pages=3)
    return make_map(filename="Atlas.pdf", filepath=path, relative_path="maps/Atlas.pdf")


@pytest.fixture()
def tokens_dir():
    rel = f"tokens/export-{uuid.uuid4().hex[:8]}"
    os.makedirs(os.path.join(LIBRARY_PATH, rel), exist_ok=True)
    return rel


class TestBookExport:
    def test_pages_as_pdf(self, client, admin_headers, pdf_book):
        resp = client.post(
            f"/api/books/{pdf_book.id}/export",
            json={"kind": "pages", "format": "pdf", "pages": "2-3"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"
        disposition = resp.headers["content-disposition"]
        assert "filename*=UTF-8''M%C3%B6rk%20Borg%20%28p2-3%29.pdf" in disposition
        assert len(fitz.open("pdf", resp.content)) == 2

    def test_pages_as_images_are_zipped(self, client, admin_headers, pdf_book):
        resp = client.post(
            f"/api/books/{pdf_book.id}/export",
            json={"kind": "pages", "format": "png", "dpi": 72, "pages": "1-3", "join_spreads": True},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/zip"
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            assert zf.namelist() == ["Mörk Borg (p1).png", "Mörk Borg (p2-3).png"]
            spread = Image.open(io.BytesIO(zf.read("Mörk Borg (p2-3).png")))
            assert spread.size == (400, 300)

    def test_single_cut_out(self, client, player_headers, pdf_book):
        resp = client.post(
            f"/api/books/{pdf_book.id}/export",
            json={
                "kind": "regions",
                "format": "webp",
                "dpi": 72,
                "regions": [{"pages": [1], "shape": "ellipse", "x": 0, "y": 0, "w": 0.5, "h": 0.5}],
            },
            headers=player_headers,
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/webp"
        assert Image.open(io.BytesIO(resp.content)).mode == "RGBA"

    def test_bad_page_spec_is_400_with_reason(self, client, admin_headers, pdf_book):
        resp = client.post(
            f"/api/books/{pdf_book.id}/export",
            json={"kind": "pages", "pages": "9"},
            headers=admin_headers,
        )
        assert resp.status_code == 400
        assert "past the end" in resp.json()["detail"]

    def test_round_cut_out_as_pdf_is_refused(self, client, admin_headers, pdf_book):
        resp = client.post(
            f"/api/books/{pdf_book.id}/export",
            json={
                "kind": "regions",
                "format": "pdf",
                "regions": [{"pages": [1], "shape": "ellipse", "x": 0, "y": 0, "w": 1, "h": 1}],
            },
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_invalid_dpi_is_422(self, client, admin_headers, pdf_book):
        resp = client.post(
            f"/api/books/{pdf_book.id}/export",
            json={"kind": "pages", "pages": "1", "format": "png", "dpi": 5000},
            headers=admin_headers,
        )
        assert resp.status_code == 422

    def test_unknown_book_is_404(self, client, admin_headers):
        resp = client.post(
            "/api/books/nope/export", json={"kind": "pages", "pages": "1"}, headers=admin_headers
        )
        assert resp.status_code == 404

    def test_missing_file_is_404(self, client, admin_headers, sys_row):
        book = make_book(
            system_id=sys_row.id,
            filepath=f"/nonexistent/{uuid.uuid4().hex}.pdf",
            mime_type="application/pdf",
        )
        resp = client.post(
            f"/api/books/{book.id}/export", json={"kind": "pages", "pages": "1"}, headers=admin_headers
        )
        assert resp.status_code == 404

    def test_format_without_pages_is_400(self, client, admin_headers, sys_row, tmp_path):
        path = tmp_path / "notes.txt"
        path.write_text("hello")
        book = make_book(
            system_id=sys_row.id, filepath=str(path), filename="notes.txt", mime_type="text/plain"
        )
        resp = client.post(
            f"/api/books/{book.id}/export", json={"kind": "pages", "pages": "1"}, headers=admin_headers
        )
        assert resp.status_code == 400

    def test_requires_auth(self, client, pdf_book):
        resp = client.post(f"/api/books/{pdf_book.id}/export", json={"kind": "pages", "pages": "1"})
        assert resp.status_code == 401


class TestBookPageHelpers:
    def test_page_size(self, client, admin_headers, pdf_book):
        resp = client.get(f"/api/books/{pdf_book.id}/page/1/size", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json() == {"width": 200, "height": 300}

    def test_page_size_out_of_range(self, client, admin_headers, pdf_book):
        resp = client.get(f"/api/books/{pdf_book.id}/page/50/size", headers=admin_headers)
        assert resp.status_code == 400

    def test_shapes(self, client, admin_headers, sys_row, tmp_path):
        path = str(tmp_path / f"tokens-{uuid.uuid4().hex[:8]}.pdf")
        doc = fitz.open()
        page = doc.new_page(width=400, height=400)
        page.draw_circle(fitz.Point(100, 100), 50, color=(0, 0, 0), width=2)
        doc.save(path)
        book = make_book(
            system_id=sys_row.id, filepath=path, filename="tokens.pdf", mime_type="application/pdf"
        )
        resp = client.get(f"/api/books/{book.id}/page/1/shapes", headers=admin_headers)
        assert resp.status_code == 200
        shapes = resp.json()["shapes"]
        assert len(shapes) == 1
        assert shapes[0]["shape"] == "ellipse"
        assert shapes[0]["x"] == pytest.approx(50 / 400, abs=0.01)
        assert shapes[0]["w"] == pytest.approx(100 / 400, abs=0.01)


class TestSaveToLibrary:
    def test_admin_saves_each_file(self, client, admin_headers, pdf_book, tokens_dir):
        body = {
            "kind": "regions",
            "format": "png",
            "dpi": 72,
            "destination": tokens_dir,
            "regions": [
                {"pages": [1], "x": 0, "y": 0, "w": 0.5, "h": 0.5, "name": "Goblin"},
                {"pages": [2], "shape": "ellipse", "x": 0, "y": 0, "w": 0.5, "h": 0.5},
            ],
        }
        resp = client.post(f"/api/books/{pdf_book.id}/export/save", json=body, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["folder"] == tokens_dir
        assert [s["name"] for s in data["saved"]] == ["Goblin.png", "Mörk Borg (p2) 1.png"]
        for s in data["saved"]:
            assert os.path.isfile(os.path.join(LIBRARY_PATH, s["path"]))

        # A second save renames instead of overwriting.
        again = client.post(f"/api/books/{pdf_book.id}/export/save", json=body, headers=admin_headers)
        assert again.json()["saved"][0]["name"] != "Goblin.png"

    def test_type_the_destination_does_not_index_is_refused(
        self, client, admin_headers, pdf_book, tokens_dir
    ):
        resp = client.post(
            f"/api/books/{pdf_book.id}/export/save",
            json={"kind": "pages", "format": "pdf", "pages": "1", "destination": tokens_dir},
            headers=admin_headers,
        )
        assert resp.status_code == 400
        assert "not a file type" in resp.json()["detail"]

    def test_partial_failure_reports_what_landed(
        self, client, admin_headers, pdf_book, tokens_dir, monkeypatch
    ):
        from backend.routers import _page_export
        from backend.services import library_fs as fs

        real = fs.save_upload
        calls = {"n": 0}

        def flaky(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 2:
                raise fs.LibraryFSError("Disk full", code="io_error")
            return real(*args, **kwargs)

        monkeypatch.setattr(_page_export.fs, "save_upload", flaky)
        resp = client.post(
            f"/api/books/{pdf_book.id}/export/save",
            json={
                "kind": "pages",
                "format": "png",
                "dpi": 36,
                "pages": "1-2",
                "destination": tokens_dir,
            },
            headers=admin_headers,
        )
        assert resp.status_code == 500
        assert resp.json()["detail"].startswith("Saved 1 of 2 files")

    def test_missing_destination_is_404(self, client, admin_headers, pdf_book):
        resp = client.post(
            f"/api/books/{pdf_book.id}/export/save",
            json={"kind": "pages", "format": "pdf", "pages": "1", "destination": "books/nowhere-x"},
            headers=admin_headers,
        )
        assert resp.status_code == 404

    def test_non_admin_cannot_save(self, client, gm_headers, pdf_book, tokens_dir):
        resp = client.post(
            f"/api/books/{pdf_book.id}/export/save",
            json={"kind": "pages", "pages": "1", "destination": tokens_dir},
            headers=gm_headers,
        )
        assert resp.status_code == 403


class TestMapExport:
    def test_pages_as_pdf(self, client, admin_headers, pdf_map):
        resp = client.post(
            f"/api/maps/{pdf_map.id}/export",
            json={"kind": "pages", "pages": "1-3"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert "Atlas (p1-3).pdf" in resp.headers["content-disposition"]

    def test_size_and_shapes(self, client, admin_headers, pdf_map):
        assert client.get(
            f"/api/maps/{pdf_map.id}/page/2/size", headers=admin_headers
        ).json() == {"width": 200, "height": 300}
        resp = client.get(f"/api/maps/{pdf_map.id}/page/1/shapes", headers=admin_headers)
        assert resp.json() == {"shapes": []}

    def test_save(self, client, admin_headers, pdf_map, tokens_dir):
        resp = client.post(
            f"/api/maps/{pdf_map.id}/export/save",
            json={"kind": "pages", "format": "jpeg", "dpi": 36, "pages": "1", "destination": tokens_dir},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["saved"][0]["name"] == "Atlas (p1).jpg"

    def test_image_map_is_400(self, client, admin_headers, tmp_path):
        path = tmp_path / "cave.png"
        Image.new("RGB", (10, 10)).save(path)
        m = make_map(filename="cave.png", filepath=str(path))
        resp = client.post(
            f"/api/maps/{m.id}/export", json={"kind": "pages", "pages": "1"}, headers=admin_headers
        )
        assert resp.status_code == 400

    def test_unknown_and_missing_maps(self, client, admin_headers):
        assert (
            client.get("/api/maps/nope/page/1/size", headers=admin_headers).status_code == 404
        )
        gone = make_map(filename="gone.pdf", filepath=f"/nonexistent/{uuid.uuid4().hex}.pdf")
        resp = client.get(f"/api/maps/{gone.id}/page/1/shapes", headers=admin_headers)
        assert resp.status_code == 404


def test_content_disposition_ascii_fallback():
    header = _content_disposition('Mörk "Borg".png')
    assert header.startswith('attachment; filename="M?rk \'Borg\'.png"')
    assert "filename*=UTF-8''M%C3%B6rk%20%22Borg%22.png" in header


def test_book_detail_carries_relative_path(client, admin_headers, pdf_book):
    """The export's "Beside the original" destination, and the reader's file
    actions, need the book's library path - the response model used to drop it."""
    resp = client.get(f"/api/books/{pdf_book.id}", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["relative_path"] == pdf_book.relative_path
