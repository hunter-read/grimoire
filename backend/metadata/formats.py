"""Serializers, one per sidecar format.

Each ``render_*`` takes the neutral field dict built by :mod:`.fields` and
returns the file's text. Rendering is pure — no filesystem, no database — so a
format's mapping can be tested by reading its output rather than by inspecting
a directory.

Every rendered file carries :data:`GENERATOR`, which is what makes the
"never clobber a file we did not write" rule enforceable: see
:func:`is_grimoire_generated`.
"""
import json
import os
import re
from typing import Any, Optional
from xml.etree import ElementTree

from ..indexer.constants import _OPF_NS

FORMAT_OPF = "opf"
FORMAT_NFO = "nfo"
FORMAT_JSON = "json"

ALL_FORMATS = (FORMAT_OPF, FORMAT_NFO, FORMAT_JSON)

# Stamped into every file we write and checked before overwriting one. The
# version is the marker's own, not the app's: it identifies the sidecar layout,
# and bumping the app must not invalidate ownership of files already on disk.
GENERATOR = "Grimoire"
_GENERATOR_MARKER = f"{GENERATOR} metadata sidecar v1"

# Suffixes are per-format because the conventions are not ours to choose:
# Calibre expects ``<stem>.opf``, Jellyfin/Kodi expect ``<stem>.nfo``. The JSON
# name is namespaced so it cannot collide with an unrelated ``<stem>.json``.
_SUFFIXES = {
    FORMAT_OPF: ".opf",
    FORMAT_NFO: ".nfo",
    FORMAT_JSON: ".grimoire.json",
}


def sidecar_path(content_path: str, fmt: str) -> str:
    """The sidecar path for a content file in ``fmt``.

    Sits next to the content, named from its stem: ``Player's Handbook.pdf``
    yields ``Player's Handbook.opf``. Splitting on ``os.path.splitext`` rather
    than ``Path.stem`` keeps the original directory string untouched, which
    matters on the Windows paths the scanner also stores.
    """
    if fmt not in _SUFFIXES:
        raise ValueError(f"unknown sidecar format: {fmt!r}")
    stem, _ = os.path.splitext(content_path)
    return stem + _SUFFIXES[fmt]


def is_grimoire_generated(text: str) -> bool:
    """Whether an existing sidecar's contents were written by Grimoire.

    Substring match rather than a parse: the file may be malformed, truncated
    by a failed write, or in a format we cannot read, and none of that should
    make us treat a file we clearly wrote as somebody else's. The inverse error
    — failing to recognise our own marker — costs only a skipped overwrite.
    """
    return _GENERATOR_MARKER in text


def _clean(value: Any) -> str:
    """A trimmed string, or "" for anything empty/None."""
    return str(value).strip() if value is not None else ""


def _date_string(fields: dict) -> str:
    """``year``/``month``/``day`` as the most precise ISO date they support.

    Grimoire stores publication dates at variable precision — a year may stand
    alone. Emitting ``2014-01-01`` for a bare year would invent a precision the
    data does not have, so a partial date stays partial.
    """
    year = fields.get("year")
    if not year:
        return ""
    month, day = fields.get("month"), fields.get("day")
    if month and day:
        return f"{year:04d}-{month:02d}-{day:02d}"
    if month:
        return f"{year:04d}-{month:02d}"
    return f"{year:04d}"


# ---------------------------------------------------------------------------
# OPF
# ---------------------------------------------------------------------------


