#!/usr/bin/env bash
# Run the E2E suite against a throwaway Grimoire instance.
#
# Starts a backend on its own port with its own DATA_PATH and LIBRARY_PATH, so
# the run never touches your real database or library, then runs the suite and
# tears the server down again.
#
#   ./scripts/run_local.sh                 # whole suite
#   ./scripts/run_local.sh -m smoke        # extra args go to pytest
#
# To test an already-running server instead, skip this script:
#   GRIMOIRE_BASE_URL=http://localhost:9481 python3 -m pytest
set -euo pipefail

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$E2E_DIR/.." && pwd)"
PORT="${GRIMOIRE_TEST_PORT:-9599}"
WORKDIR="$(mktemp -d)"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  # KEEP_WORKDIR=1 preserves the temp DATA_PATH/LIBRARY_PATH and server.log,
  # which is the first thing you want when diagnosing a failure.
  if [[ "${KEEP_WORKDIR:-0}" == "1" ]]; then
    echo "workdir kept: $WORKDIR" >&2
  else
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

if [[ ! -f "$REPO_ROOT/frontend/dist/index.html" ]]; then
  echo "frontend/dist is missing — build it first:  (cd frontend && npm run build)" >&2
  exit 1
fi

mkdir -p "$WORKDIR/data" "$WORKDIR/library"

# AUTH_RATE_LIMIT: the auth endpoints default to 10/minute. The suite's login
# tests drive the real form, which trips that limit part-way through a run and
# produces 429s unrelated to the behaviour under test.
cd "$REPO_ROOT"
DATA_PATH="$WORKDIR/data" \
LIBRARY_PATH="$WORKDIR/library" \
SECRET_KEY="e2e-local-secret-not-for-production" \
AUTH_RATE_LIMIT="1000/minute" \
LOG_LEVEL="warning" \
  python3 -m uvicorn backend.main:app --host 127.0.0.1 --port "$PORT" \
  > "$WORKDIR/server.log" 2>&1 &
SERVER_PID=$!

echo "waiting for backend on 127.0.0.1:${PORT}..."
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "backend exited during startup:" >&2
    tail -30 "$WORKDIR/server.log" >&2
    exit 1
  fi
  sleep 1
done

export GRIMOIRE_BASE_URL="http://127.0.0.1:$PORT"

cd "$E2E_DIR"
if [[ "${GRIMOIRE_SEED:-1}" == "1" ]]; then
  python3 scripts/seed_library.py --library-path "$WORKDIR/library" || {
    echo "seeding failed; content tests will skip" >&2
  }
fi

# Don't start the browser while a scan is still writing. Scans hold SQLite's
# single writer, and requests queued behind one can take long enough that the
# UI misses its mount timeout — a failure that looks like a UI bug but isn't.
python3 -c "
from grimoire_e2e import admin_client
from grimoire_e2e.config import Settings
try:
    admin_client(Settings()).wait_for_scan(timeout=300)
except Exception as exc:
    print(f'warning: could not confirm scan finished: {exc}')
"

python3 -m pytest "$@"
