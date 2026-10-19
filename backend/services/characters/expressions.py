"""A small, safe formula language for computed fields and validators.

Schemas come from strangers — a community catalogue, a pasted document — so a
formula is **parsed, never executed**. There is no ``eval``, no ``exec``, no
``compile``, and no access to Python objects from inside an expression. What
runs is a hand-written recursive-descent parser producing an AST, and a walker
that understands exactly the node types below and nothing else.

The language is deliberately small:

    arithmetic     + - * / %  and unary -
    comparison     == != < <= > >=
    logic          and or not
    conditional    cond ? a : b
    calls          floor(x), min(a, b), ... — from a closed table
    literals       numbers, 'strings', true, false, null
    names          other fields on the same character

Anything else is a parse error, which surfaces as a schema validation failure at
install time rather than a broken sheet at render time.

Division by zero yields 0 rather than raising. A character sheet mid-edit is
routinely in a nonsense state — a level of 0, an empty score box — and a sheet
that renders "0" while you fill it in is far more useful than one that refuses
to draw. The same reasoning covers unknown names, which read as 0/empty.

Formulas are also bounded, because one runs on every sheet render and a schema
can chain up to ``MAX_COMPUTED`` of them: nesting is capped at
:data:`MAX_EXPRESSION_DEPTH`, a number literal at :data:`MAX_NUMBER_LENGTH`
characters, and any number a step produces at :data:`MAX_MAGNITUDE`. Past a
bound the formula yields its default, like any other formula that cannot be
worked out - so a self-squaring chain stops at the first step that overflows
rather than growing a million-digit integer.
"""
import math
import re
from typing import Any, Callable, Union

__all__ = [
    "EVALUATION_ERRORS",
    "ExpressionError",
    "evaluate",
    "parse",
    "referenced_names",
    "FUNCTIONS",
]


class ExpressionError(ValueError):
    """An expression could not be parsed, or used something not in the language."""


#: How deeply parentheses, calls, conditionals and unary operators may nest.
#: Each level costs about nine Python frames, so this stays far inside the
#: interpreter's recursion limit (about 3,000 parentheses used to exhaust it).
MAX_EXPRESSION_DEPTH = 64

#: The longest number literal accepted, in characters. Far beyond any real
#: sheet; Python refuses to parse an int of more than 4,300 digits at all.
MAX_NUMBER_LENGTH = 32

#: The largest magnitude any step may produce. A sheet's numbers are scores,
#: weights and coin counts; this keeps every result exact in a float and in
#: JSON, and every operation on it cheap.
MAX_MAGNITUDE = 10**15

#: round()'s digits argument is clamped to this, so it cannot ask for 10**huge.
_MAX_ROUND_DIGITS = 15


# --- tokeniser -----------------------------------------------------------

_TOKEN_RE = re.compile(
    r"""
    (?P<ws>\s+)
  | (?P<number>\d+\.\d+|\d+)
  | (?P<string>'[^']*'|"[^"]*")
  | (?P<name>[A-Za-z_][A-Za-z0-9_]*)
  | (?P<op><=|>=|==|!=|&&|\|\||[-+*/%<>(),?:.])
    """,
    re.VERBOSE,
)

# Word operators are tokenised as names, then promoted here. Keeping them out of
# the regex means `android` does not tokenise as `and` + `roid`.
_WORD_OPS = {"and": "&&", "or": "||", "not": "not"}
_KEYWORDS = {"true": True, "false": False, "null": None}


def _tokenise(source: str) -> list[tuple[str, Any]]:
    tokens: list[tuple[str, Any]] = []
    pos = 0
    length = len(source)
    while pos < length:
        match = _TOKEN_RE.match(source, pos)
        if not match:
            raise ExpressionError(f"Unexpected character {source[pos]!r} at {pos}")
        pos = match.end()
        kind = match.lastgroup
        text = match.group()
        if kind == "ws":
            continue
        if kind == "number":
            if len(text) > MAX_NUMBER_LENGTH:
                raise ExpressionError(f"Number at {match.start()} is too long")
            tokens.append(("num", float(text) if "." in text else int(text)))
        elif kind == "string":
            tokens.append(("str", text[1:-1]))
        elif kind == "name":
            lowered = text.lower()
            if lowered in _WORD_OPS:
                tokens.append(("op", _WORD_OPS[lowered]))
            elif lowered in _KEYWORDS:
                tokens.append(("lit", _KEYWORDS[lowered]))
            else:
                tokens.append(("name", text))
        else:
            tokens.append(("op", text))
    tokens.append(("end", None))
    return tokens


