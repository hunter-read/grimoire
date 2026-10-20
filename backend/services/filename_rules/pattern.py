"""The folder naming pattern: one string that reads a filename and writes one.

A pattern is literal text with ``{field}`` placeholders, for example::

    {system} - [{publisher}] - {*} - {title}< (v{version}, {year})>

The same string works in both directions, which is the point of having one
mechanism rather than two (issues #521 and #522):

* **Reading** matches a filename stem against it and pulls out the fields, so a
  library named ``D&D5e - [Loot Tavern] - adventure - Crystallica (v0.99,
  2026).pdf`` shows as *Crystallica*, published by *Loot Tavern*.
* **Writing** fills the placeholders from a book's metadata to produce the
  filename the pattern describes, so a library can be renamed onto a scheme, or
  from one scheme onto the next.

``{*}`` matches anything and keeps nothing. It is what lets a pattern name only
the part it cares about without accounting for every other piece of a filename
- but a wildcard has no value to write back, so a pattern holding one can read
filenames and never rename them.

``<...>`` marks an optional part. Reading accepts the filename with or without
it; writing drops it when any field inside it is empty, so a book with no
version is written ``Title`` rather than ``Title (v, )``. The angle brackets are
free to use for this because no filesystem Grimoire runs on lets a filename
contain them portably - Windows forbids both outright.
"""
import re
from dataclasses import dataclass
from typing import Any, Optional, Union

# Every placeholder a pattern may name, with the regex it reads. A year is four
# digits rather than "anything", which is what lets ``{title} {year}`` split
# ``Curse of Strahd 2016`` at the right space.
_FIELD_REGEX = {
    "title": r".+?",
    "system": r".+?",
    "publisher": r".+?",
    "authors": r".+?",
    "year": r"\d{4}",
    "date": r"\d{4}(?:-\d{2}){0,2}",
    "version": r".+?",
    "isbn": r"[0-9Xx\-]{10,17}",
    "product_code": r".+?",
    "category": r".+?",
    "language": r".+?",
}

FIELDS: tuple[str, ...] = tuple(_FIELD_REGEX)

# The fields reading a filename may set on a book. The rest still have to match
# but are not kept: the system and category come from the folder a book sits in,
# not its name, and a date is better read as its year.
READ_FIELDS: tuple[str, ...] = ("title", "publisher", "authors", "year", "version", "isbn", "product_code")

WILDCARD = "*"

# Longest filename most filesystems accept, in bytes - ext4, APFS, NTFS and
# btrfs all sit at 255.
MAX_NAME_BYTES = 255

# Characters no portable filename may hold. A colon gets its own treatment (see
# ``clean_value``), since titles use it constantly and dropping it runs words together.
_ILLEGAL = re.compile(r'[\\/*?"<>|\x00-\x1f]')

# Splits an author list as people write one on a cover or in a filename.
_AUTHOR_SPLIT = re.compile(r"\s*(?:,|&|\band\b)\s*")

_PLACEHOLDER = re.compile(r"\{([^{}]*)\}")


class PatternError(ValueError):
    """A pattern that cannot be parsed, with a message an admin can act on."""


@dataclass(frozen=True)
class _Field:
    name: str


@dataclass(frozen=True)
class _Optional:
    parts: tuple[Union[str, _Field], ...]


_Part = Union[str, _Field, _Optional]


def _parse_run(text: str) -> list[Union[str, _Field]]:
    """Literal text and placeholders, for a stretch with no optional group in it."""
    parts: list[Union[str, _Field]] = []
    pos = 0
    for match in _PLACEHOLDER.finditer(text):
        if match.start() > pos:
            parts.append(text[pos : match.start()])
        name = match.group(1).strip().lower()
        if name != WILDCARD and name not in _FIELD_REGEX:
            known = ", ".join("{" + f + "}" for f in FIELDS)
            raise PatternError(f"Unknown field {{{match.group(1)}}}. Use one of {known}, or {{*}}.")
        parts.append(_Field(name))
        pos = match.end()
    tail = text[pos:]
    literals = [p for p in parts if isinstance(p, str)] + [tail]
    if any("{" in p or "}" in p for p in literals):
        raise PatternError("A '{' or '}' is not part of a {field}.")
    # A filename can never hold one, so a pattern with one could match nothing
    # and would preview a rename the filesystem then refuses.
    if any(c in p for p in literals for c in "/\\\x00"):
        raise PatternError("A pattern describes one filename, so it cannot contain '/' or '\\'.")
    if tail:
        parts.append(tail)
    return parts


