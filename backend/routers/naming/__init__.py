"""Naming package — filename rules (issues #521, #522, #569). Admin only.

Folder naming patterns sit under the ``files`` tag, since they read and rename
library files; variant markers sit under ``duplicates``, the review they feed.
An API key's existing permissions for those areas therefore cover them.
"""
from fastapi import APIRouter

from ... import api_keys
from ._schemas import (
    ApplyTitlesResponse,
    FolderRuleOut,
    FolderRulesResponse,
    PreviewResponse,
    NamingRenameResponse,
    NamingStatusResponse,
    VariantRulesResponse,
)
from .core import (
    apply_renames,
    apply_titles,
    delete_folder_rule,
    get_variant_rules,
    list_folder_rules,
    preview_folder_rule,
    save_folder_rule,
    save_variant_rules,
)

router = APIRouter(prefix="/naming")
router.add_api_route(
    "/folders",
    list_folder_rules,
    methods=["GET"],
    tags=["files"],
    summary="List folder naming patterns",
    response_model=FolderRulesResponse,
)
router.add_api_route(
    "/folders",
    save_folder_rule,
    methods=["PUT"],
    tags=["files"],
    summary="Set a folder's naming pattern",
    description=(
        "Creates or replaces the pattern for a folder under `books/`. New books "
        "beneath the folder read their title (and publisher, version, year, ...) "
        "from their filename with it; the nearest folder with a pattern wins."
    ),
    response_model=FolderRuleOut,
)
router.add_api_route(
    "/folders",
    delete_folder_rule,
    methods=["DELETE"],
    tags=["files"],
    summary="Remove a folder's naming pattern",
    response_model=NamingStatusResponse,
)
router.add_api_route(
    "/preview",
    preview_folder_rule,
    methods=["POST"],
    tags=["files"],
    summary="Preview a naming pattern against the books it governs",
    description=(
        "Changes nothing. Send `pattern` to preview one that has not been saved; "
        "omit it to preview the folder's saved pattern."
    ),
    response_model=PreviewResponse,
    openapi_extra=api_keys.READ_ONLY,
)
router.add_api_route(
    "/apply-titles",
    apply_titles,
    methods=["POST"],
    tags=["files"],
    summary="Set books' titles from their filenames",
    description=(
        "Uses the folder's saved pattern. Overwrites each selected book's title "
        "and fills publisher, version, year, ISBN, product code and authors only "
        "where the book has none."
    ),
    response_model=ApplyTitlesResponse,
)
router.add_api_route(
    "/rename",
    apply_renames,
    methods=["POST"],
    tags=["files"],
    summary="Rename books' files onto the folder's naming pattern",
    description=(
        "Uses the folder's saved pattern, which must not contain `{*}`. Each file "
        "is renamed and committed on its own, keeping its record, tags and "
        "sidecars; ones that cannot be renamed are listed in `skipped`."
    ),
    response_model=NamingRenameResponse,
    response_model_by_alias=True,
)
router.add_api_route(
    "/variant-rules",
    get_variant_rules,
    methods=["GET"],
    tags=["duplicates"],
    summary="List the library's variant filename rules",
    response_model=VariantRulesResponse,
)
router.add_api_route(
    "/variant-rules",
    save_variant_rules,
    methods=["PUT"],
    tags=["duplicates"],
    summary="Replace the library's variant filename rules",
    description=(
        "Rules are checked in order, before the built-in markers, whenever a "
        "variant kind is suggested from filenames."
    ),
    response_model=VariantRulesResponse,
)

__all__ = ["router"]
