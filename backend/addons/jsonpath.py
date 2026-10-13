"""A small, closed JSONPath subset for character importers.

Character builders export one large JSON document per character, and the values
a sheet wants sit at very different depths: a level at ``$.class.level``, the
skills a player chose scattered across every ``Skill Choice`` feature in the
file. A dotted path (what scrapers use, see ``interpreter._dig``) cannot reach
the second kind, so importers get this instead.

It is a *query* language, not an expression language. A path is parsed into a
fixed set of steps once, and evaluating it only ever walks the document: there
is no arithmetic, no function call, and nothing a definition writes ever reaches
``eval``. That is what lets community definitions be installed without the
consent a script needs.

Supported::

    $                 the document root            @   the current item (in a filter)
    .name  ['name']   a member                     .*  [*]  every member or item
    [0]  [-1]         an item by index             [1:3]    a slice
    ..name  ..*       a member at any depth        ..[?(...)]  a filter at any depth
    [?(@.type == 'Skill Choice')]                  keep the items a test holds for

Filter tests compare with ``== != < <= > >= in``, combine with ``&&``, ``||``
and ``!``, and group with parentheses. Either side may be a path (``@...`` or
``$...``), a quoted string, a number, ``true``, ``false`` or ``null``. A bare
path is a truthiness test: ``[?(@.selected)]`` keeps items whose ``selected`` is
set and not false or empty. A path selecting several values matches when any of
them does, and ``in`` looks inside a list on its right:
``[?(@.id in $..selectedIDs)]``.
"""
import functools
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Union

#: Upper bound on the nodes one step may produce. A five-megabyte export has
#: tens of thousands of nodes; this only exists so a pathological path over a
#: pathological document fails fast instead of stalling a request worker.
MAX_NODES = 200_000
MAX_PATH_LENGTH = 500

Node = tuple[Any, Any]  # (key or index it was reached by, value)


class JsonPathError(ValueError):
    """A path that does not parse, or that blew through ``MAX_NODES``."""


# --- tokens ----------------------------------------------------------------

_TOKEN = re.compile(
    r"""
    (?P<space>\s+)
  | (?P<dotdot>\.\.)
  | (?P<op>==|!=|<=|>=|&&|\|\||[<>!])
  | (?P<punct>[.\[\]()?,:*$@])
  | (?P<string>'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")
  | (?P<number>-?\d+(?:\.\d+)?)
  | (?P<name>[A-Za-z_][A-Za-z0-9_\-]*)
    """,
    re.VERBOSE,
)


def _tokenize(text: str) -> list[tuple[str, str]]:
    tokens: list[tuple[str, str]] = []
    position = 0
    while position < len(text):
        match = _TOKEN.match(text, position)
        if not match:
            raise JsonPathError(f"unexpected {text[position]!r} at position {position}")
        kind = match.lastgroup or ""
        value = match.group()
        position = match.end()
        if kind == "space":
            continue
        if kind == "punct":
            kind = value
        tokens.append((kind, value))
    return tokens


def _unquote(token: str) -> str:
    body = token[1:-1]
    return re.sub(r"\\(.)", r"\1", body)


# --- compiled form ---------------------------------------------------------


@dataclass(frozen=True)
class _Step:
    kind: str  # "name" | "names" | "wild" | "index" | "slice" | "filter"
    descend: bool = False  # true for a `..` step
    names: tuple[str, ...] = ()
    index: int = 0
    start: Optional[int] = None
    stop: Optional[int] = None
    test: Optional["_Expr"] = None


