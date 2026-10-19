"""Shared fixtures for Grimoire backend tests.

All backend modules are imported AFTER the temp DATA_PATH is set: config.py
reads its settings at import, so this is what puts the database (created by
startup(), or by the first session opened) in a throwaway directory.
"""
import os
import tempfile
import uuid
import pytest

# ── Must happen before any backend import ────────────────────────────────────
_DATA_DIR = tempfile.mkdtemp(prefix="grimoire_test_")
_LIB_DIR = os.path.join(_DATA_DIR, "library")
os.makedirs(_LIB_DIR, exist_ok=True)
os.environ["DATA_PATH"] = _DATA_DIR
os.environ["LIBRARY_PATH"] = _LIB_DIR
# TestClient's Host header, so the MCP host allow-list admits test requests.
os.environ.setdefault("MCP_ALLOWED_HOSTS", "testserver")
# The TestClient connects as "testclient"; treat it as a reverse proxy so tests
# can give each simulated client its own X-Forwarded-For address.
os.environ.setdefault(
    "TRUSTED_PROXIES",
    "127.0.0.0/8,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7,testclient",
)
# ─────────────────────────────────────────────────────────────────────────────

from fastapi.testclient import TestClient  # noqa: E402
from backend.main import app  # noqa: E402
from backend.config import SessionLocal  # noqa: E402
from backend.models import (  # noqa: E402
    GameSystem,
    Book,
    GenericMap,
    Model3D,
    Token,
    Audio,
    Campaign,
)
from backend.services import tag_service  # noqa: E402
from backend.tests import community_addons  # noqa: E402