# --- functions -----------------------------------------------------------
# A closed table. A schema can call these and nothing else: no attribute access,
# no indexing into Python objects, no way to reach a builtin.


def _to_number(value: Any) -> Union[int, float]:
    """Coerce a field value to a number, treating nonsense as 0.

    Sheets are edited in place, so a field is often empty or half-typed. Every
    such state reads as 0 rather than raising, for the reason in the module
    docstring.
    """
    if value is True or value is False:
        return int(value)
    if isinstance(value, float):
        # inf and nan are not numbers a sheet can show or do sums with.
        return value if math.isfinite(value) else 0
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return 0
        try:
            number = float(text) if "." in text else int(text)
        except ValueError:
            return 0
        return number if math.isfinite(number) else 0
    if isinstance(value, (list, dict)):
        return len(value)
    return 0


def _fn_floor(value: Any) -> int:
    return math.floor(_to_number(value))


def _fn_ceil(value: Any) -> int:
    return math.ceil(_to_number(value))


def _fn_round(value: Any, digits: Any = 0) -> Union[int, float]:
    places = max(-_MAX_ROUND_DIGITS, min(_MAX_ROUND_DIGITS, int(_to_number(digits))))
    result = round(_to_number(value), places)
    return int(result) if places == 0 else result


def _fn_abs(value: Any) -> Union[int, float]:
    return abs(_to_number(value))


def _flatten(values: tuple) -> list:
    """Accept min(a, b, c) and min(list) alike.

    `column(equipment, 'qty')` yields a list, and writing `max(column(...))`
    should give the largest quantity rather than the number of rows — which is
    what happened when a list arrived as a single argument and coerced to its
    length.
    """
    flat: list = []
    for value in values:
        flat.extend(value) if isinstance(value, list) else flat.append(value)
    return flat


def _fn_min(*values: Any) -> Union[int, float]:
    return min((_to_number(v) for v in _flatten(values)), default=0)


def _fn_max(*values: Any) -> Union[int, float]:
    return max((_to_number(v) for v in _flatten(values)), default=0)


def _fn_sum(*values: Any) -> Union[int, float]:
    total: Union[int, float] = 0
    for value in values:
        # sum(list) and sum(a, b, c) are both natural to write, so accept both.
        if isinstance(value, list):
            total += sum(_to_number(v) for v in value)
        else:
            total += _to_number(value)
    return total


def _fn_len(value: Any) -> int:
    if isinstance(value, (list, dict, str)):
        return len(value)
    return 0


def _fn_if(condition: Any, when_true: Any, when_false: Any) -> Any:
    return when_true if _truthy(condition) else when_false


def _fn_clamp(value: Any, low: Any, high: Any) -> Union[int, float]:
    return max(_to_number(low), min(_to_number(high), _to_number(value)))


def _fn_signed(value: Any) -> str:
    """Format a modifier the way a character sheet prints one: +3, -1, +0."""
    number = _to_number(value)
    return f"+{number}" if number >= 0 else str(number)


#: A joined string is capped, so a formula cannot build something enormous out
#: of a long list field.
MAX_CONCAT_LENGTH = 1000


def _fn_concat(*values: Any) -> str:
    """Join values as text — `concat(level, 'd', ref(klass, 'hit_die'))` is "5d8".

    `+` stays arithmetic, so a sheet adding two text-typed numbers still gets a
    sum; building a string is this function's job and nothing else's. A whole
    number prints without a trailing `.0`, and an empty value prints as nothing.
    """
    parts = []
    for value in values:
        if value is None or value is False:
            continue
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        parts.append(str(value))
    return "".join(parts)[:MAX_CONCAT_LENGTH]


# --- list functions ------------------------------------------------------
# A `list` field is a list of row dicts, so these read a column out of every
# row. The column name arrives as a *string* — `count_where(equipment,
# 'equipped', true)` — rather than as a bare name, because a bare name would
# resolve against the character before the function ever saw it.


