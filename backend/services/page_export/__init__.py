"""Exporting pages and cut-outs from paged documents (issue #207).

Split by concern: ``spec`` (request vocabulary, page ranges, limits), ``render``
(rasterising regions), ``pdf`` (vector page subsets and cut-outs), ``detect``
(suggesting tokens and pictures on a page) and ``bundle`` (naming, zipping).
"""
from .bundle import ExportFile, bundle_files, export_pages, export_regions, safe_stem
from .detect import Found, detect_shapes
from .spec import (
    IMAGE_FORMATS,
    MAX_DPI,
    MAX_IMAGE_PAGES,
    MAX_OUTPUT_PIXELS,
    MAX_REGIONS,
    MIN_DPI,
    ExportError,
    Region,
    group_spreads,
    page_label,
    parse_page_spec,
)

__all__ = [
    "ExportError",
    "ExportFile",
    "Found",
    "IMAGE_FORMATS",
    "MAX_DPI",
    "MAX_IMAGE_PAGES",
    "MAX_OUTPUT_PIXELS",
    "MAX_REGIONS",
    "MIN_DPI",
    "Region",
    "bundle_files",
    "detect_shapes",
    "export_pages",
    "export_regions",
    "group_spreads",
    "page_label",
    "parse_page_spec",
    "safe_stem",
]