def render_opf(fields: dict) -> str:
    """Calibre-compatible OPF.

    Deliberately the inverse of ``indexer.metadata.parse_opf_metadata``: every
    element written here is one that parser reads back, so an export followed by
    a rescan round-trips rather than drifting. Fields with no OPF slot
    (``artists``, ``genres``, ``version``, …) are dropped — that loss is why the
    JSON format exists.
    """
    # Both namespaces keep an explicit prefix. Mapping OPF to the default
    # namespace instead would serialise ``opf:role`` as a bare ``role``, which
    # Calibre does not read as the creator's role.
    for prefix, uri in _OPF_NS.items():
        ElementTree.register_namespace(prefix, uri)

    opf, dc = _OPF_NS["opf"], _OPF_NS["dc"]
    root = ElementTree.Element(f"{{{opf}}}package", {"version": "2.0"})
    meta = ElementTree.SubElement(root, f"{{{opf}}}metadata")

    def _add(tag: str, text: str, attrib: Optional[dict] = None) -> None:
        if not text:
            return
        el = ElementTree.SubElement(meta, f"{{{dc}}}{tag}", attrib or {})
        el.text = text

    _add("title", _clean(fields.get("title")))
    for author in fields.get("authors") or []:
        # opf:role marks these as authors specifically; Calibre writes the same,
        # and without it a reader cannot tell an author from any other creator.
        _add("creator", _clean(author), {f"{{{opf}}}role": "aut"})
    _add("description", _clean(fields.get("description")))
    _add("publisher", _clean(fields.get("publisher")))
    _add("date", _date_string(fields))
    _add("language", _clean(fields.get("language")))
    _add("identifier", _clean(fields.get("isbn")), {f"{{{opf}}}scheme": "ISBN"})
    for tag in fields.get("tags") or []:
        _add("subject", _clean(tag))

    ElementTree.SubElement(
        meta, f"{{{opf}}}meta", {"name": "generator", "content": _GENERATOR_MARKER}
    )

    cover = _clean(fields.get("cover_filename"))
    if cover:
        guide = ElementTree.SubElement(root, f"{{{opf}}}guide")
        ElementTree.SubElement(
            guide,
            f"{{{opf}}}reference",
            {"type": "cover", "title": "Cover", "href": cover},
        )

    ElementTree.indent(root, space="  ")
    body = ElementTree.tostring(root, encoding="unicode")
    return f'<?xml version="1.0" encoding="utf-8"?>\n{body}\n'


# ---------------------------------------------------------------------------
# NFO
# ---------------------------------------------------------------------------

# XML 1.0 forbids most control characters outright — no escape exists for them.
# Descriptions scraped from the wild do contain them, and leaving one in
# produces a file every consumer rejects, so they are stripped rather than
# encoded. Tab/newline/carriage return are legal and kept.
_XML_ILLEGAL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def render_nfo(fields: dict) -> str:
    """Jellyfin/Kodi-style NFO.

    Kodi has no book type, so this uses the generic ``<book>`` root that
    Jellyfin's reader accepts. ``<plot>`` rather than ``<description>`` is
    deliberate: it is the element those scrapers actually read.
    """
    root = ElementTree.Element("book")

    def _add(tag: str, text: str) -> None:
        if not text:
            return
        ElementTree.SubElement(root, tag).text = _XML_ILLEGAL.sub("", text)

    _add("title", _clean(fields.get("title")))
    _add("plot", _clean(fields.get("description")))
    _add("publisher", _clean(fields.get("publisher")))
    year = fields.get("year")
    _add("year", str(year) if year else "")
    _add("premiered", _date_string(fields))
    _add("isbn", _clean(fields.get("isbn")))
    _add("language", _clean(fields.get("language")))
    for author in fields.get("authors") or []:
        _add("author", _clean(author))
    for artist in fields.get("artists") or []:
        _add("artist", _clean(artist))
    for genre in fields.get("genres") or []:
        _add("genre", _clean(genre))
    for tag in fields.get("tags") or []:
        _add("tag", _clean(tag))
    cover = _clean(fields.get("cover_filename"))
    if cover:
        _add("thumb", cover)

    ElementTree.SubElement(root, "generator").text = _GENERATOR_MARKER

    ElementTree.indent(root, space="  ")
    body = ElementTree.tostring(root, encoding="unicode")
    return f'<?xml version="1.0" encoding="utf-8"?>\n{body}\n'


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------


def render_json(fields: dict) -> str:
    """Grimoire-native JSON — the lossless format.

    Every field is emitted, including empties, so the file documents the whole
    shape rather than only what happens to be filled in. Keys are sorted so a
    re-export with unchanged metadata produces a byte-identical file, which
    keeps sidecars out of a user's git diffs and backup deltas.
    """
    payload = {
        "generator": _GENERATOR_MARKER,
        "schema": 1,
        **{k: v for k, v in fields.items() if k != "cover_filename"},
    }
    cover = _clean(fields.get("cover_filename"))
    if cover:
        payload["cover_filename"] = cover
    return json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


_RENDERERS = {
    FORMAT_OPF: render_opf,
    FORMAT_NFO: render_nfo,
    FORMAT_JSON: render_json,
}


def render(fields: dict, fmt: str) -> str:
    """Render ``fields`` in ``fmt``."""
    try:
        return _RENDERERS[fmt](fields)
    except KeyError:
        raise ValueError(f"unknown sidecar format: {fmt!r}") from None
