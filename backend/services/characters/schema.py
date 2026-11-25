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
import math
import re
from typing import Any, Optional

from .expressions import (
    EVALUATION_ERRORS,
    each_work_budget,
    each_work_refusals,
    evaluate,
    parse,
    referenced_names,
)
from .layout_html import LayoutHtmlError, parse_layout_html
from .styles import StylesError, scope_styles

__all__ = [
    "SchemaError",
    "FIELD_TYPES",
    "COLUMN_TYPES",
    "validate_schema",
    "validate_content_types",
    "compute_values",
    "computed_overrides",
    "OVERRIDES_KEY",
    "coerce_value",
    "run_validators",
    "visible_fields",
    "MAX_ROWS",
    "SCHEMA_VERSION",
    "IMAGE_VALUE_RE",
    "image_fields",
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
        # A picture the player uploads - a coat of arms, a ship's silhouette.
        # The value is the stored file's name; the bytes live on disk beside
        # the portrait, never in the sheet's JSON.
        "image",
    }
)

#: Field types that name a content type and store references to its entries.
_CONTENT_TYPES_FIELDS: frozenset = frozenset({"content_ref", "content_list"})

#: Types a `list` column may take — the scalars, so no nesting.
COLUMN_TYPES: frozenset = frozenset(
    {"text", "number", "checkbox", "select", "textarea"}
)

#: An image field's stored value: the field's name, a random token that changes
#: with every upload (so it doubles as the cache-buster), and the extension.
#: Field names never contain a hyphen, so the name is unambiguous.
IMAGE_VALUE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*-[0-9a-f]{16}\.(?:png|jpg|webp|gif)$")

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

#: Bounds on a sheet's size. Traveller is the yardstick: a check DM for each of
#: some 130 skills against six characteristics is about a thousand computed
#: values, and the 512 KiB document cap still bounds what a payload can carry.
MAX_FIELDS = 1000
MAX_COMPUTED = 1500
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
    if not isinstance(column_type, str) or column_type not in COLUMN_TYPES:
        allowed = ", ".join(sorted(COLUMN_TYPES))
        raise SchemaError(
            f"{what} has unknown type {column_type!r} (expected one of: {allowed})"
        )
    if column_type in _OPTION_TYPES:
        _validate_options(what, {**column, "type": column_type})
    if column_type == "number":
        _validate_bounds(what, column)

    if "default_from" in column:
        # The names it reads are checked in `validate_schema`, which knows the
        # sheet's fields; here only its shape.
        formula = column["default_from"]
        if not isinstance(formula, str) or not formula.strip():
            raise SchemaError(f"{what} default_from must be a non-empty expression")
        if column_type == "checkbox":
            # An unticked box is stored as false, so there is no empty cell to
            # tell "not set yet" from "set to no".
            raise SchemaError(
                f"{what} is a checkbox and cannot have a default_from: an "
                "unticked box is a value the player chose"
            )


def _derived_columns(definition: Any) -> list[dict]:
    """A list field's columns that work out their value with `default_from`."""
    if not isinstance(definition, dict) or definition.get("type") != "list":
        return []
    return [
        column
        for column in definition.get("columns") or []
        if isinstance(column, dict) and column.get("default_from")
    ]


def _validate_field(name: str, definition: Any) -> None:
    if not _NAME_RE.match(name):
        raise SchemaError(
            f"Field name {name!r} must start with a letter and contain only "
            "letters, digits, and underscores"
        )
    _validate_definition(f"Field {name!r}", name, definition, allow_image=True)


def _validate_definition(
    what: str, name: str, definition: Any, *, allow_image: bool = False
) -> None:
    """Validate a field definition, given a caller-chosen description of it.

    Split from `_validate_field` so a nested definition — a `per_entry_fields`
    entry — is checked the same way without having to pass a synthetic name
    through the identifier rule.

    ``allow_image`` is only set for a character's own top-level fields. An image
    is a file stored against one character, so a catalog entry's property or a
    per-entry note has nowhere for its bytes to live.
    """
    definition = _require_dict(definition, what)

    field_type = definition.get("type", "text")
    if not isinstance(field_type, str) or field_type not in FIELD_TYPES:
        allowed = ", ".join(sorted(FIELD_TYPES))
        raise SchemaError(
            f"{what} has unknown type {field_type!r} (expected one of: {allowed})"
        )

    if field_type == "image":
        if not allow_image:
            raise SchemaError(
                f"{what} is an image, which only a character's own fields can be"
            )
        # The value is a file the player uploads; there is nothing a default
        # could name.
        for key in ("default", "default_from"):
            if key in definition:
                raise SchemaError(f"{what} is an image and cannot have a {key!r}")

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


#: Rules one pick may carry. A pick is one player action, so this is generous.
MAX_ON_PICK_RULES = 20
#: The most a `choose` rule may ask for in one go.
MAX_CHOOSE_COUNT = 20
#: Where each `on_pick` verb may write. `grant` adds to a multiselect or a
#: content list; `choose` asks the player to pick from options, so it needs a
#: target with options to check the picks against.
_GRANT_TARGETS: frozenset = frozenset({"multiselect", "content_list"})
_CHOOSE_TARGETS: frozenset = frozenset({"multiselect"})


