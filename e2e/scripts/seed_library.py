#!/usr/bin/env python3
"""Seed a Grimoire library with sample content, then index it.

The content-dependent tests (systems, books, the reader) skip when the target
instance has an empty library. Run this once against a local dev instance to
give them something real to exercise.

    python3 scripts/seed_library.py --library-path /path/to/library

The layout matters: Grimoire's scanner expects
``<collection>/<GameSystem>/<Category>/<Book>.pdf``, where the top-level
collection is one of `books`, `maps`, `tokens`, or `audio`. A PDF dropped at
``<GameSystem>/<Category>/`` with no collection dir is silently not indexed.
"""
from __future__ import annotations

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from grimoire_e2e import admin_client  # noqa: E402
from grimoire_e2e.config import Settings  # noqa: E402

SYSTEM = "Test System"
CATEGORY = "Rulebooks"
BOOK = "Sample Rulebook"


def write_sample_pdf(target: pathlib.Path, pages: int = 3) -> None:
    try:
        import fitz  # PyMuPDF — already a backend dependency
    except ImportError:
        sys.exit("PyMuPDF is required to generate the sample PDF: pip install pymupdf")

    target.parent.mkdir(parents=True, exist_ok=True)
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page()
        page.insert_text((72, 100), f"{BOOK} — page {i + 1}", fontsize=20)
    doc.save(str(target))
    doc.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--library-path",
        required=True,
        help="LIBRARY_PATH the target Grimoire instance is serving",
    )
    parser.add_argument("--pages", type=int, default=3)
    parser.add_argument(
        "--no-scan", action="store_true", help="Write files but skip triggering a rescan"
    )
    args = parser.parse_args()

    pdf = pathlib.Path(args.library_path) / "books" / SYSTEM / CATEGORY / f"{BOOK}.pdf"
    write_sample_pdf(pdf, args.pages)
    print(f"wrote {pdf}")

    if args.no_scan:
        return

    settings = Settings()
    api = admin_client(settings)

    # The server kicks off its own library scan in a background thread at
    # startup. Triggering a second scan while that one is still going has both
    # of them contending for SQLite's single writer, which stalls ordinary API
    # requests for long enough that the UI fails to mount. Let the startup scan
    # finish first.
    print("waiting for any startup scan to finish...")
    api.wait_for_scan(timeout=300)

    api.rescan()
    print("scan started; waiting...")
    api.wait_for_scan(timeout=300)
    print(f"systems: {[s.get('name') for s in api.list_systems()]}")
    print(f"books:   {[b.get('title') for b in api.list_books(limit=10)]}")


if __name__ == "__main__":
    main()
