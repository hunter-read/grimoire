"""Writing Grimoire's curated metadata back out as sidecar files (issue #300).

The mirror image of the sidecar *import* the scanner already does: ``.opf``
files (issue #95) and ``tags.json`` flow in, and this package flows the same
data back out so the library folder describes itself. Copy the library to
another machine, or rebuild the container with a fresh ``DATA_PATH``, and the
metadata travels with the files instead of dying with the database.

Three formats, independently selectable, because the tools downstream disagree:

    OPF   ``<book>.opf``            Calibre — and Grimoire reads it, so it round-trips
    NFO   ``<book>.nfo``            Jellyfin / Kodi / Emby
    JSON  ``<book>.grimoire.json``  Grimoire-native; the only lossless one

OPF and NFO are best-effort mappings: neither has a slot for most of what
Grimoire tracks, so fields without a home are simply dropped. The JSON format
exists so nothing is lost.

Two rules shape the whole package, both from the issue's "never destructive"
requirement:

**Grimoire only overwrites files it wrote.** Every sidecar carries a generator
marker, and a file without one is left alone unless the caller passes
``overwrite=True``. A hand-written ``.opf`` a user maintains in Calibre is not
Grimoire's to clobber.

**Writes never break the thing that triggered them.** The library may be a
read-only bind mount — that is a supported way to run Grimoire, and the default
in ``docker-compose.dev.yml``. Failures are reported per item and logged, never
raised into a metadata save that has already been committed.

See ``docs/sidecars.md`` for the field mapping per format and how export
precedence pairs with the importer's ``missing``/``replace`` modes.
"""
from .export import (
    ExportResult,
    export_book,
    export_library,
    refresh_existing,
)
from .formats import (
    ALL_FORMATS,
    FORMAT_JSON,
    FORMAT_NFO,
    FORMAT_OPF,
    GENERATOR,
    sidecar_path,
)

__all__ = [
    "ALL_FORMATS",
    "FORMAT_JSON",
    "FORMAT_NFO",
    "FORMAT_OPF",
    "GENERATOR",
    "ExportResult",
    "export_book",
    "export_library",
    "refresh_existing",
    "sidecar_path",
]
