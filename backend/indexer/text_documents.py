"""Plain-text book formats: .txt, .md, .rtf (issue #200).

Lots of homebrew content predates PDF — forum-era ``.rtf`` files, ``.txt`` notes,
``.md`` write-ups. These have no intrinsic pagination, so to reuse the paged
reader, the per-page FTS rows, and page-anchored search results, we impose one:
the decoded text is split into fixed-size pages at paragraph boundaries.

Pagination is deterministic — the same bytes always produce the same pages — so
a search hit on page 4 keeps pointing at page 4 across rescans.
"""
import logging
from pathlib import Path
from typing import Optional

from .constants import _TEXT_FILE_SIZE_CAP
from .formats import TEXT_PAGE_CHARS, TEXT_EXTS

logger = logging.getLogger("grimoire.indexer")


def _decode(raw: bytes) -> str:
    """Decode file bytes to text, tolerating the encodings old files show up in.

    Tries UTF-8 (with BOM detection) first, then the legacy Windows codepage
    that forum-era files were usually saved in, and finally falls back to lossy
    UTF-8 so a single bad byte never costs us the whole document.
    """
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def read_text_document(filepath: str) -> Optional[str]:
    """Read a text-family file and return its plain text, or None on failure.

    ``.rtf`` is unwrapped to plain text via striprtf; ``.txt``/``.md`` are used
    as-is (Markdown keeps its source markers, which are what a user searching
    for a heading would type anyway). Never raises — callers treat None as
    "no text available".
    """
    path = Path(filepath)
    ext = path.suffix.lower()
    if ext not in TEXT_EXTS:
        return None
    try:
        size = path.stat().st_size
    except OSError as exc:
        logger.debug(f"Could not stat text document '{filepath}': {exc}")
        return None
    # Guard against a multi-hundred-MB "text" file stalling the scan or
    # exhausting memory; such a file is not a book anyone reads in a browser.
    if size > _TEXT_FILE_SIZE_CAP:
        logger.warning(
            f"Text document '{filepath}' is {size} bytes, over the "
            f"{_TEXT_FILE_SIZE_CAP}-byte cap - skipping text extraction."
        )
        return None
    try:
        raw = path.read_bytes()
    except OSError as exc:
        logger.debug(f"Could not read text document '{filepath}': {exc}")
        return None

    text = _decode(raw)
    if ext == ".rtf":
        try:
            from striprtf.striprtf import rtf_to_text

            text = rtf_to_text(text, errors="ignore")
        except Exception as exc:
            # A malformed RTF should degrade to "unsearchable", not fail the scan.
            logger.warning(f"Could not parse RTF '{filepath}': {exc}")
            return None
    return text


def paginate(text: str, page_chars: int = TEXT_PAGE_CHARS) -> list[str]:
    """Split text into fixed-size pages, breaking at paragraph boundaries.

    Splitting on blank lines keeps paragraphs intact so a page break never lands
    mid-sentence. A single paragraph longer than ``page_chars`` becomes its own
    oversized page rather than being cut arbitrarily.

    Always returns at least one page for non-empty input, so a short file still
    reads as a one-page book.
    """
    if not text.strip():
        return []

    paragraphs = text.split("\n\n")
    pages: list[str] = []
    current: list[str] = []
    length = 0

    for para in paragraphs:
        para_len = len(para) + 2  # the separator we rejoin with
        # Start a new page when this paragraph would overflow the current one,
        # unless the page is still empty (an oversized paragraph must go
        # somewhere, and splitting it would break mid-sentence).
        if current and length + para_len > page_chars:
            pages.append("\n\n".join(current).strip())
            current, length = [], 0
        current.append(para)
        length += para_len

    if current:
        tail = "\n\n".join(current).strip()
        if tail:
            pages.append(tail)
    return pages


def extract_text_pages(filepath: str) -> list[dict]:
    """Return ``[{page, content}, …]`` for a text-family document.

    Mirrors the shape ``extract_text_from_pdf`` returns so ``index_book_text``
    can insert either into the FTS index without caring which produced it.
    """
    text = read_text_document(filepath)
    if not text:
        return []
    return [{"page": i, "content": content} for i, content in enumerate(paginate(text), start=1)]


def text_page_count(filepath: str) -> int:
    """Number of synthetic pages in a text-family document (0 if unreadable)."""
    text = read_text_document(filepath)
    if not text:
        return 0
    return len(paginate(text))
