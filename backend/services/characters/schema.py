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
    "validate_schema",
    "compute_values",
    "coerce_value",
    "SCHEMA_VERSION",
]


class SchemaError(ValueError):
    """A schema document is not valid."""


SCHEMA_VERSION = "grimoire://character-schema/v1"

#: Field types Phase 1 renders. Phase 2 (#130) adds list/multiselect and the
#: rest; keeping the table closed means an unknown type is caught at install
#: rather than rendering as nothing.
FIELD_TYPES: frozenset = frozenset(
    {"text", "number", "textarea", "checkbox", "select"}
)

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

    if field_type == "select":
        options = definition.get("options")
        if not isinstance(options, list) or not options:
            raise SchemaError(f"Field {name!r} is a select and needs a non-empty 'options' list")
        for option in options:
            if isinstance(option, dict):
                if "value" not in option:
                    raise SchemaError(f"Field {name!r} has an option with no 'value'")
            elif not isinstance(option, (str, int, float)):
                raise SchemaError(f"Field {name!r} has an option that is not a value or object")

    if field_type == "number":
        for bound in ("min", "max"):
            if bound in definition and not isinstance(definition[bound], (int, float)):
                raise SchemaError(f"Field {name!r} has a non-numeric {bound!r}")
        low, high = definition.get("min"), definition.get("max")
        if isinstance(low, (int, float)) and isinstance(high, (int, float)) and low > high:
            raise SchemaError(f"Field {name!r} has min greater than max")


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


def _validate_layout(layout: Any, known: set[str]) -> None:
    """Check the JSON layout tree names only fields that exist."""
    if not isinstance(layout, list):
        raise SchemaError("'layout' must be a list of sections")

    for index, section in enumerate(layout):
        section = _require_dict(section, f"Layout section {index}")
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
        allowed = {
            option["value"] if isinstance(option, dict) else option
            for option in definition.get("options", [])
        }
        # An unrecognised choice falls back to empty rather than persisting a
        # value the sheet cannot display.
        return value if value in allowed else ""

    return "" if value is None else str(value)


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

    fields = document.get("fields") or {}
    context: dict[str, Any] = {}
    for field_name, definition in fields.items():
        if field_name in data:
            context[field_name] = data[field_name]
        elif isinstance(definition, dict) and "default" in definition:
            context[field_name] = definition["default"]
        else:
            context[field_name] = "" if definition.get("type") == "text" else 0

    # Anything stored that the schema no longer declares still resolves, so a
    # formula referring to a since-renamed field keeps working until it is fixed.
    for key, value in data.items():
        context.setdefault(key, value)

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
