"""Manifest models for character importers.

A character importer reads one character from another tool - a Forge Steel
``.ds-hero`` file, a Pathbuilder JSON export or link - and maps it onto the
fields of one Grimoire character sheet. It is an add-on like a scraper:
authored in the community repo, installed by an admin, and declarative unless
it ships a script.

Kept apart from ``manifest.py`` because almost nothing is shared beyond the
envelope (id, version, script): a scraper searches a catalogue and maps onto a
fixed allowlist of Grimoire columns, while an importer reads a single document
and maps onto whatever fields the target sheet declares.

Every path here is checked with :func:`jsonpath.compile_path` when the manifest
loads, so a typo in a community definition fails at install time with a
message, not halfway through somebody's import.
"""
import re
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .constants import MAX_PATTERN_LENGTH
from .jsonpath import JsonPathError, compile_path
from .transforms import names as transform_names

#: A transform name, checked against the closed table in ``transforms`` rather
#: than a ``Literal``: importers use numeric transforms scrapers never need.
ImporterTransform = str

#: ``{$.path}`` or ``{@.path}`` inside a template.
TEMPLATE_PLACEHOLDER = re.compile(r"\{([$@][^{}]*)\}")

# Same rule as a scraper's identity_pattern: a quantified group holding a
# quantifier is the shape of catastrophic backtracking.
_NESTED_QUANTIFIER = re.compile(r"\([^()]*[*+}][^()]*\)\s*[*+{]")

