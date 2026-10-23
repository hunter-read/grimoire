"""Reading the metadata a PDF, EPUB or comic archive carries inside itself.

The built-in "File metadata" source in the metadata dialog: no add-on, no
network, just what the publisher (or their export tool) wrote into the file.

    PDF    the document info dictionary - title, author, subject, keywords,
           creation date - plus the catalog's ``/Lang``, and an ISBN from a
           custom info key, the XMP packet, or an "ISBN …" in the subject or
           keywords
    EPUB   the OPF package the container points at, read by the same rules as
           a Calibre ``.opf`` sidecar, plus its language and full date
    Comic  ``ComicInfo.xml`` (the ComicRack schema) in a CBZ/CBR/CB7/CBT

PDF info dictionaries are written by whatever tool exported the file, and many
of them fill the slots with noise: "Microsoft Word - draft3.docx" as the title,
"Administrator" as the author. Those are dropped here rather than offered, so a
fetch only ever proposes something a person might actually have typed. Like
every source, it only proposes: the dialog diffs it and nothing is written
until the user applies a selection.
"""
import os
import posixpath
import re
import zipfile
from datetime import date
from typing import Any, Optional
from urllib.parse import urlparse

import defusedxml.ElementTree as SafeElementTree

from ..indexer import comics
from ..indexer.constants import _COMIC_ARCHIVE_EXTS, _OPF_NS
from ..indexer.metadata import _valid_isbn, opf_fields
from ..render import pool as render_pool

# Formats this module can read, by extension.
PDF = "pdf"
EPUB = "epub"
COMIC = "comic"
_FORMATS = {".pdf": PDF, ".epub": EPUB, **{ext: COMIC for ext in _COMIC_ARCHIVE_EXTS}}

# The container and OPF are a few kilobytes; anything far larger is not one.
_MAX_XML_BYTES = 2 * 1024 * 1024
_CONTAINER = "META-INF/container.xml"
_CONTAINER_NS = {"c": "urn:oasis:names:tc:opendocument:xmlns:container"}

# A title that ends in a document extension is the exporter's file name.
_FILENAME_TITLE = re.compile(
    r"\.(docx?|odt|rtf|txt|pages|indd|idml|qxp|qxd|pptx?|key|psd|ai|pdf)$", re.I
)
_PLACEHOLDER_TITLES = frozenset({"untitled", "untitled document", "document", "title"})
_PLACEHOLDER_AUTHORS = frozenset(
    {"unknown", "administrator", "admin", "user", "owner", "author", "default"}
)
_AUTHOR_SPLIT = re.compile(r"\s*(?:;|,|&|\band\b)\s*")
_KEYWORD_SPLIT = re.compile(r"\s*[,;]\s*")
_MAX_TAGS = 25
_MAX_TAG_LENGTH = 50
# "D:20190501..." in a PDF, "2019-05-01" / "2019-05" / "2019" in an OPF.
_DATE = re.compile(r"^(?:D:)?(\d{4})(?:-?(\d{2})(?:-?(\d{2}))?)?")

# XMP properties that hold nothing but an ISBN, by local name (any namespace:
# PRISM's ``isbn``/``eIsbn``, and the custom ``ISBN`` some exporters add).
_XMP_ISBN_NAMES = frozenset({"isbn", "eisbn", "printisbn"})
# XMP properties that hold identifiers of any kind - an ISBN only when it says so.
_XMP_IDENTIFIER_NAMES = frozenset({"identifier"})
# "ISBN 978-0-306-40615-7" / "ISBN-10: 0306406152" written into free text.
_LABELLED_ISBN = re.compile(r"\bISBN(?:-1[03])?\s*:?\s*([0-9][0-9 -]{8,16}[0-9Xx])", re.I)
_ISBN_PREFIX = re.compile(r"^(?:urn:isbn:|isbn(?:-1[03])?\s*:?\s*)", re.I)

# ComicInfo.xml people columns that are art, not writing.
_COMIC_ARTIST_TAGS = ("Penciller", "Inker", "Colorist", "Letterer", "CoverArtist")


