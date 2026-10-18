"""The declarative character-importer engine.

Turns another tool's character document plus an importer manifest into a
*mapped character*: ``{"name", "portrait", "fields"}``, where each field holds
the list of values its mapping selected. It knows nothing about the sheet -
which values a number keeps, how a name becomes a catalog reference - because
that needs the database; ``services.characters.importing`` does it, for this
engine's output and a script's alike.

Pure, like ``interpreter``: no network, no database, so it is tested against
checked-in exports.
"""
import os
import re
from typing import Any, Optional, Union

from . import jsonpath, transforms
from .constants import MAX_IDENTITY_INPUT, MAX_IDENTITY_LENGTH
from .importer_manifest import TEMPLATE_PLACEHOLDER, ImporterField, ImporterSpec, ImporterValue
from .manifest import AddonManifest

#: Upper bound on the values one field may collect, matching the sheet's own
#: cap on list rows; anything past it would be dropped on save anyway.
MAX_VALUES = 500


class ImporterError(Exception):
    """The input is not something this importer can read. Safe to show."""


def spec_of(manifest: AddonManifest) -> ImporterSpec:
    if manifest.importer is None:
        raise ImporterError(f"add-on '{manifest.id}' is not a character importer")
    return manifest.importer


# --- recognising input -------------------------------------------------------


def extension_of(filename: str) -> str:
    """``Hero.DS-Hero`` -> ``.ds-hero``; "" when there is none."""
    return os.path.splitext(filename or "")[1].lower()


def detects(spec: ImporterSpec, document: Any) -> bool:
    """Whether every ``detect`` path selects something truthy in ``document``."""
    if not spec.detect or document is None:
        return False
    try:
        return all(
            any(_present(value) for value in jsonpath.values(document, path))
            for path in spec.detect
        )
    except jsonpath.JsonPathError:
        return False


def file_match(spec: ImporterSpec, filename: str, document: Any) -> int:
    """How strongly a file is this importer's: 0 not at all, higher is surer.

    An importer that declares extensions only claims files with one of them; one
    that declares ``detect`` only claims files its paths hold for. Declaring
    both needs both - a ``.json`` file is anyone's until its contents say whose.
    """
    if not spec.accepts_files:
        return 0
    if spec.extensions and extension_of(filename) not in spec.extensions:
        return 0
    if spec.detect and not detects(spec, document):
        return 0
    return (1 if spec.extensions else 0) + (2 if spec.detect else 0)


def url_identity(spec: ImporterSpec, text: str) -> Optional[str]:
    """The character id a pasted link carries, or None when it is not ours."""
    if spec.url is None:
        return None
    text = (text or "").strip()[:MAX_IDENTITY_INPUT]
    match = re.search(spec.url.pattern, text)
    if not match or not match.group(1):
        return None
    identity = match.group(1).strip()
    # It becomes part of a URL Grimoire requests, so it stays short and plain.
    if len(identity) > MAX_IDENTITY_LENGTH or not re.fullmatch(r"[A-Za-z0-9._~-]+", identity):
        return None
    return identity


# --- mapping -----------------------------------------------------------------


def _present(value: Any) -> bool:
    return value not in (None, "", False) and value != [] and value != {}


def _as_text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _render(template: str, document: Any, current: Any) -> Optional[str]:
    """Fill ``{$.path}`` placeholders. None when every one came up empty, so a
    template never yields only its own punctuation."""
    found = False

    def fill(match: "re.Match[str]") -> str:
        nonlocal found
        values = [v for v in jsonpath.values(document, match.group(1), current) if _present(v)]
        if not values:
            return ""
        found = True
        return ", ".join(_as_text(v) for v in values if not isinstance(v, (dict, list)))

    text = TEMPLATE_PLACEHOLDER.sub(fill, template)
    return text.strip() if found else None


def _raw(
    spec: ImporterValue, document: Any, current: Any, *, flatten: bool = True
) -> list[Any]:
    """The values a spec selects, before transforms.

    A list selected whole is read as its items, so ``$.build.languages`` and
    ``$.build.languages[*]`` agree - except when each value is a row, where a
    list *is* the row (Pathbuilder's ``["Rope", 1]``).
    """
    if spec.template is not None:
        text = _render(spec.template, document, current)
        return [text] if text else []
    if spec.from_ is None:
        return [spec.value]
    out: list[Any] = []
    for path in [spec.from_] if isinstance(spec.from_, str) else spec.from_:
        for key, value in jsonpath.query(document, path, current):
            if spec.keys:
                out.append(key)
            elif isinstance(value, list) and flatten:
                out.extend(value)
            else:
                out.append(value)
    return out


