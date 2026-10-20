"""Request and response models for the character endpoints."""
from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, Field, StringConstraints


class SchemaSummary(BaseModel):
    """One installed schema, without its document — enough to list and pick."""

    id: str
    schema_id: str
    name: str
    system: str = ""
    description: str = ""
    version: str = ""
    source_id: Optional[str] = None
    source_url: Optional[str] = None
    source_version: Optional[str] = None
    is_community: bool = False
    character_count: int = 0


class SchemaDetail(SchemaSummary):
    """A schema with its validated document, for rendering a sheet."""

    document: dict[str, Any] = Field(default_factory=dict)


class SchemaListResponse(BaseModel):
    schemas: list[SchemaSummary]


class SchemaImport(BaseModel):
    """A pasted or uploaded sheet.

    Three ways to give the sheet itself, in order of preference:

    * ``document`` — already-parsed JSON, which is what the catalogue installer
      and older clients send.
    * ``text`` — the sheet as typed, parsed as JSON and then as YAML. A sheet is
      a document people hand-write, and YAML is far kinder to write by hand than
      JSON: no quoting every key, no trailing-comma errors, and comments.

    ``layout`` and ``styles`` carry a custom sheet's HTML and CSS as their own
    fields. A layout inlined into JSON has to be escaped, which turns a readable
    template into one unbroken line of ``\\"`` and ``\\n`` — the community repo
    keeps them in sibling files for exactly that reason, and pasting one should
    not be worse than installing one. Given here, they override whatever the
    document holds.
    """

    document: dict[str, Any] = Field(default_factory=dict)
    # The sheet as text, parsed as JSON then YAML. Bounded so a paste cannot
    # hand the parser something enormous.
    text: str = Field(default="", max_length=512 * 1024)
    layout: str = Field(default="", max_length=256 * 1024)
    styles: str = Field(default="", max_length=128 * 1024)
    source_id: Optional[str] = None
    source_url: Optional[str] = None
    source_version: Optional[str] = None


class CatalogueSheet(BaseModel):
    """One sheet the community catalogue offers.

    ``id`` is namespaced by its source so two catalogues offering the same
    sheet stay distinct; ``raw_id`` is what the sheet calls itself.
    """

    id: str
    raw_id: str = ""
    name: str
    version: str = ""
    system: str = ""
    description: str = ""
    author: str = ""
    author_url: str = ""
    homepage: str = ""
    license: str = ""
    license_url: str = ""
    # Rendered verbatim: several open licences mandate exact wording.
    attribution: str = ""
    custom_layout: bool = False
    field_count: int = 0
    grimoire_min_version: str = ""
    path: str = ""
    sha256: str = ""
    # A sheet may keep its layout and stylesheet in sibling files; each is
    # downloaded and digest-checked separately.
    layout_path: str = ""
    layout_sha256: str = ""
    styles_path: str = ""
    styles_sha256: str = ""
    # Which catalogue offered it, so a repo on a branch stays distinguishable.
    index_url: str = ""
    installed: bool = False


class CatalogueSourceError(BaseModel):
    """A configured source that could not be read."""

    url: str
    error: str


class SheetCatalogueResponse(BaseModel):
    sheets: list[CatalogueSheet]
    index_url: str = ""
    # Every catalogue consulted, so a listing can say where it came from.
    sources: list[str] = Field(default_factory=list)
    # Sources that failed, reported rather than silently dropped: with several
    # configured, a missing one otherwise looks like a smaller catalogue.
    errors: list[CatalogueSourceError] = Field(default_factory=list)
    downloads_enabled: bool = True


class SchemaDeletedResponse(BaseModel):
    deleted: bool = True
    schema_id: str


class PortraitCrop(BaseModel):
    """Which part of a portrait a frame shows.

    ``x`` and ``y`` are the focus point, as percentages across and down the
    image; ``zoom`` magnifies about it. A frame of any shape keeps the focus
    point in view, so one choice serves the square header, the list's card and
    a tall panel on the sheet alike.
    """

    x: float = Field(default=50, ge=0, le=100)
    y: float = Field(default=50, ge=0, le=100)
    zoom: float = Field(default=1, ge=1, le=4)