def _validate_on_pick(
    field_name: str,
    definition: dict,
    fields: dict,
    content_types: dict,
    prompts: frozenset | set = frozenset(),
) -> None:
    """Check a content_ref's `on_pick` rules.

    `on_pick` is what makes a choice *do* something: picking a background
    grants its skills and origin feat, picking a class asks for its skill
    choices. The rules are data - a target field and the picked entry's
    property to read - so they are checked here the way formulas are: a typo in
    a property name would otherwise grant nothing, with no sign of why.
    """
    what = f"Field {field_name!r} on_pick"
    if definition.get("type") != "content_ref":
        raise SchemaError(f"{what} only applies to a content_ref field")
    rules = definition["on_pick"]
    if not isinstance(rules, list):
        raise SchemaError(f"{what} must be a list of rules")
    if len(rules) > MAX_ON_PICK_RULES:
        raise SchemaError(f"{what} has more than {MAX_ON_PICK_RULES} rules")

    picked = content_types.get(definition.get("content_type")) or {}
    properties = set((picked.get("fields") or {}))

    def _property(rule: dict, key: str, index: int, required: bool = True) -> None:
        value = rule.get(key)
        if value is None and not required:
            return
        if not isinstance(value, str) or not value:
            raise SchemaError(f"{what} rule {index} needs a {key!r} property name")
        if value not in properties:
            raise SchemaError(
                f"{what} rule {index} reads {value!r}, which the "
                f"{definition.get('content_type')!r} content type does not declare"
            )

    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise SchemaError(f"{what} rule {index} must be an object")
        verbs = [verb for verb in ("grant", "choose", "prompt") if verb in rule]
        if len(verbs) != 1:
            raise SchemaError(
                f"{what} rule {index} needs exactly one of 'grant', 'choose' or 'prompt'"
            )
        verb = verbs[0]
        target = rule[verb]
        if verb == "prompt":
            # Opens one of the sheet's prompts, reading the picked entry as `row`.
            if not isinstance(target, str) or target not in prompts:
                raise SchemaError(f"{what} rule {index} opens unknown prompt {target!r}")
            continue
        if not isinstance(target, str) or target not in fields:
            raise SchemaError(f"{what} rule {index} targets unknown field {target!r}")
        if target == field_name:
            raise SchemaError(f"{what} rule {index} cannot target its own field")
        target_type = (fields[target] or {}).get("type", "text")

        if verb == "grant":
            if target_type not in _GRANT_TARGETS:
                raise SchemaError(
                    f"{what} rule {index} grants into {target!r}, a {target_type}; "
                    "it must be a multiselect or a content_list"
                )
            if target_type == "multiselect":
                _property(rule, "from", index)
            elif "from" in rule:
                # Several entries at once - a species' traits. `from` lists
                # entry ids; `names`, a list in the same order, is what each
                # falls back to when the catalog has no such id.
                _property(rule, "from", index)
                _property(rule, "names", index, required=False)
            else:
                # A content list is granted a reference by id, falling back to
                # a named entry when the catalog has no such id.
                _property(rule, "ref", index, required="name" not in rule)
                _property(rule, "name", index, required="ref" not in rule)
            carry = rule.get("carry")
            if carry is not None:
                # Values copied from the picked entry onto a granted freeform
                # entry - the species' name as each trait's source.
                target_fields = set(
                    (content_types.get((fields[target] or {}).get("content_type")) or {})
                    .get("fields") or {}
                )
                if target_type != "content_list" or not isinstance(carry, dict):
                    raise SchemaError(f"{what} rule {index} carry needs a content_list target")
                for to_key, from_key in carry.items():
                    if to_key not in target_fields:
                        raise SchemaError(
                            f"{what} rule {index} carries into {to_key!r}, which the "
                            "target's content type does not declare"
                        )
                    if from_key not in properties:
                        raise SchemaError(
                            f"{what} rule {index} carries {from_key!r}, which the "
                            f"{definition.get('content_type')!r} content type does not declare"
                        )
            continue

        if target_type not in _CHOOSE_TARGETS:
            raise SchemaError(
                f"{what} rule {index} asks for a choice into {target!r}, a "
                f"{target_type}; it must be a multiselect"
            )
        _property(rule, "from", index)
        count = rule.get("count", 1)
        if isinstance(count, str):
            _property(rule, "count", index)
        elif isinstance(count, bool) or not isinstance(count, int) or not (
            1 <= count <= MAX_CHOOSE_COUNT
        ):
            raise SchemaError(
                f"{what} rule {index} count must be 1-{MAX_CHOOSE_COUNT} or a property name"
            )
        label = rule.get("label")
        if label is not None and (not isinstance(label, str) or len(label) > 200):
            raise SchemaError(f"{what} rule {index} label must be text under 200 characters")


#: Buttons a sheet may declare, and the steps one press may take. A rest resets
#: a few dozen counters at most; the caps only stop a hostile payload.
MAX_ACTIONS = 30
MAX_ACTION_STEPS = 50
MAX_ACTION_LABEL = 80
MAX_ACTION_CONFIRM = 300
#: Inside an `each` step, the name a formula reads the current row by.
ACTION_ROW_NAME = "row"
#: What a `set` step may write: one stored value. A list is changed row by row
#: with `each` and `append`; a content pick goes through the picker, so its
#: `on_pick` rules run; an image is an upload.
_ACTION_SET_TYPES: frozenset = frozenset({"text", "number", "textarea", "checkbox", "select"})

#: Prompts a sheet may declare: windows that ask the player a few questions -
#: hit points, an ability increase or a feat - and write the answers.
MAX_PROMPTS = 30
MAX_PROMPT_STEPS = 20
MAX_PROMPT_LABEL = 200
#: The most options a `choose`/`distribute`/`select` step may list by hand.
MAX_PROMPT_OPTIONS = 100
#: What a prompt's formulas read besides the sheet: the answers given so far,
#: the entry whose pick opened the prompt, and - inside an `entry` step's
#: `filter` - the catalog entry being considered.
PROMPT_ANSWER_NAME = "answer"
PROMPT_ROW_NAME = "row"
PROMPT_ENTRY_NAME = "entry"
_PROMPT_STEP_TYPES: frozenset = frozenset({"choose", "distribute", "entry", "number", "select"})
_PATTERN_RE = re.compile(r"^\d{1,2}(,\d{1,2}){0,9}$")


def _validate_formula(source: Any, what: str, known: set[str], images: frozenset) -> None:
    if not isinstance(source, str) or not source.strip():
        raise SchemaError(f"{what} must be a non-empty expression")
    _validate_condition(source, what, known, images)


def _validate_label(value: Any, what: str, limit: int, required: bool = True) -> None:
    if value is None and not required:
        return
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise SchemaError(f"{what} needs a 'label' under {limit} characters")


