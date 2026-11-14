"""The fixed book-language list revision 0071 normalizes to, as written for it.

Frozen copy of ``backend/models/languages.py``. A change to the live list needs
a revision of its own; it does not change what 0071 wrote.
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


def _distance(a: str, b: str) -> int:
    """Levenshtein distance: the single-letter edits that turn ``a`` into ``b``."""
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _misspelt(v: str) -> Optional[str]:
    """The one listed language ``v`` is a near miss of ("italan"), else None.

    Within one edit for a word of up to five letters, two for longer ones, and
    only the single closest language: "italan" is one edit from Italian and two
    from Catalan, so it is Italian; a tie names neither.
    """
    if len(v) < 4:
        return None
    allowed = 1 if len(v) <= 5 else 2
    scored = sorted((_distance(v, lang), lang) for lang in LANGUAGES)
    best, lang = scored[0]
    if best > allowed or scored[1][0] == best:
        return None
    return lang


def find_language(value: Optional[str]) -> Optional[str]:
    """The listed language ``value`` names, or None when it names none.

    A regional tag (``en-US``, ``pt_BR``, ``zh-Hant``) is decided by its base
    code, and a near-miss spelling ("Italan") by the language it misses.
    """
    v = " ".join((value or "").strip().lower().replace("_", "-").split())
    if not v:
        return None
    return _LOOKUP.get(v) or _LOOKUP.get(v.split("-")[0]) or _misspelt(v)


def stored_language(value: Optional[str]) -> str:
    """The value to store for ``value``: a listed language, or '' for anything else."""
    return find_language(value) or ""


def language_label(value: Optional[str]) -> str:
    """``english`` -> ``English``, for places that show a language as text."""
    v = value or ""
    return v[:1].upper() + v[1:]
