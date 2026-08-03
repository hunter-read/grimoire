"""Standalone worker for running a community add-on's Python script.

Entry point for the spawned child process created by
``backend.addons.scripts._run``. Like ``pdf_worker``, it deliberately imports
**nothing** from the rest of the ``backend`` package: importing
``backend.config`` at module load runs Alembic migrations, opens the SQLite
engine, and pings Valkey — none of which a throwaway process running
third-party code should do, and none of which that code should be able to reach.

The add-on script is loaded from its own directory and handed a JSON request on
stdin, per the contract in ``docs/scripts.md`` of the community-add-ons repo. Its
JSON response is written to ``result_path``; an empty result file signals a crash
to the parent.
"""

import importlib.util
import io
import json
import os
import sys


def _load_script(script_path: str):
    """Import an add-on script from its path, under a private module name."""
    spec = importlib.util.spec_from_file_location("grimoire_addon_script", script_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load add-on script at {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(script_path: str, request_json: str) -> dict:
    """Execute the script's ``main()`` with the request on stdin.

    Scripts follow a stdin/stdout JSON contract, so stdin and stdout are
    redirected around the call. Whatever the script prints on stdout is its
    response; anything it writes to stderr is left alone so it reaches the
    server log for the operator to read.
    """
    module = _load_script(script_path)
    entry = getattr(module, "main", None)
    if not callable(entry):
        return {"error": "add-on script defines no main()"}

    real_stdin, real_stdout = sys.stdin, sys.stdout
    captured = io.StringIO()
    sys.stdin = io.StringIO(request_json)
    sys.stdout = captured
    try:
        entry()
    finally:
        sys.stdin, sys.stdout = real_stdin, real_stdout

    raw = captured.getvalue().strip()
    if not raw:
        return {"error": "add-on script produced no output"}
    try:
        result = json.loads(raw)
    except ValueError:
        return {"error": "add-on script produced invalid JSON"}
    if not isinstance(result, dict):
        return {"error": "add-on script did not return an object"}
    return result


def main(script_path: str, request_json: str, result_path: str) -> None:
    """Child-process entry point.  Always writes a result file unless it dies.

    Script failures are reported as an ``error`` response rather than allowed to
    propagate: an uncaught exception here would leave the result file empty,
    which the parent reads as a crash. Distinguishing "the script raised" from
    "the process died" gives the operator a far more useful message.
    """
    try:
        result = run(script_path, request_json)
    except BaseException as exc:  # noqa: BLE001 - report, never crash silently
        result = {"error": f"{type(exc).__name__}: {exc}"}

    try:
        with open(result_path, "w", encoding="utf-8") as fh:
            json.dump(result, fh)
    except OSError:
        # Nothing useful left to do; the empty result file tells the parent.
        pass


if __name__ == "__main__":
    if len(sys.argv) == 4:
        main(sys.argv[1], sys.argv[2], sys.argv[3])
    else:  # pragma: no cover - defensive; the parent always passes three args
        sys.exit(f"usage: {os.path.basename(__file__)} SCRIPT REQUEST_JSON RESULT_PATH")
