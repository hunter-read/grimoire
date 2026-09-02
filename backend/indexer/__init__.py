"""Library scanner, PDF indexer, and metadata fetcher for Grimoire.

This package was decomposed from a single ``indexer.py`` module (issue #152).
The public API is unchanged: every symbol that used to live in ``indexer`` is
re-exported here, so ``from backend.indexer import X`` and ``indexer.X`` keep
working exactly as before.

Monkeypatch compatibility: the submodules invoke patch-sensitive helpers
(``_fitz_open_with_timeout``, ``extract_text_isolated``, ``generate_thumbnail``,
``_book_page_count``, ``ocr_page_isolated``, ``ocr_book_page_isolated_wrapper``)
through this package namespace, and the shared modules/callables that tests
patch on ``backend.indexer`` — ``fitz``, ``os``, ``ocr``, ``config``, ``text``,
``_MP_CONTEXT`` — are bound here as module attributes.
"""
import logging

# --- Names tests patch as backend.indexer.<name> -------------------------------
# (kept as module-level attributes so patch()/patch.object() find them here)
import os  # noqa: F401
import pickle  # noqa: F401  (patched by ocr-worker tests as backend.indexer.pickle)
import fitz  # noqa: F401  (PyMuPDF)
from sqlalchemy import text  # noqa: F401

from .. import config  # noqa: F401  (re-exported for env-override patches)
from .. import ocr  # noqa: F401  (re-exported for ocr_available patches)

logger = logging.getLogger("grimoire.indexer")

# --- Shared constants ----------------------------------------------------------
from .constants import (  # noqa: E402,F401
    ARCHIVE_EXTS,
    AUDIO_EXTS,
    CATEGORY_MAP,
    CONTAINER_ONE_PAGE,
    CONTAINER_PARENT,
    DOC_EXTS,
    IMAGE_EXTS,
    MAP_IMAGE_EXTS,
    MAP_OPAQUE_EXTS,
    MAP_VIDEO_EXTS,
    MEDIA_ARCHIVE_EXTS,
    METADATA_MODES,
    NO_AUTO_CATEGORY_MARKER,
    NSFW_MARKER,
    ONE_PAGE_MARKER,
    PARENT_SYSTEM_MARKER,
    PDF_EXTS,
    TEXT_DOC_EXTS,
    UNCATEGORIZED,
    VTT_DATA_EXTS,
    _MP_CONTEXT,
    is_vtt_data,
    map_video_mime,
)

# --- Per-format capability table (issues #180/#200/#373) -----------------------
from . import comics, text_documents  # noqa: E402,F401
from .formats import (  # noqa: E402,F401
    COMIC_EXTS,
    COMIC_MIMES,
    FITZ_EXTS,
    FITZ_MIMES,
    INDEXABLE_MIMES,
    TEXT_EXTS,
    TEXT_MIMES,
    apply_reflow_layout,
    can_index,
    can_thumbnail,
    family_for_mime,
    has_page_count,
    is_comic_path,
    is_fitz_mime,
    mime_for_ext,
    open_document,
    spec_for_ext,
    spec_for_path,
)

# --- Category inference --------------------------------------------------------
from .categories import (  # noqa: E402,F401
    agnostic_category,
    detect_container_kind,
    folder_category_inference_disabled,
    guess_category,
    has_nsfw_marker,
    is_one_page_folder,
    is_special_collection_folder,
    is_system_agnostic_folder,
    prettify_collection_name,
    slugify,
    strip_container_suffix,
    strip_sort_prefix,
)

# --- Archive + thumbnail helpers -----------------------------------------------
from .thumbnails import (  # noqa: E402,F401
    _extract_7z_member,
    _first_image_from_archive,
    _generate_thumbnail_task,
    archive_ext,
    archive_mime,
    generate_thumbnail,
)

# --- Content hashing / change detection ----------------------------------------
from .hashing import (  # noqa: E402,F401
    apply_signature,
    changed_content,
    file_signature,
    hash_file,
    signature_matches,
)

# --- Isolated extraction / OCR -------------------------------------------------
from ._subprocess import (  # noqa: E402,F401
    PdfExtractionCrashError,
    _book_page_count,
    _commit,
    _fitz_open_with_timeout,
    _run_with_timeout,
    extract_text_from_pdf,
    extract_text_isolated,
    ocr_book,
    ocr_book_page_isolated_wrapper,
    ocr_page_isolated,
)

# --- Sidecar / embedded metadata + scope ---------------------------------------
from .metadata import (  # noqa: E402,F401
    _apply_opf_to_book,
    _extract_embedded_art,
    _find_folder_artwork,
    _find_opf_meta,
    _has_embedded_art,
    _read_audio_metadata,
    is_exported_cover_name,
    is_folder_cover_name,
    parse_opf_metadata,
    resolve_collection_dir,
    resolve_scope,
)

# --- Full-text indexing --------------------------------------------------------
from .text_index import (  # noqa: E402,F401
    index_book_text,
    reindex_single_book,
)

# --- Library scan --------------------------------------------------------------
from .scan import (  # noqa: E402,F401
    _count_eligible_files,
    _prune_dirs,
    scan_library,
)

# --- tags.json application -----------------------------------------------------
from .tags import (  # noqa: E402,F401
    _apply_tags_from_library,
    _load_tags_json,
    _within_scope,
)
