"""Files package — admin-only structural management of the library (issue #302)."""
from fastapi import APIRouter

from ._schemas import (
    BrowseResponse,
    DeletedFolderResponse,
    FolderResponse,
    MoveResponse,
    RenameResponse,
    ScaffoldResponse,
    UploadResponse,
)
from .core import (
    browse,
    create_folder,
    delete_folder,
    move_files,
    rename_file,
    scaffold_categories,
    update_markers,
    upload_file,
)

router = APIRouter(prefix="/files", tags=["files"])
router.add_api_route(
    "/browse",
    browse,
    methods=["GET"],
    summary="List a library folder with indexing state",
    response_model=BrowseResponse,
)
router.add_api_route(
    "/move",
    move_files,
    methods=["POST"],
    summary="Move files or folders, preserving their metadata",
    response_model=MoveResponse,
)
router.add_api_route(
    "/rename",
    rename_file,
    methods=["POST"],
    summary="Rename a file or folder on disk",
    response_model=RenameResponse,
    response_model_by_alias=True,
)
router.add_api_route(
    "/folder",
    create_folder,
    methods=["POST"],
    summary="Create a folder, optionally as a container or NSFW",
    response_model=FolderResponse,
)
router.add_api_route(
    "/folder/markers",
    update_markers,
    methods=["PUT"],
    summary="Set a folder's container/NSFW markers",
    response_model=FolderResponse,
)
router.add_api_route(
    "/folder",
    delete_folder,
    methods=["DELETE"],
    summary="Delete an empty folder",
    response_model=DeletedFolderResponse,
)
router.add_api_route(
    "/folder/scaffold",
    scaffold_categories,
    methods=["POST"],
    summary="Create the standard category folders in a system folder",
    response_model=ScaffoldResponse,
)
router.add_api_route(
    "/upload",
    upload_file,
    methods=["POST"],
    summary="Upload a single file into a library folder",
    description=(
        "Multipart upload of one file. Send files individually so progress can be "
        "reported per file and failures retried in isolation."
    ),
    response_model=UploadResponse,
)

__all__ = ["router"]
