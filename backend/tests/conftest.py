"""Shared fixtures for Grimoire backend tests.

All backend modules are imported AFTER the temp DATA_PATH is set so that
config.py initialises the SQLite database in a throwaway directory.
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
# ─────────────────────────────────────────────────────────────────────────────

from fastapi.testclient import TestClient  # noqa: E402
from backend.main import app  # noqa: E402
from backend.config import SessionLocal  # noqa: E402
from backend.models import (  # noqa: E402
    GameSystem,
    Book,
    GenericMap,
    Token,
    Audio,
    Campaign,
)


# ---------------------------------------------------------------------------
# Session-level HTTP client
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def client():
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c


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


def make_game_system(**kwargs) -> GameSystem:
    """Insert a GameSystem row directly and return it (caller must close db)."""
    uid = str(uuid.uuid4())[:8]
    defaults = dict(
        name=f"System-{uid}",
        slug=f"system-{uid}",
        description="",
    )
    defaults.update(kwargs)
    db = SessionLocal()
    system = GameSystem(**defaults)
    db.add(system)
    db.commit()
    db.refresh(system)
    db.close()
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
    db = SessionLocal()
    book = Book(**defaults)
    db.add(book)
    db.commit()
    db.refresh(book)
    db.close()
    return book


def make_map(**kwargs) -> GenericMap:
    uid = str(uuid.uuid4())[:8]
    defaults = dict(
        filename=f"map-{uid}.png",
        filepath=f"/tmp/map-{uid}.png",
        relative_path=f"map-{uid}.png",
    )
    defaults.update(kwargs)
    db = SessionLocal()
    m = GenericMap(**defaults)
    db.add(m)
    db.commit()
    db.refresh(m)
    db.close()
    return m


def make_token(**kwargs) -> Token:
    uid = str(uuid.uuid4())[:8]
    defaults = dict(
        filename=f"token-{uid}.png",
        filepath=f"/tmp/token-{uid}.png",
        relative_path=f"token-{uid}.png",
    )
    defaults.update(kwargs)
    db = SessionLocal()
    t = Token(**defaults)
    db.add(t)
    db.commit()
    db.refresh(t)
    db.close()
    return t


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
    db = SessionLocal()
    a = Audio(**defaults)
    db.add(a)
    db.commit()
    db.refresh(a)
    db.close()
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