def _validate_write_steps(
    steps: Any,
    what: str,
    fields: dict,
    known: set[str],
    images: frozenset,
    *,
    prompts: set[str],
    prompt_verbs: bool = False,
    content_types: dict | None = None,
    may_open_prompts: bool = True,
) -> None:
    """Check a list of writes, as an action's `steps` or a prompt's `apply`.

    - `{"set": field, "to": formula}` writes one field.
    - `{"each": list, "where": condition, "set": {column: formula}}` writes
      columns of the rows `where` picks (every row without it), with `row`
      naming the row - a list's columns, or a content_list's per-entry fields.
    - `{"append": list, "values": {column: formula}}` adds a row to a list.
    - `{"prompt": name}` opens one of the sheet's prompts once the writes are
      made.

    A prompt's `apply` may also:

    - `{"add": multiselect, "values": formula}` add the values a formula lists
      to a multiselect, skipping any it already has;
    - `{"pick": content field, "entry": formula, "values": {field: formula}}`
      put the entry a formula names (an `entry` step's answer) in a content_ref
      or a new row of a content_list, with its per-entry fields, and follow
      its `on_pick` as a pick by hand;
    - `{"unpick": content_list, "entry": formula}` take out of a content_list
      the row of the entry a formula names (an `entry` step's answer), as a
      row removed by hand, so what its `on_pick` granted goes with it - an
      option given up for another;
    - `{"grant": field, "from": formula, "names": formula, "carry": {key:
      formula}, "source": field}` grant as an `on_pick` rule does, its
      properties worked out by formulas - a level's class features. `from`
      lists ids (or a multiselect's values); `names`, in the same order, are
      what each falls back to when the catalog has no such id; `carry` sets
      values on those freeform entries. What it adds is recorded under
      `source` (a content_ref with `on_pick`, so picking another class there
      takes it back), or else under the pick that opened the prompt.
    """
    if not isinstance(steps, list) or not steps:
        raise SchemaError(f"{what} must be a non-empty list of steps")
    if len(steps) > MAX_ACTION_STEPS:
        raise SchemaError(f"{what} has more than {MAX_ACTION_STEPS} steps")

    def _row_keys(target: str, where: str, *, appendable: bool) -> set[str]:
        found = fields.get(target)
        definition: dict = found if isinstance(found, dict) else {}
        field_type = definition.get("type", "text") if isinstance(found, dict) else None
        allowed = ("list",) if appendable else ("list", "content_list")
        if field_type not in allowed:
            kinds = "a list" if appendable else "a list or a content_list"
            raise SchemaError(f"{where} targets {target!r}, which is not {kinds}")
        if field_type == "list":
            return {
                column["key"]
                for column in definition.get("columns") or []
                if isinstance(column, dict) and isinstance(column.get("key"), str)
            }
        return set(definition.get("per_entry_fields") or {})

    def _cells(values: Any, keys: set[str], target: str, where: str, names_known: set[str]) -> None:
        if not isinstance(values, dict) or not values:
            raise SchemaError(f"{where} needs an object of column formulas")
        for key, source in values.items():
            if key not in keys:
                raise SchemaError(f"{where} writes {key!r}, which {target!r} does not have")
            _validate_formula(source, f"{where} {key!r}", names_known, images)

    # An `on_skip` only writes: it runs because a prompt was put aside, so it
    # opens none of its own.
    verbs_allowed = (
        ["each", "append"]
        + (["prompt"] if may_open_prompts else [])
        + (["add", "pick", "unpick", "grant"] if prompt_verbs else [])
    )
    for step_index, step in enumerate(steps):
        step = _require_dict(step, f"{what} step {step_index}")
        where = f"{what} step {step_index}"
        verbs = [verb for verb in verbs_allowed if verb in step]
        if len(verbs) > 1 or (not verbs and "set" not in step):
            names = ", ".join(repr(verb) for verb in ["set", *verbs_allowed])
            raise SchemaError(f"{where} needs exactly one of {names}")
        verb = verbs[0] if verbs else "set"
        target = step[verb]

        if verb == "prompt":
            if not isinstance(target, str) or target not in prompts:
                raise SchemaError(f"{where} opens unknown prompt {target!r}")
            continue
        if not isinstance(target, str) or target not in fields:
            raise SchemaError(f"{where} targets unknown field {target!r}")
        field_type = (fields[target] or {}).get("type", "text")

        if verb == "set":
            if field_type not in _ACTION_SET_TYPES:
                raise SchemaError(
                    f"{where} sets {target!r}, a {field_type}; 'set' writes a single "
                    "value - change a list with 'each' or 'append'"
                )
            _validate_formula(step.get("to"), f"{where} 'to'", known, images)
        elif verb == "each":
            keys = _row_keys(target, where, appendable=False)
            row_known = known | {ACTION_ROW_NAME}
            if "where" in step:
                _validate_formula(step["where"], f"{where} 'where'", row_known, images)
            _cells(step.get("set"), keys, target, f"{where} 'set'", row_known)
        elif verb == "append":
            keys = _row_keys(target, where, appendable=True)
            _cells(step.get("values"), keys, target, f"{where} 'values'", known)
        elif verb == "add":
            if field_type != "multiselect":
                raise SchemaError(f"{where} adds to {target!r}, which is not a multiselect")
            _validate_formula(step.get("values"), f"{where} 'values'", known, images)
        elif verb == "unpick":
            if field_type != "content_list":
                raise SchemaError(f"{where} takes out of {target!r}, which is not a content_list")
            _validate_formula(step.get("entry"), f"{where} 'entry'", known, images)
        elif verb == "grant":
            _validate_prompt_grant(
                step, target, field_type, where, fields, known, images, content_types or {}
            )
        else:
            if field_type not in _CONTENT_TYPES_FIELDS:
                raise SchemaError(
                    f"{where} picks into {target!r}, which is not a content_ref or a content_list"
                )
            _validate_formula(step.get("entry"), f"{where} 'entry'", known, images)
            if "values" in step:
                keys = set((fields[target] or {}).get("per_entry_fields") or {})
                _cells(step["values"], keys, target, f"{where} 'values'", known)


def _validate_prompt_grant(
    step: dict,
    target: str,
    field_type: str,
    where: str,
    fields: dict,
    known: set[str],
    images: frozenset,
    content_types: dict,
) -> None:
    """Check a prompt's `grant` step: an `on_pick` grant whose properties are formulas."""
    if field_type not in _GRANT_TARGETS:
        raise SchemaError(
            f"{where} grants into {target!r}, a {field_type}; it must be a multiselect "
            "or a content_list"
        )
    _validate_formula(step.get("from"), f"{where} 'from'", known, images)
    for key in ("names", "carry"):
        if key in step and field_type != "content_list":
            raise SchemaError(f"{where} {key!r} needs a content_list target")
    if "names" in step:
        _validate_formula(step["names"], f"{where} 'names'", known, images)
    if "carry" in step:
        carry = step["carry"]
        if not isinstance(carry, dict) or not carry:
            raise SchemaError(f"{where} 'carry' must be an object of field: formula")
        # A freeform entry has the fields of the list's content type.
        target_fields = set(
            (content_types.get((fields[target] or {}).get("content_type")) or {}).get("fields")
            or {}
        )
        for key, formula in carry.items():
            if key not in target_fields:
                raise SchemaError(
                    f"{where} carries into {key!r}, which the target's content type "
                    "does not declare"
                )
            _validate_formula(formula, f"{where} 'carry' {key!r}", known, images)
    if "source" in step:
        source = step["source"]
        definition = fields.get(source) if isinstance(source, str) else None
        if (
            not isinstance(definition, dict)
            or definition.get("type") != "content_ref"
            or not definition.get("on_pick")
        ):
            raise SchemaError(
                f"{where} 'source' must name a content_ref field with on_pick, "
                f"not {source!r}"
            )


