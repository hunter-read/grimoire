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
from typing import Any, Optional

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
    {
        "text", "number", "textarea", "checkbox", "select", "multiselect", "list",
        # Phase 3: references into the content catalog. `content_ref` is a
        # single pick (a class, a kit); `content_list` is many (spells known).
        # Both store the entry's id, never a copy of it, so an erratum reaches
        # every character built on it.
        "content_ref", "content_list",
    }
)

#: Field types that name a content type and store references to its entries.
_CONTENT_TYPES_FIELDS: frozenset = frozenset({"content_ref", "content_list"})

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
#: `{name}` placeholders in a content type's compact_display template.
_DISPLAY_TOKENS = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
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
    _validate_definition(f"Field {name!r}", name, definition)


def _validate_definition(what: str, name: str, definition: Any) -> None:
    """Validate a field definition, given a caller-chosen description of it.

    Split from `_validate_field` so a nested definition — a `per_entry_fields`
    entry — is checked the same way without having to pass a synthetic name
    through the identifier rule.
    """
    definition = _require_dict(definition, what)

    field_type = definition.get("type", "text")
    if field_type not in FIELD_TYPES:
        allowed = ", ".join(sorted(FIELD_TYPES))
        raise SchemaError(
            f"{what} has unknown type {field_type!r} (expected one of: {allowed})"
        )

    if field_type in _OPTION_TYPES:
        _validate_options(what, definition)
    if field_type == "number":
        _validate_bounds(what, definition)

    if field_type in _CONTENT_TYPES_FIELDS:
        content_type = definition.get("content_type")
        if not isinstance(content_type, str) or not content_type.strip():
            raise SchemaError(
                f"{what} is a {field_type} and needs a 'content_type' naming the "
                "catalog it picks from"
            )
        # Per-entry fields are the character's own notes on a referenced entry —
        # prepared, equipped, uses remaining. They are ordinary field
        # definitions, validated as such.
        per_entry = definition.get("per_entry_fields") or {}
        if not isinstance(per_entry, dict):
            raise SchemaError(f"{what} has a non-object 'per_entry_fields'")
        for per_name, per_definition in per_entry.items():
            if not _NAME_RE.match(str(per_name)):
                raise SchemaError(
                    f"{what} per-entry field {per_name!r} is not a valid identifier"
                )
            _validate_definition(
                f"{what} per-entry field {per_name!r}", per_name, per_definition
            )

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


MAX_CONTENT_TYPES = 50


