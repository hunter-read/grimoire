"""GrimoireCodexDB integration (issue #35): lookup, linking and submitting.

GrimoireCodexDB (https://db.grimoirecodex.org) is the community catalogue of
TTRPG systems and books. Grimoire uses it as a built-in metadata source, keeps
the GrimoireCodexDB id of each record it was matched to (``codex_id``), and can send
local records and corrections back. See ``docs/codex.md``.
"""
from .client import CodexDisabled, CodexError, http_error
from .lookup import SOURCE_ID
from .settings import DEFAULT_URL, CodexSettings, load, save

__all__ = [
    "CodexDisabled",
    "CodexError",
    "CodexSettings",
    "DEFAULT_URL",
    "SOURCE_ID",
    "http_error",
    "load",
    "save",
]
