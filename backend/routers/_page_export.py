"""Shared glue for exporting pages and cut-outs (issue #207).

Books and PDF maps both offer export, from the same reader components, so the
request models and the work of turning a request into a response live here
once. Each router only resolves its record, checks access, and hands over the
file path and a title to name the output after.
"""
import io
import os
from typing import Literal
from urllib.parse import quote

import fitz  # type: ignore[import-untyped]
from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..config import logger
from ..indexer.formats import open_document
from ..services import library_fs as fs
from ..services import page_export as pe

# Mirrors the file manager's mapping, so a save into the library fails with the
# same status a plain upload into that folder would.
_FS_STATUS = {
    "forbidden": 403,
    "not_found": 404,
    "conflict": 409,
    "read_only": 409,
    "too_large": 413,
    "io_error": 500,
}


class ExportRegionIn(BaseModel):
    pages: list[int] = Field(min_length=1, max_length=2)
    shape: Literal["rect", "ellipse"] = "rect"
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)
    name: str = Field("", max_length=200)


class ExportRequest(BaseModel):
    kind: Literal["pages", "regions"]
    format: Literal["pdf", "png", "jpeg", "webp"] = "pdf"
    dpi: int = Field(150, ge=pe.MIN_DPI, le=pe.MAX_DPI)
    # kind=pages: a page list like "12-15, 20".
    pages: str = ""
    # kind=pages, image formats: join facing pages into one image each, paired
    # the way the reader pairs them (spread_offset 1 pairs the cover with page 2).
    join_spreads: bool = False
    spread_offset: Literal[0, 1] = 0
    # kind=regions: the areas to cut out.
    regions: list[ExportRegionIn] = Field(default_factory=list, max_length=pe.MAX_REGIONS)


class SaveExportRequest(ExportRequest):
    destination: str = Field(..., min_length=1)


class SavedFile(BaseModel):
    path: str
    name: str
    size: int


class SaveExportResponse(BaseModel):
    folder: str
    saved: list[SavedFile]


class PageSizeResponse(BaseModel):
    width: float
    height: float


class DetectedShape(BaseModel):
    shape: Literal["rect", "ellipse"]
    x: float
    y: float
    w: float
    h: float


class DetectShapesResponse(BaseModel):
    shapes: list[DetectedShape]


def _content_disposition(name: str) -> str:
    """An attachment header that survives non-ASCII titles.

    Starlette encodes headers as Latin-1, so a raw "Mörk Borg" or a CJK title
    would 500. The plain ``filename`` carries an ASCII fallback and
    ``filename*`` the real name (RFC 6266), which every current browser prefers.
    """
    ascii_name = name.encode("ascii", "replace").decode("ascii").replace('"', "'")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name, safe='')}"


def _produce(filepath: str, title: str, req: ExportRequest) -> tuple[list[pe.ExportFile], str]:
    """Run an export, returning its files and the name a zip of them would take."""
    doc = open_document(filepath)
    try:
        stem = pe.safe_stem(title)
        if req.kind == "pages":
            pages = pe.parse_page_spec(req.pages, len(doc))
            files = pe.export_pages(
                doc, title, pages, req.format, req.dpi, req.join_spreads, req.spread_offset
            )
            return files, f"{stem} ({pe.page_label(pages)})"
        regions = [
            pe.Region(
                pages=tuple(r.pages), shape=r.shape, x=r.x, y=r.y, w=r.w, h=r.h, name=r.name
            )
            for r in req.regions
        ]
        files = pe.export_regions(doc, title, regions, req.format, req.dpi)
        return files, f"{stem} (cut-outs)"
    except pe.ExportError as e:
        raise HTTPException(400, str(e)) from e
    finally:
        doc.close()


def export_response(filepath: str, title: str, req: ExportRequest) -> Response:
    """Stream the export: the single file, or a zip when there are several."""
    files, zip_stem = _produce(filepath, title, req)
    out = pe.bundle_files(files, zip_stem)
    return Response(
        content=out.data,
        media_type=out.media_type,
        headers={"Content-Disposition": _content_disposition(out.name)},
    )


def save_export(filepath: str, title: str, req: SaveExportRequest) -> SaveExportResponse:
    """Write each exported file into a library folder, never overwriting.

    Goes through the same path as an upload, so the destination is validated
    against the library root, refused on a read-only mount, and checked against
    the file types that part of the library indexes - a PDF saved into Tokens is
    an error the user sees now, not a file the scanner silently ignores later.
    Files are written one by one and kept separate: a zip in the library is an
    archive to unpack, not twelve tokens.
    """
    files, _ = _produce(filepath, title, req)
    saved: list[SavedFile] = []
    for f in files:
        try:
            result = fs.save_upload(req.destination, f.name, io.BytesIO(f.data), on_conflict="rename")
        except fs.LibraryFSError as e:
            if saved:
                # Report what did land, so a failure partway is not mistaken
                # for nothing having been written.
                logger.warning(
                    "Export save stopped after %d of %d files: %s", len(saved), len(files), e
                )
                raise HTTPException(
                    _FS_STATUS.get(e.code, 400),
                    f"Saved {len(saved)} of {len(files)} files, then: {e.message}",
                ) from e
            raise HTTPException(_FS_STATUS.get(e.code, 400), e.message) from e
        saved.append(SavedFile(path=result["path"], name=result["name"], size=result["size"]))
    return SaveExportResponse(folder=req.destination, saved=saved)


def _open_page(filepath: str, page_num: int) -> tuple[fitz.Document, fitz.Page]:
    if not os.path.exists(filepath):
        raise HTTPException(404, "File not found on disk")
    doc = open_document(filepath)
    if page_num < 1 or page_num > len(doc):
        count = len(doc)
        doc.close()
        raise HTTPException(400, f"Page must be between 1 and {count}")
    return doc, doc[page_num - 1]


def page_size(filepath: str, page_num: int) -> PageSizeResponse:
    """A page's size in PDF points, for showing what a resolution will produce."""
    doc, page = _open_page(filepath, page_num)
    try:
        return PageSizeResponse(width=page.rect.width, height=page.rect.height)
    finally:
        doc.close()


def detect_page_shapes(filepath: str, page_num: int) -> DetectShapesResponse:
    """Suggested cut-outs for one page, as fractions of the page."""
    doc, page = _open_page(filepath, page_num)
    try:
        width, height = page.rect.width, page.rect.height
        found = pe.detect_shapes(doc, page_num)
        return DetectShapesResponse(
            shapes=[
                DetectedShape(
                    shape=f.shape,
                    x=(f.rect.x0 - page.rect.x0) / width,
                    y=(f.rect.y0 - page.rect.y0) / height,
                    w=f.rect.width / width,
                    h=f.rect.height / height,
                )
                for f in found
            ]
        )
    finally:
        doc.close()