@dataclass(frozen=True)
class Path:
    """A parsed path. Build one with :func:`compile_path`."""

    source: str
    relative: bool  # starts at `@` rather than `$`
    steps: tuple[_Step, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class _Literal:
    value: Any


@dataclass(frozen=True)
class _Compare:
    left: Union[Path, _Literal]
    op: str
    right: Union[Path, _Literal]


@dataclass(frozen=True)
class _Truthy:
    operand: Union[Path, _Literal]


@dataclass(frozen=True)
class _Not:
    inner: "_Expr"


@dataclass(frozen=True)
class _Bool:
    op: str  # "&&" | "||"
    left: "_Expr"
    right: "_Expr"


_Expr = Union[_Compare, _Truthy, _Not, _Bool]


class _Parser:
    def __init__(self, text: str) -> None:
        self.text = text
        self.tokens = _tokenize(text)
        self.position = 0

    # token helpers
    def _peek(self, offset: int = 0) -> tuple[str, str]:
        index = self.position + offset
        return self.tokens[index] if index < len(self.tokens) else ("end", "")

    def _take(self, kind: Optional[str] = None) -> tuple[str, str]:
        token = self._peek()
        if kind is not None and token[0] != kind:
            found = token[1] or "the end"
            raise JsonPathError(f"expected {kind!r} but found {found!r} in {self.text!r}")
        self.position += 1
        return token

    # paths
    def parse_path(self) -> Path:
        kind, _ = self._peek()
        if kind not in ("$", "@"):
            raise JsonPathError(f"a path must start with '$' or '@': {self.text!r}")
        self._take()
        steps: list[_Step] = []
        while True:
            kind, _ = self._peek()
            if kind == ".":
                self._take()
                steps.append(self._member(descend=False))
            elif kind == "dotdot":
                self._take()
                if self._peek()[0] == "[":
                    steps.append(self._bracket(descend=True))
                else:
                    steps.append(self._member(descend=True))
            elif kind == "[":
                steps.append(self._bracket(descend=False))
            else:
                break
        return Path(source="", relative=False, steps=tuple(steps))

    def _member(self, *, descend: bool) -> _Step:
        kind, value = self._take()
        if kind == "*":
            return _Step("wild", descend=descend)
        if kind == "name":
            return _Step("name", descend=descend, names=(value,))
        raise JsonPathError(f"expected a member name after '.' in {self.text!r}")

    def _bracket(self, *, descend: bool) -> _Step:
        self._take("[")
        kind, value = self._peek()
        if kind == "*":
            self._take()
            step = _Step("wild", descend=descend)
        elif kind == "?":
            self._take()
            self._take("(")
            test = self._or()
            self._take(")")
            step = _Step("filter", descend=descend, test=test)
        elif kind == "string":
            names = [_unquote(self._take()[1])]
            while self._peek()[0] == ",":
                self._take()
                names.append(_unquote(self._take("string")[1]))
            step = _Step("names", descend=descend, names=tuple(names))
        elif kind in ("number", ":"):
            step = self._index_or_slice(descend)
        else:
            raise JsonPathError(f"unexpected {value or 'end'!r} inside [] in {self.text!r}")
        self._take("]")
        return step

    def _index_or_slice(self, descend: bool) -> _Step:
        start = self._int() if self._peek()[0] == "number" else None
        if self._peek()[0] != ":":
            if start is None:
                raise JsonPathError(f"expected an index in {self.text!r}")
            return _Step("index", descend=descend, index=start)
        self._take(":")
        stop = self._int() if self._peek()[0] == "number" else None
        return _Step("slice", descend=descend, start=start, stop=stop)

    def _int(self) -> int:
        _, value = self._take("number")
        if "." in value:
            raise JsonPathError(f"an index must be a whole number in {self.text!r}")
        return int(value)

    # filter expressions
    def _or(self) -> _Expr:
        left = self._and()
        while self._peek()[0] == "op" and self._peek()[1] == "||":
            self._take()
            left = _Bool("||", left, self._and())
        return left

    def _and(self) -> _Expr:
        left = self._unary()
        while self._peek()[0] == "op" and self._peek()[1] == "&&":
            self._take()
            left = _Bool("&&", left, self._unary())
        return left

    def _unary(self) -> _Expr:
        kind, value = self._peek()
        if kind == "op" and value == "!":
            self._take()
            return _Not(self._unary())
        if kind == "(":
            self._take()
            inner = self._or()
            self._take(")")
            return inner
        left = self._operand()
        kind, value = self._peek()
        if kind == "op" and value in ("==", "!=", "<", "<=", ">", ">="):
            self._take()
            return _Compare(left, value, self._operand())
        if kind == "name" and value == "in":
            self._take()
            return _Compare(left, "in", self._operand())
        return _Truthy(left)

    def _operand(self) -> Union[Path, _Literal]:
        kind, value = self._peek()
        if kind in ("$", "@"):
            path = self.parse_path()
            return Path(source=value, relative=kind == "@", steps=path.steps)
        self._take()
        if kind == "string":
            return _Literal(_unquote(value))
        if kind == "number":
            return _Literal(float(value) if "." in value else int(value))
        if kind == "name" and value in ("true", "false", "null"):
            return _Literal({"true": True, "false": False, "null": None}[value])
        raise JsonPathError(f"unexpected {value or 'end'!r} in a filter in {self.text!r}")


@functools.lru_cache(maxsize=1024)
def compile_path(text: str) -> Path:
    """Parse ``text`` once. Raises :class:`JsonPathError` naming what is wrong."""
    if not isinstance(text, str) or not text.strip():
        raise JsonPathError("a path must not be empty")
    if len(text) > MAX_PATH_LENGTH:
        raise JsonPathError(f"a path may be at most {MAX_PATH_LENGTH} characters")
    parser = _Parser(text.strip())
    path = parser.parse_path()
    if parser.position != len(parser.tokens):
        leftover = parser.tokens[parser.position][1]
        raise JsonPathError(f"unexpected {leftover!r} in {text!r}")
    return Path(source=text, relative=text.strip().startswith("@"), steps=path.steps)


# --- evaluation ------------------------------------------------------------


class _Context:
    """Per-query state: the root, and absolute sub-paths already evaluated.

    ``[?(@.id in $..selectedIDs)]`` would otherwise re-walk the whole document
    for every item it tests.
    """

    def __init__(self, root: Any) -> None:
        self.root = root
        self.absolute: dict[int, list[Any]] = {}


def _children(value: Any) -> list[Node]:
    if isinstance(value, dict):
        return list(value.items())
    if isinstance(value, list):
        return list(enumerate(value))
    return []


def _descendants(node: Node) -> list[Node]:
    """The node and everything beneath it, in document order. Iterative, so a
    deeply nested document cannot exhaust the interpreter's recursion limit."""
    out: list[Node] = []
    stack = [node]
    while stack:
        current = stack.pop()
        out.append(current)
        if len(out) > MAX_NODES:
            raise JsonPathError("the path matches too much of the document")
        stack.extend(reversed(_children(current[1])))
    return out


def _apply(step: _Step, value: Any, context: _Context) -> list[Node]:
    if step.kind == "name" or step.kind == "names":
        if isinstance(value, dict):
            return [(name, value[name]) for name in step.names if name in value]
        return []
    if step.kind == "wild":
        return _children(value)
    if step.kind == "index":
        if isinstance(value, list) and -len(value) <= step.index < len(value):
            return [(step.index % len(value), value[step.index])]
        return []
    if step.kind == "slice":
        if isinstance(value, list):
            indices = range(len(value))[step.start:step.stop]
            return [(index, value[index]) for index in indices]
        return []
    if step.kind == "filter" and step.test is not None:
        test = step.test
        return [child for child in _children(value) if _holds(test, child[1], context)]
    return []


def _run(path: Path, start: Any, context: _Context) -> list[Node]:
    nodes: list[Node] = [(None, start)]
    for step in path.steps:
        produced: list[Node] = []
        for _, value in nodes:
            targets = _descendants((None, value)) if step.descend else [(None, value)]
            for _, target in targets:
                produced.extend(_apply(step, target, context))
            if len(produced) > MAX_NODES:
                raise JsonPathError("the path matches too much of the document")
        nodes = produced
    return nodes


def _operand_values(operand: Union[Path, _Literal], current: Any, context: _Context) -> list[Any]:
    if isinstance(operand, _Literal):
        return [operand.value]
    if operand.relative:
        return [value for _, value in _run(operand, current, context)]
    key = id(operand)
    if key not in context.absolute:
        context.absolute[key] = [value for _, value in _run(operand, context.root, context)]
    return context.absolute[key]


def _truthy(value: Any) -> bool:
    return value not in (None, False, "", 0) and value != [] and value != {}


def _equal(a: Any, b: Any) -> bool:
    """JSON equality: ``false`` is not ``0`` and ``true`` is not ``1``, as Python
    would otherwise have it."""
    if isinstance(a, bool) != isinstance(b, bool):
        return False
    return bool(a == b)


_COMPARE: dict[str, Callable[[Any, Any], bool]] = {
    "==": _equal,
    "!=": lambda a, b: not _equal(a, b),
    "<": lambda a, b: bool(a < b),
    "<=": lambda a, b: bool(a <= b),
    ">": lambda a, b: bool(a > b),
    ">=": lambda a, b: bool(a >= b),
}


def _holds(expr: _Expr, current: Any, context: _Context) -> bool:
    if isinstance(expr, _Bool):
        if expr.op == "&&":
            return _holds(expr.left, current, context) and _holds(expr.right, current, context)
        return _holds(expr.left, current, context) or _holds(expr.right, current, context)
    if isinstance(expr, _Not):
        return not _holds(expr.inner, current, context)
    if isinstance(expr, _Truthy):
        return any(_truthy(v) for v in _operand_values(expr.operand, current, context))

    left = _operand_values(expr.left, current, context)
    right = _operand_values(expr.right, current, context)
    if expr.op == "in":
        pool: list[Any] = []
        for item in right:
            pool.extend(item if isinstance(item, list) else [item])
        return any(_equal(value, candidate) for value in left for candidate in pool)
    compare = _COMPARE[expr.op]
    for a in left:
        for b in right:
            try:
                if compare(a, b):
                    return True
            except TypeError:
                # 'Might' < 3: not comparable is simply not a match.
                continue
    return False


def query(document: Any, path: Union[str, Path], current: Any = None) -> list[Node]:
    """Every ``(key, value)`` the path selects from ``document``.

    A relative path (``@...``) starts at ``current`` - the row being read when a
    list field maps its columns - and an absolute one at ``document``.
    """
    compiled = compile_path(path) if isinstance(path, str) else path
    context = _Context(document)
    start = current if compiled.relative else document
    return _run(compiled, start, context)


def values(document: Any, path: Union[str, Path], current: Any = None) -> list[Any]:
    """The values a path selects, without their keys."""
    return [value for _, value in query(document, path, current)]
