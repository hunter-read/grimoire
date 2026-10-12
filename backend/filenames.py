"""Library filenames that are not valid UTF-8 (issue #547).

Python reads a filename it cannot decode as UTF-8 with ``surrogateescape``: each
offending byte becomes a lone surrogate (byte ``0xD6`` turns into ``'\\udcd6'``).
That string still works for filesystem calls, but SQLite, JSON, and the log
stream all refuse to encode it, so one such name used to abort a whole library
scan and turn the file manager into a bare "Internal Server Error".

The usual source is a folder named on Windows with a legacy code page and copied
onto a share that stores names as raw bytes: Windows-1252 writes the ``Ö`` in
"MÖRK BORG" as the single byte ``0xD6``, which on its own is not UTF-8.

Guessing the intended character is unreliable (the same byte is ``Ö`` in
Windows-1252 and ``Ц`` in Windows-1251), so Grimoire never renames anything.
Scans skip these entries with a warning, and the file manager shows them with a
placeholder in place of each bad byte and no actions. The fix is renaming the
entry on the share itself.
"""

import logging
import re

logger = logging.getLogger("grimoire.indexer")

# Shown in place of each byte that is not valid UTF-8. U+FFFD is the standard
# "replacement character", which browsers render as a ? in a diamond.
PLACEHOLDER = "�"

# The surrogates ``surrogateescape`` produces: U+DC80..U+DCFF, one per raw byte
# 0x80..0xFF. A valid UTF-8 name never decodes to any of them.
_ESCAPED_BYTE = re.compile("[\udc80-\udcff]")


def is_undecodable(name: str) -> bool:
    """Whether ``name`` holds bytes that are not valid UTF-8."""
    return _ESCAPED_BYTE.search(name) is not None


def display_name(name: str) -> str:
    """``name`` with each undecodable byte replaced by :data:`PLACEHOLDER`.

    Safe to put in a log line, a JSON response, or a database column. Returns
    ``name`` unchanged when it is already valid.
    """
    return _ESCAPED_BYTE.sub(PLACEHOLDER, name)


def likely_name(name: str) -> str:
    """A best guess at what ``name`` was meant to say, reading bad bytes as Windows-1252.

    Only for log messages, to help someone find the entry to rename. Each bad
    byte is decoded on its own, so the parts of the name that are valid UTF-8
    stay as they are rather than turning into mojibake.
    """
    return _ESCAPED_BYTE.sub(
        lambda m: bytes([ord(m.group()) - 0xDC00]).decode("cp1252", "replace"), name
    )


def warn_skipped(path: str) -> None:
    """Log that the scan is skipping ``path`` because its name is not UTF-8."""
    logger.warning(
        "Skipping '%s': its name is not valid UTF-8 (read as Windows-1252 it would "
        "be '%s'). Rename it on the share to include it in the library.",
        display_name(path),
        likely_name(path),
    )