class CharacterSummary(BaseModel):
    """One character, without its data — enough for the list view."""

    id: str
    name: str
    schema_ref: str
    schema_name: str = ""
    system: str = ""
    # False when the schema this character was built on is not installed. The
    # character still opens; it renders read-only from stored data.
    schema_missing: bool = False
    # The campaign this character is played in, if any. Setting it lets the
    # party read the sheet; editing stays with the owner.
    campaign_id: Optional[str] = None
    campaign_name: Optional[str] = None
    # "active", "retired" or "dead". A player may have several characters in
    # one campaign; the status is how a fallen one stays without being current.
    status: str = "active"
    portrait_path: Optional[str] = None
    # Changes with the image, for cache-busting the portrait's URL.
    portrait_version: Optional[int] = None
    # The player's framing of the portrait; null is centred and unzoomed.
    portrait_crop: Optional[PortraitCrop] = None
    # Whether the campaign has a GM other than the player, so letting the GM
    # edit means something.
    campaign_has_gm: bool = False
    # The player's opt-in for the campaign's GM to edit the sheet. Off by
    # default, and cleared when the character moves to another campaign.
    gm_can_edit: bool = False
    # False when the caller is reading a party member's sheet rather than
    # their own.
    owned: bool = True
    # Whether the caller may edit it: true for its owner, and for the
    # campaign's GM when `gm_can_edit` is on.
    editable: bool = True
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ValidatorResult(BaseModel):
    """One schema validator that fired against a character."""

    rule: str
    message: str = ""
    severity: str = "warning"
    # The field to attach the message to, when the schema names one. Null means
    # it belongs to the sheet as a whole.
    field: Optional[str] = None


class CharacterDetail(CharacterSummary):
    """A character with its values, derived values, and any validator results."""

    data: dict[str, Any] = Field(default_factory=dict)
    computed: dict[str, Any] = Field(default_factory=dict)
    validators: list[ValidatorResult] = Field(default_factory=list)
    # Catalog entries this character's references point at, keyed by entry id,
    # so rendering the sheet costs no extra request.
    entries: dict[str, Any] = Field(default_factory=dict)


class CharacterListResponse(BaseModel):
    characters: list[CharacterSummary]


class CharacterCreate(BaseModel):
    schema_ref: str
    name: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
    campaign_id: Optional[str] = None


class CharacterUpdate(BaseModel):
    name: Optional[str] = None
    data: Optional[dict[str, Any]] = None
    # Field names to remove from the stored data. Removing a field is what hands
    # it back to its `default_from`: a value the player typed over a derived one
    # is theirs until they reset it, and this is the reset. Separate from `data`
    # because a null there already means "cleared" mid-edit, and snapping a
    # half-typed number back to its default would fight the player.
    unset: list[str] = Field(default_factory=list, max_length=100)
    # "" clears the campaign; a real id must be one the owner owns or has joined.
    campaign_id: Optional[str] = None
    status: Optional[str] = None
    # Reframes the portrait. Sending the defaults (centred, unzoomed) clears it.
    portrait_crop: Optional[PortraitCrop] = None
    # Lets the campaign's GM edit the sheet. The owner's to set; a GM sending
    # it, a campaign or a status is refused.
    gm_can_edit: Optional[bool] = None


class CharacterExport(BaseModel):
    """A self-contained character file.

    Every reference is denormalised into `entries`, and the schema travels with
    it, so the file opens on an instance that has neither the pack nor the
    ruleset content it was built from.
    """

    schema_marker: str = Field(default="", alias="$schema")
    name: str = ""
    status: str = "active"
    schema_id: str = ""
    character_schema: dict[str, Any] = Field(default_factory=dict, alias="schema")
    data: dict[str, Any] = Field(default_factory=dict)
    entries: dict[str, Any] = Field(default_factory=dict)
    # Pictures, as `data:` URLs, so the file carries them: the portrait, its
    # framing, and each image field's picture keyed by field name.
    portrait: Optional[str] = None
    portrait_crop: Optional[PortraitCrop] = None
    images: dict[str, str] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class CharacterImport(BaseModel):
    payload: dict[str, Any]
    # Recreate entries the receiving instance lacks as the importer's own
    # ruleset, so the sheet reads correctly rather than showing gaps.
    import_entries: bool = True


