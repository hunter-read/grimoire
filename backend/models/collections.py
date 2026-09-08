"""The media collections, described once.

A *collection* is one of the indexed libraries — books, maps, tokens, audio,
models. Before this module each feature that had to work "for every collection"
carried its own hand-written table of them: a dict of models in the bulk
service, another in the duplicates job, another for dismissals, a third spelling
in the tag service, plus a scattering of ``("book", "map", "token", "audio")``
tuples and four-armed ``if/elif`` chains. Adding a fifth collection meant
finding all of them, and three failed *silently* when missed — an unlisted type
dropped its tags, orphaned its favourites on delete, or refused a scoped rescan.

So the collections are named here, once, and the tables that used to be written
out by hand are derived from this one. Adding a collection is a row in
``COLLECTIONS`` plus the things a row cannot express (a router package, a
frontend view); it is no longer a hunt.

Singular vs plural
------------------
Both spellings are load-bearing and neither is derivable from the other in
general (``audio`` is its own plural). The *singular* is the discriminator
stored in rows — ``resource_tags.resource_type``, ``favorites.item_type``,
``campaign_resources.resource_type``, ``VARIANT_KINDS_BY_TYPE``. The *section*
is the plural: the top-level library folder, the scan-scope prefix, and the key
in stats payloads. ``singular_for`` / ``section_for`` translate between them, in
place of the six independent re-derivations that existed before — including one
that spelled it ``section[:-1]``.

This module deliberately imports only models. It sits below services and routers
so anything may import it without a cycle.
"""
from typing import Any, Dict, Iterator, NamedTuple, Optional, Tuple

from .library import Book, BookFolder
from .media import Audio, AudioFolder, GenericMap, MapFolder, Model3D, Model3DFolder, Token, TokenFolder


class CollectionSpec(NamedTuple):
    """Everything about one collection that other modules used to hardcode."""

    singular: str
    section: str
    model: Any
    folder_model: Any
    # Where rendered thumbnails live under DATA_PATH/thumbnails/, or None for a
    # collection that has none. Audio is the None case: its card art comes from
    # embedded or folder artwork resolved at request time, not a file we wrote.
    thumb_section: Optional[str]
    # Fields "copy metadata across" may touch when merging a duplicate. Excludes
    # everything identifying the file (id, filepath, filename, relative_path,
    # content_hash, file_mtime, file_size) and the variant columns: copying
    # those would corrupt the row's link to its file or bypass the guards in
    # services/variants.py.
    mergeable_fields: frozenset
    # Fields shown side by side in the duplicate compare view.
    compare_fields: Tuple[str, ...]


# Ordered as the UI presents them. Keyed by singular, because that is the
# discriminator that appears in stored rows and request payloads.
COLLECTIONS: Dict[str, CollectionSpec] = {
    "book": CollectionSpec(
        singular="book",
        section="books",
        model=Book,
        folder_model=BookFolder,
        thumb_section="books",
        mergeable_fields=frozenset(
            {
                "title",
                "description",
                "authors",
                "artists",
                "publisher",
                "publisher_url",
                "urls",
                "genres",
                "isbn",
                "version",
                "language",
                "license",
                "year",
                "month",
                "day",
                "category",
                "is_explicit",
                "tags",
            }
        ),
        compare_fields=(
            "title",
            "category",
            "page_count",
            "file_size",
            "mime_type",
            "publisher",
            "version",
            "language",
            "year",
            "isbn",
            "content_hash",
        ),
    ),
    "map": CollectionSpec(
        singular="map",
        section="maps",
        model=GenericMap,
        folder_model=MapFolder,
        thumb_section="maps",
        mergeable_fields=frozenset({"description", "map_type", "grid_size", "tags"}),
        compare_fields=("map_type", "grid_size", "file_size", "description"),
    ),
    "token": CollectionSpec(
        singular="token",
        section="tokens",
        model=Token,
        folder_model=TokenFolder,
        thumb_section="tokens",
        mergeable_fields=frozenset({"description", "is_explicit", "tags"}),
        compare_fields=("file_size", "description", "is_explicit"),
    ),
    "audio": CollectionSpec(
        singular="audio",
        section="audio",
        model=Audio,
        folder_model=AudioFolder,
        thumb_section=None,
        mergeable_fields=frozenset(
            {"description", "title", "artist", "album", "tags"}
        ),
        compare_fields=("title", "artist", "album", "duration", "file_size"),
    ),
    "model": CollectionSpec(
        singular="model",
        section="models",
        model=Model3D,
        folder_model=Model3DFolder,
        thumb_section="models",
        mergeable_fields=frozenset(
            {"description", "is_explicit", "is_supported", "tags"}
        ),
        compare_fields=(
            "file_size",
            "triangle_count",
            "is_supported",
            "description",
        ),
    ),
}

# The media collections: everything except books. Maps, tokens, audio and models
# are flat walks with no container or category structure above the file, and
# several call sites care about exactly that distinction.
MEDIA_SINGULARS = tuple(k for k in COLLECTIONS if k != "book")

SINGULARS = tuple(COLLECTIONS)
SECTIONS = tuple(spec.section for spec in COLLECTIONS.values())

_BY_SECTION: Dict[str, CollectionSpec] = {
    spec.section: spec for spec in COLLECTIONS.values()
}
_BY_MODEL: Dict[Any, CollectionSpec] = {
    spec.model: spec for spec in COLLECTIONS.values()
}


def spec_for(singular: str) -> Optional[CollectionSpec]:
    """The spec for a resource type ("map"), or None if it names no collection."""
    return COLLECTIONS.get(singular)


def spec_for_section(section: str) -> Optional[CollectionSpec]:
    """The spec for a library section ("maps"), or None."""
    return _BY_SECTION.get(section)


def spec_for_model(model: Any) -> Optional[CollectionSpec]:
    """The spec owning an ORM model, or None for a model that is not a collection."""
    return _BY_MODEL.get(model)


def section_for(singular: str) -> Optional[str]:
    """Plural section for a resource type: "map" -> "maps"."""
    spec = COLLECTIONS.get(singular)
    return spec.section if spec else None


def singular_for(section: str) -> Optional[str]:
    """Resource type for a section: "maps" -> "map"."""
    spec = _BY_SECTION.get(section)
    return spec.singular if spec else None


def models_by_singular() -> Dict[str, Any]:
    """``{"book": Book, ...}`` — the shape the per-feature tables used to hold."""
    return {k: spec.model for k, spec in COLLECTIONS.items()}


def models_by_section() -> Dict[str, Any]:
    """``{"books": Book, ...}`` — keyed by library folder instead."""
    return {spec.section: spec.model for spec in COLLECTIONS.values()}


def thumb_sections() -> Dict[str, str]:
    """``{section: thumb_dir}`` for collections that write thumbnails to disk.

    Derived rather than hand-listed: a collection that renders a thumbnail but
    is missing from this mapping strands the file on delete and shows a broken
    image after a move, with nothing to catch it.
    """
    return {
        spec.section: spec.thumb_section
        for spec in COLLECTIONS.values()
        if spec.thumb_section
    }


def iter_specs() -> Iterator[CollectionSpec]:
    """Every collection, in presentation order."""
    return iter(COLLECTIONS.values())