def _validate_content_type(name: str, definition: Any) -> None:
    """Check one `content_types` entry.

    A content type is a field schema applied to catalog entries rather than to a
    character, so its `fields` are validated exactly as a sheet's are — one
    renderer draws both, and one validator checks both.
    """
    if not _NAME_RE.match(name):
        raise SchemaError(f"Content type {name!r} is not a valid identifier")
    definition = _require_dict(definition, f"Content type {name!r}")
    what = f"Content type {name!r}"

    fields = _require_dict(definition.get("fields", {}), f"{what} 'fields'")
    if not fields:
        raise SchemaError(f"{what} needs at least one field")
    if len(fields) > MAX_FIELDS:
        raise SchemaError(f"{what} has more than {MAX_FIELDS} fields")
    for field_name, field_definition in fields.items():
        if not _NAME_RE.match(str(field_name)):
            raise SchemaError(f"{what} field {field_name!r} is not a valid identifier")
        _validate_definition(f"{what} field {field_name!r}", field_name, field_definition)

    # The entry's "name" — what a reference shows and what the catalog sorts by.
    identity = definition.get("identity_field", "name")
    if identity not in fields:
        raise SchemaError(
            f"{what} identity_field {identity!r} is not one of its fields"
        )

    # Each of these names fields that must exist, so a typo is caught here
    # rather than producing an empty filter sidebar nobody can explain.
    for key in ("sort_default", "search_fields", "filter_fields"):
        names = definition.get(key)
        if names is None:
            continue
        if not isinstance(names, list):
            raise SchemaError(f"{what} {key!r} must be a list of field names")
        unknown = [n for n in names if n not in fields]
        if unknown:
            raise SchemaError(
                f"{what} {key!r} names unknown "
                f"{'fields' if len(unknown) > 1 else 'field'}: {', '.join(map(str, unknown))}"
            )

    display = definition.get("compact_display")
    if display is not None:
        if not isinstance(display, str):
            raise SchemaError(f"{what} compact_display must be a string")
        unknown = [token for token in _DISPLAY_TOKENS.findall(display) if token not in fields]
        if unknown:
            raise SchemaError(
                f"{what} compact_display references unknown "
                f"{'fields' if len(unknown) > 1 else 'field'}: {', '.join(unknown)}"
            )


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

    content_types = _require_dict(document.get("content_types", {}), "'content_types'")
    if len(content_types) > MAX_CONTENT_TYPES:
        raise SchemaError(f"Schema has more than {MAX_CONTENT_TYPES} content types")
    for type_name, type_definition in content_types.items():
        _validate_content_type(type_name, type_definition)

    # A content_ref/content_list must name a catalog that exists, or the picker
    # would open on nothing with no way for the player to know why.
    for field_name, definition in fields.items():
        if not isinstance(definition, dict):
            continue
        if definition.get("type") in _CONTENT_TYPES_FIELDS:
            wanted = definition.get("content_type")
            if wanted not in content_types:
                known = ", ".join(sorted(content_types)) or "none declared"
                raise SchemaError(
                    f"Field {field_name!r} picks from content type {wanted!r}, "
                    f"which the schema does not define (has: {known})"
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

    if field_type == "content_ref":
        return _coerce_ref(definition, value)

    if field_type == "content_list":
        if not isinstance(value, list):
            return []
        refs = [_coerce_ref(definition, item) for item in value[:MAX_ROWS]]
        return [ref for ref in refs if ref]

    return "" if value is None else str(value)


#: Keys a stored reference carries. `_ref` is the catalog entry's id, `_source`
#: the pack it came from (two packs may each define "fireball"), `_per` the
#: character's own notes on it, and `_inline` marks a freeform entry that exists
#: only on this character.
_REF_KEYS = ("_ref", "_source", "_per", "_inline")


def _coerce_ref(definition: dict, value: Any) -> Any:
    """Coerce one catalog reference.

    A reference is stored, never a copy of the entry: an erratum or a homebrew
    edit then reaches every character built on it. The exception is an `_inline`
    entry — something the player typed rather than picked — which has nothing to
    reference and so carries its own values.
    """
    if not isinstance(value, dict):
        # A bare string is read as an entry id, which is what a simple schema
        # or a hand-written import is likely to contain.
        if isinstance(value, str) and value.strip():
            return {"_ref": value.strip()}
        return None

    if value.get("_inline"):
        # Freeform: keep the declared per-entry fields plus a display name, and
        # drop anything else, exactly as a list row is rebuilt from its columns.
        inline: dict[str, Any] = {"_inline": True}
        name = value.get("name")
        inline["name"] = "" if name is None else str(name)
        inline.update(_coerce_per_entry(definition, value.get("_per")))
        per = inline.pop("_per", None)
        if per:
            inline["_per"] = per
        return inline

    entry_id = value.get("_ref")
    if not isinstance(entry_id, str) or not entry_id.strip():
        return None

    ref: dict[str, Any] = {"_ref": entry_id.strip()}
    source = value.get("_source")
    if isinstance(source, str) and source.strip():
        ref["_source"] = source.strip()
    per = _coerce_per_entry(definition, value.get("_per")).get("_per")
    if per:
        ref["_per"] = per
    return ref


def _coerce_per_entry(definition: dict, value: Any) -> dict:
    """Coerce a reference's per-entry fields against their declarations.

    These are the character's own notes on a catalog entry — prepared, equipped,
    uses remaining — so they are coerced like any other field, and a key the
    schema does not declare is dropped.
    """
    declared = definition.get("per_entry_fields") or {}
    if not isinstance(value, dict) or not isinstance(declared, dict) or not declared:
        return {}
    per = {
        key: coerce_value(declared[key], item)
        for key, item in value.items()
        if key in declared
    }
    return {"_per": per} if per else {}


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


def _build_context(document: dict, data: dict, entries: Optional[dict] = None) -> dict:
    """The value of every field, for evaluating formulas and conditions against.

    ``entries`` maps a catalog entry id to the entry itself. It rides in the
    context under ``_entries`` so `ref()` and friends can read a referenced
    entry's own properties; without it those functions return 0, which is what a
    sheet shows before its catalog has loaded.
    """
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
    if entries:
        context["_entries"] = entries
    return context


def compute_values(document: dict, data: dict, entries: Optional[dict] = None) -> dict:
    """Evaluate a schema's computed values against a character's data.

    Computed values may depend on one another, and a schema author should not
    have to declare them in dependency order. Rather than topologically sorting,
    this runs repeated passes until the results stop changing — simpler, and it
    degrades gracefully on a cyclic schema instead of failing to load one.
    """
    computed = document.get("computed") or {}
    if not isinstance(computed, dict) or not computed:
        return {}

    context = _build_context(document, data, entries)

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


def run_validators(document: dict, data: dict, entries: Optional[dict] = None) -> list[dict]:
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

    context = _build_context(document, data, entries)
    context.update(compute_values(document, data, entries))

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


def visible_fields(document: dict, data: dict, entries: Optional[dict] = None) -> dict[str, bool]:
    """Which fields a `visible_if` currently shows, keyed by field name.

    Only fields that declare one appear here; anything absent is always shown.
    The client evaluates this too, so the sheet reacts as you type — this is for
    callers that need the answer server-side.
    """
    fields = document.get("fields") or {}
    context = _build_context(document, data, entries)
    context.update(compute_values(document, data, entries))

    return {
        name: bool(evaluate(definition["visible_if"], context, default=True))
        for name, definition in fields.items()
        if isinstance(definition, dict) and definition.get("visible_if")
    }
