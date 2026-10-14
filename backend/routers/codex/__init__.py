"""Grimoire Codex DB package — registers the Grimoire Codex DB routes on a single router (issue #35)."""
from fastapi import APIRouter, Depends

from ._schemas import (
    CodexSettingsResponse,
    CodexStatus,
    CodexSubmitResponse,
    CodexTestResponse,
    StatusResponse,
)
from .core import (
    get_settings,
    get_status,
    require_enabled,
    submit_book,
    submit_system,
    test_connection,
    unlink_book,
    unlink_system,
    update_settings,
)

router = APIRouter(prefix="/codex", tags=["codex"])
# Everything but /status: without GRIMOIRE_CODEX_DB_API_TOKEN these answer 404.
_enabled = [Depends(require_enabled)]

__all__ = ["router"]

router.add_api_route(
    "/status",
    get_status,
    methods=["GET"],
    summary="Grimoire Codex DB status",
    description=(
        "Whether Grimoire Codex DB is on for this server (GRIMOIRE_CODEX_DB_API_TOKEN is set), "
        "and its address."
    ),
    response_model=CodexStatus,
)
router.add_api_route(
    "/settings",
    get_settings,
    methods=["GET"],
    summary="Get Grimoire Codex DB settings",
    description="Admin only. The API token comes from GRIMOIRE_CODEX_DB_API_TOKEN and is never returned.",
    dependencies=_enabled,
    response_model=CodexSettingsResponse,
)
router.add_api_route(
    "/settings",
    update_settings,
    methods=["PUT"],
    summary="Update Grimoire Codex DB settings",
    description="Admin only. Settings pinned by a GRIMOIRE_CODEX_DB_* environment variable are read-only.",
    dependencies=_enabled,
    response_model=CodexSettingsResponse,
)
router.add_api_route(
    "/test",
    test_connection,
    methods=["POST"],
    summary="Test the Grimoire Codex DB connection",
    description="Admin only. Reaches Grimoire Codex DB and reports the account the API token belongs to.",
    dependencies=_enabled,
    response_model=CodexTestResponse,
)
router.add_api_route(
    "/books/{book_id}/submit",
    submit_book,
    methods=["POST"],
    summary="Send a book to Grimoire Codex DB",
    description=(
        "Creates the book in Grimoire Codex DB, or sends the chosen fields as a correction to the linked "
        "record. Grimoire Codex DB decides whether it applies at once or waits for review."
    ),
    dependencies=_enabled,
    response_model=CodexSubmitResponse,
)
router.add_api_route(
    "/systems/{system_id}/submit",
    submit_system,
    methods=["POST"],
    summary="Send a game system to Grimoire Codex DB",
    description="Creates the system in Grimoire Codex DB, or sends the chosen fields as a correction.",
    dependencies=_enabled,
    response_model=CodexSubmitResponse,
)
router.add_api_route(
    "/books/{book_id}/link",
    unlink_book,
    methods=["DELETE"],
    summary="Unlink a book from Grimoire Codex DB",
    description="Clears the book's codex_id. Nothing changes in Grimoire Codex DB.",
    dependencies=_enabled,
    response_model=StatusResponse,
)
router.add_api_route(
    "/systems/{system_id}/link",
    unlink_system,
    methods=["DELETE"],
    summary="Unlink a game system from Grimoire Codex DB",
    description="Clears the system's codex_id. Nothing changes in Grimoire Codex DB.",
    dependencies=_enabled,
    response_model=StatusResponse,
)
