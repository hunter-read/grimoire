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
from ...models.game_types import ARMORY_SECTION
from ...models.library import Book, BookFolder

# The collections whose files are ``Book`` rows filed as
# ``<collection>/<System>/<Category>/...``: role-playing books, and the
# armory's wargame books beside them (``models/game_types.py``). The armory is
# not a collection of its own in ``models.collections`` - its rows are books,
# reported, tagged and thumbnailed as books - but on disk it is a second root
# with the same shape, and every books/ rule here applies to it.
BOOK_SECTIONS: tuple[str, ...] = ("books", ARMORY_SECTION)

# The indexed collections, and the model that owns each one. Keyed by the
# top-level library folder so a caller can go from a path straight to its model.
# The armory comes last, so a lookup from ``Book`` back to its section still
# answers ``books`` - the thumbnail folder and resource type books share.
COLLECTIONS: dict[str, Any] = {**models_by_section(), ARMORY_SECTION: Book}

# The folder-tag table for each collection, keyed the same way. Folder rows are
# addressed by path rather than id, so a move or rename has to rewrite them
# explicitly — see ``_relink_folders`` (issue #445).
FOLDER_MODELS: dict[str, Any] = {**folder_models_by_section(), ARMORY_SECTION: BookFolder}

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
    "Magazines",
)

# The same for a wargame system in the armory, read with the wargame vocabulary
# (``indexer/factions.py``): each name infers back to its wargame category
# (``Factions`` → ``army-book``, ``Rules Updates`` → ``errata``), and
# ``Factions`` is the folder the documented layout files armies under.
WARGAME_SCAFFOLD_CATEGORY_FOLDERS = (
    "Core",
    "Factions",
    "Rules Updates",
    "Missions",
    "Campaigns",
    "Supplements",
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

