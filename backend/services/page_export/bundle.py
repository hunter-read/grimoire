"""Turning an export request into the files it produces (issue #207).

Each request yields a list of named files. One file is handed back as itself;
several are zipped, since a browser asked to save twenty downloads at once
either blocks them or buries the user in prompts. Saving into the library takes
the same list and writes each file on its own.
"""
import io
import re
import zipfile
from dataclasses import dataclass

import fitz  # type: ignore[import-untyped]

from .pdf import pages_pdf, region_pdf
from .render import encode, render_region
from .spec import (
    EXTENSIONS,
    IMAGE_FORMATS,
    MAX_IMAGE_PAGES,
    MAX_REGIONS,
    MEDIA_TYPES,
    ExportError,
    Region,
    group_spreads,
    page_label,
    validate_region,
)

_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')
_MAX_STEM = 150


@dataclass(frozen=True)
class ExportFile:
    """One produced file, ready to stream or write."""

    name: str
    data: bytes
    media_type: str


def safe_stem(text: str, fallback: str = "export") -> str:
    """A filename stem with path separators and reserved characters removed."""
    stem = " ".join(_UNSAFE.sub(" ", text or "").split()).strip(" .")
    return stem[:_MAX_STEM].rstrip(" .") or fallback


def _unique(names: list[str]) -> list[str]:
    """Suffix repeats with (2), (3)... so no file in a zip overwrites another."""
    seen: dict[str, int] = {}
    out: list[str] = []
    for name in names:
        key = name.lower()
        if key not in seen:
            seen[key] = 1
            out.append(name)
            continue
        stem, dot, ext = name.rpartition(".")
        while True:
            seen[key] += 1
            candidate = f"{stem} ({seen[key]}){dot}{ext}" if dot else f"{name} ({seen[key]})"
            if candidate.lower() not in seen:
                seen[candidate.lower()] = 1
                out.append(candidate)
                break
    return out


def export_pages(
    doc: fitz.Document,
    title: str,
    pages: list[int],
    fmt: str,
    dpi: int,
    join_spreads: bool,
    spread_offset: int,
) -> list[ExportFile]:
    """Whole pages: one PDF, or one image per page (or per joined spread)."""
    stem = safe_stem(title)
    if fmt == "pdf":
        return [
            ExportFile(
                name=f"{stem} ({page_label(pages)}).pdf",
                data=pages_pdf(doc, pages),
                media_type=MEDIA_TYPES["pdf"],
            )
        ]
    if fmt not in IMAGE_FORMATS:
        raise ExportError(f"'{fmt}' is not a format pages can be saved as")
    if len(pages) > MAX_IMAGE_PAGES:
        raise ExportError(
            f"That is {len(pages)} pages - images are limited to {MAX_IMAGE_PAGES} at a time. "
            "Save as PDF, or export a shorter range"
        )
    groups = group_spreads(pages, spread_offset) if join_spreads else [(p,) for p in pages]
    files: list[ExportFile] = []
    for group in groups:
        region = Region(pages=group, shape="rect", x=0.0, y=0.0, w=1.0, h=1.0)
        files.append(
            ExportFile(
                name=f"{stem} ({page_label(group)}).{EXTENSIONS[fmt]}",
                data=encode(render_region(doc, region, dpi), fmt),
                media_type=MEDIA_TYPES[fmt],
            )
        )
    return files


def export_regions(
    doc: fitz.Document,
    title: str,
    regions: list[Region],
    fmt: str,
    dpi: int,
) -> list[ExportFile]:
    """Cut-outs: one file per region, named by the user or after its page."""
    if not regions:
        raise ExportError("Draw at least one area to cut out")
    if len(regions) > MAX_REGIONS:
        raise ExportError(f"Cut-outs are limited to {MAX_REGIONS} at a time")
    if fmt not in EXTENSIONS:
        raise ExportError(f"'{fmt}' is not a format cut-outs can be saved as")
    page_count = len(doc)
    checked = [validate_region(r, page_count) for r in regions]
    if fmt == "pdf" and any(r.shape == "ellipse" for r in checked):
        raise ExportError("Round cut-outs need a transparent background - save them as PNG or WebP")

    stem = safe_stem(title)
    per_page: dict[tuple[int, ...], int] = {}
    names: list[str] = []
    for region in checked:
        per_page[region.pages] = per_page.get(region.pages, 0) + 1
        default = f"{stem} ({page_label(region.pages)}) {per_page[region.pages]}"
        names.append(f"{safe_stem(region.name, default)}.{EXTENSIONS[fmt]}")

    files: list[ExportFile] = []
    for name, region in zip(_unique(names), checked):
        data = (
            region_pdf(doc, region)
            if fmt == "pdf"
            else encode(render_region(doc, region, dpi), fmt)
        )
        files.append(ExportFile(name=name, data=data, media_type=MEDIA_TYPES[fmt]))
    return files


def bundle_files(files: list[ExportFile], zip_stem: str) -> ExportFile:
    """The one file to hand back: the file itself, or a zip of them all."""
    if len(files) == 1:
        return files[0]
    buf = io.BytesIO()
    # Stored, not deflated: PNG, JPEG, WebP and deflated PDF are already
    # compressed, and squeezing them again only spends CPU.
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        for name, f in zip(_unique([f.name for f in files]), files):
            zf.writestr(name, f.data)
    return ExportFile(
        name=f"{safe_stem(zip_stem)}.zip", data=buf.getvalue(), media_type=MEDIA_TYPES["zip"]
    )
