"""Username folding as migration 0060 backfills it.

A copy of ``backend.sql_functions.fold_text`` on the day 0060 was written: NFKC,
then full Unicode case folding.
"""
import unicodedata
from typing import Optional


def fold_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    return unicodedata.normalize("NFKC", value).casefold()
