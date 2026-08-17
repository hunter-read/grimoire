"""Pydantic models for add-on manifests and the community index.

The Python twin of ``schema/addon.schema.json`` in the community-add-ons repo.
Validation happens here on load, so a malformed definition is rejected with a
useful message instead of failing somewhere deep in the interpreter.
"""
import re
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .constants import (
    DEFAULT_CACHE_TTL,
    DEFAULT_MIN_SCORE,
    DEFAULT_SCRIPT_TIMEOUT,
    DEFAULT_SEARCH_LIMIT,
    MAX_PATTERN_LENGTH,
    MAX_SCRIPT_TIMEOUT,
    MAX_SEARCH_LIMIT,
)

# A *quantified group that itself contains a quantifier* — the classic shape of
# catastrophic backtracking, e.g. ``(a+)+`` or ``(\d*[a-z]+)*``.  A single
# quantifier inside a group (``([a-z-]+)``) is perfectly safe and very common,
# so it must not trip this. Community patterns are checked rather than trusted.
_NESTED_QUANTIFIER = re.compile(r"\([^()]*[*+}][^()]*\)\s*[*+{]")

TransformName = Literal[
    "slugify",
    "titlecase",
    "upper",
    "lower",
    "trim",
    "upper_dice",
    "strip_query",
    "strip_html",
]

# Grimoire fields an add-on is allowed to populate, per target.  Anything not
# listed is rejected at load time, so a definition can never reach for a column
# it has no business writing (ids, file paths, cover images, indexing flags, …).
MAPPABLE_SYSTEM_FIELDS = (
    "description",
    "publishers",
    "year",
    "license",
    "system_family",
    "parent_system",
    "edition",
    "genres",
    "dice_materials",
    "tags",
    "urls",
    "character_builder_urls",
)

MAPPABLE_BOOK_FIELDS = (
    "title",
    "description",
    "authors",
    "artists",
    "publisher",
    "publisher_url",
    "urls",
    "genres",
    "isbn",
    "version",
    "language",
    "license",
    "year",
    "month",
    "day",
    "tags",
)

MAPPABLE_BY_TARGET: dict[str, tuple[str, ...]] = {
    "game-system": MAPPABLE_SYSTEM_FIELDS,
    "book": MAPPABLE_BOOK_FIELDS,
}

# Backwards-compatible alias: the original name referred to system fields.
MAPPABLE_FIELDS = MAPPABLE_SYSTEM_FIELDS

# Fields whose Grimoire column is a plain list of strings.
LIST_FIELDS = frozenset({"genres", "dice_materials", "tags", "authors", "artists"})
# Fields stored as lists of {label, url} objects.
LINK_LIST_FIELDS = frozenset({"urls", "character_builder_urls"})
# Integer-valued fields.
INT_FIELDS = frozenset({"year", "month", "day"})


class _Strict(BaseModel):
    """Reject unknown keys, so a typo in a manifest is an error, not a silent no-op."""

    model_config = ConfigDict(extra="forbid")


class SourceSpec(_Strict):
    url: str
    format: Literal["json"]
    cache_ttl: int = Field(default=DEFAULT_CACHE_TTL, ge=0)
    user_agent: str = ""

    @field_validator("url")
    @classmethod
    def http_only(cls, v: str) -> str:
        """Only http(s).  Blocks file://, ftp://, and friends reaching the fetcher."""
        if not v.startswith(("http://", "https://")):
            raise ValueError("source.url must be an http(s) URL")
        return v


class ScriptSpec(_Strict):
    entry: str
    timeout: int = Field(default=DEFAULT_SCRIPT_TIMEOUT, ge=1, le=MAX_SCRIPT_TIMEOUT)

    @field_validator("entry")
    @classmethod
    def safe_filename(cls, v: str) -> str:
        """A bare .py filename — never a path that could escape the add-on directory."""
        if "/" in v or "\\" in v or v.startswith("."):
            raise ValueError("script.entry must be a bare filename")
        if not v.endswith(".py"):
            raise ValueError("script.entry must be a .py file")
        return v


class SkipWhen(_Strict):
    field: str
    equals: Any


