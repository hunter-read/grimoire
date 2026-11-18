"""The shapes a wiki import's JSON must have before ``wiki_io`` reads it.

An imported file is untrusted, so a Grimoire bundle and a LegendKeeper export
are validated here first: a field the parser uses as text must be text (or
absent), and a list must be a list of objects. A file that fails is refused
with a 400 naming the first field at fault. Fields cleaned one by one where they
are used - an icon, its colour, a map page's picture and pins - are taken as
they come, and whatever is wrong with them is dropped there. ProseMirror bodies
are a free-form tree; the converter in ``wiki_io`` skips any node it can't use.
"""

from typing import Any, Optional, TypeVar

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, ValidationError


class _Strict(BaseModel):
    # Strict, so a number is not quietly read as text; unknown keys are ignored.
    model_config = ConfigDict(extra="ignore", strict=True)


class BundlePage(_Strict):
    title: Optional[str] = None
    body: Optional[str] = None
    slug: Optional[str] = None
    parent: Optional[str] = None
    visibility: Optional[str] = None
    page_type: Optional[str] = None
    session_date: Optional[str] = None
    icon: Any = None
    icon_color: Any = None
    map_id: Any = None
    map_file_id: Any = None
    pins: Any = None


class Bundle(_Strict):
    """A Grimoire JSON bundle: ``{grimoire_wiki_version, campaign, pages[]}``."""

    pages: list[BundlePage] = []


class LkDocument(_Strict):
    id: Optional[str] = None
    # HTML in a per-page export, a ProseMirror document in a bundle.
    content: Any = None


class LkResource(_Strict):
    """One resource of a LegendKeeper bundle (``{version, resources[]}``)."""

    id: str
    name: Optional[str] = None
    parentId: Optional[str] = None
    isHidden: Any = None
    documents: list[LkDocument] = []


class LkPage(_Strict):
    """A LegendKeeper per-page export."""

    id: Optional[str] = None
    name: Optional[str] = None
    documents: list[LkDocument] = []


_M = TypeVar("_M", bound=BaseModel)


def validate_import(model: type[_M], obj: Any, what: str) -> _M:
    """``obj`` as ``model``, or a 400 saying which field is wrong."""
    try:
        return model.model_validate(obj)
    except ValidationError as e:
        first = e.errors()[0]
        where = ".".join(str(part) for part in first["loc"]) or "the top level"
        raise HTTPException(
            400, f"That {what} can't be imported: {where} - {first['msg']}"
        ) from None
