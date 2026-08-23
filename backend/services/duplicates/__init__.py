"""Duplicate detection: finding candidate groups for a user to resolve.

Public surface for the detection half of issue #304. The *resolution* half —
linking, merging, deleting — lives in ``routers/duplicates``, and the variant
model those actions write to lives in ``services/variants``.
"""
from .dismissals import (
    dismiss,
    dismissed_pairs,
    expand_pairs,
    list_dismissals,
    sweep_stale,
    undismiss,
)
from .grid import grid_marker, is_grid_pair, strip_grid_tokens
from .grouping import Edge, Group, build_groups, group_key
from .job import (
    DEFAULT_STATUS,
    RESOURCE_MODELS,
    clear_stop,
    detect_edges,
    get_status,
    is_stop_requested,
    request_stop,
    run_detection_sync,
    set_status,
)
from .scoring import describe, suggest_kind, suggest_parent, version_token

__all__ = [
    # detection
    "detect_edges",
    "run_detection_sync",
    "Edge",
    "Group",
    "build_groups",
    "group_key",
    # job control
    "DEFAULT_STATUS",
    "RESOURCE_MODELS",
    "get_status",
    "set_status",
    "request_stop",
    "clear_stop",
    "is_stop_requested",
    # dismissals
    "dismiss",
    "undismiss",
    "dismissed_pairs",
    "expand_pairs",
    "list_dismissals",
    "sweep_stale",
    # scoring / heuristics
    "suggest_kind",
    "suggest_parent",
    "version_token",
    "describe",
    "grid_marker",
    "is_grid_pair",
    "strip_grid_tokens",
]
