"""Tell a scan from artwork before OCRing a book whose text layer is thin.

A PDF whose own text covers less than ``OCR_MIN_TEXT_COVERAGE`` of its pages is
queued for OCR (issue #685): usually it is a scan with a few digitally-set
pages. But a digital book that is mostly full-page art - a map pack, an art
book, a handout bundle - looks exactly the same to that test, and OCRing it
spends hours of CPU filling search with noise read off the pictures.

So before such a book is OCR'd in full, a few of its image-only pages are read
as a sample. A scanned page yields a page of words; a map or an illustration
yields a handful at most. When the sample reads like artwork the book keeps its
own text layer and is not OCR'd. Re-OCR from the book's menu still reads it in
full: that request skips the sample (it clears ``text_pages``).
"""
from __future__ import annotations

import logging
import re
from typing import Callable, Literal, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend import indexer  # package namespace, for patch-sensitive calls
from .. import pdf_worker
from ..models import Book
from ._subprocess import OCR_PAGE_ABANDONED, PdfExtractionCrashError, _commit

logger = logging.getLogger("grimoire.indexer")

# How many image-only pages are read, spread through the book.
SAMPLE_PAGES = 3
# Fewer words than this per sampled page, on average, reads as artwork. A
# scanned page of a rulebook yields hundreds; a battlemap's labels, a dozen.
MIN_WORDS_PER_PAGE = 25
# A word, for counting: three or more letters, so OCR's stray marks and digits
# from the texture of an illustration don't count.
_WORD = re.compile(r"[^\W\d_]{3,}")

Verdict = Literal["scan", "artwork", "stopped"]


def should_sample(book: Book) -> bool:
    """Whether ``book`` should be sampled before a full OCR pass.

    Only a fresh pass over a book the indexer queued: a resumed pass already
    decided, and a manual Re-OCR (``text_pages`` cleared) asked for the whole
    book outright.

    It deliberately does not ask how much text the book has. ``text_pages``
    counts pages carrying a text layer, and a book whose every page holds only
    a running header counts 0 of them — the same as a book with no text at all,
    though one may well be artwork and the other cannot be. ``probe`` reads the
    book to tell those apart, since it extracts the text anyway.
    """
    return book.text_pages is not None and not (book.ocr_pages_done or 0)


def sample_pages(image_only: list[int], count: int = SAMPLE_PAGES) -> list[int]:
    """Up to ``count`` of ``image_only`` (page indexes), spread evenly through them."""
    if len(image_only) <= count:
        return list(image_only)
    step = len(image_only) / count
    return [image_only[int(step * i + step / 2)] for i in range(count)]


def count_words(content: str) -> int:
    return len(_WORD.findall(content))


def probe(
    book: Book,
    session: Session,
    page_count: int,
    should_stop: Optional[Callable[[], bool]] = None,
    languages: Optional[str] = None,
) -> Verdict:
    """Sample ``book`` and, if it reads as artwork, index its own text layer instead.

    ``languages`` is what the sampled pages are read with, the same as the full
    pass would use; None means ``OCR_LANGUAGES``.

    Returns ``"scan"`` to go on with the full OCR pass, ``"artwork"`` when the
    book has been indexed from its own text (and taken off the queue), or
    ``"stopped"`` when a stop arrived mid-sample. Anything that stops the sample
    from being taken - an extraction crash, every sampled page abandoned - errs
    towards OCR, which is what the book was queued for.
    """
    try:
        pages, _ = indexer.extract_text_isolated(
            book.filepath, should_stop=should_stop, text_only=True
        )
    except TimeoutError:
        return "stopped"
    except PdfExtractionCrashError as e:
        logger.warning(f"OCR: couldn't sample '{book.filename}' ({e}) - reading all of it")
        return "scan"

    if not pages:
        # Not a page of text in it, not even a header. That is a scan, judged
        # on its own as it always was - there is nothing here to sample that
        # would say otherwise.
        return "scan"

    # The pages OCR would actually read: those without a text layer of their
    # own. A page holding only a running header is one of them, so sampling it
    # is what tells a scan stamped with its chapter title from real artwork.
    with_text = {p["page"] for p in pages if not pdf_worker.text_is_thin(p["content"])}
    image_only = [i for i in range(page_count) if i + 1 not in with_text]
    words: list[int] = []
    for index in sample_pages(image_only):
        if should_stop and should_stop():
            return "stopped"
        content = indexer.ocr_book_page_isolated_wrapper(
            book.filepath, index, should_stop, dpi=book.ocr_dpi, languages=languages
        )
        if should_stop and should_stop():
            return "stopped"
        if content is not OCR_PAGE_ABANDONED:
            words.append(count_words(content or ""))
    if not words or sum(words) / len(words) >= MIN_WORDS_PER_PAGE:
        return "scan"

    for page in pages:
        session.execute(
            text(
                "INSERT INTO book_search (book_id, page_number, content) "
                "VALUES (:bid, :pnum, :content)"
            ),
            {"bid": book.id, "pnum": page["page"], "content": page["content"]},
        )
    # Every page's own text is kept, but only the substantive ones count - the
    # same measure the indexer records, so Re-OCR is still offered for a book
    # whose pages carry nothing but a header.
    book.text_pages = len(with_text)
    book.ocr_pending = False
    book.ocr_pages_done = 0
    book.indexed = True
    book.index_failed = False
    book.index_error = ""
    _commit(session, f"ocr sample says artwork '{book.filepath}'")
    logger.info(
        f"'{book.title or book.filename}' looks like artwork rather than a scan "
        f"(about {sum(words) // len(words)} word(s) on each sampled page), so it keeps "
        f"its own text and isn't read with OCR. Use Re-OCR on the book to read it anyway."
    )
    return "artwork"
