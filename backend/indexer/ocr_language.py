"""Choosing the Tesseract languages to read one scanned book with.

``OCR_LANGUAGES`` is one setting for the whole library, but a library can hold
books in several languages. Reading a German scan with English language data
alone loses the umlauts and much of the vocabulary, so before a book is OCR'd
its own language is looked up, first in each of these, and the first that
names a language wins:

1. the book's ``language`` field - Grimoire's own metadata, which a person
   may have corrected, so it outranks anything the file says
2. its ``.opf`` sidecar's ``dc:language`` (``<stem>.opf``, then Calibre's
   ``metadata.opf``), for a book scanned before that tag was read into the
   field, or one whose field was left empty
3. the PDF catalog's ``/Lang``

That language goes first and ``OCR_LANGUAGES`` follows it, so nothing the
operator configured is ever dropped: an English book in a library set to
``eng`` is read exactly as before. A language whose traineddata isn't installed
can't be used, so the book is read with ``OCR_LANGUAGES`` alone and the log
says which language pack would have helped.
"""
import logging
import os
import re
from typing import Callable, Iterator

from .. import ocr
from ..models import Book
from .metadata import _find_opf_meta

logger = logging.getLogger("grimoire.ocr")

# ISO 639-1 codes (what BCP 47 tags such as "de-DE" start with) to the code of
# the matching Tesseract traineddata, for every language Tesseract ships. The
# withdrawn codes "iw", "in" and "mo" still turn up in older files.
_ISO_639_1 = {
    "af": "afr", "am": "amh", "ar": "ara", "as": "asm", "az": "aze", "be": "bel",
    "bg": "bul", "bn": "ben", "bo": "bod", "br": "bre", "bs": "bos", "ca": "cat",
    "co": "cos", "cs": "ces", "cy": "cym", "da": "dan", "de": "deu", "dv": "div",
    "dz": "dzo", "el": "ell", "en": "eng", "eo": "epo", "es": "spa", "et": "est",
    "eu": "eus", "fa": "fas", "fi": "fin", "fo": "fao", "fr": "fra", "fy": "fry",
    "ga": "gle", "gd": "gla", "gl": "glg", "gu": "guj", "he": "heb", "hi": "hin",
    "hr": "hrv", "ht": "hat", "hu": "hun", "hy": "hye", "id": "ind", "in": "ind",
    "is": "isl", "it": "ita", "iu": "iku", "iw": "heb", "ja": "jpn", "jv": "jav",
    "ka": "kat", "kk": "kaz", "km": "khm", "kn": "kan", "ko": "kor", "ku": "kmr",
    "ky": "kir", "la": "lat", "lb": "ltz", "lo": "lao", "lt": "lit", "lv": "lav",
    "mi": "mri", "mk": "mkd", "ml": "mal", "mn": "mon", "mo": "ron", "mr": "mar",
    "ms": "msa", "mt": "mlt", "my": "mya", "nb": "nor", "ne": "nep", "nl": "nld",
    "nn": "nor", "no": "nor", "oc": "oci", "or": "ori", "pa": "pan", "pl": "pol",
    "ps": "pus", "pt": "por", "qu": "que", "ro": "ron", "ru": "rus", "sa": "san",
    "sd": "snd", "si": "sin", "sk": "slk", "sl": "slv", "sq": "sqi", "su": "sun",
    "sv": "swe", "sw": "swa", "ta": "tam", "te": "tel", "tg": "tgk", "th": "tha",
    "ti": "tir", "tl": "fil", "to": "ton", "tr": "tur", "tt": "tat", "ug": "uig",
    "uk": "ukr", "ur": "urd", "uz": "uzb", "vi": "vie", "yi": "yid", "yo": "yor",
}
# Tesseract names its data by ISO 639-2/T. Calibre and older tools write the
# bibliographic (/B) variant for these, and a few other three-letter codes
# share the language's data.
_ISO_639_2_ALIASES = {
    "alb": "sqi", "arm": "hye", "baq": "eus", "bur": "mya", "cze": "ces", "dut": "nld",
    "fre": "fra", "geo": "kat", "ger": "deu", "gre": "ell", "ice": "isl", "mac": "mkd",
    "may": "msa", "per": "fas", "rum": "ron", "slo": "slk", "tib": "bod", "wel": "cym",
    "nob": "nor", "nno": "nor", "tgl": "fil",
}
_TESSERACT_CODES = frozenset(_ISO_639_1.values())
# The field is free text, so a person may well have typed a name. The common
# ones, in English and as the language calls itself.
_NAMES = {
    "english": "eng", "german": "deu", "deutsch": "deu", "french": "fra",
    "français": "fra", "francais": "fra", "spanish": "spa", "español": "spa",
    "espanol": "spa", "castellano": "spa", "italian": "ita", "italiano": "ita",
    "portuguese": "por", "português": "por", "portugues": "por", "dutch": "nld",
    "nederlands": "nld", "polish": "pol", "polski": "pol", "russian": "rus",
    "русский": "rus", "ukrainian": "ukr", "українська": "ukr", "czech": "ces",
    "čeština": "ces", "cestina": "ces", "slovak": "slk", "hungarian": "hun",
    "magyar": "hun", "romanian": "ron", "română": "ron", "greek": "ell",
    "ελληνικά": "ell", "turkish": "tur", "türkçe": "tur", "swedish": "swe",
    "svenska": "swe", "danish": "dan", "dansk": "dan", "norwegian": "nor",
    "norsk": "nor", "finnish": "fin", "suomi": "fin", "catalan": "cat",
    "català": "cat", "japanese": "jpn", "日本語": "jpn", "korean": "kor",
    "한국어": "kor", "chinese": "chi_sim", "中文": "chi_sim",
    "simplified chinese": "chi_sim", "traditional chinese": "chi_tra",
    "hebrew": "heb", "arabic": "ara", "latin": "lat", "esperanto": "epo",
}
# Script and region subtags that mean a Chinese text is in traditional characters.
_TRADITIONAL = frozenset({"hant", "tw", "hk", "mo"})
# "English, German" or "eng+deu" in one field: each part is a language.
_LIST_SPLIT = re.compile(r"\s*[,;/+&]\s*")