def _finish(spec: ImporterValue, values: list[Any]) -> list[Any]:
    """Transforms, the lookup table, then ``join``."""
    out: list[Any] = []
    for value in values:
        # Empty is dropped; false and 0 are real answers and are kept.
        if value is None or (isinstance(value, (str, list, dict)) and not value):
            continue
        if spec.transform and not isinstance(value, (dict, list)):
            value = transforms.apply(_as_text(value), spec.transform)
        if spec.values is not None and not isinstance(value, (dict, list)):
            value = spec.values.get(_as_text(value), value)
        out.append(value)
    if spec.join is not None:
        # A language two features both grant is still one language.
        texts = dict.fromkeys(_as_text(v) for v in out if not isinstance(v, (dict, list)))
        joined = spec.join.join(texts)
        return [joined] if joined else []
    return out[:MAX_VALUES]


def read_value(
    spec: Union[str, ImporterValue], document: Any, current: Any = None
) -> list[Any]:
    """Every value one spec selects, finished."""
    if isinstance(spec, str):
        spec = ImporterValue.model_validate({"from": spec})
    return _finish(spec, _raw(spec, document, current))


def _first_text(spec: Union[str, ImporterValue, None], document: Any, item: Any) -> str:
    if spec is None:
        return ""
    found = read_value(spec, document, item)
    return _as_text(found[0]) if found and not isinstance(found[0], (dict, list)) else ""


def read_field(spec: Union[str, ImporterField], document: Any) -> list[Any]:
    """One sheet field's values.

    Plain values come back as they are. With ``name`` (a catalog field over
    objects) each object becomes ``{"name", "description"}``, plus ``per`` when
    the field reads per-entry values; with ``columns`` (a list field) each
    becomes a row keyed by column.
    """
    if isinstance(spec, str):
        return read_value(spec, document)
    if (
        spec.columns is None
        and spec.name is None
        and spec.description is None
        and not spec.match
        and not spec.per
    ):
        return read_value(spec, document)

    out: list[Any] = []
    for item in _raw(spec, document, None, flatten=spec.columns is None)[:MAX_VALUES]:
        if spec.columns is not None:
            row = {}
            for key, column in spec.columns.items():
                found = read_value(column, document, item)
                if found:
                    row[key] = found[0]
            if row:
                out.append(row)
            continue
        if isinstance(item, dict):
            name = _first_text(spec.name or "@.name", document, item)
        elif _present(item) and not isinstance(item, list):
            name = _as_text(item)
        else:
            continue
        if not name:
            continue
        entry: dict[str, Any] = {"name": name}
        description = _first_text(spec.description, document, item)
        if description:
            entry["description"] = description
        if spec.match:
            entry["match"] = {
                key: _first_text(criterion, document, item)
                for key, criterion in spec.match.items()
            }
        if spec.per:
            per = {}
            for key, column in spec.per.items():
                found = read_value(column, document, item)
                if found and not isinstance(found[0], (dict, list)):
                    per[key] = found[0]
            if per:
                entry["per"] = per
        out.append(entry)
    return out


def map_document(manifest: AddonManifest, document: Any) -> dict[str, Any]:
    """Map a parsed export onto the importer's sheet fields.

    A field whose paths select nothing is left out rather than set empty, so
    the sheet's own default - or its `default_from` formula - still applies.
    """
    spec = spec_of(manifest)
    if not isinstance(document, (dict, list)):
        raise ImporterError("that file is not a JSON document")
    try:
        fields: dict[str, list[Any]] = {}
        for field_name, entry in spec.fields.items():
            values = [
                value
                for field_spec in (entry if isinstance(entry, list) else [entry])
                for value in read_field(field_spec, document)
            ]
            if values:
                fields[field_name] = values
        name = read_value(spec.name, document) if spec.name is not None else []
        portrait = read_value(spec.portrait, document) if spec.portrait is not None else []
    except jsonpath.JsonPathError as exc:
        raise ImporterError(f"could not read the file: {exc}") from exc
    return {
        "name": _as_text(name[0]) if name else "",
        "portrait": portrait[0] if portrait and isinstance(portrait[0], str) else None,
        "fields": fields,
    }
