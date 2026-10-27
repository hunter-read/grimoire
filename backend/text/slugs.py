"""The one ``slugify``, with an option for every way the backend slugs a name.

The callers used to carry nine copies that had drifted apart (issue #711): some
keep accented letters and some fold them, some drop ``&`` and some spell it out,
some drop punctuation and some turn it into a separator. Several of those slugs
are **persisted**, so a caller cannot simply switch to a different rule without
orphaning what it has already stored. Each caller therefore keeps its own rule,
spelled out as options here, and ``backend/tests/test_slugs.py`` pins every one
against the copy it replaced.

The families, and whether their output is stored:

    wiki page slugs      routers/campaigns/wikilinks.slugify     PERSISTED
                         chars="words", trim=False, fallback="untitled"
                         ``[[Title]]`` links resolve by re-slugging the title, so a
                         change would break every link to an existing page.
    library slugs        indexer/categories.slugify              PERSISTED
                         chars="words"
                         Game-system slugs and thumbnail filenames, and the
                         folder names compared against fixed slug lists.
    ruleset entry ids    services/characters/rulesets.slugify    PERSISTED
                         chars="unicode", drop_apostrophes=True, max_len=200,
                         fallback="entry"
    character sheet ids  routers/characters/core._slugify        PERSISTED
                         chars="unicode", max_len=100, fallback="sheet"
    theme ids            services/themes.slugify_id              PERSISTED
                         chars="ascii", max_len=MAX_ID_LENGTH
    add-on transform     addons/transforms.slugify               add-on output
                         fold="ascii", amp="", drop_apostrophes=True
                         Named in community add-on definitions, which expect it to
                         keep producing what it does.
    Codex DB category    codex/compare._slug                     mirrors Codex DB
                         fold="accents", amp=" and ", max_len=100
                         Must match Grimoire Codex DB's own rule, not ours.

None of them may change output without a migration for what is stored.
"""
import re
import unicodedata
from typing import Literal, Optional

# Runs of characters that become a single "-", for each ``chars`` setting.
_SEPARATORS = {
    "ascii": re.compile(r"[^a-z0-9]+"),
    # Python's \w is exactly str.isalnum() plus "_", so this is "not alphanumeric".
    "unicode": re.compile(r"[\W_]+"),
    "words": re.compile(r"[\s_-]+"),
}
# What "words" drops outright rather than treating as a separator.
_WORDS_PUNCTUATION = re.compile(r"[^\w\s-]")
_APOSTROPHES = ("'", "’")


def slugify(
    text: Optional[str],
    *,
    chars: Literal["ascii", "unicode", "words"] = "ascii",
    fold: Optional[Literal["accents", "ascii"]] = None,
    amp: Optional[str] = None,
    drop_apostrophes: bool = False,
    trim: bool = True,
    max_len: Optional[int] = None,
    fallback: str = "",
) -> str:
    """Lowercase ``text`` and hyphenate it, by the rule the options describe.

    ``chars`` picks what survives:

    - ``"ascii"``: ``a-z`` and ``0-9``; anything else separates words.
    - ``"unicode"``: any letter or digit, accented or not; anything else separates.
    - ``"words"``: any letter or digit; whitespace, ``_`` and ``-`` separate, and
      other punctuation is dropped, so "Hunter's" reads ``hunters``.

    ``fold`` runs first: ``"accents"`` strips combining marks ("é" to "e"), and
    ``"ascii"`` also drops whatever is still not ASCII afterwards ("ß" vanishes).
    ``amp`` replaces ``&`` and ``drop_apostrophes`` removes ``'`` and ``’``, both
    before separating. ``trim`` strips leading and trailing hyphens (``"words"``
    strips surrounding whitespace either way). ``max_len`` caps the result, which
    may then end in a hyphen, and ``fallback`` stands in for an empty one.
    """
    value = text or ""
    if fold is not None:
        value = unicodedata.normalize("NFKD", value)
        if fold == "ascii":
            value = value.encode("ascii", "ignore").decode()
        else:
            value = "".join(c for c in value if not unicodedata.combining(c))
    value = value.lower()
    if amp is not None:
        value = value.replace("&", amp)
    if drop_apostrophes:
        for mark in _APOSTROPHES:
            value = value.replace(mark, "")
    if chars == "words":
        value = _WORDS_PUNCTUATION.sub("", value).strip()
    value = _SEPARATORS[chars].sub("-", value)
    if trim:
        value = value.strip("-")
    if max_len is not None:
        value = value[:max_len]
    return value or fallback
