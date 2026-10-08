"""Shared-tag domain logic (issue #235).

All tag reads/writes across resources funnel through here so matching is always
by the lowercased ``internal`` key and the display casing stays consistent. A tag
is created the first time an internal key is seen; its display value defaults to
the exact casing first entered and is only changed explicitly (tags page).

This was one module until it outgrew a single file; it is now split by concern:

- :mod:`._paths` - where a book sits in the library tree (category depth, the
  folder paths a book belongs to).
- :mod:`._catalog` - what a tag *is*: normalising, validating, and
  get-or-creating ``Tag`` rows.
- :mod:`._resources` - the ``ResourceTag`` link table: tags on one item or a
  batch of items.
- :mod:`._folders` - media-folder and book-folder tags: registering them and
  resolving their display.
- :mod:`._folder_scopes` - the items a folder tag covers, resolved in SQL.
- :mod:`._queries` - cross-resource queries: liveness filtering, usage counts.
- :mod:`._admin` - Tags-page management: metadata, rename/merge, pruning.

Everything is re-exported here, so ``from ..services import tag_service`` and
``tag_service.X`` are unchanged from when this was a single module.
"""
from __future__ import annotations

from ._admin import (
    prune_orphan_tags,
    rename_tag,
    tags_meta_for_internals,
)
from ._catalog import (
    TAG_FORBIDDEN_CHARS,
    dedupe_tags,
    default_display,
    get_or_create_tag,
    normalize_internal,
    tag_dict,
    validate_tag_value,
)
from ._folder_scopes import (
    FolderResolver,
    folder_groups_for_tag,
    folder_tag_counts,
    folder_tags_in_use,
    folders_for_tag,
    tagged_folders,
)
from ._folders import (
    _FOLDER_SOURCES as _FOLDER_SOURCES,
    effective_category,
    folder_display_tags,
    folder_types_for_tag,
    register_folder_tags,
    remove_tag_from_folders,
    upsert_folder_tags,
)
from ._paths import (
    _book_folder_ancestor_paths as _book_folder_ancestor_paths,
    system_category_depth,
    system_category_depths,
)
from ._queries import (
    live_link_counts,
    live_resource_ids,
    resources_for_tag,
    tags_in_use,
)
from ._resources import (
    add_resource_tags,
    display_tags_for_resource,
    display_tags_for_resources,
    set_resource_tags,
    sync_tags_from_payload,
    tags_for_resource,
    tags_for_resources,
)

__all__ = [
    "FolderResolver",
    "TAG_FORBIDDEN_CHARS",
    "add_resource_tags",
    "dedupe_tags",
    "default_display",
    "display_tags_for_resource",
    "display_tags_for_resources",
    "effective_category",
    "folder_display_tags",
    "folder_groups_for_tag",
    "folder_tag_counts",
    "folder_tags_in_use",
    "folder_types_for_tag",
    "folders_for_tag",
    "get_or_create_tag",
    "live_link_counts",
    "live_resource_ids",
    "normalize_internal",
    "prune_orphan_tags",
    "register_folder_tags",
    "remove_tag_from_folders",
    "rename_tag",
    "resources_for_tag",
    "set_resource_tags",
    "sync_tags_from_payload",
    "system_category_depth",
    "system_category_depths",
    "tag_dict",
    "tags_for_resource",
    "tags_for_resources",
    "tags_in_use",
    "tagged_folders",
    "tags_meta_for_internals",
    "upsert_folder_tags",
    "validate_tag_value",
]
