"""Grimoire Codex package — registers the Codex routes on a single router (issue #35)."""
from fastapi import APIRouter

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
    submit_book,
    submit_system,
    test_connection,
    unlink_book,
    unlink_system,
    update_settings,
)

router = APIRouter(prefix="/codex", tags=["codex"])

__all__ = ["router"]

router.add_api_route(
    "/status",
    get_status,
    methods=["GET"],
    summary="Grimoire Codex status",
    description="Whether Grimoire Codex is enabled, its address, and whether records can be sent.",
    response_model=CodexStatus,
)
router.add_api_route(
    "/settings",
    get_settings,
    methods=["GET"],
    summary="Get Grimoire Codex settings",
    description="Admin only. The API token is never returned, only whether one is set.",
    response_model=CodexSettingsResponse,
)
router.add_api_route(
    "/settings",
    update_settings,
    methods=["PUT"],
    summary="Update Grimoire Codex settings",
    description="Admin only. Settings pinned by a CODEX_* environment variable are read-only.",
    response_model=CodexSettingsResponse,
)
router.add_api_route(
    "/test",
    test_connection,
    methods=["POST"],
    summary="Test the Grimoire Codex connection",
    description="Admin only. Reaches Codex and reports the account the API token belongs to.",
    response_model=CodexTestResponse,
)
router.add_api_route(
    "/books/{book_id}/submit",
    submit_book,
    methods=["POST"],
    summary="Send a book to Grimoire Codex",
    description=(
        "Creates the book in Codex, or sends the chosen fields as a correction to the linked "
        "record. Codex decides whether it applies at once or waits for review."
    ),
    response_model=CodexSubmitResponse,
)
router.add_api_route(
    "/systems/{system_id}/submit",
    submit_system,
    methods=["POST"],
    summary="Send a game system to Grimoire Codex",
    description="Creates the system in Codex, or sends the chosen fields as a correction.",
    response_model=CodexSubmitResponse,
)
router.add_api_route(
    "/books/{book_id}/link",
    unlink_book,
    methods=["DELETE"],
    summary="Unlink a book from Grimoire Codex",
    description="Clears the book's codex_id. Nothing changes in Codex.",
    response_model=StatusResponse,
)
router.add_api_route(
    "/systems/{system_id}/link",
    unlink_system,
    methods=["DELETE"],
    summary="Unlink a game system from Grimoire Codex",
    description="Clears the system's codex_id. Nothing changes in Codex.",
    response_model=StatusResponse,
)
