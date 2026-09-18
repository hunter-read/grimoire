"""The character sheet engine: schemas, expressions, layouts, and evaluation.

Split by concern so no one file carries both the parsing and the policy:

* ``expressions`` — the sandboxed formula language (no eval, ever)
* ``layout_html`` — the allowlisted HTML layout parser
* ``styles`` — the scoped, property-filtered stylesheet filter
* ``schema`` — schema validation and character evaluation, tying the three together

``from backend.services import characters`` gets the whole public surface.
"""
from .expressions import ExpressionError, evaluate, parse, referenced_names
from .layout_html import (
    ALLOWED_TAGS,
    DIRECTIVE_TAGS,
    LayoutHtmlError,
    parse_layout_html,
)
from .schema import (
    COLUMN_TYPES,
    FIELD_TYPES,
    MAX_ROWS,
    SCHEMA_VERSION,
    SchemaError,
    coerce_value,
    compute_values,
    run_validators,
    validate_schema,
    visible_fields,
)
from .styles import ALLOWED_PROPERTIES, StylesError, scope_styles

__all__ = [
    "ExpressionError",
    "evaluate",
    "parse",
    "referenced_names",
    "LayoutHtmlError",
    "parse_layout_html",
    "ALLOWED_TAGS",
    "DIRECTIVE_TAGS",
    "StylesError",
    "scope_styles",
    "ALLOWED_PROPERTIES",
    "SchemaError",
    "validate_schema",
    "compute_values",
    "coerce_value",
    "run_validators",
    "visible_fields",
    "FIELD_TYPES",
    "COLUMN_TYPES",
    "MAX_ROWS",
    "SCHEMA_VERSION",
]
