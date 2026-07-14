"""Tests for the standalone PDF extraction worker (backend/pdf_worker.py).

The worker runs inside the isolated extraction subprocess and must stay
behaviourally identical to ``indexer.extract_text_from_pdf`` while importing
none of the heavy ``backend`` app modules.
"""
from __future__ import annotations

import pickle
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import fitz

from backend import indexer, pdf_worker


def _make_text_pdf(path: Path, texts: list[str]) -> None:
    doc = fitz.open()
    for t in texts:
        page = doc.new_page()
        page.insert_text((72, 72), t)
    doc.save(str(path))
    doc.close()


def test_matches_extract_text_from_pdf(tmp_path):
    """pdf_worker.run must produce the same output as the in-process reference."""
    pdf = tmp_path / "sample.pdf"
    _make_text_pdf(pdf, ["Hello world", "Second page text"])

    worker_pages, worker_ocr = pdf_worker.run(str(pdf))
    ref_pages, ref_ocr = indexer.extract_text_from_pdf(str(pdf))

    assert worker_pages == ref_pages
    assert worker_ocr == ref_ocr
    assert [p["page"] for p in worker_pages] == [1, 2]


def _make_image_only_pdf(path: Path) -> None:
    """A PDF whose single page has no embedded text layer (get_text() -> "")."""
    doc = fitz.open()
    doc.new_page()  # blank page
    doc.save(str(path))
    doc.close()


def test_ocr_settings_disabled_by_env(monkeypatch):
    monkeypatch.setenv("OCR_ENABLED", "false")
    enabled, langs = pdf_worker._ocr_settings()
    assert enabled is False
    assert langs == "eng"


def test_ocr_settings_enabled_probes_tesseract(monkeypatch):
    """When OCR_ENABLED and tesseract is importable, settings report enabled."""
    monkeypatch.setenv("OCR_ENABLED", "true")
    monkeypatch.setenv("OCR_LANGUAGES", "eng+deu")
    fake_tess = MagicMock()
    fake_tess.get_tesseract_version.return_value = "5.0.0"
    with patch.dict(sys.modules, {"pytesseract": fake_tess}):
        enabled, langs = pdf_worker._ocr_settings()
    assert enabled is True
    assert langs == "eng+deu"


def test_ocr_settings_enabled_but_tesseract_missing(monkeypatch):
    monkeypatch.setenv("OCR_ENABLED", "true")
    fake_tess = MagicMock()
    fake_tess.get_tesseract_version.side_effect = RuntimeError("no binary")
    with patch.dict(sys.modules, {"pytesseract": fake_tess}):
        enabled, _ = pdf_worker._ocr_settings()
    assert enabled is False


def test_run_ocrs_text_less_pages(tmp_path):
    """A page with no text layer is OCR'd when OCR is available."""
    pdf = tmp_path / "scan.pdf"
    _make_image_only_pdf(pdf)

    with patch.object(pdf_worker, "_ocr_settings", return_value=(True, "eng")):
        with patch.object(pdf_worker, "_ocr_page", return_value="recognised words"):
            pages, used_ocr = pdf_worker.run(str(pdf))

    assert used_ocr is True
    assert pages == [{"page": 1, "content": "recognised words"}]


def test_ocr_page_runs_tesseract(tmp_path):
    """_ocr_page renders the page and returns tesseract's stripped output."""
    pdf = tmp_path / "scan.pdf"
    _make_image_only_pdf(pdf)
    doc = fitz.open(str(pdf))
    page = doc[0]

    fake_tess = MagicMock()
    fake_tess.image_to_string.return_value = "  hello ocr  \n"
    with patch.dict(sys.modules, {"pytesseract": fake_tess}):
        text = pdf_worker._ocr_page(page, "eng")
    doc.close()

    assert text == "hello ocr"
    assert fake_tess.image_to_string.called