def _sync_tags(resource_type: str, resource_id: str, tags) -> None:
    """Mirror a factory's ``tags`` into the shared-tag tables, matching the app's
    write path so join-table reads see them (tags now come from that table)."""
    if not tags:
        return
    db = SessionLocal()
    try:
        tag_service.set_resource_tags(db, resource_type, resource_id, tags)
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Parallel runs keep the serial order (pytest-xdist, issue #582)
# ---------------------------------------------------------------------------


# tryfirst: xdist's own hook turns xdist_group marks into scheduling groups,
# so they have to be on the items before it runs.
@pytest.hookimpl(tryfirst=True)
def pytest_collection_modifyitems(config, items):
    """Split the suite into one contiguous run of files per xdist worker.

    The tests share one database and one library folder, and plenty of them
    lean on what earlier files left behind. Run serially that order is fixed,
    so it works; handed out file by file, each worker would see a different,
    changing mix, and those dependencies surface as failures that move from
    run to run. So with ``--dist loadgroup`` each worker gets a contiguous
    slice of the files in their usual order, sized by test count, and runs it
    exactly as a serial run would - only the first file of each slice loses
    its predecessors. Without xdist this does nothing.
    """
    workers = int(os.environ.get("PYTEST_XDIST_WORKER_COUNT") or 0)
    if workers < 2 or not items:
        return
    per_chunk = len(items) / workers
    chunk_of: dict[str, int] = {}
    seen = 0
    for item in items:
        path = item.nodeid.split("::", 1)[0]
        if path not in chunk_of:
            chunk_of[path] = min(workers - 1, int(seen / per_chunk))
        seen += 1
    for item in items:
        chunk = chunk_of[item.nodeid.split("::", 1)[0]]
        item.add_marker(pytest.mark.xdist_group(f"chunk-{chunk}"))


# ---------------------------------------------------------------------------
# Reports must survive the trip from a pytest-xdist worker
# ---------------------------------------------------------------------------


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """Escape what UTF-8 can't encode in a test's captured output.

    Several tests deliberately log filenames that aren't valid UTF-8 (issue
    #547), so the captured log holds lone surrogates. That's harmless in one
    process, but xdist sends each report to the controller as UTF-8, and a
    surrogate there crashes the worker and silently drops every test it had
    left to run.
    """
    outcome = yield
    report = outcome.get_result()
    report.sections = [
        (title, text.encode("utf-8", "backslashreplace").decode("utf-8"))
        for title, text in report.sections
    ]


# ---------------------------------------------------------------------------
# Community add-on contract tests must run in CI, not skip (issue #581)
# ---------------------------------------------------------------------------

_community_skips: list[str] = []


def pytest_runtest_logreport(report):
    """Note every contract test that skipped for want of the community checkout."""
    if (
        community_addons.REQUIRED
        and report.skipped
        and community_addons.MISSING in str(report.longrepr)
    ):
        _community_skips.append(report.nodeid)


def pytest_terminal_summary(terminalreporter):
    if _community_skips:
        terminalreporter.section("community-add-ons contract tests skipped", red=True)
        terminalreporter.write_line(
            f"REQUIRE_COMMUNITY_ADDONS is set, but {len(_community_skips)} test(s) skipped "
            f"because {community_addons.ROOT} (or a file in it) is missing:"
        )
        for nodeid in _community_skips[:20]:
            terminalreporter.write_line(f"  {nodeid}")
        if len(_community_skips) > 20:
            terminalreporter.write_line(f"  ... and {len(_community_skips) - 20} more")


def pytest_sessionfinish(session, exitstatus):
    # A skip is not a pass here: it means the contract went unchecked.
    if _community_skips and exitstatus == pytest.ExitCode.OK:
        session.exitstatus = pytest.ExitCode.TESTS_FAILED


# ---------------------------------------------------------------------------
# Session-level HTTP client
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def client():
    with TestClient(app, raise_server_exceptions=True) as c:
        wait_for_startup_scan()
        yield c


def wait_for_startup_scan() -> None:
    """Block until the app's start-up library scan has finished.

    Call it after entering any ``TestClient`` that runs the lifespan.

    The lifespan starts it on a background thread, holding DATA_PATH/.scan.lock
    until it's done. Left running, it races whichever tests come first: they
    see "a scan is in progress", or rows appearing and vanishing under them.
    Run serially that was always the same few files, which didn't care; under
    pytest-xdist any file can be first on a worker.
    """
    import fcntl

    with open(os.path.join(_DATA_DIR, ".scan.lock"), "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        fcntl.flock(lock, fcntl.LOCK_UN)


@pytest.fixture(autouse=True)
def _reset_client_cookies(client):
    """The session-scoped client shares a cookie jar across tests. Auth flows
    now set a session cookie (issue #156), which would otherwise silently
    authenticate later "unauthenticated" requests. Clear it before every test so
    each starts with no ambient credentials."""
    client.cookies.clear()
    yield


# ---------------------------------------------------------------------------
# Bootstrap admin (runs once per session via /api/auth/setup)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def admin_setup(client):
    """Creates the initial admin account and returns (token, user dict)."""
    resp = client.post(
        "/api/auth/setup",
        json={
            "username": "admin",
            "password": "adminpass123",
        },
    )
    assert resp.status_code == 200, f"setup failed: {resp.text}"
    data = resp.json()
    return data["token"], data["user"]


@pytest.fixture(scope="session")
def admin_token(admin_setup):
    return admin_setup[0]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def admin_id(admin_setup):
    return admin_setup[1]["id"]


# ---------------------------------------------------------------------------
# Session-level GM and player accounts
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def gm_setup(client, admin_headers):
    resp = client.post(
        "/api/users",
        json={
            "username": "gmuser",
            "password": "gmpassword123",
            "role": "gm",
        },
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    user = resp.json()
    login = client.post(
        "/api/auth/login",
        json={
            "username": "gmuser",
            "password": "gmpassword123",
        },
    )
    assert login.status_code == 200
    return login.json()["token"], user


@pytest.fixture(scope="session")
def gm_token(gm_setup):
    return gm_setup[0]


@pytest.fixture(scope="session")
def gm_headers(gm_token):
    return {"Authorization": f"Bearer {gm_token}"}


@pytest.fixture(scope="session")
def gm_id(gm_setup):
    return gm_setup[1]["id"]


@pytest.fixture(scope="session")
def player_setup(client, admin_headers):
    resp = client.post(
        "/api/users",
        json={
            "username": "playeruser",
            "password": "playerpass123",
            "role": "player",
        },
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    user = resp.json()
    login = client.post(
        "/api/auth/login",
        json={
            "username": "playeruser",
            "password": "playerpass123",
        },
    )
    assert login.status_code == 200
    return login.json()["token"], user


@pytest.fixture(scope="session")
def player_token(player_setup):
    return player_setup[0]


@pytest.fixture(scope="session")
def player_headers(player_token):
    return {"Authorization": f"Bearer {player_token}"}


@pytest.fixture(scope="session")
def player_id(player_setup):
    return player_setup[1]["id"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def live_scan_status(**extra) -> dict:
    """A library scan status that reads as genuinely running.

    A running status needs a fresh heartbeat to count as live - without one it
    is an abandoned scan (issue #524), which nothing should defer to.
    """
    from datetime import datetime, timezone

    return {"running": True, "heartbeat": datetime.now(timezone.utc).isoformat(), **extra}


def make_game_system(**kwargs) -> GameSystem:
    """Insert a GameSystem row directly and return it (caller must close db)."""
    uid = str(uuid.uuid4())[:8]
    defaults = dict(
        name=f"System-{uid}",
        slug=f"system-{uid}",
        description="",
    )
    defaults.update(kwargs)
    tags = defaults.pop("tags", None)  # shared tags live in the join table now
    db = SessionLocal()
    system = GameSystem(**defaults)
    db.add(system)
    db.commit()
    db.refresh(system)
    db.close()
    _sync_tags("system", system.id, tags)
    return system


def make_book(system_id: str, **kwargs) -> Book:
    uid = str(uuid.uuid4())[:8]
    defaults = dict(
        title=f"Book-{uid}",
        filename=f"book-{uid}.pdf",
        filepath=f"/tmp/book-{uid}.pdf",
        relative_path=f"book-{uid}.pdf",
        game_system_id=system_id,
        category="core",
    )
    defaults.update(kwargs)
    tags = defaults.pop("tags", None)
    db = SessionLocal()
    book = Book(**defaults)
    db.add(book)
    db.commit()
    db.refresh(book)
    db.close()
    _sync_tags("book", book.id, tags)
    return book


def make_map(**kwargs) -> GenericMap:
    uid = str(uuid.uuid4())[:8]
    defaults = dict(
        filename=f"map-{uid}.png",
        filepath=f"/tmp/map-{uid}.png",
        relative_path=f"map-{uid}.png",
    )
    defaults.update(kwargs)
    tags = defaults.pop("tags", None)
    db = SessionLocal()
    m = GenericMap(**defaults)
    db.add(m)
    db.commit()
    db.refresh(m)
    db.close()
    _sync_tags("map", m.id, tags)
    return m


def make_token(**kwargs) -> Token:
    uid = str(uuid.uuid4())[:8]
    defaults = dict(
        filename=f"token-{uid}.png",
        filepath=f"/tmp/token-{uid}.png",
        relative_path=f"token-{uid}.png",
    )
    defaults.update(kwargs)
    tags = defaults.pop("tags", None)
    db = SessionLocal()
    t = Token(**defaults)
    db.add(t)
    db.commit()
    db.refresh(t)
    db.close()
    _sync_tags("token", t.id, tags)
    return t


def make_model3d(**kwargs) -> Model3D:
    uid = str(uuid.uuid4())[:8]
    defaults = dict(
        filename=f"model-{uid}.stl",
        filepath=f"/tmp/model-{uid}.stl",
        relative_path=f"models/model-{uid}.stl",
    )
    defaults.update(kwargs)
    tags = defaults.pop("tags", None)
    db = SessionLocal()
    m = Model3D(**defaults)
    db.add(m)
    db.commit()
    db.refresh(m)
    db.close()
    _sync_tags("model", m.id, tags)
    return m


def make_audio(**kwargs) -> Audio:
    uid = str(uuid.uuid4())[:8]
    defaults = dict(
        filename=f"track-{uid}.mp3",
        filepath=f"/tmp/track-{uid}.mp3",
        relative_path=f"track-{uid}.mp3",
        duration=123.5,
        title=f"Track {uid}",
    )
    defaults.update(kwargs)
    tags = defaults.pop("tags", None)
    db = SessionLocal()
    a = Audio(**defaults)
    db.add(a)
    db.commit()
    db.refresh(a)
    db.close()
    _sync_tags("audio", a.id, tags)
    return a


def make_campaign(owner_id: str, **kwargs) -> Campaign:
    uid = str(uuid.uuid4())[:8]
    defaults = dict(
        name=f"Campaign-{uid}",
        description="",
        owner_id=owner_id,
        is_gm_campaign=False,
        gm_title="Game Master",
    )
    defaults.update(kwargs)
    db = SessionLocal()
    c = Campaign(**defaults)
    db.add(c)
    db.commit()
    db.refresh(c)
    db.close()
    return c