def file_format(filepath: str) -> Optional[str]:
    """``PDF``, ``EPUB``, ``COMIC``, or None for a format with nothing to read."""
    return _FORMATS.get(os.path.splitext(filepath)[1].lower())


def read(filepath: str) -> dict[str, Any]:
    """The book fields embedded in ``filepath``; empty when it carries none.

    Raises ``ValueError`` for a format this module cannot read, and lets an
    ``OSError`` (missing file) or a render error (broken PDF) through for the
    caller to report.
    """
    kind = file_format(filepath)
    if kind == PDF:
        return pdf_fields(render_pool.document_metadata(filepath))
    if kind == EPUB:
        return epub_fields(filepath)
    if kind == COMIC:
        if not os.path.isfile(filepath):
            # The archive readers swallow every error, so say "missing" here.
            raise FileNotFoundError(f"no such file: '{filepath}'")
        data = comics.read_comic_info(filepath, os.path.splitext(filepath)[1].lower())
        return comic_fields(data) if data else {}
    raise ValueError(
        "only PDF, EPUB and comic archive files carry metadata Grimoire can read"
    )


def pdf_fields(info: dict[str, str]) -> dict[str, Any]:
    """Map a PDF info dictionary (``ops.document_metadata``) onto book fields."""
    fields: dict[str, Any] = {}

    title = _clean(info.get("title"))
    if title.casefold() not in _PLACEHOLDER_TITLES and not _FILENAME_TITLE.search(title):
        if title:
            fields["title"] = title

    authors = _authors(info.get("author"))
    if authors:
        fields["authors"] = authors

    # The PDF "Subject" is the closest thing it has to a blurb.
    subject = _clean(info.get("subject"))
    if subject:
        fields["description"] = subject

    tags = _tags(_KEYWORD_SPLIT.split(info.get("keywords") or ""))
    if tags:
        fields["tags"] = tags

    language = _language(info.get("language"))
    if language:
        fields["language"] = language

    isbn = (
        _isbn(info.get("isbn"))
        or _xmp_isbn(info.get("xmp"))
        or _labelled_isbn(info.get("subject"), info.get("keywords"))
    )
    if isbn:
        fields["isbn"] = isbn

    fields.update(_date_fields(info.get("creationDate")))
    return fields


def comic_fields(xml: bytes) -> dict[str, Any]:
    """Map a ``ComicInfo.xml`` onto book fields; empty when it is unreadable."""
    try:
        root = SafeElementTree.fromstring(xml)
    except (SafeElementTree.ParseError, ValueError):
        return {}

    def text(tag: str) -> str:
        el = root.find(tag)
        return _clean(el.text) if el is not None and el.text else ""

    fields: dict[str, Any] = {}

    # Many taggers leave Title for the story and name the book by its series.
    title = text("Title")
    if not title and text("Series"):
        number = text("Number")
        title = f"{text('Series')} #{number}" if number else text("Series")
    if title:
        fields["title"] = title

    authors = _authors(text("Writer"))
    if authors:
        fields["authors"] = authors

    artists = _authors(", ".join(text(tag) for tag in _COMIC_ARTIST_TAGS))
    if artists:
        fields["artists"] = artists

    summary = text("Summary")
    if summary:
        fields["description"] = summary

    publisher = text("Publisher") or text("Imprint")
    if publisher:
        fields["publisher"] = publisher

    genres: dict[str, str] = {}
    for genre in _KEYWORD_SPLIT.split(text("Genre")):
        if genre:
            genres.setdefault(genre.casefold(), genre)
    if genres:
        fields["genres"] = list(genres.values())

    tags = _tags(_KEYWORD_SPLIT.split(text("Tags")))
    if tags:
        fields["tags"] = tags

    urls = _links(text("Web"))
    if urls:
        fields["urls"] = urls

    language = _language(text("LanguageISO"))
    if language:
        fields["language"] = language

    isbn = _isbn(text("GTIN"))
    if isbn:
        fields["isbn"] = isbn

    # Unset numbers are -1 in ComicRack's schema; _date_fields refuses those.
    dated = "-".join(
        part.zfill(2) for part in (text("Year"), text("Month"), text("Day")) if part.isdigit()
    )
    fields.update(_date_fields(dated if text("Year").isdigit() else ""))
    return fields