def test_ocr_page_swallows_errors(tmp_path):
    """_ocr_page returns "" if rendering or OCR raises."""
    pdf = tmp_path / "scan.pdf"
    _make_image_only_pdf(pdf)
    doc = fitz.open(str(pdf))
    page = doc[0]

    fake_tess = MagicMock()
    fake_tess.image_to_string.side_effect = RuntimeError("boom")
    with patch.dict(sys.modules, {"pytesseract": fake_tess}):
        text = pdf_worker._ocr_page(page, "eng")
    doc.close()

    assert text == ""


def test_main_writes_pickled_result(tmp_path):
    """pdf_worker.main pickles (pages, used_ocr) to the given result path."""
    pdf = tmp_path / "sample.pdf"
    _make_text_pdf(pdf, ["Only page"])
    result_path = tmp_path / "out.pkl"

    pdf_worker.main(str(pdf), str(result_path))

    with open(result_path, "rb") as fh:
        pages, used_ocr = pickle.load(fh)
    assert pages == [{"page": 1, "content": "Only page"}]
    assert used_ocr is False


def test_run_text_only_skips_ocr(tmp_path):
    """text_only=True never OCRs: an image-only page yields no pages."""
    pdf = tmp_path / "scan.pdf"
    _make_image_only_pdf(pdf)

    called = {"ocr": False}

    def _spy(*a, **k):
        called["ocr"] = True
        return "should not run"

    with patch.object(pdf_worker, "_ocr_settings", return_value=(True, "eng")):
        with patch.object(pdf_worker, "_ocr_page", side_effect=_spy):
            pages, used_ocr = pdf_worker.run(str(pdf), text_only=True)

    assert pages == []
    assert used_ocr is False
    assert called["ocr"] is False


def test_run_text_only_keeps_text_layer(tmp_path):
    """text_only still reads embedded text; it only skips OCR of image pages."""
    pdf = tmp_path / "mixed.pdf"
    _make_text_pdf(pdf, ["Real text here"])

    pages, used_ocr = pdf_worker.run(str(pdf), text_only=True)
    assert pages == [{"page": 1, "content": "Real text here"}]
    assert used_ocr is False


def test_ocr_page_single(tmp_path):
    """ocr_page OCRs one image-only page and returns its text."""
    pdf = tmp_path / "scan.pdf"
    _make_image_only_pdf(pdf)

    with patch.object(pdf_worker, "_ocr_page", return_value="page text"):
        out = pdf_worker.ocr_page(str(pdf), 0, "eng")
    assert out == "page text"


def test_ocr_page_skips_text_layer_pages(tmp_path):
    """ocr_page returns "" for a page that already has a text layer (no dup)."""
    pdf = tmp_path / "text.pdf"
    _make_text_pdf(pdf, ["Already has text"])

    with patch.object(pdf_worker, "_ocr_page", return_value="unexpected") as m:
        out = pdf_worker.ocr_page(str(pdf), 0, "eng")
    assert out == ""
    assert not m.called


def test_ocr_scale_default(monkeypatch):
    monkeypatch.delenv("OCR_DPI", raising=False)
    assert pdf_worker._ocr_scale() == 150.0 / 72.0


def test_ocr_scale_reads_env(monkeypatch):
    monkeypatch.setenv("OCR_DPI", "300")
    assert pdf_worker._ocr_scale() == 300.0 / 72.0


def test_ocr_scale_clamps_and_handles_bad_value(monkeypatch):
    monkeypatch.setenv("OCR_DPI", "5000")
    assert pdf_worker._ocr_scale() == 600.0 / 72.0  # clamped high
    monkeypatch.setenv("OCR_DPI", "10")
    assert pdf_worker._ocr_scale() == 72.0 / 72.0  # clamped low
    monkeypatch.setenv("OCR_DPI", "bogus")
    assert pdf_worker._ocr_scale() == 150.0 / 72.0  # fallback


