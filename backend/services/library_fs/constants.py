"""Module-wide constants and the error type the routers map to status codes.

Split out so every other module in the package can import these without
creating a cycle back through the package ``__init__``.
"""
from typing import Any

from ...models.collections import (
    folder_models_by_section,
    models_by_section,
    thumb_sections,
)


# The indexed collections, and the model that owns each one. Keyed by the
# top-level library folder so a caller can go from a path straight to its model.
COLLECTIONS: dict[str, Any] = models_by_section()

# The folder-tag table for each collection, keyed the same way. Folder rows are
# addressed by path rather than id, so a move or rename has to rewrite them
# explicitly — see ``_relink_folders`` (issue #445).
FOLDER_MODELS: dict[str, Any] = folder_models_by_section()

# Where each collection's rendered thumbnails live under DATA_PATH/thumbnails/.
# Derived from the registry rather than listed here: a collection that renders a
# thumbnail but is missing from this map strands the file on delete and shows a
# broken image after a move, with nothing to catch it.
_THUMB_SECTIONS = thumb_sections()

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