def _validate_actions(
    actions: Any, fields: dict, known: set[str], images: frozenset, prompts: set[str]
) -> None:
    """Check a sheet's `actions`: named buttons that change several values at once.

    A rest is the example - every "used" counter that recovers on a long rest
    back to nought, hit points to their maximum, death saves cleared. Each step
    is data, as an `on_pick` rule is: a target and a formula, read against the
    sheet as it stands when the button is pressed. Nothing here is about one
    game; an action is only a list of writes the player could make by hand
    (see `_validate_write_steps`).
    """
    if not isinstance(actions, list):
        raise SchemaError("'actions' must be a list")
    if len(actions) > MAX_ACTIONS:
        raise SchemaError(f"Schema has more than {MAX_ACTIONS} actions")

    seen: set[str] = set()
    for index, action in enumerate(actions):
        action = _require_dict(action, f"Action {index}")
        name = action.get("name")
        if not isinstance(name, str) or not _NAME_RE.match(name):
            raise SchemaError(f"Action {index} needs a 'name' that is a valid identifier")
        if name in seen:
            raise SchemaError(f"Two actions are named {name!r}")
        seen.add(name)
        what = f"Action {name!r}"

        _validate_label(action.get("label"), what, MAX_ACTION_LABEL)
        confirm = action.get("confirm")
        if confirm is not None and (
            not isinstance(confirm, str) or not confirm.strip() or len(confirm) > MAX_ACTION_CONFIRM
        ):
            raise SchemaError(f"{what} 'confirm' must be text under {MAX_ACTION_CONFIRM} characters")
        if not isinstance(action.get("steps"), list) or not action.get("steps"):
            raise SchemaError(f"{what} needs a non-empty list of 'steps'")
        _validate_write_steps(action["steps"], what, fields, known, images, prompts=prompts)


def _validate_prompt_options(options: Any, where: str, known: set[str], images: frozenset) -> None:
    """A step's options: a list written out, or a formula that lists them."""
    if isinstance(options, str):
        _validate_formula(options, f"{where} 'options'", known, images)
        return
    if not isinstance(options, list) or not options:
        raise SchemaError(f"{where} needs 'options': a non-empty list or a formula")
    if len(options) > MAX_PROMPT_OPTIONS:
        raise SchemaError(f"{where} lists more than {MAX_PROMPT_OPTIONS} options")
    for option in options:
        value = option.get("value") if isinstance(option, dict) else option
        label = option.get("label", "") if isinstance(option, dict) else ""
        if (
            not isinstance(value, (str, int))
            or isinstance(value, bool)
            or not isinstance(label, str)
        ):
            raise SchemaError(f"{where} options must be text or {{value, label}} objects")


def _validate_start_prompt(
    start: Any, prompt_names: set[str], known: set[str], images: frozenset
) -> None:
    """Check a sheet's `start_prompt`: `{"prompt": name, "when": condition}`.

    The prompt the sheet opens by itself when a character is opened and
    `when` holds - a new character's first level. Put off, it is not kept
    with the prompts a pick opened: it opens again the next time, while
    `when` still holds.
    """
    start = _require_dict(start, "'start_prompt'")
    if start.get("prompt") not in prompt_names:
        raise SchemaError(f"'start_prompt' opens unknown prompt {start.get('prompt')!r}")
    _validate_condition(start.get("when"), "'start_prompt' when", known, images)


def _validate_prompts(
    prompts: Any, fields: dict, known: set[str], images: frozenset, content_types: dict
) -> None:
    """Check a sheet's `prompts`: windows asking the player for a few answers.

    A level gained is the example: the hit points rolled, then an ability
    increase or a feat, the feat picked from the catalog. Each prompt is a
    list of `steps`, one question each, and an `apply` list of writes made
    once the player confirms - the same writes an action makes, reading what
    was answered as `answer.<key>` and the entry whose pick opened the prompt
    as `row`. A step's `visible_if` hides it until an earlier answer calls for
    it, so one prompt can branch.

    Steps, by `type`:

    - `choose`: `count` values from `options` (or the `target` multiselect's),
      leaving out those `target` already has.
    - `distribute`: points spread over `options` in one of the `patterns`
      allowed, each a comma-separated list of amounts ("2", "1,1").
    - `entry`: one catalog entry of `content_type`, narrowed by fixed
      `filters` and a `filter` formula reading the candidate as `entry`.
    - `number`: a number, starting from `default`, with a button for `average`.
    - `select`: one of `options`.

    A step's `label_formula`, when it works out to some text, is shown in
    place of its `label` - the kind of option a class replaces.
    """
    prompts = _require_dict(prompts, "'prompts'")
    if len(prompts) > MAX_PROMPTS:
        raise SchemaError(f"Schema has more than {MAX_PROMPTS} prompts")
    names = set(prompts)
    base = known | {PROMPT_ANSWER_NAME, PROMPT_ROW_NAME}

    for name, prompt in prompts.items():
        if not isinstance(name, str) or not _NAME_RE.match(name):
            raise SchemaError(f"Prompt {name!r} needs a name that is a valid identifier")
        what = f"Prompt {name!r}"
        prompt = _require_dict(prompt, what)
        _validate_label(prompt.get("label"), what, MAX_PROMPT_LABEL)

        steps = prompt.get("steps")
        if not isinstance(steps, list) or not steps:
            raise SchemaError(f"{what} needs a non-empty list of 'steps'")
        if len(steps) > MAX_PROMPT_STEPS:
            raise SchemaError(f"{what} has more than {MAX_PROMPT_STEPS} steps")
        keys: set[str] = set()
        for index, step in enumerate(steps):
            where = f"{what} step {index}"
            step = _require_dict(step, where)
            key = step.get("key")
            if not isinstance(key, str) or not _NAME_RE.match(key):
                raise SchemaError(f"{where} needs a 'key' that is a valid identifier")
            if key in keys:
                raise SchemaError(f"{what} has two steps keyed {key!r}")
            keys.add(key)
            where = f"{what} step {key!r}"
            kind = step.get("type")
            if kind not in _PROMPT_STEP_TYPES:
                allowed = ", ".join(sorted(_PROMPT_STEP_TYPES))
                raise SchemaError(f"{where} needs a 'type': one of {allowed}")
            _validate_label(step.get("label"), where, MAX_PROMPT_LABEL, required=False)
            if "label_formula" in step:
                _validate_formula(step["label_formula"], f"{where} 'label_formula'", base, images)
            _validate_condition(step.get("visible_if"), f"{where} visible_if", base, images)

            if kind == "choose":
                target = step.get("target")
                if target is not None and (
                    not isinstance(target, str)
                    or target not in fields
                    or (fields[target] or {}).get("type") != "multiselect"
                ):
                    raise SchemaError(f"{where} 'target' must name a multiselect field")
                if "options" in step:
                    _validate_prompt_options(step["options"], where, base, images)
                elif target is None:
                    raise SchemaError(f"{where} needs 'options' or a multiselect 'target'")
                count = step.get("count", 1)
                if isinstance(count, str):
                    _validate_formula(count, f"{where} 'count'", base, images)
                elif isinstance(count, bool) or not isinstance(count, int) or not (
                    1 <= count <= MAX_CHOOSE_COUNT
                ):
                    raise SchemaError(f"{where} 'count' must be 1-{MAX_CHOOSE_COUNT} or a formula")
            elif kind == "distribute":
                _validate_prompt_options(step.get("options"), where, base, images)
                patterns = step.get("patterns")
                if (
                    not isinstance(patterns, list)
                    or not patterns
                    or len(patterns) > 10
                    or not all(isinstance(p, str) and _PATTERN_RE.match(p) for p in patterns)
                ):
                    raise SchemaError(
                        f"{where} needs 'patterns': the amounts the points may be spread in, "
                        'such as ["2", "1,1"]'
                    )
            elif kind == "entry":
                content_type = step.get("content_type")
                if not isinstance(content_type, str) or content_type not in content_types:
                    raise SchemaError(f"{where} picks from unknown content type {content_type!r}")
                filters = step.get("filters")
                if filters is not None and (
                    not isinstance(filters, dict)
                    or not all(
                        isinstance(value, (str, int)) and not isinstance(value, bool)
                        for value in filters.values()
                    )
                ):
                    raise SchemaError(f"{where} 'filters' must map properties to fixed values")
                if "filter" in step:
                    _validate_formula(
                        step["filter"], f"{where} 'filter'", base | {PROMPT_ENTRY_NAME}, images
                    )
            elif kind == "number":
                for formula in ("default", "average"):
                    if formula in step:
                        _validate_formula(step[formula], f"{where} {formula!r}", base, images)
                for bound in ("min", "max"):
                    value = step.get(bound)
                    if value is not None and (
                        isinstance(value, bool) or not isinstance(value, (int, float))
                    ):
                        raise SchemaError(f"{where} {bound!r} must be a number")
            else:
                _validate_prompt_options(step.get("options"), where, base, images)

        _validate_write_steps(
            prompt.get("apply"),
            f"{what} 'apply'",
            fields,
            base,
            images,
            prompts=names,
            prompt_verbs=True,
            content_types=content_types,
        )
        # What putting the prompt aside does instead of keeping it for later:
        # a box ticked to open it, unticked again.
        if "on_skip" in prompt:
            _validate_write_steps(
                prompt["on_skip"],
                f"{what} 'on_skip'",
                fields,
                known,
                images,
                prompts=names,
                may_open_prompts=False,
            )


