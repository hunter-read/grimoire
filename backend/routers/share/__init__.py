"""Public share-link routes (issue #541) - reachable without logging in.

Mounted on its own router so nothing here can pick up an auth dependency by
accident; the token in the path is the only credential.
"""
from fastapi import APIRouter

from ._schemas import ShareMetaResponse, ShareUnlockResponse
from .core import share_content, share_meta, unlock_share

public_router = APIRouter(prefix="/api/share", tags=["share"])

# The fixed sub-paths are declared before "/{token}/{filename}", which would
# otherwise take "meta" or "unlock" as a filename.
public_router.add_api_route(
    "/{token}/meta",
    share_meta,
    methods=["GET"],
    summary="Describe a share link",
    description=(
        "What the share page needs: the item's name, type and file URLs. For a "
        "password-protected link only `password_required` and `unlocked` are "
        "returned until it is unlocked. 404 for any link that does not work."
    ),
    response_model=ShareMetaResponse,
)
public_router.add_api_route(
    "/{token}/unlock",
    unlock_share,
    methods=["POST"],
    summary="Unlock a password-protected share link",
    description=(
        "Checks the password and sets an HttpOnly cookie, scoped to this link's "
        "URLs, that unlocks it in this browser for 12 hours. 403 for a wrong "
        "password; wrong guesses are throttled per client and link."
    ),
    response_model=ShareUnlockResponse,
)
public_router.add_api_route(
    "/{token}",
    share_content,
    methods=["GET", "HEAD"],
    summary="Fetch a shared item",
    description=(
        "Serves the shared item inline (`?download=1` for an attachment). Image "
        "maps, tokens, books, audio and models serve their file (audio supports "
        "Range requests); a PDF map serves its first page as WebP and a "
        "Universal VTT map its embedded image. 401 when the link needs a "
        "password; 404 for any link that does not work."
    ),
)
public_router.add_api_route(
    "/{token}/{filename}",
    share_content,
    methods=["GET", "HEAD"],
    summary="Fetch a shared item by filename",
    description=(
        "The same as `GET /api/share/{token}`. The filename is ignored; it is "
        "there for tools that infer a file's type from the URL's extension."
    ),
)
