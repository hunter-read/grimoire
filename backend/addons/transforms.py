"""Named value transforms available to add-on definitions.

A closed table rather than an expression language: a definition can only name a
transform that exists here, so no add-on YAML can ever cause arbitrary code to
run. Add new entries here (and to the schema) when a real source needs one.
"""
import re
import unicodedata
from html import unescape
from typing import Callable, Iterable, Union
from urllib.parse import urlsplit, urlunsplit

# Words a title-caser should leave lowercase when they aren't the first word.
_MINOR_WORDS = frozenset({"of", "the", "and", "in", "on", "a", "an", "to", "for", "or"})

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")
_DICE_TOKEN = re.compile(r"\b(\d*)[dD](\d+|F)\b")


def slugify(value: str) -> str:
    """Lowercase, ASCII-fold, and hyphenate — matching the usual web slug rules.

    Accents are folded to their base letters and ``&`` / apostrophes are dropped
    rather than becoming separators, so "Dungeons & Dragons" yields
    ``dungeons-dragons`` rather than ``dungeons---dragons``.
    """
    folded = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    folded = folded.lower().replace("&", "").replace("'", "").replace("’", "")
    return _SLUG_STRIP.sub("-", folded).strip("-")


def titlecase(value: str) -> str:
    """Title-case a display value, keeping minor words lowercase mid-phrase.

    Hyphenated compounds are cased on each part, so ``post-apocalyptic`` becomes
    ``Post-Apocalyptic``.
    """
    words = value.strip().split()
    out: list[str] = []
    for i, word in enumerate(words):
        lowered = word.lower()
        if i > 0 and lowered in _MINOR_WORDS:
            out.append(lowered)
        else:
            out.append("-".join(part.capitalize() for part in lowered.split("-")))
    return " ".join(out)


def upper_dice(value: str) -> str:
    """Normalise dice notation to uppercase D while leaving prose alone.

    ``2d6 dice pool`` becomes ``2D6 dice pool``; ``Diceless`` is untouched
    because it contains no dice token.
    """
    return _DICE_TOKEN.sub(lambda m: f"{m.group(1)}D{m.group(2)}", value)


_TAG = re.compile(r"<[^>]+>")
# A closed block ends a paragraph — two newlines, so paragraphs stay visually
# separated in the plain-text field.
_BLOCK_END = re.compile(r"</(p|div|li|h[1-6]|tr|blockquote)\s*>", re.I)
# A line break inside a block is a single newline.
_LINE_BREAK = re.compile(r"<br\s*/?>", re.I)
_WS = re.compile(r"[ \t]+")
_BLANK_LINES = re.compile(r"\n{3,}")


def strip_html(value: str) -> str:
    """Reduce an HTML fragment to readable plain text.

    Store and catalogue descriptions are marketing HTML. Grimoire's description
    fields are plain text, so tags are removed rather than stored raw — both
    because they would render as literal markup and because storing third-party
    HTML is not something a metadata import should quietly do.
    """
    if "<" not in value:
        return value.strip()
    # Turn block boundaries into newlines first so paragraphs don't run together.
    text = _BLOCK_END.sub("\n\n", value)
    text = _LINE_BREAK.sub("\n", text)
    text = _TAG.sub("", text)
    text = unescape(text)
    text = _WS.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return _BLANK_LINES.sub("\n\n", text).strip()


def strip_query(value: str) -> str:
    """Drop the query string and fragment from a URL.

    Sources commonly append their own tracking or affiliate parameters to
    outbound links. Importing those into a user's library would silently
    monetise their data on someone else's behalf, so definitions pointing at
    such a source should strip them.  Non-URL text is returned unchanged.
    """
    if "://" not in value:
        return value
    parts = urlsplit(value)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


_TRANSFORMS: dict[str, Callable[[str], str]] = {
    "slugify": slugify,
    "titlecase": titlecase,
    "upper": str.upper,
    "lower": str.lower,
    "trim": str.strip,
    "upper_dice": upper_dice,
    "strip_query": strip_query,
    "strip_html": strip_html,
}


def apply(value: str, names: Union[str, Iterable[str], None]) -> str:
    """Apply one transform, or several in order.  Unknown names are ignored.

    Unknown names cannot normally occur — the manifest model constrains them to
    the ``TransformName`` literal — so this is belt-and-braces for definitions
    loaded through another path.
    """
    if not names:
        return value
    if isinstance(names, str):
        names = [names]
    for name in names:
        fn = _TRANSFORMS.get(name)
        if fn is not None:
            value = fn(value)
    return value