def tesseract_codes(value: str) -> list[str]:
    """The Tesseract language codes ``value`` names, in order; [] for none.

    ``value`` may be a BCP 47 tag (``en``, ``de-DE``, ``zh-Hant``), an ISO 639-2
    code of either kind (``deu``, ``ger``), a Tesseract code (``chi_sim``), a
    language's name (``German``, ``Deutsch``), or several of those separated by
    commas or ``+``. A part that names no language Tesseract knows is skipped.
    """
    codes: list[str] = []
    for part in _LIST_SPLIT.split(value.strip().casefold()):
        code = _tesseract_code(part)
        if code and code not in codes:
            codes.append(code)
    return codes


def _tesseract_code(value: str) -> str:
    if value in _NAMES:
        return _NAMES[value]
    if value in _TESSERACT_CODES or value in ("chi_sim", "chi_tra", "srp", "srp_latn"):
        return value
    primary, *subtags = value.replace("_", "-").split("-")
    if primary in ("zh", "zho", "chi"):
        return "chi_tra" if _TRADITIONAL.intersection(subtags) else "chi_sim"
    if primary in ("sr", "srp", "scc"):
        return "srp_latn" if "latn" in subtags else "srp"
    if len(primary) == 2:
        return _ISO_639_1.get(primary, "")
    if primary in _TESSERACT_CODES:
        return primary
    return _ISO_639_2_ALIASES.get(primary, "")


def book_languages(book: Book) -> str:
    """The ``+``-joined Tesseract languages to OCR ``book`` with.

    The book's own language first, then ``OCR_LANGUAGES``; just
    ``OCR_LANGUAGES`` when the book names no language, or names one whose
    language data isn't installed. Never raises: a source that can't be read
    is a source with no language to offer.
    """
    configured = [c for c in ocr.effective_languages().split("+") if c]
    found = next(_declared(book), None)
    if found is None:
        return "+".join(configured)
    codes, source = found
    installed = ocr.installed_languages()
    usable = [c for c in codes if c in installed]
    missing = [c for c in codes if c not in installed and c not in configured]
    if missing:
        logger.info(
            f"'{book.title or book.filename}' is in {'+'.join(missing)} (from {source}), "
            f"but Tesseract has no language data for it, so it is read with "
            f"{'+'.join(configured)}. Add the {'+'.join(missing)} traineddata to read it "
            f"in its own language."
        )
    return "+".join(usable + [c for c in configured if c not in usable])


def _declared(book: Book) -> Iterator[tuple[list[str], str]]:
    """Each source's languages, most trusted first, skipping those naming none.

    A generator so a later source is only read when every earlier one came up
    empty: the PDF is never opened for a book whose field already says.
    """
    sources: tuple[tuple[str, Callable[[Book], str]], ...] = (
        ("its language field", lambda b: b.language or ""),
        ("its .opf sidecar", _sidecar_language),
        ("the PDF", _pdf_language),
    )
    for source, read in sources:
        try:
            codes = tesseract_codes(read(book))
        except Exception as exc:  # an unreadable file is a source with no answer
            logger.debug(f"OCR language: could not read {source} of '{book.filename}': {exc}")
            continue
        if codes:
            yield codes, source


def _sidecar_language(book: Book) -> str:
    meta = _find_opf_meta(os.path.dirname(book.filepath), book.filename)
    return str(meta.get("language", ""))


def _pdf_language(book: Book) -> str:
    if not book.filepath.lower().endswith(".pdf"):
        return ""
    # Through the render pool, so a malformed PDF crashes a worker, not the indexer.
    from ..render import pool as render_pool

    return render_pool.document_metadata(book.filepath).get("language", "")
