"""Running script-backed add-ons in an isolated subprocess.

Follows the pattern proven by ``backend/indexer/_subprocess.py``: spawn a fresh
interpreter, poll it with a timeout, terminate on overrun, and treat an empty
result file as a crash.

The child gets the request and its own directory — no database session, no
Grimoire internals, none of our open handles. That contains crashes, hangs, and
runaway memory. It is **not** a sandbox: a script can still open sockets and read
what the server user can read. The real control is consent — scripts run only
when the operator has enabled them globally *and* approved this add-on. See
``docs/scripts.md`` in the community-add-ons repo.
"""
import json
import logging
import os
import tempfile
from typing import Any, Optional

from .constants import MP_CONTEXT
from .manifest import AddonManifest
from .registry import AddonError, addon_dir

logger = logging.getLogger("grimoire.addons")


class AddonScriptError(Exception):
    """A script-backed add-on failed to produce a usable result."""


def _run(request: dict, manifest: AddonManifest) -> dict:
    """Execute the add-on's script with ``request`` and return its response."""
    if manifest.script is None:
        raise AddonScriptError("add-on does not define a script")

    directory = addon_dir(manifest.id)
    script_path = os.path.join(directory, manifest.script.entry)
    if not os.path.isfile(script_path):
        raise AddonScriptError(f"script '{manifest.script.entry}' is missing")

    payload = dict(request)
    payload["addon_dir"] = directory

    from .. import addon_worker

    fd, result_path = tempfile.mkstemp(prefix="grimoire_addon_", suffix=".json")
    os.close(fd)
    timeout = manifest.script.timeout
    proc = MP_CONTEXT.Process(
        target=addon_worker.main,
        args=(script_path, json.dumps(payload), result_path),
    )
    try:
        proc.start()
        proc.join(timeout)

        if proc.is_alive():
            logger.warning(
                "Add-on script '%s' timed out after %ss", manifest.id, timeout
            )
            proc.terminate()
            proc.join()
            raise AddonScriptError(f"script timed out after {timeout}s")

        if os.path.getsize(result_path) == 0:
            code = proc.exitcode
            reason = (
                f"killed by signal {-code}"
                if code is not None and code < 0
                else f"exited with code {code}"
            )
            logger.warning("Add-on script '%s' crashed (%s)", manifest.id, reason)
            raise AddonScriptError(f"script {reason}")

        with open(result_path, "r", encoding="utf-8") as fh:
            result = json.load(fh)
    except ValueError as exc:
        raise AddonScriptError("script returned invalid JSON") from exc
    finally:
        if proc.is_alive():
            proc.terminate()
            proc.join()
        try:
            os.unlink(result_path)
        except OSError:
            pass

    if not isinstance(result, dict):
        raise AddonScriptError("script did not return an object")
    if result.get("error"):
        # A script reporting its own failure is an expected outcome, not a bug.
        raise AddonScriptError(str(result["error"]))
    return result


def search(query: str, manifest: AddonManifest) -> list[dict]:
    """Run the script's ``search`` action and normalise its candidates."""
    result = _run({"action": "search", "query": query}, manifest)
    raw = result.get("results")
    if not isinstance(raw, list):
        raise AddonScriptError("script did not return a 'results' list")

    candidates = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        identity = str(item.get("identity", "")).strip()
        if not identity:
            continue
        candidates.append(
            {
                "identity": identity,
                "label": str(item.get("label") or identity),
                "score": _as_score(item.get("score")),
                "url": str(item.get("url") or ""),
            }
        )
    return candidates


def fetch(identity: str, manifest: AddonManifest) -> tuple[dict[str, Any], str]:
    """Run the script's ``fetch`` action.  Returns ``(fields, source_url)``."""
    result = _run({"action": "fetch", "identity": identity}, manifest)
    fields = result.get("fields")
    if not isinstance(fields, dict):
        raise AddonScriptError("script did not return a 'fields' object")
    return fields, str(result.get("url") or "")


def _as_score(value: Optional[Any]) -> float:
    try:
        return max(0.0, min(1.0, float(value)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0


def ensure_runnable(manifest: AddonManifest) -> None:
    """Raise unless this manifest actually has a script to run."""
    if manifest.script is None:
        raise AddonError(f"add-on '{manifest.id}' is not script-backed")