def _rows(value: Any) -> list:
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _fn_count_where(rows: Any, column: Any, expected: Any = True) -> int:
    """How many rows have `column` equal to `expected` (default: truthy)."""
    key = str(column)
    return sum(1 for row in _rows(rows) if _equal(row.get(key), expected))


def _fn_sum_where(rows: Any, column: Any, where: Any = None, expected: Any = True) -> Any:
    """Total of `column` across rows, optionally only those matching `where`."""
    key = str(column)
    filter_key = None if where is None else str(where)
    total: Union[int, float] = 0
    for row in _rows(rows):
        if filter_key is not None and not _equal(row.get(filter_key), expected):
            continue
        total += _to_number(row.get(key))
    return total


def _fn_any_where(rows: Any, column: Any, expected: Any = True) -> bool:
    key = str(column)
    return any(_equal(row.get(key), expected) for row in _rows(rows))


def _fn_column(rows: Any, column: Any) -> list:
    """Every value of one column, for passing to sum()/min()/max()."""
    key = str(column)
    return [row.get(key) for row in _rows(rows)]


def _fn_contains(haystack: Any, needle: Any) -> bool:
    """Whether a multiselect (or any list) holds a value, or text contains it."""
    if isinstance(haystack, list):
        return any(_equal(item, needle) for item in haystack)
    if isinstance(haystack, str):
        return str(needle).strip().lower() in haystack.lower()
    return False


# --- catalog functions ---------------------------------------------------
# A `content_ref`/`content_list` value is a reference — {_ref, _source, _per} —
# not a copy of the entry. To read an entry's own properties a formula needs the
# resolved entry, which `compute_values` puts in the context under `_entries`
# keyed by entry id. Without it these fall back to the reference's own data, so
# a formula still evaluates (to 0/empty) rather than failing.


def _resolved(value: Any, entries: Any) -> list[dict]:
    """Every entry a reference or list of references points at."""
    items = value if isinstance(value, list) else [value]
    table = entries if isinstance(entries, dict) else {}
    out = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("_inline"):
            # A freeform entry's per-entry notes count as much as a picked
            # one's - a custom item's quantity, a homebrew spell marked prepared.
            out.append({**item, **(item.get("_per") or {})})
            continue
        entry = table.get(str(item.get("_ref")))
        if isinstance(entry, dict):
            # The character's own per-entry notes win over the catalog's, so
            # `ref(spells, 'prepared')` reads what the player set.
            out.append({**entry, **(item.get("_per") or {})})
    return out


def _fn_ref(value: Any, prop: Any, entries: Any = None) -> Any:
    """One property of a single reference — `ref(klass, 'hit_die')`.

    Missing reads as ``""`` rather than 0, for both an unpicked reference and a
    property the entry does not carry. Empty string coerces to 0 in arithmetic,
    so `ref(klass, 'hit_die') + 1` is unaffected — but `ref(klass, 'x') != ''`
    now answers correctly, where a 0 default made every empty reference look
    like a non-empty string.
    """
    found = _resolved(value, entries)
    if not found:
        return ""
    value_found = found[0].get(str(prop), "")
    return "" if value_found is None else value_found


def _fn_sum_refs(value: Any, prop: Any, entries: Any = None) -> Union[int, float]:
    """Total one property across every referenced entry."""
    return sum(_to_number(entry.get(str(prop))) for entry in _resolved(value, entries))


def _fn_has_ref(value: Any, entry_id: Any) -> bool:
    """Whether a list holds a reference to one entry id."""
    items = value if isinstance(value, list) else [value]
    wanted = str(entry_id).strip().lower()
    return any(
        isinstance(item, dict) and str(item.get("_ref", "")).strip().lower() == wanted
        for item in items
    )