def epub_fields(filepath: str) -> dict[str, Any]:
    """Map an EPUB's OPF package onto book fields; empty when it has none."""
    try:
        with zipfile.ZipFile(filepath) as archive:
            opf_path = _rootfile(archive)
            if not opf_path:
                return {}
            root = SafeElementTree.fromstring(_read_member(archive, opf_path))
    except (
        zipfile.BadZipFile,
        KeyError,
        RuntimeError,
        NotImplementedError,
        SafeElementTree.ParseError,
        ValueError,
    ):
        # Not a zip, no such member, an encrypted or oddly compressed member,
        # or XML the safe parser refuses: an EPUB with nothing readable is an
        # EPUB with no metadata to offer.
        return {}

    fields = opf_fields(root)
    fields.pop("cover_image_filename", None)  # a sidecar concept, not a field
    if "tags" in fields:
        fields["tags"] = _tags(fields["tags"])
        if not fields["tags"]:
            del fields["tags"]
    if "authors" in fields:
        authors = [a for a in fields["authors"] if a.casefold() not in _PLACEHOLDER_AUTHORS]
        if authors:
            fields["authors"] = authors
        else:
            del fields["authors"]

    if "isbn" not in fields:
        isbn = _urn_isbn(root)
        if isbn:
            fields["isbn"] = isbn

    language = _language(_dc_text(root, "language"))
    if language:
        fields["language"] = language

    # The sidecar reader keeps only the year; an EPUB's date is often exact.
    dated = _date_fields(_dc_text(root, "date"))
    if dated:
        fields.pop("year", None)
        fields.update(dated)
    return fields


def _rootfile(archive: zipfile.ZipFile) -> str:
    """The OPF path ``META-INF/container.xml`` names, normalised inside the zip."""
    container = SafeElementTree.fromstring(_read_member(archive, _CONTAINER))
    el = container.find("c:rootfiles/c:rootfile", _CONTAINER_NS)
    path = (el.get("full-path") or "").strip() if el is not None else ""
    return posixpath.normpath(path) if path else ""


def _read_member(archive: zipfile.ZipFile, name: str) -> bytes:
    """One XML member's bytes, refusing one too large to be what it claims."""
    if archive.getinfo(name).file_size > _MAX_XML_BYTES:
        raise ValueError(f"{name} is too large to be EPUB metadata")
    with archive.open(name) as member:
        # Read one byte past the cap, so a lying size header is caught too.
        data = member.read(_MAX_XML_BYTES + 1)
    if len(data) > _MAX_XML_BYTES:
        raise ValueError(f"{name} is too large to be EPUB metadata")
    return data


def _dc_text(root: Any, tag: str) -> str:
    el = root.find(f"opf:metadata/dc:{tag}", _OPF_NS)
    return el.text.strip() if el is not None and el.text else ""


def _urn_isbn(root: Any) -> str:
    """An ISBN written as ``urn:isbn:…``, the EPUB 3 way (no ``opf:scheme``).

    The prefix is required: an unprefixed identifier is usually a UUID, and the
    check digit is still verified before anything is offered.
    """
    for el in root.findall("opf:metadata/dc:identifier", _OPF_NS):
        text = (el.text or "").strip()
        if text.lower().startswith("urn:isbn:"):
            normalised = re.sub(r"[-\s]", "", text[9:]).upper()
            if _valid_isbn(normalised):
                return normalised
    return ""


def _isbn(value: Optional[str]) -> str:
    """A validated, separator-free ISBN from ``value``, or "".

    Accepts a bare ISBN or one labelled ``urn:isbn:`` / ``ISBN:``; the check
    digit decides, so an EAN that is not a book number is refused.
    """
    normalised = re.sub(r"[-\s]", "", _ISBN_PREFIX.sub("", _clean(value))).upper()
    if len(normalised) == 13 and not normalised.startswith(("978", "979")):
        return ""  # a valid EAN-13, but a product barcode rather than a book's
    return normalised if _valid_isbn(normalised) else ""


