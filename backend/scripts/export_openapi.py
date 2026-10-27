#!/usr/bin/env python3
"""Print the API's OpenAPI schema as JSON, without starting a server.

The frontend generates its TypeScript API types from this output
(`npm run api:types` in frontend/, issue #587), and CI regenerates them to fail
a PR whose committed types have gone stale.

Importing the app opens the database and runs migrations, so DATA_PATH and
LIBRARY_PATH are pointed at a throwaway directory first - exporting the schema
must never touch a real install. The flags that add or remove routes are pinned
so the output is the same on every machine.

Run from the repo root:

    python3 backend/scripts/export_openapi.py > openapi.json
"""
import contextlib
import json
import os
import sys
import tempfile

# Pinned so the route table does not depend on the caller's environment. OPDS
# and MCP mount outside /api and the frontend calls neither.
_PINNED_ENV = {
    "OPDS_ENABLED": "false",
    "MCP_ENABLED": "false",
}


def main() -> None:
    root =os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    sys.path.insert(0, root)
    with tempfile.TemporaryDirectory(prefix="grimoire_openapi_") as data_dir:
        library_dir = os.path.join(data_dir, "library")
        os.makedirs(library_dir)
        os.environ.update(_PINNED_ENV, DATA_PATH=data_dir, LIBRARY_PATH=library_dir)
        # Anything the app prints while starting up must not end up in the JSON.
        with contextlib.redirect_stdout(sys.stderr):
            from backend.main import app

            spec = app.openapi()
    json.dump(spec, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