def _fn_sum_qty(value: Any, column: Any, qty: Any = "qty", entries: Any = None) -> Any:
    """Total of a column times each row's quantity - carried weight, cargo mass.

    Reads a `list` field's rows, or the entries a `content_list` picks (with the
    character's per-entry quantity on top). A row whose quantity is blank counts
    once, since an item listed without a count is one item; a quantity of 0
    counts as none.
    """
    key, qty_key = str(column), str(qty)
    rows = value if isinstance(value, list) else []
    if any(isinstance(row, dict) and ("_ref" in row or row.get("_inline")) for row in rows):
        rows = _resolved(rows, entries)
    total: Union[int, float] = 0
    for row in _rows(rows):
        count = row.get(qty_key)
        multiplier = 1 if count is None or str(count).strip() == "" else _to_number(count)
        total += _to_number(row.get(key)) * multiplier
    return total


def _fn_count_refs(value: Any, prop: Any = None, expected: Any = True,
                   entries: Any = None) -> int:
    """How many references there are, or how many match a property."""
    if prop is None:
        items = value if isinstance(value, list) else []
        return sum(1 for item in items if isinstance(item, dict))
    key = str(prop)
    return sum(
        1 for entry in _resolved(value, entries) if _equal(entry.get(key), expected)
    )


FUNCTIONS: dict[str, Callable[..., Any]] = {
    "floor": _fn_floor,
    "ceil": _fn_ceil,
    "round": _fn_round,
    "abs": _fn_abs,
    "min": _fn_min,
    "max": _fn_max,
    "sum": _fn_sum,
    "len": _fn_len,
    "if": _fn_if,
    "clamp": _fn_clamp,
    "signed": _fn_signed,
    "concat": _fn_concat,
    "count_where": _fn_count_where,
    "sum_where": _fn_sum_where,
    "any_where": _fn_any_where,
    "column": _fn_column,
    "contains": _fn_contains,
    "ref": _fn_ref,
    "sum_refs": _fn_sum_refs,
    "has_ref": _fn_has_ref,
    "count_refs": _fn_count_refs,
    "sum_qty": _fn_sum_qty,
}

#: Functions that read resolved catalog entries. `_eval_node` passes the table
#: to these as a keyword, so a schema author never writes it and the function's
#: own parameter defaults still apply.
_ENTRY_AWARE: frozenset = frozenset({"ref", "sum_refs", "count_refs", "sum_qty"})


def _truthy(value: Any) -> bool:
    """Truthiness, with the sheet-shaped exception that "0" is false."""
    if isinstance(value, str):
        text = value.strip()
        return bool(text) and text not in ("0", "false", "False")
    if isinstance(value, (list, dict)):
        return bool(value)
    return bool(_to_number(value)) if isinstance(value, (int, float, bool)) else bool(value)


# --- parser --------------------------------------------------------------
# Precedence climbing, loosest binding first. Each level returns an AST node:
# a tuple whose first element names the node type.

_COMPARISONS = {"==", "!=", "<", "<=", ">", ">="}


