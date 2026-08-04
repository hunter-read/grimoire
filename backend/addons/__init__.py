"""Community add-ons: installable metadata scrapers.

Add-ons are authored in the separate ``grimoire-codex/community-add-ons`` repo
and installed at runtime into ``DATA_PATH/add-ons/``. Most are declarative YAML
that this package interprets itself; a few ship a Python script, which runs in
an isolated subprocess and only with the operator's explicit consent.

Module map:

``manifest``     Pydantic models for a manifest and the community index
``registry``     discovery, loading, install state, enable/approval checks
``install``      index refresh, download + integrity verification, install/remove
``fetch``        HTTP with shared limits and an on-disk response cache
``interpreter``  the declarative engine: records → ranked search → mapped fields
``transforms``   the closed table of named value transforms
``scripts``      subprocess runner for script-backed add-ons
``service``      resolves YAML vs script and answers search/fetch
``diff``         compares fetched values against a system's current ones
"""
from .diff import STATUS_DIFFERS, STATUS_ONLY_INCOMING, STATUS_SAME
from .diff import build as build_diff
from .fetch import AddonFetchError, clear_cache
from .install import (
    available,
    find_entry,
    pending_updates,
    refresh_index,
    set_enabled,
    set_script_approved,
    uninstall,
    update_all,
)
# Re-exported under a distinct name: a bare ``install`` here would shadow the
# ``backend.addons.install`` submodule for anyone importing the package.
from .install import install as install_addon
from .interpreter import AddonDataError
from .manifest import (
    MAPPABLE_BOOK_FIELDS,
    MAPPABLE_BY_TARGET,
    MAPPABLE_FIELDS,
    MAPPABLE_SYSTEM_FIELDS,
    AddonIndex,
    AddonManifest,
    IndexEntry,
)
from .registry import (
    AddonError,
    addon_dir,
    describe,
    enabled_for_target,
    get_cached_index,
    get_index_url,
    get_runnable,
    get_state,
    installed_ids,
    is_enabled,
    is_newer,
    load_all,
    load_manifest,
    scripts_allowed,
    set_index_url,
    set_scripts_allowed,
)
from .scripts import AddonScriptError
from .service import fetch_fields, resolve_identity, search

__all__ = [
    "MAPPABLE_BOOK_FIELDS",
    "MAPPABLE_BY_TARGET",
    "MAPPABLE_FIELDS",
    "MAPPABLE_SYSTEM_FIELDS",
    "STATUS_DIFFERS",
    "STATUS_ONLY_INCOMING",
    "STATUS_SAME",
    "AddonDataError",
    "AddonError",
    "AddonFetchError",
    "AddonIndex",
    "AddonManifest",
    "AddonScriptError",
    "IndexEntry",
    "addon_dir",
    "available",
    "build_diff",
    "clear_cache",
    "describe",
    "enabled_for_target",
    "fetch_fields",
    "resolve_identity",
    "find_entry",
    "get_cached_index",
    "get_index_url",
    "get_runnable",
    "get_state",
    "install_addon",
    "installed_ids",
    "pending_updates",
    "is_enabled",
    "is_newer",
    "load_all",
    "load_manifest",
    "refresh_index",
    "scripts_allowed",
    "search",
    "set_enabled",
    "set_index_url",
    "set_script_approved",
    "set_scripts_allowed",
    "uninstall",
    "update_all",
]