def _xmp_isbn(xmp: Optional[str]) -> str:
    """The first valid ISBN in a PDF's XMP packet, or "".

    An ISBN-only property (``prism:isbn``) is read whether it is written as an
    element or the attribute shorthand; a generic identifier (``dc:identifier``)
    only counts when it is labelled as an ISBN.
    """
    if not xmp:
        return ""
    try:
        root = SafeElementTree.fromstring(xmp.encode("utf-8"))
    except (SafeElementTree.ParseError, ValueError):
        return ""
    for el in root.iter():
        for name, value in el.attrib.items():
            if _local(name) in _XMP_ISBN_NAMES and (isbn := _isbn(value)):
                return isbn
        local = _local(el.tag)
        if local in _XMP_ISBN_NAMES or local in _XMP_IDENTIFIER_NAMES:
            # The value is the element's own text or its rdf:li items.
            for value in el.itertext():
                if local in _XMP_IDENTIFIER_NAMES and not _ISBN_PREFIX.match(value.strip()):
                    continue
                if isbn := _isbn(value):
                    return isbn
    return ""


def _labelled_isbn(*texts: Optional[str]) -> str:
    """An "ISBN …" someone typed into free text, such as the PDF subject."""
    for value in texts:
        for match in _LABELLED_ISBN.finditer(value or ""):
            if isbn := _isbn(match.group(1)):
                return isbn
    return ""


def _local(name: Any) -> str:
    """An XML name without its ``{namespace}``, lower-cased."""
    return str(name).rsplit("}", 1)[-1].lower()


def _links(value: str) -> list[dict[str, str]]:
    """``http(s)`` URLs from a space- or comma-separated list, labelled by host."""
    links: dict[str, dict[str, str]] = {}
    for url in re.split(r"[\s,]+", value):
        parsed = urlparse(url)
        if parsed.scheme in ("http", "https") and parsed.netloc:
            host = parsed.netloc.lower().removeprefix("www.")
            links.setdefault(url, {"label": host, "url": url})
    return list(links.values())


def _clean(value: Optional[str]) -> str:
    """Collapse whitespace; PDF strings often carry stray newlines and NULs."""
    return " ".join((value or "").replace("\x00", "").split())


def _authors(value: Optional[str]) -> list[str]:
    seen: dict[str, str] = {}
    for part in _AUTHOR_SPLIT.split(_clean(value)):
        name = part.strip()
        if name and name.casefold() not in _PLACEHOLDER_AUTHORS:
            seen.setdefault(name.casefold(), name)
    return list(seen.values())


def _tags(values: list[str]) -> list[str]:
    """Lower-cased, de-duplicated, and bounded: keyword fields can be SEO soup."""
    seen: dict[str, None] = {}
    for value in values:
        tag = _clean(value).lower()
        if tag and len(tag) <= _MAX_TAG_LENGTH:
            seen.setdefault(tag, None)
    return list(seen)[:_MAX_TAGS]


def _language(value: Optional[str]) -> str:
    language = _clean(value)
    # The column holds 20 characters; a BCP 47 tag that long is not a real one.
    return language if 0 < len(language) <= 20 else ""


def _date_fields(value: Optional[str]) -> dict[str, int]:
    """``year`` and, when the date has them and they are valid, ``month``/``day``."""
    match = _DATE.match(_clean(value))
    if not match:
        return {}
    year = int(match.group(1))
    # 0101-01-01 is Calibre's "no date"; a future year is a broken clock.
    if year <= 1000 or year > date.today().year + 1:
        return {}
    fields = {"year": year}
    if match.group(2):
        month = int(match.group(2))
        if not 1 <= month <= 12:
            return fields
        fields["month"] = month
        if match.group(3):
            try:
                fields["day"] = date(year, month, int(match.group(3))).day
            except ValueError:
                pass  # a 31st of a 30-day month: keep the year and month
    return fields