class _Parser:
    def __init__(self, tokens: list[tuple[str, Any]]):
        self.tokens = tokens
        self.pos = 0
        self.depth = 0

    def descend(self) -> None:
        """Count one level of nesting, refusing past MAX_EXPRESSION_DEPTH."""
        self.depth += 1
        if self.depth > MAX_EXPRESSION_DEPTH:
            raise ExpressionError(
                f"Expression is nested more than {MAX_EXPRESSION_DEPTH} levels deep"
            )

    def peek(self) -> tuple[str, Any]:
        return self.tokens[self.pos]

    def take(self) -> tuple[str, Any]:
        token = self.tokens[self.pos]
        self.pos += 1
        return token

    def expect_op(self, op: str) -> None:
        kind, value = self.take()
        if kind != "op" or value != op:
            raise ExpressionError(f"Expected {op!r}, found {value!r}")

    def at_op(self, *ops: str) -> bool:
        kind, value = self.peek()
        return kind == "op" and value in ops

    # conditional  →  or  [ '?' expr ':' expr ]
    def parse_expression(self) -> tuple:
        # Every nested sub-expression (parentheses, call arguments, conditional
        # branches) comes back through here, so this is where depth is counted.
        self.descend()
        try:
            condition = self.parse_or()
            if self.at_op("?"):
                self.take()
                when_true = self.parse_expression()
                self.expect_op(":")
                when_false = self.parse_expression()
                return ("cond", condition, when_true, when_false)
            return condition
        finally:
            self.depth -= 1

    def parse_or(self) -> tuple:
        node = self.parse_and()
        while self.at_op("||"):
            self.take()
            node = ("or", node, self.parse_and())
        return node

    def parse_and(self) -> tuple:
        node = self.parse_not()
        while self.at_op("&&"):
            self.take()
            node = ("and", node, self.parse_not())
        return node

    def parse_not(self) -> tuple:
        if self.at_op("not"):
            self.take()
            self.descend()
            try:
                return ("not", self.parse_not())
            finally:
                self.depth -= 1
        return self.parse_comparison()

    def parse_comparison(self) -> tuple:
        node = self.parse_additive()
        while self.at_op(*_COMPARISONS):
            _, op = self.take()
            node = ("compare", op, node, self.parse_additive())
        return node

    def parse_additive(self) -> tuple:
        node = self.parse_multiplicative()
        while self.at_op("+", "-"):
            _, op = self.take()
            node = ("binary", op, node, self.parse_multiplicative())
        return node

    def parse_multiplicative(self) -> tuple:
        node = self.parse_unary()
        while self.at_op("*", "/", "%"):
            _, op = self.take()
            node = ("binary", op, node, self.parse_unary())
        return node

    def parse_unary(self) -> tuple:
        if self.at_op("-", "+"):
            _, op = self.take()
            self.descend()
            try:
                operand = self.parse_unary()
            finally:
                self.depth -= 1
            return ("neg", operand) if op == "-" else operand
        return self.parse_primary()

    def parse_primary(self) -> tuple:
        kind, value = self.take()

        if kind == "num" or kind == "str" or kind == "lit":
            return ("const", value)

        if kind == "op" and value == "(":
            node = self.parse_expression()
            self.expect_op(")")
            return node

        if kind == "name":
            if self.at_op("("):
                self.take()
                args = []
                if not self.at_op(")"):
                    args.append(self.parse_expression())
                    while self.at_op(","):
                        self.take()
                        args.append(self.parse_expression())
                self.expect_op(")")
                name = value.lower()
                if name not in FUNCTIONS:
                    raise ExpressionError(f"Unknown function {value!r}")
                return ("call", name, args)
            # A dotted path reads one key out of a nested field value. It is a
            # path, not attribute access — the walker only ever indexes dicts.
            path = [value]
            while self.at_op("."):
                self.take()
                next_kind, next_value = self.take()
                if next_kind != "name":
                    raise ExpressionError("Expected a name after '.'")
                path.append(next_value)
            return ("name", path)

        raise ExpressionError(f"Unexpected {value!r} in expression")


def parse(source: str) -> tuple:
    """Parse an expression to an AST, raising ExpressionError if it is not valid."""
    if not isinstance(source, str) or not source.strip():
        raise ExpressionError("Expression is empty")
    parser = _Parser(_tokenise(source))
    node = parser.parse_expression()
    kind, value = parser.peek()
    if kind != "end":
        raise ExpressionError(f"Unexpected trailing {value!r}")
    return node


# --- evaluation ----------------------------------------------------------


def _lookup(path: list[str], context: dict) -> Any:
    """Read a dotted path out of the context, missing keys reading as 0."""
    current: Any = context
    for key in path:
        if isinstance(current, dict):
            current = current.get(key)
        else:
            return 0
        if current is None:
            return 0
    return current


def _compare(op: str, left: Any, right: Any) -> bool:
    # Equality compares values as written so `race == 'elf'` works; the ordering
    # operators are numeric, because that is the only thing a sheet orders.
    if op == "==":
        return _equal(left, right)
    if op == "!=":
        return not _equal(left, right)
    a, b = _to_number(left), _to_number(right)
    if op == "<":
        return a < b
    if op == "<=":
        return a <= b
    if op == ">":
        return a > b
    return a >= b


def _equal(left: Any, right: Any) -> bool:
    if isinstance(left, str) or isinstance(right, str):
        # One side being text means a text comparison was intended; compare
        # case-insensitively so `race == 'Elf'` matches a stored "elf".
        return str(left).strip().lower() == str(right).strip().lower()
    return _to_number(left) == _to_number(right)


