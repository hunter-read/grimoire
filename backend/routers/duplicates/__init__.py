"""Duplicate resolution — comparing look-alikes and acting on them.

Admin-only throughout: these endpoints delete irreplaceable files and restructure
how the library presents itself. Detection (which *finds* the candidates) lives
in ``services/duplicates``; this package is only about what the user does once
they have looked at a group.
"""
from fastapi import APIRouter

from ._schemas import (
    CompareResult,
    DeleteItemResult,
    DescribeResult,
    DismissalListResponse,
    DismissalOut,
    GroupListResponse,
    LinkResult,
    MergeBatchResult,
    MergeMetadataResult,
    MergeResult,
    ScanStatus,
    ScanTriggerResult,
    PromoteResult,
    UnlinkResult,
)
from .core import (
    compare_items,
    delete_item,
    describe_variant,
    link_variants,
    merge_metadata,
    promote_variant,
    unlink_variants,
)
from .merging import merge_batch, merge_items
from .detection import (
    cancel_scan,
    dismiss_group,
    get_scan_status,
    list_dismissals,
    list_groups,
    start_scan,
    undismiss_group,
)

router = APIRouter(prefix="/duplicates", tags=["duplicates"])

router.add_api_route(
    "/link",
    link_variants,
    methods=["POST"],
    summary="File items under a parent as its variants",
    response_model=LinkResult,
)
router.add_api_route(
    "/describe",
    describe_variant,
    methods=["POST"],
    summary="Set the kind and label one version shows in the picker",
    response_model=DescribeResult,
)
router.add_api_route(
    "/promote",
    promote_variant,
    methods=["POST"],
    summary="Make a different copy the main version of an existing family",
    response_model=PromoteResult,
)
router.add_api_route(
    "/unlink",
    unlink_variants,
    methods=["POST"],
    summary="Promote variants back to standalone entries",
    response_model=UnlinkResult,
)
router.add_api_route(
    "/merge",
    merge_items,
    methods=["POST"],
    summary="Merge copies into one, moving everything that points at them",
    response_model=MergeResult,
)
router.add_api_route(
    "/merge-batch",
    merge_batch,
    methods=["POST"],
    summary="Run several merges behind one confirmation",
    response_model=MergeBatchResult,
)
router.add_api_route(
    "/merge-metadata",
    merge_metadata,
    methods=["POST"],
    summary="Copy metadata fields from one copy onto another",
    response_model=MergeMetadataResult,
)
router.add_api_route(
    "/items/{resource_type}/{item_id}",
    delete_item,
    methods=["DELETE"],
    summary="Delete one duplicate record, and optionally its file",
    response_model=DeleteItemResult,
)
router.add_api_route(
    "/compare",
    compare_items,
    methods=["GET"],
    summary="Side-by-side comparison of two to four items",
    response_model=CompareResult,
)
router.add_api_route(
    "/scan-status",
    get_scan_status,
    methods=["GET"],
    summary="Progress of the duplicate-detection scan",
    response_model=ScanStatus,
)
router.add_api_route(
    "/scan",
    start_scan,
    methods=["POST"],
    summary="Start a duplicate-detection scan",
    response_model=ScanTriggerResult,
)
router.add_api_route(
    "/cancel-scan",
    cancel_scan,
    methods=["POST"],
    summary="Stop a running duplicate scan",
    response_model=ScanTriggerResult,
)
router.add_api_route(
    "/groups",
    list_groups,
    methods=["GET"],
    summary="Candidate duplicate groups from the last scan",
    response_model=GroupListResponse,
)
router.add_api_route(
    "/dismiss",
    dismiss_group,
    methods=["POST"],
    summary="Mark a group as not duplicates",
    response_model=DismissalOut,
)
router.add_api_route(
    "/dismissals",
    list_dismissals,
    methods=["GET"],
    summary="List dismissed groups",
    response_model=DismissalListResponse,
)
router.add_api_route(
    "/dismissals/{dismissal_id}",
    undismiss_group,
    methods=["DELETE"],
    summary="Undo a dismissal",
    response_model=ScanTriggerResult,
)

__all__ = ["router"]