class SelectSpec(_Strict):
    """Filter a list of objects down to those matching on ``field``.

    Sources commonly carry one entry per language or variant, or a flat
    taxonomy where only some branches are interesting; this narrows to the
    relevant entries before a value is read out of them. Give either ``equals``
    for a single value or ``in`` for several.
    """

    field: str
    equals: Any = None
    in_: Optional[list[Any]] = Field(default=None, alias="in")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="after")
    def needs_a_test(self) -> "SelectSpec":
        if self.equals is None and self.in_ is None:
            raise ValueError("select needs either 'equals' or 'in'")
        return self

    def matches(self, value: Any) -> bool:
        if self.in_ is not None:
            return value in self.in_
        return bool(value == self.equals)


class RecordsSpec(_Strict):
    root: str = "$"
    skip_when: Optional[SkipWhen] = None


class DetailSpec(_Strict):
    """A second request for the chosen record's full data.

    Many catalogues return trimmed summaries from search and keep the full
    fields behind a per-item endpoint. When present, ``map`` runs against the
    detail response instead of the search hit.
    """

    url: str
    root: str = "$"

    @field_validator("url")
    @classmethod
    def http_only(cls, v: str) -> str:
        if not v.startswith(("http://", "https://")):
            raise ValueError("detail.url must be an http(s) URL")
        if "{identity}" not in v:
            raise ValueError("detail.url must contain the {identity} placeholder")
        return v


class ValueSpec(_Strict):
    """Resolves to a single string: a field read, or a template over fields."""

    from_: Optional[str] = Field(default=None, alias="from")
    template: Optional[str] = None
    transform: Optional[Union[TransformName, list[TransformName]]] = None

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="after")
    def needs_a_source(self) -> "ValueSpec":
        if self.from_ is None and self.template is None:
            raise ValueError("needs either 'from' or 'template'")
        return self


class SearchField(_Strict):
    field: str
    weight: float = Field(default=1.0, ge=0)
    strategy: Literal["fuzzy", "exact", "contains"] = "fuzzy"


class SearchSpec(_Strict):
    # Ranking rules for a declaratively-fetched document.  A script-backed
    # add-on does its own searching, so it may declare a ``search`` block purely
    # to carry ``identity_pattern`` and leave this empty; the requirement is
    # enforced on the manifest, where ``source`` is visible.
    fields: list[SearchField] = Field(default_factory=list)
    min_score: float = Field(default=DEFAULT_MIN_SCORE, ge=0, le=1)
    limit: int = Field(default=DEFAULT_SEARCH_LIMIT, ge=1, le=MAX_SEARCH_LIMIT)
    label: Optional[ValueSpec] = None
    identity: Optional[ValueSpec] = None
    url: Optional[ValueSpec] = None
    # Lets a user paste a source URL (or a bare id) instead of searching.
    identity_pattern: Optional[str] = Field(
        default=None, max_length=MAX_PATTERN_LENGTH
    )

    @field_validator("identity_pattern")
    @classmethod
    def compilable_single_group(cls, v: Optional[str]) -> Optional[str]:
        """The pattern must compile and capture exactly one group.

        Definitions come from a community repo, so the pattern is treated as
        untrusted input: it is length-capped above, checked for the nested
        quantifiers that make catastrophic backtracking possible, and matched
        against length-capped input at call time.
        """
        if v is None:
            return v
        try:
            compiled = re.compile(v)
        except re.error as exc:
            raise ValueError(f"identity_pattern is not a valid regex: {exc}") from exc
        if compiled.groups != 1:
            raise ValueError(
                f"identity_pattern must have exactly one capture group, got {compiled.groups}"
            )
        if _NESTED_QUANTIFIER.search(v):
            raise ValueError(
                "identity_pattern contains a nested quantifier, which risks "
                "catastrophic backtracking"
            )
        return v