def _bounded(value: Any) -> Any:
    """``value``, unless it is a number past MAX_MAGNITUDE or not finite."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    if isinstance(value, float) and not math.isfinite(value):
        raise ExpressionError("Result is not a finite number")
    if abs(value) > MAX_MAGNITUDE:
        raise ExpressionError("Result is too large")
    return value


def _eval_node(node: tuple, context: dict) -> Any:
    kind = node[0]

    if kind == "const":
        return node[1]
    if kind == "name":
        return _lookup(node[1], context)
    if kind == "neg":
        return _bounded(-_to_number(_eval_node(node[1], context)))
    if kind == "not":
        return not _truthy(_eval_node(node[1], context))
    if kind == "and":
        return _truthy(_eval_node(node[1], context)) and _truthy(
            _eval_node(node[2], context)
        )
    if kind == "or":
        return _truthy(_eval_node(node[1], context)) or _truthy(
            _eval_node(node[2], context)
        )
    if kind == "cond":
        branch = node[2] if _truthy(_eval_node(node[1], context)) else node[3]
        return _eval_node(branch, context)
    if kind == "compare":
        return _compare(
            node[1], _eval_node(node[2], context), _eval_node(node[3], context)
        )
    if kind == "call":
        name = node[1]
        args = [_eval_node(arg, context) for arg in node[2]]
        # The catalog functions need the resolved entries to read an entry's own
        # properties. Threading that through as a visible argument would make
        # every formula carry `_entries`, so it is supplied here instead: an
        # author writes `ref(klass, 'hit_die')` and the table arrives behind it.
        kwargs = {}
        if name in _ENTRY_AWARE:
            # By keyword, not by position: padding the skipped parameters with
            # None would override each function's own defaults, which is how
            # `count_refs(spells, 'prepared')` came to count entries whose
            # `prepared` was None rather than True.
            kwargs["entries"] = context.get("_entries")
        try:
            return _bounded(FUNCTIONS[name](*args, **kwargs))
        except ExpressionError:
            raise
        except (TypeError, ValueError):
            # Wrong arity or an argument the function cannot use. A sheet being
            # edited hits this constantly, so it reads as 0 like everything else.
            return 0

    if kind == "binary":
        op = node[1]
        # Operands are bounded too: a field value can arrive larger than any
        # formula could produce, and dividing two such ints overflows a float.
        left = _bounded(_to_number(_eval_node(node[2], context)))
        right = _bounded(_to_number(_eval_node(node[3], context)))
        if op == "+":
            return _bounded(left + right)
        if op == "-":
            return _bounded(left - right)
        if op == "*":
            return _bounded(left * right)
        # Division by zero is routine on a half-filled sheet: see the module
        # docstring. Integer division stays integral so modifiers print cleanly.
        if op == "/":
            if right == 0:
                return 0
            result = left / right
            return _bounded(int(result) if float(result).is_integer() else result)
        if op == "%":
            return 0 if right == 0 else left % right

    raise ExpressionError(f"Unsupported expression node {kind!r}")


#: Everything ``evaluate`` turns into the default value; schema validation
#: catches the same set around ``parse``.
EVALUATION_ERRORS = (
    ExpressionError,
    RecursionError,
    OverflowError,
    ValueError,
    ZeroDivisionError,
)


def evaluate(source: Any, context: dict, default: Any = 0) -> Any:
    """Evaluate an expression against a context of field values.

    Returns ``default`` if the expression cannot be parsed or worked out.
    Callers that need to surface a bad formula (schema validation) should call
    ``parse`` directly.
    """
    try:
        node = source if isinstance(source, tuple) else parse(source)
        return _eval_node(node, context)
    except EVALUATION_ERRORS:
        # ExpressionError covers the bounds above. The rest should be
        # unreachable now, but a formula is stranger-supplied and runs on every
        # sheet render: whatever goes wrong, the sheet still draws.
        return default


def referenced_names(node: tuple) -> set[str]:
    """Every top-level field name an AST reads, for dependency ordering."""
    found: set[str] = set()
    stack: list[Any] = [node]
    while stack:
        current = stack.pop()
        if not isinstance(current, tuple):
            if isinstance(current, list):
                stack.extend(current)
            continue
        if current[0] == "name":
            found.add(current[1][0])
            continue
        stack.extend(current[1:])
    return found