_SHEET_ID = re.compile(r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$")
_INPUT_KEY = re.compile(r"^[a-z][a-z0-9_]{0,39}$")

#: How many inputs one importer may ask for, and how long an answer may be.
MAX_INPUTS = 5
MAX_INPUT_LENGTH = 2000
_EXTENSION = re.compile(r"^\.[a-z0-9][a-z0-9._-]{0,30}$")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


def _check_path(path: str) -> str:
    try:
        compile_path(path)
    except JsonPathError as exc:
        raise ValueError(f"invalid path {path!r}: {exc}") from exc
    return path


def _check_template(template: str) -> str:
    placeholders = TEMPLATE_PLACEHOLDER.findall(template)
    if not placeholders:
        raise ValueError(f"template {template!r} has no {{$.path}} placeholder")
    for path in placeholders:
        _check_path(path)
    return template


def _check_transforms(value: Union[str, list[str], None]) -> Union[str, list[str], None]:
    known = transform_names()
    for name in [value] if isinstance(value, str) else value or []:
        if name not in known:
            raise ValueError(f"unknown transform {name!r}; known: {', '.join(sorted(known))}")
    return value


class ImporterValue(_Strict):
    """How to read one value - a field, a list column, a ref's name.

    Exactly one source: ``from`` (one path, or several whose results are
    concatenated), ``template`` (text with ``{$.path}`` placeholders), or
    ``value`` (a constant).
    """

    from_: Optional[Union[str, list[str]]] = Field(default=None, alias="from")
    template: Optional[str] = None
    value: Any = None
    # Applied to each value in order, then ``values`` looks the result up.
    transform: Optional[Union[ImporterTransform, list[ImporterTransform]]] = None
    # A lookup table from the source's vocabulary to the sheet's - Pathbuilder's
    # "cha" to the sheet's "charisma". A value with no entry passes through.
    values: Optional[dict[str, Any]] = None
    # Yield the member names a path selects rather than their values, for
    # sources keyed by what the sheet wants: {"acrobatics": 2, "arcana": 4}.
    keys: bool = False
    # Join every value into one string. Without it a text field takes the
    # first value.
    join: Optional[str] = Field(default=None, max_length=20)

    @field_validator("from_")
    @classmethod
    def paths_compile(cls, v: Union[str, list[str], None]) -> Union[str, list[str], None]:
        for path in [v] if isinstance(v, str) else v or []:
            _check_path(path)
        return v

    @field_validator("template")
    @classmethod
    def template_compiles(cls, v: Optional[str]) -> Optional[str]:
        return _check_template(v) if v is not None else v

    @field_validator("transform")
    @classmethod
    def transforms_exist(
        cls, v: Union[str, list[str], None]
    ) -> Union[str, list[str], None]:
        return _check_transforms(v)

    @model_validator(mode="after")
    def one_source(self) -> "ImporterValue":
        given = [
            name
            for name, present in (
                ("from", self.from_ is not None),
                ("template", self.template is not None),
                ("value", "value" in self.model_fields_set),
            )
            if present
        ]
        if len(given) != 1:
            raise ValueError("give exactly one of 'from', 'template' or 'value'")
        return self


class ImporterField(ImporterValue):
    """One sheet field's mapping.

    What happens to the values depends on the field's type in the sheet, so a
    definition stays short: a number takes the first value, a multiselect all
    of them, a ``content_ref`` / ``content_list`` matches each by name against
    the installed content and keeps any that do not match as custom entries.

    For catalog fields over objects, ``name`` and ``description`` are paths
    relative to each object (``@.name``), and ``per`` maps the sheet's
    per-entry fields the same way. For a ``list`` field, ``columns`` maps each
    column key to a path relative to each row.
    """

    name: Optional[str] = None
    description: Optional[str] = None
    # Catalog fields: properties an entry must also have to count as a match,
    # for content that reuses names - every Draw Steel class has a feature
    # called "Skills", told apart by its `origin`. Each value is read like any
    # other (a path relative to the item, an absolute path, or a template).
    match: Optional[dict[str, Union[str, ImporterValue]]] = None
    # Catalog fields: the sheet's per-entry values for each item - a piece of
    # equipment's quantity, whether a spell is prepared - read like `columns`.
    per: Optional[dict[str, Union[str, ImporterValue]]] = None
    columns: Optional[dict[str, Union[str, ImporterValue]]] = None

    @field_validator("name", "description")
    @classmethod
    def relative_paths(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not v.strip().startswith("@"):
            raise ValueError(f"{v!r} must be relative to each item, starting with '@'")
        return _check_path(v)

    @field_validator("match", "per", "columns")
    @classmethod
    def column_paths(
        cls, v: Optional[dict[str, Union[str, ImporterValue]]]
    ) -> Optional[dict[str, Union[str, ImporterValue]]]:
        for spec in (v or {}).values():
            if isinstance(spec, str):
                _check_path(spec)
        return v


class ImporterUrl(_Strict):
    """Importing from a pasted link.

    ``pattern`` recognises the link and captures the character's id;
    ``fetch`` is the JSON endpoint to read it from. Grimoire only ever requests
    ``fetch`` with the captured id substituted, never the pasted URL itself, so
    a link cannot point the server anywhere the definition did not name.

    A script-backed importer may omit ``fetch`` and receive the id instead, for
    a source that needs more than one request.
    """

    pattern: str = Field(max_length=MAX_PATTERN_LENGTH)
    fetch: Optional[str] = None
    # What the paste box shows as its placeholder.
    hint: str = Field(default="", max_length=200)
    user_agent: str = ""

    @field_validator("pattern")
    @classmethod
    def one_safe_group(cls, v: str) -> str:
        try:
            compiled = re.compile(v)
        except re.error as exc:
            raise ValueError(f"url.pattern is not a valid regex: {exc}") from exc
        if compiled.groups != 1:
            raise ValueError("url.pattern must have exactly one capture group")
        if _NESTED_QUANTIFIER.search(v):
            raise ValueError("url.pattern contains a nested quantifier")
        return v

    @field_validator("fetch")
    @classmethod
    def http_with_identity(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not v.startswith(("https://", "http://")):
            raise ValueError("url.fetch must be an http(s) URL")
        if "{identity}" not in v:
            raise ValueError("url.fetch must contain the {identity} placeholder")
        return v


class ImporterInput(_Strict):
    """Something the user types for one import - an API key, a password.

    The dialog shows the field; the value goes to the importer's script in that
    import's request and nowhere else. It is never stored, logged, or sent to
    anything but the script, so a credential for a private character can be
    pasted per import rather than configured on the server.
    """

    key: str
    label: str = Field(max_length=80)
    help: str = Field(default="", max_length=300)
    # A password field rather than a text field, so it is not shown on screen.
    secret: bool = False
    # Required inputs are asked for before the script runs. An optional one is
    # offered up front, and asked for again if the script answers that it
    # needs it - a key only a private sheet calls for.
    required: bool = False
    # Which kind of import it belongs to: a key for a link means nothing to a
    # file someone uploads.
    when: Literal["always", "file", "link"] = "always"

    @field_validator("key")
    @classmethod
    def identifier(cls, v: str) -> str:
        if not _INPUT_KEY.match(v):
            raise ValueError(
                "an input key is lowercase letters, digits and '_', starting with a letter"
            )
        return v

    def applies_to(self, mode: str) -> bool:
        """Whether this input belongs to a "file" or "link" import."""
        return self.when in ("always", mode)


class ImporterSpec(_Strict):
    """The ``importer`` block of a character-importer manifest."""

    # The sheet the result is built on, by its id in the sheet catalogue.
    sheet: str
    # File types this importer reads, lowercase with the dot: [".ds-hero"].
    extensions: list[str] = Field(default_factory=list, max_length=20)
    # Paths that must all select something for a file to be recognised. What
    # tells a Pathbuilder export apart from any other `.json` file.
    detect: list[str] = Field(default_factory=list, max_length=20)
    url: Optional[ImporterUrl] = None
    # The character's name, and an optional portrait (a `data:image/...` URL).
    name: Optional[Union[str, ImporterValue]] = None
    portrait: Optional[Union[str, ImporterValue]] = None
    # A field may take a list of mappings, whose values are concatenated - for
    # one catalog field fed from places that need different `match` criteria.
    fields: dict[str, Union[str, ImporterField, list[Union[str, ImporterField]]]] = Field(
        default_factory=dict
    )
    # What the user types alongside the file or link. Only a script can use
    # them, which the manifest checks.
    inputs: list[ImporterInput] = Field(default_factory=list, max_length=MAX_INPUTS)

    @field_validator("sheet")
    @classmethod
    def sheet_id(cls, v: str) -> str:
        if not _SHEET_ID.match(v):
            raise ValueError("sheet must be a sheet id: lowercase letters, digits, '-' or '_'")
        return v

    @field_validator("extensions")
    @classmethod
    def dotted_lowercase(cls, v: list[str]) -> list[str]:
        for extension in v:
            if not _EXTENSION.match(extension):
                raise ValueError(f"extension {extension!r} must be lowercase and start with '.'")
        return v

    @field_validator("detect")
    @classmethod
    def detect_paths(cls, v: list[str]) -> list[str]:
        for path in v:
            _check_path(path)
        return v

    @field_validator("name", "portrait")
    @classmethod
    def shorthand_path(
        cls, v: Union[str, ImporterValue, None]
    ) -> Union[str, ImporterValue, None]:
        if isinstance(v, str):
            _check_path(v)
        return v

    @field_validator("fields")
    @classmethod
    def field_paths(
        cls, v: dict[str, Union[str, ImporterField, list[Union[str, ImporterField]]]]
    ) -> dict[str, Union[str, ImporterField, list[Union[str, ImporterField]]]]:
        for entry in v.values():
            for spec in entry if isinstance(entry, list) else [entry]:
                if isinstance(spec, str):
                    _check_path(spec)
        return v

    @field_validator("inputs")
    @classmethod
    def distinct_keys(cls, v: list[ImporterInput]) -> list[ImporterInput]:
        keys = [item.key for item in v]
        if len(keys) != len(set(keys)):
            raise ValueError("each input needs its own key")
        return v

    @model_validator(mode="after")
    def recognisable(self) -> "ImporterSpec":
        """Something must say which files or links are this importer's.

        An importer with neither would claim every file anyone uploads.
        """
        if not self.extensions and not self.detect and self.url is None:
            raise ValueError("an importer needs 'extensions', 'detect' or 'url'")
        return self

    @property
    def accepts_files(self) -> bool:
        return bool(self.extensions or self.detect)

    def inputs_for(self, mode: str) -> list[ImporterInput]:
        """The inputs that belong to a "file" or "link" import."""
        return [item for item in self.inputs if item.applies_to(mode)]