class PluckSpec(_Strict):
    """Read one value out of each object kept by an outer ``select``.

    Needed when a source nests a second per-language (or per-variant) list
    inside each entry of the list you just filtered.
    """

    from_: str = Field(alias="from")
    select: Optional[SelectSpec] = None
    first: bool = False
    transform: Optional[Union[TransformName, list[TransformName]]] = None

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class MappingEntry(_Strict):
    from_: Optional[str] = Field(default=None, alias="from")
    template: Optional[str] = None
    label: str = ""
    split: Optional[str] = None
    when_present: bool = False
    as_: Optional[Literal["link_list"]] = Field(default=None, alias="as")
    transform: Optional[Union[TransformName, list[TransformName]]] = None
    # Narrow a list of objects before reading ``from`` out of them.
    select: Optional[SelectSpec] = None
    # Read a value out of each surviving object, rather than the whole object.
    pluck: Optional[PluckSpec] = None
    # Keep only the first value when a path yields several (e.g. a scalar
    # target fed by a repeated field).
    first: bool = False

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="after")
    def needs_a_source(self) -> "MappingEntry":
        if self.from_ is None and self.template is None:
            raise ValueError("needs either 'from' or 'template'")
        return self


class AddonManifest(BaseModel):
    """A single add-on definition.

    Deliberately *not* ``_Strict``: the community repo may add top-level fields
    ahead of this client, and an older server must skip what it does not
    understand rather than refuse to load the add-on entirely — the same
    reasoning ``IndexEntry`` documents. Typo protection is retained where the
    schema is intricate: every nested spec stays strict, and ``map`` keys are
    checked against the per-target allowlist below.
    """

    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    version: str
    kind: Literal["scraper"]
    target: Literal["game-system", "book"] = "game-system"
    description: str = ""
    homepage: str = ""
    attribution: str = ""
    grimoire_min_version: str = ""

    source: Optional[SourceSpec] = None
    script: Optional[ScriptSpec] = None
    records: RecordsSpec = Field(default_factory=RecordsSpec)
    detail: Optional[DetailSpec] = None
    search: Optional[SearchSpec] = None
    map: dict[str, Union[MappingEntry, list[MappingEntry]]] = Field(default_factory=dict)

    @field_validator("id")
    @classmethod
    def safe_id(cls, v: str) -> str:
        """Lowercase-hyphenated only — the id becomes a directory name on disk."""
        if not v or not all(c.isalnum() or c == "-" for c in v):
            raise ValueError("id must be lowercase alphanumeric with hyphens")
        if v != v.lower() or v.startswith("-") or v.endswith("-"):
            raise ValueError("id must be lowercase and not start or end with a hyphen")
        return v

    @model_validator(mode="after")
    def mapped_fields_exist_on_target(self) -> "AddonManifest":
        """Every mapped key must be a field the chosen target actually has.

        Checked here rather than on ``map`` alone because the allowlist depends
        on ``target`` — a book scraper may write ``isbn``, a system scraper
        may not.
        """
        allowed = MAPPABLE_BY_TARGET.get(self.target, ())
        unknown = sorted(set(self.map) - set(allowed))
        if unknown:
            raise ValueError(
                f"map targets field(s) not valid for target '{self.target}': "
                f"{', '.join(unknown)}"
            )
        return self

    @property
    def mappable_fields(self) -> tuple[str, ...]:
        return MAPPABLE_BY_TARGET.get(self.target, ())

    @model_validator(mode="after")
    def needs_a_backend(self) -> "AddonManifest":
        if self.source is None and self.script is None:
            raise ValueError("manifest needs either 'source' or 'script'")
        if self.source is not None:
            if self.search is None:
                raise ValueError("a 'source' manifest needs a 'search' block")
            if not self.search.fields:
                # Only the declarative path ranks records itself, so this is
                # required here rather than on SearchSpec — a script-backed
                # add-on has nothing to rank and would otherwise be forced to
                # declare a field it never uses just to enable link pasting.
                raise ValueError("a 'source' manifest needs 'search.fields'")
        return self

    @property
    def requires_script(self) -> bool:
        return self.script is not None


class IndexEntry(BaseModel):
    """One row of the community index.  Lenient about extras: the index is
    generated by a repo that may add fields ahead of this client."""

    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    kind: str = "scraper"
    target: str = "game-system"
    version: str
    path: str
    sha256: str = ""
    description: str = ""
    homepage: str = ""
    requires_script: bool = False
    script_sha256: str = ""
    grimoire_min_version: str = ""


class AddonIndex(BaseModel):
    model_config = ConfigDict(extra="ignore")

    version: int = 1
    generated: str = ""
    addons: list[IndexEntry] = Field(default_factory=list)
