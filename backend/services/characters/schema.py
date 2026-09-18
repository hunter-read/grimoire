"""Validation of a character schema document, and evaluation of a character.

A schema describes a sheet: what fields it has (``fields``), what values derive
from them (``computed``), and how it is drawn (``layout``, or the optional
``layout_html`` + ``styles`` pair). This module is the gate every schema passes
through on the way in, and the engine that turns a character's stored values
into a rendered set of numbers on the way out.

Validation is strict and happens at install time. A schema that names an unknown
field type, writes a formula that will not parse, or puts a ``<script>`` in its
layout is rejected with a message naming the problem — far better than a sheet
that silently draws nothing at 2am mid-session.

Evaluation is forgiving, for the opposite reason: a sheet is edited in place and
is routinely half-filled, so a missing value reads as 0 rather than an error.
"""
import re
from typing import Any

from .expressions import ExpressionError, evaluate, parse, referenced_names
from .layout_html import LayoutHtmlError, parse_layout_html
from .styles import StylesError, scope_styles

__all__ = [
    "SchemaError",
    "FIELD_TYPES",
    "COLUMN_TYPES",
    "validate_schema",
    "compute_values",
    "coerce_value",
    "run_validators",
    "visible_fields",
    "MAX_ROWS",
    "SCHEMA_VERSION",
]


class SchemaError(ValueError):
    """A schema document is not valid."""


#: Distinguishes "this rule could not be evaluated" from "this rule returned a
#: falsey value", which must not be reported the same way.
_UNEVALUATED = object()


SCHEMA_VERSION = "grimoire://character-schema/v1"

#: Every field type the engine renders. Keeping the table closed means an
#: unknown type is caught at install rather than rendering as nothing.
#:
#: `list` holds repeatable rows of typed columns; a column may be any of the
#: scalar types but not another `list`, because a sheet that nests tables two
#: deep has outgrown what a sheet should be doing.
FIELD_TYPES: frozenset = frozenset(
    {"text", "number", "textarea", "checkbox", "select", "multiselect", "list"}
)

#: Types a `list` column may take — the scalars, so no nesting.
COLUMN_TYPES: frozenset = frozenset(
    {"text", "number", "checkbox", "select", "textarea"}
)

#: Types that need `options`.
_OPTION_TYPES: frozenset = frozenset({"select", "multiselect"})

MAX_COLUMNS = 20
MAX_VALIDATORS = 200
#: A list is a person's equipment, not a database table. The cap is well above
#: any real sheet and stops a hostile payload growing a row at a time.
MAX_ROWS = 500