def _validate_computed(name: str, definition: Any) -> tuple:
    if not _NAME_RE.match(name):
        raise SchemaError(f"Computed name {name!r} is not a valid identifier")

    formula = definition.get("formula") if isinstance(definition, dict) else definition
    if not isinstance(formula, str) or not formula.strip():
        raise SchemaError(f"Computed {name!r} needs a non-empty 'formula'")

    try:
        return parse(formula)
    except EVALUATION_ERRORS as exc:
        raise SchemaError(f"Computed {name!r} has an invalid formula: {exc}") from exc


def _reject_images(names: set[str], images: set[str], what: str) -> None:
    """Refuse an expression that reads an image field.

    An image's value is a stored file name, which no formula can do anything
    meaningful with - and a rule that quietly depended on it would change
    whenever the picture was replaced.
    """
    used = names & images
    if used:
        raise SchemaError(
            f"{what} reads the image {'fields' if len(used) > 1 else 'field'} "
            f"{', '.join(sorted(used))}; an image has no value a formula can use"
        )


def _validate_condition(
    source: Any, what: str, known: set[str], images: frozenset = frozenset()
) -> None:
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
    except EVALUATION_ERRORS as exc:
        raise SchemaError(f"{what} is not a valid expression: {exc}") from exc

    names = referenced_names(ast)
    unknown = names - known
    if unknown:
        raise SchemaError(
            f"{what} references unknown "
            f"{'names' if len(unknown) > 1 else 'name'}: {', '.join(sorted(unknown))}"
        )
    _reject_images(names, set(images), what)


def _validate_validator(
    index: int, validator: Any, known: set[str], images: frozenset = frozenset()
) -> None:
    validator = _require_dict(validator, f"Validator {index}")

    rule = validator.get("rule")
    if not isinstance(rule, str) or not rule.strip():
        raise SchemaError(f"Validator {index} needs a non-empty 'rule'")
    _validate_condition(rule, f"Validator {index} rule", known, images)

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


def _validate_column_formulas(
    field_name: str, definition: Any, fields: dict, computed: dict, images: frozenset
) -> None:
    """Check the `default_from` formulas on a list field's columns.

    A column's formula is worked out once per row, against the sheet's fields
    with that row's columns laid over them, the way a `<g-repeat>` sees them. A
    column shadows a field of the same name - an image field included, so a
    column called `portrait` reads the row's cell, not the picture.

    It may not read another derived column, or itself: each row is worked out
    in one pass, so that cell would read as empty.
    """
    derived = _derived_columns(definition)
    if not derived:
        return
    column_keys = {column["key"] for column in definition["columns"] if isinstance(column, dict)}
    derived_keys = {column["key"] for column in derived}
    known = (set(fields) | column_keys) - derived_keys
    for column in derived:
        what = f"Field {field_name!r} column {column['key']!r} default_from"
        try:
            ast = parse(column["default_from"])
        except EVALUATION_ERRORS as exc:
            raise SchemaError(f"{what} is not a valid expression: {exc}") from exc
        names = referenced_names(ast)
        clash = names & derived_keys
        if clash:
            raise SchemaError(
                f"{what} reads {', '.join(repr(name) for name in sorted(clash))}, "
                "which works out its own value with default_from - a column's "
                "formula can read plain columns only"
            )
        unknown = names - known
        if unknown:
            message = (
                f"{what} references unknown "
                f"{'names' if len(unknown) > 1 else 'name'}: {', '.join(sorted(unknown))}"
            )
            if unknown & set(computed):
                message += (
                    " - default_from can read fields but not computed values, "
                    "which are worked out after it"
                )
            raise SchemaError(message)
        _reject_images(names, set(images) - column_keys, what)