class Pattern:
    """A parsed naming pattern. Build one with :func:`parse`."""

    def __init__(self, source: str, parts: tuple[_Part, ...]) -> None:
        self.source = source
        self.parts = parts
        self._regex = re.compile("^" + "".join(_regex_for(p) for p in parts) + "$", re.IGNORECASE)

    @property
    def fields(self) -> list[str]:
        """Every named field, in order, without wildcards."""
        out: list[str] = []
        for part in self.parts:
            inner = part.parts if isinstance(part, _Optional) else (part,)
            out.extend(p.name for p in inner if isinstance(p, _Field) and p.name != WILDCARD)
        return out

    @property
    def renderable(self) -> bool:
        """Whether every placeholder has a value to write, i.e. no ``{*}``."""
        for part in self.parts:
            inner = part.parts if isinstance(part, _Optional) else (part,)
            if any(isinstance(p, _Field) and p.name == WILDCARD for p in inner):
                return False
        return True

    def read(self, filename: str) -> Optional[dict[str, Any]]:
        """The fields ``filename`` carries, or None when it does not fit the pattern.

        Only :data:`READ_FIELDS` are returned, each trimmed; a field that matched
        nothing (inside an absent optional part) is left out rather than empty,
        so callers can tell "no publisher in the name" from "an empty one".
        """
        match = self._regex.match(_stem(filename))
        if not match:
            return None
        out: dict[str, Any] = {}
        for name, raw in match.groupdict().items():
            if raw is None or name not in READ_FIELDS:
                continue
            value = raw.strip()
            if not value:
                continue
            if name == "year":
                out[name] = int(value)
            elif name == "authors":
                out[name] = [a for a in _AUTHOR_SPLIT.split(value) if a]
            else:
                out[name] = value
        return out if out.get("title") else None

    def render(self, values: dict[str, str], ext: str = "") -> tuple[Optional[str], list[str]]:
        """``(filename, missing)`` for a book whose metadata is ``values``.

        ``missing`` names the required fields that were empty; when it is
        non-empty the filename is None, since a name with a hole where the
        publisher should be is worse than leaving the file alone.
        """
        if not self.renderable:
            raise PatternError("A pattern with {*} can read filenames but not write them.")
        missing: list[str] = []
        out: list[str] = []
        for part in self.parts:
            if isinstance(part, _Optional):
                chunk = _render_run(part.parts, values)
                if chunk is not None:
                    out.append(chunk)
            elif isinstance(part, _Field):
                value = clean_value(values.get(part.name, ""))
                if not value:
                    missing.append(part.name)
                out.append(value)
            else:
                out.append(part)
        if missing:
            return None, missing
        name = re.sub(r"\s+", " ", "".join(out)).strip().rstrip(". ")
        if not name:
            return None, ["title"]
        return name + ext, []


def _stem(filename: str) -> str:
    dot = filename.rfind(".")
    return filename[:dot] if dot > 0 else filename


def _literal_regex(text: str) -> str:
    """A literal, matching any run of whitespace where the pattern has one."""
    return r"\s+".join(re.escape(chunk) for chunk in re.split(r"\s+", text))


def _regex_for(part: _Part) -> str:
    if isinstance(part, _Optional):
        return "(?:" + "".join(_regex_for(p) for p in part.parts) + ")?"
    if isinstance(part, _Field):
        if part.name == WILDCARD:
            return r".+?"
        return f"(?P<{part.name}>{_FIELD_REGEX[part.name]})"
    return _literal_regex(part)


def clean_value(value: Any) -> str:
    """A metadata value made safe to put in a filename.

    ``Curse of Strahd: Reloaded`` becomes ``Curse of Strahd - Reloaded``: a colon
    is the character titles reach for most and filesystems refuse most, and
    dropping it outright runs the words either side together. Everything else
    illegal goes, and a slash becomes a dash so ``AD&D 1e/2e`` keeps its meaning.
    """
    text = str(value or "").strip()
    text = re.sub(r"\s*:\s*", " - ", text)
    text = text.replace("/", "-").replace("\\", "-")
    text = _ILLEGAL.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def _render_run(parts: tuple[Union[str, _Field], ...], values: dict[str, str]) -> Optional[str]:
    """An optional group's text, or None when any field inside it is empty."""
    out: list[str] = []
    for part in parts:
        if isinstance(part, _Field):
            value = clean_value(values.get(part.name, ""))
            if not value:
                return None
            out.append(value)
        else:
            out.append(part)
    return "".join(out)


def parse(source: str) -> Pattern:
    """Parse ``source``, raising :class:`PatternError` with a usable message."""
    text = (source or "").strip()
    if not text:
        raise PatternError("The pattern is empty.")
    if len(text) > 500:
        raise PatternError("The pattern is too long.")

    parts: list[_Part] = []
    pos = 0
    while pos < len(text):
        open_at = text.find("<", pos)
        close_at = text.find(">", pos)
        if close_at != -1 and (open_at == -1 or close_at < open_at):
            raise PatternError("A '>' closes an optional part that was never opened.")
        if open_at == -1:
            parts.extend(_parse_run(text[pos:]))
            break
        parts.extend(_parse_run(text[pos:open_at]))
        end = text.find(">", open_at + 1)
        if end == -1:
            raise PatternError("An optional part opened with '<' is never closed with '>'.")
        inner = text[open_at + 1 : end]
        if "<" in inner:
            raise PatternError("Optional parts cannot be nested.")
        group = _parse_run(inner)
        if not any(isinstance(p, _Field) for p in group):
            raise PatternError("An optional part needs at least one {field} inside it.")
        parts.append(_Optional(tuple(group)))
        pos = end + 1

    pattern_parts = tuple(parts)
    names = [
        p.name
        for part in pattern_parts
        for p in (part.parts if isinstance(part, _Optional) else (part,))
        if isinstance(p, _Field) and p.name != WILDCARD
    ]
    if "title" not in names:
        raise PatternError("The pattern needs a {title}.")
    repeated = sorted({n for n in names if names.count(n) > 1})
    if repeated:
        raise PatternError(f"{{{repeated[0]}}} appears more than once.")
    for prev, nxt in zip(_flatten(pattern_parts), _flatten(pattern_parts)[1:]):
        if isinstance(prev, _Field) and isinstance(nxt, _Field):
            raise PatternError(
                "Two fields need something between them, or there is no telling where one ends."
            )
    return Pattern(text, pattern_parts)


def _flatten(parts: tuple[_Part, ...]) -> list[Union[str, _Field]]:
    out: list[Union[str, _Field]] = []
    for part in parts:
        if isinstance(part, _Optional):
            out.extend(part.parts)
        else:
            out.append(part)
    return out