_ID_RE = re.compile(r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$")
_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

MAX_FIELDS = 500
MAX_COMPUTED = 500
#: A computed value may depend on others, so evaluation is iterative. This caps
#: the passes — deeper than any real sheet, and it makes a cyclic schema
#: terminate rather than spin.
MAX_COMPUTE_PASSES = 12


def _require_dict(value: Any, what: str) -> dict:
    if not isinstance(value, dict):
        raise SchemaError(f"{what} must be an object")
    return value


def _validate_options(what: str, definition: dict) -> None:
    options = definition.get("options")
    if not isinstance(options, list) or not options:
        raise SchemaError(f"{what} is a {definition['type']} and needs a non-empty 'options' list")
    for option in options:
        if isinstance(option, dict):
            if "value" not in option:
                raise SchemaError(f"{what} has an option with no 'value'")
        elif not isinstance(option, (str, int, float)):
            raise SchemaError(f"{what} has an option that is not a value or object")


def _validate_bounds(what: str, definition: dict) -> None:
    for bound in ("min", "max"):
        if bound in definition and not isinstance(definition[bound], (int, float)):
            raise SchemaError(f"{what} has a non-numeric {bound!r}")
    low, high = definition.get("min"), definition.get("max")
    if isinstance(low, (int, float)) and isinstance(high, (int, float)) and low > high:
        raise SchemaError(f"{what} has min greater than max")


def _validate_column(field_name: str, index: int, column: Any) -> None:
    column = _require_dict(column, f"Field {field_name!r} column {index}")

    key = column.get("key")
    if not isinstance(key, str) or not _NAME_RE.match(key):
        raise SchemaError(
            f"Field {field_name!r} column {index} needs a 'key' that is a valid "
            "identifier (letters, digits, underscores)"
        )

    what = f"Field {field_name!r} column {key!r}"
    column_type = column.get("type", "text")
    if column_type not in COLUMN_TYPES:
        allowed = ", ".join(sorted(COLUMN_TYPES))
        raise SchemaError(
            f"{what} has unknown type {column_type!r} (expected one of: {allowed})"
        )
    if column_type in _OPTION_TYPES:
        _validate_options(what, {**column, "type": column_type})
    if column_type == "number":
        _validate_bounds(what, column)


def _validate_field(name: str, definition: Any) -> None:
    if not _NAME_RE.match(name):
        raise SchemaError(
            f"Field name {name!r} must start with a letter and contain only "
            "letters, digits, and underscores"
        )
    definition = _require_dict(definition, f"Field {name!r}")

    field_type = definition.get("type", "text")
    if field_type not in FIELD_TYPES:
        allowed = ", ".join(sorted(FIELD_TYPES))
        raise SchemaError(
            f"Field {name!r} has unknown type {field_type!r} (expected one of: {allowed})"
        )

    what = f"Field {name!r}"
    if field_type in _OPTION_TYPES:
        _validate_options(what, definition)
    if field_type == "number":
        _validate_bounds(what, definition)

    if field_type == "list":
        columns = definition.get("columns")
        if not isinstance(columns, list) or not columns:
            raise SchemaError(f"{what} is a list and needs a non-empty 'columns' list")
        if len(columns) > MAX_COLUMNS:
            raise SchemaError(f"{what} has more than {MAX_COLUMNS} columns")
        seen: set = set()
        for index, column in enumerate(columns):
            _validate_column(name, index, column)
            key = column["key"]
            if key in seen:
                raise SchemaError(f"{what} has two columns keyed {key!r}")
            seen.add(key)


def _validate_computed(name: str, definition: Any) -> tuple:
    if not _NAME_RE.match(name):
        raise SchemaError(f"Computed name {name!r} is not a valid identifier")

    formula = definition.get("formula") if isinstance(definition, dict) else definition
    if not isinstance(formula, str) or not formula.strip():
        raise SchemaError(f"Computed {name!r} needs a non-empty 'formula'")

    try:
        return parse(formula)
    except ExpressionError as exc:
        raise SchemaError(f"Computed {name!r} has an invalid formula: {exc}") from exc


def _validate_condition(source: Any, what: str, known: set[str]) -> None:
    """Check a `visible_if` / validator expression parses and names real fields.

    Absent is fine — that means "always". Present but unparseable is not: a
    condition that silently fails would hide a whole block of a sheet with no
    indication why.
    """
    if source is None:
        return
    if not isinstance(source, str) or not source.strip():
        raise SchemaError(f"{what} must be a non-empty expression")
    try:
        ast = parse(source)
    except ExpressionError as exc:
        raise SchemaError(f"{what} is not a valid expression: {exc}") from exc

    unknown = referenced_names(ast) - known
    if unknown:
        raise SchemaError(
            f"{what} references unknown "
            f"{'names' if len(unknown) > 1 else 'name'}: {', '.join(sorted(unknown))}"
        )


def _validate_validator(index: int, validator: Any, known: set[str]) -> None:
    validator = _require_dict(validator, f"Validator {index}")

    rule = validator.get("rule")
    if not isinstance(rule, str) or not rule.strip():
        raise SchemaError(f"Validator {index} needs a non-empty 'rule'")
    _validate_condition(rule, f"Validator {index} rule", known)

    message = validator.get("message")
    if not isinstance(message, str) or not message.strip():
        raise SchemaError(
            f"Validator {index} needs a 'message' — a rule that fires without "
            "saying why is not actionable"
        )

    severity = validator.get("severity", "warning")
    if severity not in ("warning", "error"):
        raise SchemaError(
            f"Validator {index} has severity {severity!r} (expected 'warning' or 'error')"
        )


def _validate_layout(layout: Any, known: set[str]) -> None:
    """Check the JSON layout tree names only fields that exist."""
    if not isinstance(layout, list):
        raise SchemaError("'layout' must be a list of sections")

    for index, section in enumerate(layout):
        section = _require_dict(section, f"Layout section {index}")
        _validate_condition(
            section.get("visible_if"), f"Layout section {index} visible_if", known
        )
        rows = section.get("fields", section.get("rows", []))
        if not isinstance(rows, list):
            raise SchemaError(f"Layout section {index} has a non-list 'fields'")
        for entry in rows:
            name = entry if isinstance(entry, str) else (entry or {}).get("field")
            if isinstance(name, str) and name and name not in known:
                raise SchemaError(f"Layout references unknown field {name!r}")


def validate_schema(document: Any, *, scope: str = "gc-sheet") -> dict:
    """Validate a schema document, returning it normalised.

    The returned document gains two derived keys the renderer uses and the
    author never writes: ``layout_ast`` (the parsed, allowlisted HTML) and
    ``styles_css`` (the filtered, scoped stylesheet). Deriving them here means
    the expensive, security-critical work happens once at install rather than on
    every render, and the client is handed data instead of markup.
    """
    document = _require_dict(document, "Schema")

    schema_id = document.get("id")
    if not isinstance(schema_id, str) or not _ID_RE.match(schema_id):
        raise SchemaError(
            "Schema 'id' must be lowercase letters, digits, and single hyphens "
            "or underscores (e.g. 'dnd-5e')"
        )

    name = document.get("name")
    if not isinstance(name, str) or not name.strip():
        raise SchemaError("Schema 'name' is required")

    fields = _require_dict(document.get("fields", {}), "'fields'")
    if len(fields) > MAX_FIELDS:
        raise SchemaError(f"Schema has more than {MAX_FIELDS} fields")
    for field_name, definition in fields.items():
        _validate_field(field_name, definition)

    computed = _require_dict(document.get("computed", {}), "'computed'")
    if len(computed) > MAX_COMPUTED:
        raise SchemaError(f"Schema has more than {MAX_COMPUTED} computed values")

    overlap = set(fields) & set(computed)
    if overlap:
        raise SchemaError(
            "These names are both a field and a computed value, which is "
            f"ambiguous: {', '.join(sorted(overlap))}"
        )

    known = set(fields) | set(computed)
    asts: dict[str, tuple] = {}
    for computed_name, definition in computed.items():
        ast = _validate_computed(computed_name, definition)
        asts[computed_name] = ast
        unknown = referenced_names(ast) - known
        if unknown:
            raise SchemaError(
                f"Computed {computed_name!r} references unknown "
                f"{'names' if len(unknown) > 1 else 'name'}: {', '.join(sorted(unknown))}"
            )

    # `visible_if` on a field, and on a layout section, is checked with the same
    # rules as a formula: it is the same expression language.
    for field_name, definition in fields.items():
        _validate_condition(
            definition.get("visible_if"), f"Field {field_name!r} visible_if", known
        )

    validators = document.get("validators", [])
    if not isinstance(validators, list):
        raise SchemaError("'validators' must be a list")
    if len(validators) > MAX_VALIDATORS:
        raise SchemaError(f"Schema has more than {MAX_VALIDATORS} validators")
    for index, validator in enumerate(validators):
        _validate_validator(index, validator, known)

    if "layout" in document:
        _validate_layout(document["layout"], known)

    normalised = dict(document)

    layout_html = document.get("layout_html")
    if layout_html is not None:
        try:
            normalised["layout_ast"] = parse_layout_html(layout_html)
        except LayoutHtmlError as exc:
            raise SchemaError(f"Invalid layout_html: {exc}") from exc

    styles = document.get("styles")
    if styles is not None:
        try:
            normalised["styles_css"] = scope_styles(styles, scope)
        except StylesError as exc:
            raise SchemaError(f"Invalid styles: {exc}") from exc

    if "layout" not in document and layout_html is None:
        # Neither layout given: the renderer falls back to listing fields in
        # declaration order, which is a usable sheet for a simple system.
        normalised["layout"] = [{"title": name, "fields": list(fields)}]

    return normalised


# --- character evaluation ------------------------------------------------


def coerce_value(definition: dict, value: Any) -> Any:
    """Coerce a submitted value to its field's type.

    Out-of-range numbers are clamped rather than rejected: the bound is there to
    guide, and refusing to save a character because a temporary buff put a score
    at 21 would lose the player's work.
    """
    field_type = (definition or {}).get("type", "text")

    if field_type == "checkbox":
        if isinstance(value, str):
            return value.strip().lower() in ("true", "1", "yes", "on")
        return bool(value)

    if field_type == "number":
        if value in (None, ""):
            return None
        try:
            number: Any = float(value)
        except (TypeError, ValueError):
            return None
        if float(number).is_integer():
            number = int(number)
        low, high = definition.get("min"), definition.get("max")
        if isinstance(low, (int, float)):
            number = max(low, number)
        if isinstance(high, (int, float)):
            number = min(high, number)
        return number

    if field_type == "select":
        # An unrecognised choice falls back to empty rather than persisting a
        # value the sheet cannot display.
        return value if value in _allowed_options(definition) else ""

    if field_type == "multiselect":
        if not isinstance(value, list):
            return []
        allowed = _allowed_options(definition)
        # Order is the author's, not the order they were clicked in, so a sheet
        # reads the same each time it is opened. Duplicates collapse.
        chosen = {item for item in value if item in allowed}
        return [option for option in _option_values(definition) if option in chosen]

    if field_type == "list":
        return _coerce_rows(definition, value)

    return "" if value is None else str(value)


def _option_values(definition: dict) -> list:
    return [
        option["value"] if isinstance(option, dict) else option
        for option in definition.get("options", [])
    ]


def _allowed_options(definition: dict) -> set:
    return set(_option_values(definition))


def _coerce_rows(definition: dict, value: Any) -> list:
    """Coerce a list field's rows, column by column.

    Every row is rebuilt from the declared columns, so a key the schema does not
    define is dropped rather than stored — the same rule the top-level fields
    follow, and for the same reason: a client must not be able to write
    arbitrary JSON into the row.
    """
    if not isinstance(value, list):
        return []

    columns = definition.get("columns") or []
    rows = []
    for row in value[:MAX_ROWS]:
        if not isinstance(row, dict):
            continue
        clean = {}
        for column in columns:
            key = column.get("key")
            if not key:
                continue
            if key in row:
                clean[key] = coerce_value(column, row[key])
            elif "default" in column:
                clean[key] = coerce_value(column, column["default"])
            else:
                clean[key] = coerce_value(column, None)
        rows.append(clean)
    return rows


#: What a field reads as when the character has no value for it. A list is an
#: empty list rather than 0 so `len(equipment)` is 0 on a new sheet instead of
#: counting a zero.
_EMPTY_BY_TYPE: dict[str, Any] = {
    "text": "",
    "textarea": "",
    "select": "",
    "checkbox": False,
    "multiselect": [],
    "list": [],
}


def _build_context(document: dict, data: dict) -> dict:
    """The value of every field, for evaluating formulas and conditions against."""
    fields = document.get("fields") or {}
    context: dict[str, Any] = {}
    for field_name, definition in fields.items():
        if field_name in data:
            context[field_name] = data[field_name]
        elif isinstance(definition, dict) and "default" in definition:
            context[field_name] = definition["default"]
        else:
            field_type = (definition or {}).get("type", "text")
            context[field_name] = _EMPTY_BY_TYPE.get(field_type, 0)

    # Anything stored that the schema no longer declares still resolves, so a
    # formula referring to a since-renamed field keeps working until it is fixed.
    for key, value in data.items():
        context.setdefault(key, value)
    return context


def compute_values(document: dict, data: dict) -> dict:
    """Evaluate a schema's computed values against a character's data.

    Computed values may depend on one another, and a schema author should not
    have to declare them in dependency order. Rather than topologically sorting,
    this runs repeated passes until the results stop changing — simpler, and it
    degrades gracefully on a cyclic schema instead of failing to load one.
    """
    computed = document.get("computed") or {}
    if not isinstance(computed, dict) or not computed:
        return {}

    context = _build_context(document, data)

    results: dict[str, Any] = {}
    for _ in range(MAX_COMPUTE_PASSES):
        changed = False
        for computed_name, definition in computed.items():
            formula = (
                definition.get("formula") if isinstance(definition, dict) else definition
            )
            value = evaluate(formula, context)
            if results.get(computed_name) != value:
                results[computed_name] = value
                context[computed_name] = value
                changed = True
        if not changed:
            break

    return results


def run_validators(document: dict, data: dict) -> list[dict]:
    """Evaluate a schema's validators against a character.

    Returns the ones that *fired* — a rule states what should be true, so a
    result of false is the problem worth reporting.

    A validator whose expression cannot be evaluated is skipped rather than
    reported: schema validation already rejected unparseable rules at install,
    so reaching here means a stored document drifted, and inventing a warning
    the author never wrote would be worse than staying quiet.
    """
    validators = document.get("validators") or []
    if not isinstance(validators, list) or not validators:
        return []

    context = _build_context(document, data)
    context.update(compute_values(document, data))

    fired = []
    for validator in validators:
        if not isinstance(validator, dict):
            continue
        rule = validator.get("rule")
        if not isinstance(rule, str):
            continue
        # A rule that cannot be evaluated yields the sentinel rather than a
        # falsey 0, so "broken" is distinguishable from "failed".
        outcome = evaluate(rule, context, default=_UNEVALUATED)
        if outcome is _UNEVALUATED or outcome:
            continue
        fired.append(
            {
                "rule": rule,
                "message": validator.get("message", ""),
                "severity": validator.get("severity", "warning"),
                "field": validator.get("field"),
            }
        )
    return fired


def visible_fields(document: dict, data: dict) -> dict[str, bool]:
    """Which fields a `visible_if` currently shows, keyed by field name.

    Only fields that declare one appear here; anything absent is always shown.
    The client evaluates this too, so the sheet reacts as you type — this is for
    callers that need the answer server-side.
    """
    fields = document.get("fields") or {}
    context = _build_context(document, data)
    context.update(compute_values(document, data))

    return {
        name: bool(evaluate(definition["visible_if"], context, default=True))
        for name, definition in fields.items()
        if isinstance(definition, dict) and definition.get("visible_if")
    }
