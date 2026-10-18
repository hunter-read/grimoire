"""The OpenAPI exporter the frontend generates its API types from (issue #587).

CI regenerates frontend/src/api/schema.d.ts from this output and fails when the
committed copy differs, so the export has to be valid, deterministic, and
independent of whatever environment it runs in.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
EXPORTER = REPO / "backend" / "scripts" / "export_openapi.py"


def _export(env_overrides=None):
    env = {k: v for k, v in os.environ.items() if k != "PYTHONHASHSEED"}
    env.update(env_overrides or {})
    result = subprocess.run(
        [sys.executable, str(EXPORTER)],
        cwd=REPO,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=True,
    )
    return result.stdout


def test_exports_the_api_schema_as_json():
    spec = json.loads(_export())
    assert spec["openapi"].startswith("3.")
    assert "/api/campaigns/{campaign_id}" in spec["paths"]
    assert spec["components"]["schemas"]


def test_drops_head_operations_so_operation_ids_are_unique():
    # A GET+HEAD route gives both methods one operationId, which the type
    # generator rejects as invalid OpenAPI.
    spec = json.loads(_export())
    ids = []
    for ops in spec["paths"].values():
        assert "head" not in ops
        ids.extend(op["operationId"] for op in ops.values() if isinstance(op, dict))
    assert len(ids) == len(set(ids))


def test_output_is_stable_across_runs_and_environments():
    # The hash seed decides which operationId a GET+HEAD route gets, and the
    # OPDS/MCP flags add routes; neither may leak into the output.
    first = _export({"PYTHONHASHSEED": "123"})
    second = _export({"OPDS_ENABLED": "true", "MCP_ENABLED": "true"})
    assert first == second


def test_never_touches_the_configured_data_path(tmp_path):
    # Importing the app runs migrations; the exporter must aim them elsewhere.
    data = tmp_path / "data"
    data.mkdir()
    _export({"DATA_PATH": str(data), "LIBRARY_PATH": str(tmp_path / "library")})
    assert list(data.iterdir()) == []
