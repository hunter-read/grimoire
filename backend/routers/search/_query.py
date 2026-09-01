"""Field-scoped query parsing for the search API (issue #343).

A search box that only ever matched indexed page text made "do I own this book?"
the one question it could not answer: typing a title returned every page that
happened to mention it, and the book itself was nowhere near the top. This module
adds a ``field:value`` prefix syntax — ``title:avatar``, ``author:"Ben Robbins"``,
``tag:dungeon`` — so a query can name what it is searching over.

The parse is deliberately forgiving. An unknown prefix (``foo:bar``) is *not* an
error: it falls through to the free-text terms, because a colon is ordinary
punctuation in book titles ("Vaesen: Nordic Horror") and a search box that
rejects a title is worse than one that searches for it literally.

Two rules drive everything downstream:

* **A metadata filter suppresses content search.** ``title:avatar`` searches book
  titles, never page text — that is the entire point of the issue. Only free
  text (or an explicit ``text:``/``content:``) reaches FTS5.
* **Filters are ANDed, values within a repeated field are ORed.** ``system:pbta
  category:core`` narrows; ``tag:forest tag:swamp`` widens.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional


# Every accepted prefix, mapped to its canonical field name. Aliases exist where
# users will reasonably reach for a different word than the schema uses
# ("system" is the field, but "game" reads naturally in a search box).
FIELD_ALIASES: dict[str, str] = {
    "title": "title",
    "name": "title",
    "author": "author",
    "authors": "author",
    "artist": "artist",
    "artists": "artist",
    "publisher": "publisher",
    "system": "system",
    "game": "system",
    "category": "category",
    "tag": "tag",
    "tags": "tag",
    "year": "year",
    "isbn": "isbn",
    "language": "language",
    "lang": "language",
    "description": "description",
    "desc": "description",
    "album": "album",
    "filename": "filename",
    "file": "filename",
    "text": "text",
    "content": "text",
    "page": "text",
}

# Fields that only a book can satisfy. When one is used, the maps/tokens/audio
# sections are suppressed entirely rather than returned unfiltered — a query
# saying "author:gygax" is asking about books, and a full list of every map
# would read as though the filter had been ignored.
BOOK_ONLY_FIELDS = frozenset(
    {"author", "publisher", "category", "year", "isbn", "language", "description", "text"}
)

# Fields a book row can match. The complement of the media-only fields
# (``album``, ``artist``): a filter naming none of these describes nothing a
# book has, and must return no books rather than an unfiltered list.
BOOK_FIELDS = frozenset(
    {
        "title",
        "author",
        "artist",
        "publisher",
        "system",
        "category",
        "tag",
        "year",
        "isbn",
        "language",
        "description",
        "filename",
    }
)

# Fields a map/token/audio row can match. ``title`` maps onto a filename (and an
# audio track's embedded title), which is why a bare ``title:`` search still
# turns up the map you were thinking of.
MEDIA_FIELDS = frozenset({"title", "tag", "filename", "artist", "album"})

# Split on whitespace, keeping "quoted phrases" (single or double) as one token.
# Group 1 is a field prefix, groups 2/3/4 the double-quoted, single-quoted, and
# bare value forms respectively.
_TOKEN_RE = re.compile(
    r"""
    (?:(?P<field>[A-Za-z_]+):)?      # optional field prefix
    (?: "(?P<dq>[^"]*)"              # "double quoted value"
      | '(?P<sq>[^']*)'              # 'single quoted value'
      | (?P<bare>\S+)                # bare-word value
    )
    """,
    re.VERBOSE,
)


# FTS5 bareword syntax treats plenty of ordinary punctuation as operators: a
# hyphen introduces a column filter ("coverage-compendium" -> "no such column"),
# "&" is a syntax error, and a trailing AND/OR/NEAR is an incomplete expression.
# Real book titles are full of all three ("D&D", "Star Wars - Edge of the
# Empire"), so an unquoted user string reaching MATCH is a 500 waiting to happen.
_FTS_BAREWORD = re.compile(r"^[A-Za-z0-9_]+$")

# FTS5's boolean keywords are barewords, so quoting punctuation alone still
# leaves "trailing AND" a syntax error. They are kept as operators where they
# are well-formed — "fireball OR lightning" is a genuinely useful query — and
# quoted into literals only where FTS5 would reject them: leading, trailing, or
# adjacent to another operator, which is always a half-typed query rather than
# an intended one.
_FTS_OPERATORS = frozenset({"AND", "OR", "NOT", "NEAR"})


def to_fts_query(raw: str) -> str:
    """Turn user text into an FTS5 expression that cannot be a syntax error.

    Each whitespace-separated token becomes a quoted phrase unless it is a plain
    bareword, which is left alone so FTS5 prefix search (``fire*``) keeps
    working. Embedded double quotes are doubled, per FTS5 string escaping.

    Quoting loses the boolean operators, which is the right trade: a search box
    that 500s on "D&D" is broken in a way that a search box which takes "AND"
    literally is not.
    """
    raw_tokens = (raw or "").split()
    operator_at = [t.upper() in _FTS_OPERATORS for t in raw_tokens]

    tokens = []
    for i, token in enumerate(raw_tokens):
        if operator_at[i]:
            # Well-formed only with a non-operator term on both sides.
            has_left = i > 0 and not operator_at[i - 1]
            has_right = i + 1 < len(raw_tokens) and not operator_at[i + 1]
            tokens.append(token if has_left and has_right else f'"{token}"')
        elif _FTS_BAREWORD.fullmatch(token) or (
            token.endswith("*") and _FTS_BAREWORD.fullmatch(token[:-1])
        ):
            tokens.append(token)
        else:
            escaped = token.replace('"', '""')
            tokens.append(f'"{escaped}"')
    return " ".join(tokens)


@dataclass
class ParsedQuery:
    """The result of parsing a raw search box string.

    ``filters`` maps a canonical field name to the list of values given for it.
    ``free_text`` is everything that carried no recognised prefix, rejoined with
    spaces — the part that reaches FTS5 when no metadata filter is present.
    """

    raw: str
    filters: dict[str, list[str]] = field(default_factory=dict)
    free_text: str = ""

    @property
    def has_filters(self) -> bool:
        return bool(self.filters)

    @property
    def metadata_fields(self) -> set[str]:
        """Filter fields other than the content-search ``text:``."""
        return {f for f in self.filters if f != "text"}

    @property
    def content_query(self) -> str:
        """The string to hand FTS5, or "" when no content search should run.

        Free text alone searches content (today's behaviour). An explicit
        ``text:``/``content:`` always searches content, and combines with free
        text. A metadata filter with neither suppresses content search — the
        heart of issue #343.
        """
        explicit = " ".join(self.filters.get("text", []))
        if explicit and self.free_text:
            return to_fts_query(f"{explicit} {self.free_text}")
        if explicit:
            return to_fts_query(explicit)
        if self.metadata_fields:
            return ""
        return to_fts_query(self.free_text)

    @property
    def books_only(self) -> bool:
        """True when a filter in play can only be satisfied by a book."""
        return bool(self.metadata_fields & BOOK_ONLY_FIELDS) or "text" in self.filters

    def values(self, field_name: str) -> list[str]:
        return self.filters.get(field_name, [])


def parse_query(raw: str) -> ParsedQuery:
    """Parse a raw search string into field filters plus free text.

    Unknown prefixes and empty values fall back to free text, so a title
    containing a colon still searches for itself rather than erroring.
    """
    parsed = ParsedQuery(raw=raw)
    free: list[str] = []

    for match in _TOKEN_RE.finditer(raw or ""):
        prefix = match.group("field")
        quoted = match.group("dq") is not None or match.group("sq") is not None
        value = match.group("dq")
        if value is None:
            value = match.group("sq")
        if value is None:
            value = match.group("bare") or ""

        canonical = FIELD_ALIASES.get(prefix.lower()) if prefix else None
        if canonical and value.strip():
            parsed.filters.setdefault(canonical, []).append(value.strip())
            continue

        # Not a recognised filter. Put the token back the way the user typed it
        # so an unmatched prefix searches literally rather than vanishing.
        if prefix and not canonical:
            free.append(f"{prefix}:{value}" if not quoted else f'{prefix}:"{value}"')
        elif value.strip():
            free.append(value)

    parsed.free_text = " ".join(free)
    return parsed


def year_bounds(values: list[str]) -> tuple[Optional[int], Optional[int]]:
    """Interpret ``year:`` values as an inclusive ``(low, high)`` range.

    Accepts a plain year (``year:1999``), an open range (``year:>1999``,
    ``year:<=2005``), and a closed one (``year:1999-2005``). Anything
    unparseable yields ``(None, None)``, which the caller treats as no
    constraint rather than as an empty result — a typo should not silently hide
    the whole library.
    """
    low: Optional[int] = None
    high: Optional[int] = None
    for value in values:
        v = value.strip()
        try:
            if m := re.fullmatch(r">=?\s*(\d{1,4})", v):
                bound = int(m.group(1)) + (0 if v.startswith(">=") else 1)
                low = bound if low is None else max(low, bound)
            elif m := re.fullmatch(r"<=?\s*(\d{1,4})", v):
                bound = int(m.group(1)) - (0 if v.startswith("<=") else 1)
                high = bound if high is None else min(high, bound)
            elif m := re.fullmatch(r"(\d{1,4})\s*-\s*(\d{1,4})", v):
                lo, hi = int(m.group(1)), int(m.group(2))
                low = lo if low is None else max(low, lo)
                high = hi if high is None else min(high, hi)
            elif m := re.fullmatch(r"\d{1,4}", v):
                exact = int(v)
                low = exact if low is None else max(low, exact)
                high = exact if high is None else min(high, exact)
        except ValueError:  # pragma: no cover - guarded by the regexes above
            continue
    return low, high