class PortraitResponse(BaseModel):
    portrait_path: str
    portrait_version: Optional[int] = None


class ImageFieldResponse(BaseModel):
    field: str
    # The stored file's name. It changes with every upload, so it doubles as
    # the image URL's cache-buster.
    value: str


class CharacterDeletedResponse(BaseModel):
    deleted: bool = True
    id: str


class ImporterInputSummary(BaseModel):
    """A field the import dialog shows for an importer - an API key, say."""

    key: str
    label: str
    help: str = ""
    secret: bool = False
    required: bool = False
    when: Literal["always", "file", "link"] = "always"


class ImporterSummary(BaseModel):
    """One installed character-importer add-on, as the import dialog shows it."""

    id: str
    name: str
    description: str = ""
    homepage: str = ""
    author: str = ""
    author_url: str = ""
    attribution: str = ""
    # The sheet its characters are built on, and whether the caller has it.
    # A missing sheet is installed from the catalogue on the first import.
    sheet: str
    sheet_name: str = ""
    sheet_installed: bool = False
    extensions: list[str] = Field(default_factory=list)
    accepts_files: bool = False
    accepts_url: bool = False
    url_hint: str = ""
    inputs: list[ImporterInputSummary] = Field(default_factory=list)
    version: str = ""
    # "server": installed by an admin for everyone. "user": the caller's own.
    scope: Literal["server", "user"] = "server"
    # Set when the caller's own copy has a newer version in the catalogue.
    available_version: str = ""


class AvailableImporter(BaseModel):
    """An importer the catalogue offers that the caller does not have."""

    id: str
    name: str
    description: str = ""
    homepage: str = ""
    author: str = ""
    author_url: str = ""
    version: str = ""
    sheet: str = ""
    sheet_name: str = ""
    requires_script: bool = False
    # How the caller could get it: "user" - install it for themselves;
    # "server" - an admin installs it for everyone, from the dialog;
    # "settings" - an admin installs it from Settings, where a script's
    # consent is asked; "admin" - only an admin can, so the caller asks one.
    install_as: Literal["user", "server", "settings", "admin"]
    index_url: str = ""


class ImporterListResponse(BaseModel):
    importers: list[ImporterSummary]
    available: list[AvailableImporter] = Field(default_factory=list)
    # False when the server may not install from a community repository.
    downloads_enabled: bool = True


class UserImporterInstalled(BaseModel):
    id: str
    name: str
    version: str = ""


class ExternalCharacterImport(BaseModel):
    """Another tool's character: a file's text, or a link to it.

    ``importer_id`` is optional - the importer that recognises the file or
    link is chosen automatically, and naming one only settles a tie.
    """

    importer_id: Optional[str] = None
    # Bounded so an upload cannot hand the parser something enormous. Big
    # enough for a builder that embeds its whole rulebook in every export, as
    # Forge Steel does.
    text: str = Field(default="", max_length=10 * 1024 * 1024)
    filename: str = Field(default="", max_length=255)
    url: str = Field(default="", max_length=2048)
    campaign_id: Optional[str] = None
    # Answers to the importer's declared `inputs`, by key. Passed to its script
    # for this import only and never stored; a key it did not declare is
    # dropped.
    inputs: dict[
        Annotated[str, StringConstraints(max_length=40)],
        Annotated[str, StringConstraints(max_length=2000)],
    ] = Field(default_factory=dict, max_length=10)


class ImportedCharacter(CharacterDetail):
    """The new character, and what the import could not match."""

    importer_id: str = ""
    importer_name: str = ""
    # Names that matched nothing in the installed content and were kept as
    # custom entries, so the player knows what to check.
    unmatched: list[str] = Field(default_factory=list)