def test_ocr_page_uses_configured_dpi(tmp_path, monkeypatch):
    """_ocr_page renders at the OCR_DPI-derived scale."""
    pdf = tmp_path / "scan.pdf"
    _make_image_only_pdf(pdf)
    doc = fitz.open(str(pdf))
    page = doc[0]

    monkeypatch.setenv("OCR_DPI", "72")  # scale 1.0 → smaller pixmap
    fake_tess = MagicMock()
    fake_tess.image_to_string.return_value = "x"
    captured = {}
    real_get_pixmap = page.get_pixmap

    def spy(*a, **k):
        captured["matrix"] = k.get("matrix")
        return real_get_pixmap(*a, **k)

    page.get_pixmap = spy
    with patch.dict(sys.modules, {"pytesseract": fake_tess}):
        pdf_worker._ocr_page(page, "eng")
    doc.close()
    # 72 DPI → scale 1.0 identity matrix
    assert captured["matrix"] == fitz.Matrix(1.0, 1.0)


def test_ocr_scale_explicit_dpi_overrides_env(monkeypatch):
    monkeypatch.setenv("OCR_DPI", "150")
    # Explicit per-book DPI wins over the env default.
    assert pdf_worker._ocr_scale(300) == 300.0 / 72.0
    # None falls back to the env value.
    assert pdf_worker._ocr_scale(None) == 150.0 / 72.0


def test_ocr_scale_explicit_dpi_clamped(monkeypatch):
    assert pdf_worker._ocr_scale(9000) == 600.0 / 72.0
    assert pdf_worker._ocr_scale(1) == 72.0 / 72.0


def test_ocr_page_threads_explicit_dpi(tmp_path):
    """_ocr_page renders at the scale derived from an explicit DPI override."""
    pdf = tmp_path / "scan.pdf"
    _make_image_only_pdf(pdf)
    doc = fitz.open(str(pdf))
    page = doc[0]
    real_get_pixmap = page.get_pixmap
    captured = {}

    def spy(*a, **k):
        captured["matrix"] = k.get("matrix")
        return real_get_pixmap(*a, **k)

    page.get_pixmap = spy
    fake_tess = MagicMock()
    fake_tess.image_to_string.return_value = "x"
    with patch.dict(sys.modules, {"pytesseract": fake_tess}):
        pdf_worker._ocr_page(page, "eng", dpi=288)  # 288/72 = 4.0
    doc.close()
    assert captured["matrix"] == fitz.Matrix(4.0, 4.0)


def test_ocr_page_main_passes_dpi(tmp_path):
    """ocr_page_main forwards its dpi argument to ocr_page."""
    pdf = tmp_path / "scan.pdf"
    _make_image_only_pdf(pdf)
    result_path = tmp_path / "out.pkl"
    with patch.object(pdf_worker, "ocr_page", return_value="ok") as m:
        pdf_worker.ocr_page_main(str(pdf), 0, "eng", str(result_path), dpi=250)
    assert m.call_args.kwargs.get("dpi") == 250


def test_ocr_page_main_writes_pickled_text(tmp_path):
    """ocr_page_main pickles the recognised text to result_path."""
    pdf = tmp_path / "scan.pdf"
    _make_image_only_pdf(pdf)
    result_path = tmp_path / "out.pkl"

    with patch.object(pdf_worker, "_ocr_page", return_value="recognised"):
        pdf_worker.ocr_page_main(str(pdf), 0, "eng", str(result_path))

    with open(result_path, "rb") as fh:
        assert pickle.load(fh) == "recognised"


def test_worker_imports_no_heavy_backend_modules():
    """Importing pdf_worker must not pull in backend.config (DB/Valkey/Alembic).

    Run in a clean interpreter so a config import elsewhere in the test session
    can't mask a real dependency.  Guards the isolation guarantee: a throwaway
    extraction process must not open the SQLite engine or run migrations.
    """
    code = (
        "import backend.pdf_worker, sys; "
        "assert 'backend.config' not in sys.modules, "
        "'pdf_worker must not import backend.config'; "
        "print('ok')"
    )
    with tempfile.TemporaryDirectory() as data:
        env = {"PATH": "/usr/bin:/bin", "DATA_PATH": data}
        # Preserve the interpreter's import path so 'backend' resolves.
        proc = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            cwd=str(Path(__file__).resolve().parents[2]),
            env={**env},
        )
    assert proc.returncode == 0, f"stdout={proc.stdout!r} stderr={proc.stderr!r}"
    assert "ok" in proc.stdout
