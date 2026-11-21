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

``{field:N}`` caps what writing puts in a field at N characters, so
``{title:80}`` keeps a long title from pushing a name past what a filesystem
or a sync tool takes (issue #938). Reading ignores the cap: a name written
with one fits the pattern either way, and so does one written before it.

``<...>`` marks an optional part. Reading accepts the filename with or without
it; writing drops it when any field inside it is empty, so a book with no
version is written ``Title`` rather than ``Title (v, )``. The angle brackets are
free to use for this because no filesystem Grimoire runs on lets a filename
contain them portably - Windows forbids both outright.

Reading means the same as matching the pattern as one regex, anchored at both
ends and ignoring case, in which most fields are a lazy ``.+?`` and an optional
part is a greedy ``(?:...)?``. It is not done with that regex, though: every
lazy field multiplies the ways a backtracking engine tries to split a name that
does not fit, so a few ``{*}`` against one long name could take minutes, in a
scan or a preview. :class:`_Matcher` searches the same choices in the same
order, so it finds the same match, but remembers every (part, position) it has
already seen fail, which keeps the work to a few passes over the name.
"""
import re
from dataclasses import dataclass, field
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
# A match may start only at the first space of a run, so a long run of spaces
# is scanned once (see `_AUTHOR_SPLIT` in backend/metadata/embedded.py).
_AUTHOR_SPLIT = re.compile(r"(?:(?!\s)|(?<!\s))\s*(?:,|&|\band\b)\s*")

_PLACEHOLDER = re.compile(r"\{([^{}]*)\}")

# More placeholders than any real naming scheme needs (there are only eleven
# named fields), and a bound on how much work reading one name can be.
MAX_PLACEHOLDERS = 20

# Longer than any filename a supported filesystem allows (255 bytes is at most
# 255 characters), so a longer name - one written from metadata, say - cannot
# be a file and is not read, rather than costing time in proportion to it.
_MAX_READ_CHARS = 1024


class PatternError(ValueError):
    """A pattern that cannot be parsed, with a message an admin can act on."""


@dataclass(frozen=True)
class _Field:
    name: str
    # The most characters writing puts here (``{title:80}``); None is no cap.
    limit: Optional[int] = None


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
        raw_name, colon, raw_limit = match.group(1).partition(":")
        name = raw_name.strip().lower()
        if name != WILDCARD and name not in _FIELD_REGEX:
            known = ", ".join("{" + f + "}" for f in FIELDS)
            raise PatternError(f"Unknown field {{{match.group(1)}}}. Use one of {known}, or {{*}}.")
        parts.append(_Field(name, _parse_limit(name, raw_limit) if colon else None))
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


def _parse_limit(name: str, raw: str) -> int:
    """The N of ``{name:N}``, checked."""
    if name == WILDCARD:
        raise PatternError("{*} writes nothing, so it cannot have a length.")
    text = raw.strip()
    if not text.isascii() or not text.isdigit() or not 1 <= int(text) <= MAX_NAME_BYTES:
        raise PatternError(
            f"The length in {{{name}:{raw}}} must be a whole number from 1 to {MAX_NAME_BYTES}."
        )
    return int(text)


class Pattern:
    """A parsed naming pattern. Build one with :func:`parse`."""

    def __init__(self, source: str, parts: tuple[_Part, ...]) -> None:
        self.source = source
        self.parts = parts
        self._matcher = _Matcher(parts)

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

    def written(self, name: str, value: Any) -> str:
        """``value`` as writing would put it in field ``name``: cleaned, and cut to any cap."""
        limit = next((p.limit for p in _flatten(self.parts) if isinstance(p, _Field) and p.name == name), None)
        return _fit(value, limit)

    def read(self, filename: str) -> Optional[dict[str, Any]]:
        """The fields ``filename`` carries, or None when it does not fit the pattern.

        Only :data:`READ_FIELDS` are returned, each trimmed; a field that matched
        nothing (inside an absent optional part) is left out rather than empty,
        so callers can tell "no publisher in the name" from "an empty one".
        """
        match = self._matcher.match(_stem(filename))
        if match is None:
            return None
        out: dict[str, Any] = {}
        for name, raw in match.items():
            if name not in READ_FIELDS:
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
                value = _fit(values.get(part.name, ""), part.limit)
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


# How far a field that is not "anything" can reach, and so how many ends it
# has to try: a year is exactly four characters, an ISBN ten to seventeen.
_FIELD_LENGTHS = {"year": (4, 4), "date": (4, 10), "isbn": (10, 17)}

_WHITESPACE = re.compile(r"\s*")


@dataclass(frozen=True)
class _Lit:
    """Literal text. Whitespace in it matches any run of whitespace.

    Each chunk of text between runs is fixed and holds no whitespace, so every
    run but a trailing one must take all the whitespace there is: the text up to
    the last chunk matches in exactly one way (``core``). A trailing run can end
    anywhere in the whitespace after it, and like the greedy ``\\s+`` it stands
    for, it tries the longest first.
    """

    core: Optional["re.Pattern[str]"]
    trailing: bool


@dataclass(frozen=True)
class _Fld:
    """A field. ``rx`` None is ``.+?``: anything but a newline, shortest first.

    A field with its own regex is greedy, so it tries its longest match first.
    """

    name: Optional[str]
    rx: Optional["re.Pattern[str]"]
    lengths: tuple[int, int] = (1, 1)


@dataclass(frozen=True)
class _Split:
    """An optional part starts here: try it, and failing that jump past it."""

    skip_to: int


_Op = Union[_Lit, _Fld, _Split]


def _lit(text: str) -> _Lit:
    chunks = re.split(r"\s+", text)
    trailing = len(chunks) > 1 and chunks[-1] == ""
    fixed = chunks[:-1] if trailing else chunks
    core = r"\s+".join(re.escape(chunk) for chunk in fixed)
    return _Lit(re.compile(core, re.IGNORECASE) if core else None, trailing)


def _fld(name: str) -> _Fld:
    if name == WILDCARD:
        return _Fld(None, None)
    regex = _FIELD_REGEX[name]
    if regex == r".+?":
        return _Fld(name, None)
    return _Fld(name, re.compile(regex, re.IGNORECASE), _FIELD_LENGTHS[name])


@dataclass
class _Matcher:
    """Reads a name the way the pattern's regex would, without its blow-up.

    The pattern is compiled to a short program of literals, fields and the
    start of each optional part, and a name is matched by a depth-first search
    over it that makes the same choices in the same order as a backtracking
    regex engine: a lazy field takes as little as it can, a greedy one as much,
    and an optional part is tried before it is skipped. So it settles on the
    same match. What happens from a given step at a given position never depends
    on how the search got there, so each result is remembered, and no step is
    worked out twice from one position.
    """

    parts: tuple[_Part, ...]
    program: list[_Op] = field(default_factory=list)

    def __post_init__(self) -> None:
        for part in self.parts:
            if isinstance(part, _Optional):
                start = len(self.program)
                self.program.append(_Split(0))
                self.program.extend(_op(p) for p in part.parts)
                self.program[start] = _Split(len(self.program))
            else:
                self.program.append(_op(part))

    def match(self, text: str) -> Optional[dict[str, str]]:
        """The named fields' raw text, or None when ``text`` does not fit."""
        if len(text) > _MAX_READ_CHARS:
            return None
        found = _Search(self.program, text).run(0, 0)
        if found is None:
            return None
        out: dict[str, str] = {}
        while found:
            name, start, end, found = found
            out[name] = text[start:end]
        return out


def _op(part: Union[str, _Field]) -> _Op:
    return _fld(part.name) if isinstance(part, _Field) else _lit(part)


# A match is the fields it captured, as a chain (name, start, end, rest) ending
# in (); None is no match.
_Found = Optional[tuple[Any, ...]]
_UNSEEN: Any = object()


class _Search:
    """One name against one program, with every (step, position) remembered."""

    def __init__(self, program: list[_Op], text: str) -> None:
        self.program = program
        self.text = text
        self.size = len(text)
        self.width = len(text) + 1
        self.seen: dict[int, _Found] = {}

    def run(self, pc: int, pos: int) -> _Found:
        key = pc * self.width + pos
        found = self.seen.get(key, _UNSEEN)
        if found is _UNSEEN:
            found = self.seen[key] = self._step(pc, pos)
        return found

    def _step(self, pc: int, pos: int) -> _Found:
        text = self.text
        if pc == len(self.program):
            # ``$``: the end, or just before a newline that ends the text.
            at_end = pos == self.size or (pos == self.size - 1 and text[pos] == "\n")
            return () if at_end else None
        op = self.program[pc]
        if isinstance(op, _Split):
            found = self.run(pc + 1, pos)
            return found if found is not None else self.run(op.skip_to, pos)
        if isinstance(op, _Lit):
            end = pos
            if op.core is not None:
                m = op.core.match(text, pos)
                if m is None:
                    return None
                end = m.end()
            if not op.trailing:
                return self.run(pc + 1, end)
            run_end = _WHITESPACE.match(text, end).end()  # type: ignore[union-attr]  # \s* always matches
            for stop in range(run_end, end, -1):
                found = self.run(pc + 1, stop)
                if found is not None:
                    return found
            return None
        if op.rx is None:
            # ``.`` stops at a newline, which only a literal's whitespace takes.
            newline = text.find("\n", pos)
            stops: range = range(pos + 1, (self.size if newline == -1 else newline) + 1)
        else:
            low, high = op.lengths
            stops = range(min(pos + high, self.size), pos + low - 1, -1)
        for stop in stops:
            if op.rx is not None and op.rx.fullmatch(text, pos, stop) is None:
                continue
            found = self.run(pc + 1, stop)
            if found is not None:
                return found if op.name is None else (op.name, pos, stop, found)
        return None


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


# Left dangling at the end of a cut value: ``Curse of Strahd - Reloaded`` cut
# to 17 is ``Curse of Strahd``, not ``Curse of Strahd -``.
_CUT_TAIL = " -,;([{"


def _fit(value: Any, limit: Optional[int]) -> str:
    """``value`` cleaned for a filename and cut to ``limit`` characters."""
    text = clean_value(value)
    if limit is None or len(text) <= limit:
        return text
    cut = text[:limit]
    return cut.rstrip(_CUT_TAIL) or cut.rstrip()


def _render_run(parts: tuple[Union[str, _Field], ...], values: dict[str, str]) -> Optional[str]:
    """An optional group's text, or None when any field inside it is empty."""
    out: list[str] = []
    for part in parts:
        if isinstance(part, _Field):
            value = _fit(values.get(part.name, ""), part.limit)
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
    placeholders = sum(isinstance(p, _Field) for p in _flatten(pattern_parts))
    if placeholders > MAX_PLACEHOLDERS:
        raise PatternError(f"A pattern can hold at most {MAX_PLACEHOLDERS} {{fields}}, {{*}} included.")
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
