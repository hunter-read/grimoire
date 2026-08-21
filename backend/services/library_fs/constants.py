"""Module-wide constants and the error type the routers map to status codes.

Split out so every other module in the package can import these without
creating a cycle back through the package ``__init__``.
"""
from typing import Any

from ...models.library import Book
from ...models.media import Audio, GenericMap, Token


# The four indexed collections, and the model that owns each one. Keyed by the
# top-level library folder so a caller can go from a path straight to its model.
COLLECTIONS: dict[str, Any] = {
    "books": Book,
    "maps": GenericMap,
    "tokens": Token,
    "audio": Audio,
}

# Thumbnails live under DATA_PATH/thumbnails/<section>/ for these collections
# only; tokens and audio have no rendered thumbnail on disk.
_THUMB_SECTIONS = {"books": "books", "maps": "maps"}

# Upload chunk size. Large enough that syscall overhead is irrelevant on a
# multi-hundred-MB book, small enough that memory stays flat per request.
_UPLOAD_CHUNK = 1 << 20

# Thumbnails live under DATA_PATH/thumbnails/<section>/ for these collections
# only; tokens and audio have no rendered thumbnail on disk.
_THUMB_SECTIONS = {"books": "books", "maps": "maps"}

# Upload chunk size. Large enough that syscall overhead is irrelevant on a
# multi-hundred-MB book, small enough that memory stays flat per request.
_UPLOAD_CHUNK = 1 << 20

# The category folders `scaffold_categories` creates for a system, in the order
# they should appear. Plural, human-readable spellings deliberately — each one
# is verified to infer back to its canonical category slug (``Adventures`` →
# ``adventure``), so a user gets folders that both read well in a file browser
# and classify correctly on the next scan.
SCAFFOLD_CATEGORY_FOLDERS = (
    "Core",
    "Supplements",
    "Adventures",
    "Character Sheets",
    "Maps",
    "Handouts",
    "Homebrew",
    "Starter Sets",
)


# Thumbnails live under DATA_PATH/thumbnails/<section>/ for these collections
# only; tokens and audio have no rendered thumbnail on disk.
_THUMB_SECTIONS = {"books": "books", "maps": "maps"}

# Upload chunk size. Large enough that syscall overhead is irrelevant on a
# multi-hundred-MB book, small enough that memory stays flat per request.
_UPLOAD_CHUNK = 1 << 20

# The category folders `scaffold_categories` creates for a system, in the order
# they should appear. Plural, human-readable spellings deliberately — each one
# is verified to infer back to its canonical category slug (``Adventures`` →
# ``adventure``), so a user gets folders that both read well in a file browser
# and classify correctly on the next scan.
SCAFFOLD_CATEGORY_FOLDERS = (
    "Core",
    "Supplements",
    "Adventures",
    "Character Sheets",
    "Maps",
    "Handouts",
    "Homebrew",
    "Starter Sets",
)


class LibraryFSError(Exception):
    """A structural operation failed for a reason the user should see.

    Carries an HTTP-ish ``code`` so the router can map failures to status codes
    without re-deriving them from message text.
    """

    def __init__(self, message: str, code: str = "invalid") -> None:
        super().__init__(message)
        self.message = message
        self.code = code

