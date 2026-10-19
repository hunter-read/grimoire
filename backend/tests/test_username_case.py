"""Usernames are unique regardless of case, matching how sign-in compares them."""
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from backend.config import SessionLocal
from backend.models import User
from backend.usernames import ensure_unique_index, find_by_username, username_taken


def _name():
    return f"CaseUser{uuid.uuid4().hex[:6]}"


def test_create_refuses_a_name_differing_only_in_case(client, admin_headers):
    name = _name()
    body = {"username": name, "password": "case-test-passphrase", "role": "player"}
    assert client.post("/api/users", json=body, headers=admin_headers).status_code in (200, 201)
    again = client.post(
        "/api/users", json={**body, "username": name.lower()}, headers=admin_headers
    )
    assert again.status_code == 400


def test_database_index_refuses_it_too():
    name = _name()
    db = SessionLocal()
    try:
        db.add(User(username=name, role="player"))
        db.commit()
        db.add(User(username=name.upper(), role="player"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
    finally:
        db.close()


def test_lookup_helpers():
    name = _name()
    db = SessionLocal()
    try:
        user = User(username=name, role="player")
        db.add(user)
        db.commit()
        assert find_by_username(db, f"  {name.swapcase()} ").id == user.id
        assert username_taken(db, name.lower())
        assert not username_taken(db, name.lower(), exclude_id=user.id)
    finally:
        db.close()


def test_oidc_registration_avoids_a_case_variant(client, admin_setup):
    from backend.routers.oidc._helpers import _resolve_user

    name = _name()
    db = SessionLocal()
    try:
        db.add(User(username=name, role="player"))
        db.commit()
        eff = {"oidc_match_by": "none", "oidc_groups_claim": "", "oidc_permissions_claim": "",
               "oidc_auto_register": True}
        sub = f"sub-{uuid.uuid4().hex[:8]}"
        user = _resolve_user(db, {"sub": sub, "preferred_username": name.lower()}, eff)
        db.commit()
        assert user.username.lower() != name.lower()
    finally:
        db.close()


def test_duplicates_are_logged_not_fatal(tmp_path, caplog):
    engine = create_engine(f"sqlite:///{tmp_path / 'u.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE users (id TEXT, username TEXT)"))
        conn.execute(text("INSERT INTO users VALUES ('1', 'Admin'), ('2', 'admin')"))
    with engine.begin() as conn, caplog.at_level("WARNING", logger="grimoire.users"):
        assert ensure_unique_index(conn) is False
    assert "Admin" in caplog.text and "admin" in caplog.text
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET username = 'admin2' WHERE id = '2'"))
        assert ensure_unique_index(conn) is True
        assert ensure_unique_index(conn) is True  # idempotent
    engine.dispose()


def test_setup_recount_refuses_a_second_admin(client, monkeypatch):
    """Two setups racing past the first count: the recount after the insert
    catches the second. Simulated by letting the first count see no users."""
    from sqlalchemy.orm import Query

    real_count = Query.count
    calls = {"n": 0}

    def first_count_says_empty(self):
        calls["n"] += 1
        return 0 if calls["n"] == 1 else real_count(self)

    monkeypatch.setattr(Query, "count", first_count_says_empty)
    resp = client.post(
        "/api/auth/setup", json={"username": _name(), "password": "race-test-passphrase"}
    )
    assert resp.status_code == 400
    monkeypatch.setattr(Query, "count", real_count)
    db = SessionLocal()
    try:
        assert db.query(User).filter_by(role="admin").count() >= 1
    finally:
        db.close()
