"""Rulesets package — named sets of content, owned by a campaign or the server."""
from fastapi import APIRouter

from ._schemas import (
    DeletedResponse,
    ImportResponse,
    InstallablePackListResponse,
    RulesetEntryDetail,
    RulesetEntryListResponse,
    RulesetExport,
    RulesetListResponse,
    RulesetSummary,
)
from .core import (
    create_entry,
    create_ruleset,
    delete_entry,
    delete_ruleset,
    export_ruleset,
    fork_entry,
    get_entry,
    get_ruleset,
    import_into_ruleset,
    list_entries,
    list_installable_packs,
    list_rulesets,
    update_entry,
    update_ruleset,
)

router = APIRouter(prefix="/rulesets", tags=["rulesets"])

__all__ = ["router"]

# Literal segments before /{ruleset_id}, so they are not swallowed by it.
router.add_api_route(
    "",
    list_rulesets,
    methods=["GET"],
    summary="List rulesets this user can read",
    response_model=RulesetListResponse,
)
router.add_api_route(
    "",
    create_ruleset,
    methods=["POST"],
    summary="Create a ruleset for a campaign, or for the server",
    response_model=RulesetSummary,
)
router.add_api_route(
    "/installable",
    list_installable_packs,
    methods=["GET"],
    summary="Content packs that can be imported into a ruleset",
    response_model=InstallablePackListResponse,
)
router.add_api_route(
    "/{ruleset_id}",
    get_ruleset,
    methods=["GET"],
    summary="One ruleset",
    response_model=RulesetSummary,
)
router.add_api_route(
    "/{ruleset_id}",
    update_ruleset,
    methods=["PUT"],
    summary="Rename a ruleset or change its credit",
    response_model=RulesetSummary,
)
router.add_api_route(
    "/{ruleset_id}",
    delete_ruleset,
    methods=["DELETE"],
    summary="Delete a ruleset and its entries",
    response_model=DeletedResponse,
)
router.add_api_route(
    "/{ruleset_id}/export",
    export_ruleset,
    methods=["GET"],
    summary="Export a ruleset",
    response_model=RulesetExport,
    response_model_by_alias=True,
)
router.add_api_route(
    "/{ruleset_id}/import",
    import_into_ruleset,
    methods=["POST"],
    summary="Import content into a ruleset",
    response_model=ImportResponse,
)
router.add_api_route(
    "/{ruleset_id}/fork",
    fork_entry,
    methods=["POST"],
    summary="Copy a catalogue entry into this ruleset",
    response_model=RulesetEntryDetail,
)
router.add_api_route(
    "/{ruleset_id}/entries",
    list_entries,
    methods=["GET"],
    summary="A ruleset's entries",
    response_model=RulesetEntryListResponse,
)
router.add_api_route(
    "/{ruleset_id}/entries",
    create_entry,
    methods=["POST"],
    summary="Write an entry",
    response_model=RulesetEntryDetail,
)
router.add_api_route(
    "/{ruleset_id}/entries/{entry_row_id}",
    get_entry,
    methods=["GET"],
    summary="One entry",
    response_model=RulesetEntryDetail,
)
router.add_api_route(
    "/{ruleset_id}/entries/{entry_row_id}",
    update_entry,
    methods=["PUT"],
    summary="Edit an entry",
    response_model=RulesetEntryDetail,
)
router.add_api_route(
    "/{ruleset_id}/entries/{entry_row_id}",
    delete_entry,
    methods=["DELETE"],
    summary="Delete an entry",
    response_model=DeletedResponse,
)
