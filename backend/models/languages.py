"""The languages a book can be written in: a fixed list.

Stored lowercase (``english``) and shown with a capital (``English``). The
Codex keeps the same list (grimoire-codex-db ``src/shared/languages.ts``) and
the frontend mirrors it in ``frontend/src/utils/languages.ts`` (a test checks the
two here agree), so a value moves between them unchanged.

Input is forgiving about form but not spelling: any case, an ISO 639 code
(``en``, ``eng``, ``pt-BR``) or the language's own name (``Deutsch``) resolves
to the stored value, and anything else names no language.
"""
from typing import Optional

LANGUAGES: tuple[str, ...] = (
    "arabic",
    "catalan",
    "chinese",
    "czech",
    "danish",
    "dutch",
    "english",
    "finnish",
    "french",
    "german",
    "greek",
    "hebrew",
    "hungarian",
    "indonesian",
    "italian",
    "japanese",
    "korean",
    "norwegian",
    "polish",
    "portuguese",
    "romanian",
    "russian",
    "slovak",
    "spanish",
    "swedish",
    "turkish",
    "ukrainian",
)

# Other spellings of each language: ISO 639-1/-2/-3 codes and its own name.
_ALIASES: dict[str, tuple[str, ...]] = {
    "arabic": ("ar", "ara", "العربية"),
    "catalan": ("ca", "cat", "català", "catala"),
    "chinese": ("zh", "zho", "chi", "cmn", "mandarin", "中文", "汉语", "漢語"),
    "czech": ("cs", "ces", "cze", "čeština", "cestina"),
    "danish": ("da", "dan", "dansk"),
    "dutch": ("nl", "nld", "dut", "nederlands", "flemish"),
    "english": ("en", "eng"),
    "finnish": ("fi", "fin", "suomi"),
    "french": ("fr", "fra", "fre", "français", "francais"),
    "german": ("de", "deu", "ger", "deutsch"),
    "greek": ("el", "ell", "gre", "ελληνικά"),
    "hebrew": ("he", "heb", "iw", "עברית"),
    "hungarian": ("hu", "hun", "magyar"),
    "indonesian": ("id", "ind", "bahasa indonesia"),
    "italian": ("it", "ita", "italiano"),
    "japanese": ("ja", "jpn", "日本語"),
    "korean": ("ko", "kor", "한국어"),
    "norwegian": ("no", "nor", "nb", "nob", "nn", "nno", "norsk"),
    "polish": ("pl", "pol", "polski"),
    "portuguese": ("pt", "por", "português", "portugues", "brazilian portuguese"),
    "romanian": ("ro", "ron", "rum", "română", "romana"),
    "russian": ("ru", "rus", "русский"),
    "slovak": ("sk", "slk", "slo", "slovenčina", "slovencina"),
    "spanish": ("es", "spa", "español", "espanol", "castellano"),
    "swedish": ("sv", "swe", "svenska"),
    "turkish": ("tr", "tur", "türkçe", "turkce"),
    "ukrainian": ("uk", "ukr", "українська"),
}

_LOOKUP: dict[str, str] = {}
for _lang in LANGUAGES:
    _LOOKUP[_lang] = _lang
    for _alias in _ALIASES[_lang]:
        _LOOKUP[_alias] = _lang


# Longer than any name, code or regional tag on the list, so not worth looking up.
MAX_LOOKUP_LENGTH = 64


def find_language(value: Optional[str]) -> Optional[str]:
    """The listed language ``value`` names, or None when it names none.

    Only an exact name, code or own-language name counts, in any case. A
    regional tag (``en-US``, ``pt_BR``, ``zh-Hant``) is decided by its base
    code. A spelling the list does not hold is no match, not a guess: a guess
    would read a real unlisted language as its listed neighbour (Bulgarian as
    Hungarian, Javanese as Japanese).
    """
    v = " ".join((value or "").strip().lower().replace("_", "-").split())
    if not v or len(v) > MAX_LOOKUP_LENGTH:
        return None
    return _LOOKUP.get(v) or _LOOKUP.get(v.split("-")[0])


def stored_language(value: Optional[str]) -> str:
    """The value to store for ``value``: a listed language, or '' for anything else."""
    return find_language(value) or ""


def language_label(value: Optional[str]) -> str:
    """``english`` -> ``English``, for places that show a language as text."""
    v = value or ""
    return v[:1].upper() + v[1:]