def _validate_layout(layout: Any, known: set[str], images: frozenset = frozenset()) -> None:
    """Check the JSON layout tree names only fields that exist."""
    if not isinstance(layout, list):
        raise SchemaError("'layout' must be a list of sections")

    for index, section in enumerate(layout):
        section = _require_dict(section, f"Layout section {index}")
        _validate_condition(
            section.get("visible_if"), f"Layout section {index} visible_if", known, images
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
    if not isinstance(identity, str) or identity not in fields:
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
        unknown = [n for n in names if not isinstance(n, str) or n not in fields]
        if unknown:
            raise SchemaError(
                f"{what} {key!r} names unknown "
                f"{'fields' if len(unknown) > 1 else 'field'}: {', '.join(map(str, unknown))}"
            )

    # `{"origin": "class"}`: the origin filter narrows within a chosen class.
    # One level only, so a chain or a cycle is refused rather than half-honoured.
    dependencies = definition.get("filter_depends", {})
    if not isinstance(dependencies, dict):
        raise SchemaError(f"{what} 'filter_depends' must be a mapping")
    filter_fields = definition.get("filter_fields") or []
    for child, parent in dependencies.items():
        if (
            not isinstance(child, str)
            or not isinstance(parent, str)
            or child == parent
            or child not in filter_fields
            or parent not in filter_fields
        ):
            raise SchemaError(f"{what} 'filter_depends' must map distinct filter fields")
        if parent in dependencies:
            raise SchemaError(f"{what} 'filter_depends' cannot contain chains or cycles")

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


def validate_content_types(value: Any, *, what: str = "'content_types'") -> dict:
    """Check a table of content types outside a sheet, and return it.

    A content pack may declare types of its own in its ``_meta.json`` - the
    reference material no sheet picks from, like conditions or monsters. They
    are the same objects a sheet's ``content_types`` holds, so they pass the
    same check: one renderer draws both.
    """
    content_types = _require_dict(value, what)
    if len(content_types) > MAX_CONTENT_TYPES:
        raise SchemaError(f"{what} has more than {MAX_CONTENT_TYPES} content types")
    for type_name, type_definition in content_types.items():
        _validate_content_type(str(type_name), type_definition)
    return content_types


#: The keys validate_schema works out from ``layout_html``/``styles`` and their
#: ``mobile_`` counterparts. The renderer trusts them, so the author never
#: supplies them.
DERIVED_LAYOUT_KEYS: frozenset = frozenset(
    {"layout_ast", "styles_css", "mobile_layout_ast", "mobile_styles_css"}
)


def _check_action_buttons(document: dict, actions: Any, prompts: Any) -> None:
    """Refuse a `<g-action>` naming an action or a prompt the sheet lacks.

    The client renders nothing for an unknown `name` or `prompt`, so a typo
    would otherwise leave a missing button and no error anywhere.
    """
    prompt_names = set(prompts) if isinstance(prompts, dict) else set()
    names = {
        action["name"]
        for action in actions or []
        if isinstance(action, dict) and isinstance(action.get("name"), str)
    }
    for key, label in (("layout_ast", "layout_html"), ("mobile_layout_ast", "mobile_layout_html")):
        stack = list(document.get(key) or [])
        while stack:
            node = stack.pop()
            if not isinstance(node, dict):
                continue
            if node.get("tag") == "g-action":
                attrs = node.get("attrs") or {}
                if "prompt" in attrs:
                    if attrs["prompt"] not in prompt_names:
                        raise SchemaError(
                            f"{label}: <g-action> opens unknown prompt {attrs['prompt']!r}"
                        )
                    continue
                name = attrs.get("name")
                if name not in names:
                    raise SchemaError(f"{label}: <g-action> names unknown action {name!r}")
            stack.extend(node.get("children") or [])


def _derive_html_layouts(document: dict, scope: str) -> dict[str, Any]:
    """Parse a sheet's HTML layouts and scope their stylesheets.

    Returns the derived keys (``layout_ast``, ``styles_css`` and their
    ``mobile_`` counterparts) for whichever of them the document supplies.
    """
    derived: dict[str, Any] = {}

    layout_html = document.get("layout_html")
    if layout_html is not None:
        try:
            derived["layout_ast"] = parse_layout_html(layout_html)
        except LayoutHtmlError as exc:
            raise SchemaError(f"Invalid layout_html: {exc}") from exc

    styles = document.get("styles")
    if styles is not None:
        try:
            derived["styles_css"] = scope_styles(styles, scope)
        except StylesError as exc:
            raise SchemaError(f"Invalid styles: {exc}") from exc

    # A phone layout: the same parser, allowlist and caps as the desktop pair,
    # and independent of it - a sheet with a JSON `layout` can still ship one.
    # Its stylesheet shares the sheet's scope class; the client attaches one
    # stylesheet or the other, never both, so the two cannot mix.
    mobile_layout_html = document.get("mobile_layout_html")
    if mobile_layout_html is not None:
        try:
            derived["mobile_layout_ast"] = parse_layout_html(mobile_layout_html)
        except LayoutHtmlError as exc:
            raise SchemaError(f"Invalid mobile_layout_html: {exc}") from exc

    mobile_styles = document.get("mobile_styles")
    if mobile_styles is not None:
        if mobile_layout_html is None:
            raise SchemaError("mobile_styles needs a mobile_layout_html")
        try:
            derived["mobile_styles_css"] = scope_styles(mobile_styles, scope)
        except StylesError as exc:
            raise SchemaError(f"Invalid mobile_styles: {exc}") from exc

    return derived


def validate_schema(document: Any, *, scope: str = "gc-sheet") -> dict:
    """Validate a schema document, returning it normalised.

    The returned document gains two derived keys the renderer uses and the
    author never writes: ``layout_ast`` (the parsed, allowlisted HTML) and
    ``styles_css`` (the filtered, scoped stylesheet), plus ``mobile_layout_ast``
    and ``mobile_styles_css`` for a sheet that ships a phone layout as well.
    Deriving them here means
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
    images = frozenset(image_fields(document))
    asts: dict[str, tuple] = {}
    for computed_name, definition in computed.items():
        ast = _validate_computed(computed_name, definition)
        asts[computed_name] = ast
        names = referenced_names(ast)
        unknown = names - known
        if unknown:
            raise SchemaError(
                f"Computed {computed_name!r} references unknown "
                f"{'names' if len(unknown) > 1 else 'name'}: {', '.join(sorted(unknown))}"
            )
        _reject_images(names, set(images), f"Computed {computed_name!r}")

    # `visible_if` on a field, and on a layout section, is checked with the same
    # rules as a formula: it is the same expression language. So is
    # `default_from`, which derives a field's starting value from the others.
    for field_name, definition in fields.items():
        _validate_condition(
            definition.get("visible_if"), f"Field {field_name!r} visible_if", known, images
        )
        if isinstance(definition, dict) and definition.get("default_from"):
            # Fields only, not computed values: a default is worked out while
            # the field values are being assembled, before anything is computed,
            # so a computed name here would silently read as nothing.
            try:
                _validate_condition(
                    definition["default_from"],
                    f"Field {field_name!r} default_from",
                    set(fields),
                    images,
                )
            except SchemaError as exc:
                if any(name in str(exc) for name in computed):
                    raise SchemaError(
                        f"{exc} - default_from can read fields but not computed "
                        "values, which are worked out after it"
                    ) from exc
                raise
        _validate_column_formulas(field_name, definition, fields, computed, images)

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
                declared = ", ".join(sorted(content_types)) or "none declared"
                raise SchemaError(
                    f"Field {field_name!r} picks from content type {wanted!r}, "
                    f"which the schema does not define (has: {declared})"
                )

    prompts = document.get("prompts")
    prompt_names = set(prompts) if isinstance(prompts, dict) else set()
    for field_name, definition in fields.items():
        if isinstance(definition, dict) and "on_pick" in definition:
            _validate_on_pick(
                field_name, definition, fields, content_types, prompt_names
            )

    # The field that holds the character's name, kept in step with it.
    name_field = document.get("name_field")
    if name_field is not None:
        if not isinstance(name_field, str) or name_field not in fields:
            raise SchemaError(f"'name_field' names unknown field {name_field!r}")
        if (fields[name_field] or {}).get("type", "text") != "text":
            raise SchemaError(f"'name_field' {name_field!r} must be a text field")

    validators = document.get("validators", [])
    if not isinstance(validators, list):
        raise SchemaError("'validators' must be a list")
    if len(validators) > MAX_VALIDATORS:
        raise SchemaError(f"Schema has more than {MAX_VALIDATORS} validators")
    for index, validator in enumerate(validators):
        _validate_validator(index, validator, known, images)

    if "prompts" in document:
        _validate_prompts(prompts, fields, known, images, content_types)
    if "start_prompt" in document:
        _validate_start_prompt(document["start_prompt"], prompt_names, known, images)
    if "actions" in document:
        _validate_actions(document["actions"], fields, known, images, prompt_names)

    # A field's `on_change`: writes, and prompts, that follow a change the
    # player makes to it by hand - a box ticked that asks what for, hit points
    # at 0 that end Concentration. They read the sheet with the new value.
    for field_name, definition in fields.items():
        if isinstance(definition, dict) and "on_change" in definition:
            _validate_write_steps(
                definition["on_change"],
                f"Field {field_name!r} on_change",
                fields,
                known,
                images,
                prompts=prompt_names,
            )

    if "layout" in document:
        _validate_layout(document["layout"], known, images)

    # The derived keys come only from their source fields. A document that
    # carries them already - written by hand, or copied from another user's
    # sheet - has them dropped and rebuilt, never passed along as written.
    normalised = {
        key: value for key, value in document.items() if key not in DERIVED_LAYOUT_KEYS
    }
    normalised.update(_derive_html_layouts(document, scope))
    _check_action_buttons(normalised, document.get("actions"), document.get("prompts"))

    if "layout" not in document and document.get("layout_html") is None:
        # Neither layout given: the renderer falls back to listing fields in
        # declaration order, which is a usable sheet for a simple system.
        normalised["layout"] = [{"title": name, "fields": list(fields)}]

    return normalised


# --- character evaluation ------------------------------------------------


def coerce_value(
    definition: dict, value: Any, content_types: Optional[dict] = None
) -> Any:
    """Coerce a submitted value to its field's type.

    Out-of-range numbers are clamped rather than rejected: the bound is there to
    guide, and refusing to save a character because a temporary buff put a score
    at 21 would lose the player's work.

    ``content_types`` is the sheet's content type table. A freeform catalog entry
    keeps the properties its content type declares - a custom trait's
    description, a custom item's weight - which the field's own definition does
    not know about.
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
        except (TypeError, ValueError, OverflowError):
            return None
        if not math.isfinite(number):
            # "1e999" parses as inf, which no formula can do sums with and
            # JSON cannot carry. Treat it like any other unreadable number.
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
        return value if _is_option(value, _allowed_options(definition)) else ""

    if field_type == "multiselect":
        if not isinstance(value, list):
            return []
        allowed = _allowed_options(definition)
        # Order is the author's, not the order they were clicked in, so a sheet
        # reads the same each time it is opened. Duplicates collapse.
        chosen = {item for item in value if _is_option(item, allowed)}
        return [option for option in _option_values(definition) if _is_option(option, chosen)]

    if field_type == "list":
        return _coerce_rows(definition, value)

    if field_type == "content_ref":
        return _coerce_ref(definition, value, content_types)

    if field_type == "content_list":
        if not isinstance(value, list):
            return []
        refs = [_coerce_ref(definition, item, content_types) for item in value[:MAX_ROWS]]
        return [ref for ref in refs if ref]

    if field_type == "image":
        # Only ever a name this server wrote; anything else - a path, a URL -
        # reads as no image rather than something to go looking for.
        return value if isinstance(value, str) and IMAGE_VALUE_RE.match(value) else ""

    return "" if value is None else str(value)


#: Keys a stored reference carries. `_ref` is the catalog entry's id, `_source`
#: the pack it came from (two packs may each define "fireball"), `_per` the
#: character's own notes on it, and `_inline` marks a freeform entry that exists
#: only on this character.
_REF_KEYS = ("_ref", "_source", "_per", "_inline")


def _coerce_ref(definition: dict, value: Any, content_types: Optional[dict] = None) -> Any:
    """Coerce one catalog reference.

    A reference is stored, never a copy of the entry: an erratum or a ruleset
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
        # Freeform: keep a display name, the properties its content type
        # declares - the same form the sheet offers for it - and the declared
        # per-entry fields, and drop anything else, exactly as a list row is
        # rebuilt from its columns.
        inline: dict[str, Any] = {"_inline": True}
        name = value.get("name")
        inline["name"] = "" if name is None else str(name)
        type_definition = (content_types or {}).get(definition.get("content_type"))
        properties = (type_definition or {}).get("fields") or {}
        for key, declared in properties.items():
            if key != "name" and key in value and isinstance(declared, dict):
                inline[key] = coerce_value(declared, value[key])
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
    # An option written as a list or object can never be chosen: it has no
    # value to compare with, and would stop the set being built at all.
    return {value for value in _option_values(definition) if _hashable(value)}


def _hashable(value: Any) -> bool:
    try:
        hash(value)
    except TypeError:
        return False
    return True


def _is_option(value: Any, allowed: set) -> bool:
    """Whether ``value`` is one of ``allowed``. A list or object never is - a
    ``default_from`` formula can work one out, and a client can send one."""
    return _hashable(value) and value in allowed


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
            elif "default" in column and not column.get("default_from"):
                # A derived column's `default` is only the formula's fallback;
                # stored, it would be a value the formula never overrides.
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
    "image": "",
}


def image_fields(document: Any) -> set[str]:
    """The names of a schema's `image` fields."""
    fields = (document or {}).get("fields") if isinstance(document, dict) else None
    if not isinstance(fields, dict):
        return set()
    return {
        name
        for name, definition in fields.items()
        if isinstance(definition, dict) and definition.get("type") == "image"
    }


# Every formula a sheet computation runs shares one per-row budget (see
# MAX_EACH_WORK in expressions.py), so each entry point below opens it and the
# ones they call join it.
@each_work_budget()
def _build_context(document: dict, data: dict, entries: Optional[dict] = None) -> dict:
    """The value of every field, for evaluating formulas and conditions against.

    ``entries`` maps a catalog entry id to the entry itself. It rides in the
    context under ``_entries`` so `ref()` and friends can read a referenced
    entry's own properties; without it `ref()` reads as empty, which is what a
    sheet shows before its catalog has loaded.

    A field with a ``default_from`` formula and no stored value takes the
    formula's result. Presence in ``data`` is what marks a field as the
    player's: once they set it, their value is used and the formula stops
    applying, so deriving a value never takes the choice away.
    """
    fields = document.get("fields") or {}
    context: dict[str, Any] = {}
    deferred: dict[str, dict] = {}
    for field_name, definition in fields.items():
        if field_name in data:
            context[field_name] = data[field_name]
            continue
        if isinstance(definition, dict) and definition.get("default_from"):
            # Held back: the formula may read another field, so it cannot be
            # evaluated until every plain value is in the context.
            deferred[field_name] = definition
            continue
        if isinstance(definition, dict) and "default" in definition:
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

    for field_name, definition in deferred.items():
        field_type = definition.get("type", "text")
        empty = _EMPTY_BY_TYPE.get(field_type, 0)
        # Seeded empty first so a `default_from` naming another deferred field
        # reads a defined value rather than tripping the evaluator.
        context.setdefault(field_name, empty)
    for field_name, definition in deferred.items():
        derived = evaluate(definition["default_from"], context, default=None)
        if derived is None or derived == "":
            field_type = definition.get("type", "text")
            derived = definition.get("default", _EMPTY_BY_TYPE.get(field_type, 0))
        context[field_name] = coerce_value(definition, derived)

    for field_name, definition in fields.items():
        derived_columns = _derived_columns(definition)
        rows = context.get(field_name)
        if derived_columns and isinstance(rows, list):
            context[field_name] = _derive_rows(derived_columns, rows, context)
    return context


def _derive_rows(columns: list[dict], rows: list, context: dict) -> list:
    """Copies of a list's rows with their empty `default_from` cells worked out.

    A cell is the player's once it holds anything: rows are stored with every
    column, a blank one as ``None`` or ``""``, so an empty cell is what "not
    set" means here and a typed ``0`` is a real value. The copies only ever go
    into the context - the stored rows are left as they are, or the derived
    value would freeze the first time the row was saved.
    """
    asts = {column["key"]: _parse_or_none(column["default_from"]) for column in columns}
    derived_rows: list = []
    for row in rows:
        if not isinstance(row, dict):
            derived_rows.append(row)
            continue
        scope = {**context, **row}
        filled = dict(row)
        for column in columns:
            key = column["key"]
            if row.get(key) not in (None, ""):
                continue
            ast = asts[key]
            value = evaluate(ast, scope, default=None) if ast is not None else None
            if value is None or value == "":
                value = column.get("default")
            filled[key] = coerce_value(column, value)
        derived_rows.append(filled)
    return derived_rows


def _parse_or_none(source: Any) -> Optional[tuple]:
    """A formula's AST, or None for one that does not parse."""
    try:
        return parse(source)
    except EVALUATION_ERRORS:
        return None


#: Where a character's overrides of computed values are stored in its data.
OVERRIDES_KEY = "_overrides"


def computed_overrides(document: dict, data: dict) -> dict:
    """The player's overrides of computed values, limited to names that exist.

    An override of a computed value the schema has since dropped is ignored
    rather than resurrected as a name, so a stale one cannot shadow a field.
    """
    computed = document.get("computed") or {}
    stored = (data or {}).get(OVERRIDES_KEY)
    if not isinstance(stored, dict) or not isinstance(computed, dict):
        return {}
    return {name: value for name, value in stored.items() if name in computed}


@each_work_budget()
def compute_values(document: dict, data: dict, entries: Optional[dict] = None) -> dict:
    """Evaluate a schema's computed values against a character's data.

    Computed values may depend on one another, and a schema author should not
    have to declare them in dependency order. Rather than topologically sorting,
    this runs repeated passes until the results stop changing — simpler, and it
    degrades gracefully on a cyclic schema instead of failing to load one.

    The player can override any computed value: `data["_overrides"]` maps a
    computed name to the value they set. An overridden value is used as-is and
    its formula never runs, and it is in the context from the first pass, so
    everything that depends on it follows — override proficiency and the save
    DC built on it changes too. A sheet's formulas are a starting point, never
    the last word.
    """
    computed = document.get("computed") or {}
    if not isinstance(computed, dict) or not computed:
        return {}

    context = _build_context(document, data, entries)
    overrides = computed_overrides(document, data)

    results: dict[str, Any] = dict(overrides)
    context.update(overrides)
    # One budget for every pass, so a schema that never settles costs no more
    # than one that does. A formula the budget refuses on a later pass keeps
    # the value an earlier pass worked out rather than falling to its default.
    with each_work_budget(fresh=True):
        for _ in range(MAX_COMPUTE_PASSES):
            changed = False
            for computed_name, definition in computed.items():
                if computed_name in overrides:
                    continue
                formula = (
                    definition.get("formula") if isinstance(definition, dict) else definition
                )
                refused = each_work_refusals()
                value = evaluate(formula, context)
                if each_work_refusals() > refused and computed_name in results:
                    continue
                if results.get(computed_name) != value:
                    results[computed_name] = value
                    context[computed_name] = value
                    changed = True
            if not changed:
                break

    return results


@each_work_budget()
def run_validators(document: dict, data: dict, entries: Optional[dict] = None) -> list[dict]:
    """Evaluate a schema's validators against a character.

    Returns the ones that *fired* — a rule states what should be true, so a
    result of false is the problem worth reporting.

    A validator whose expression cannot be evaluated is skipped rather than
    reported: schema validation already rejected unparseable rules at install,
    so reaching here means a stored document drifted, and inventing a warning
    the author never wrote would be worse than staying quiet.

    So is one attached to a field whose own `visible_if` is false (issue #765):
    the sheet does not show that field, so a warning about it has nothing to
    act on. The sheet also holds back those inside a hidden section or tab, but
    which layout draws the sheet depends on the screen, so that part stays
    with the client.
    """
    validators = document.get("validators") or []
    if not isinstance(validators, list) or not validators:
        return []

    context = _build_context(document, data, entries)
    context.update(compute_values(document, data, entries))
    fields = document.get("fields") or {}

    fired = []
    for validator in validators:
        if not isinstance(validator, dict):
            continue
        rule = validator.get("rule")
        if not isinstance(rule, str):
            continue
        field = validator.get("field")
        definition = (
            fields.get(field) if isinstance(field, str) and isinstance(fields, dict) else None
        )
        condition = definition.get("visible_if") if isinstance(definition, dict) else None
        if condition and not evaluate(condition, context, default=True):
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


@each_work_budget()
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
