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


# ---------------------------------------------------------------------------
# Usernames outside ASCII (SQLite's own lower() only folds A-Z)
# ---------------------------------------------------------------------------


def _accented():
    # A capital outside ASCII first, so SQLite's lower() would leave it alone.
    return f"Émile{uuid.uuid4().hex[:6]}"


def _sign_in(client, username, password, ip):
    return client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
        headers={"X-Forwarded-For": ip},
    )


def test_a_non_ascii_username_signs_in_in_any_case(client, admin_headers):
    name = _accented()
    password = "accent-test-passphrase"
    created = client.post(
        "/api/users",
        json={"username": name, "password": password, "role": "player"},
        headers=admin_headers,
    )
    assert created.status_code in (200, 201), created.text
    for i, typed in enumerate((name, name.lower(), name.upper(), f" {name.casefold()} ")):
        resp = _sign_in(client, typed, password, f"203.0.113.{170 + i}")
        assert resp.status_code == 200, (typed, resp.text)
        assert resp.json()["user"]["username"] == name


def test_a_non_ascii_case_variant_is_taken(client, admin_headers):
    name = _accented()
    body = {"username": name, "password": "accent-test-passphrase", "role": "player"}
    assert client.post("/api/users", json=body, headers=admin_headers).status_code in (200, 201)
    again = client.post(
        "/api/users", json={**body, "username": name.lower()}, headers=admin_headers
    )
    assert again.status_code == 400
    assert "already exists" in again.json()["detail"]


def test_compatibility_forms_count_as_the_same_name():
    from backend.usernames import fold_username

    # NFKC: the "ﬁ" ligature and full-width letters are the plain letters.
    assert fold_username("ﬁona") == fold_username("FIONA") == "fiona"
    assert fold_username("ＡＢＣ") == "abc"
    assert fold_username("Straße") == fold_username("STRASSE")
    assert fold_username(None) is None


@pytest.mark.sqlite_only  # a function registered on SQLite connections
def test_fold_function_is_registered_on_connections():
    import sqlite3

    from backend import sql_functions

    raw = sqlite3.connect(":memory:")
    try:
        sql_functions.register(raw)
        row = raw.execute("SELECT grimoire_fold('ÉMILE'), grimoire_fold(NULL), grimoire_fold(7)")
        assert row.fetchone() == ("émile", None, 7)
    finally:
        raw.close()
    db = SessionLocal()
    try:
        # Every app connection has it, and the built-in lower() is untouched.
        row = db.execute(text("SELECT grimoire_fold('Ä'), lower('Ä')")).one()
        assert tuple(row) == ("ä", "Ä")
    finally:
        db.close()


def test_blank_username_matches_nothing():
    db = SessionLocal()
    try:
        assert find_by_username(db, "   ") is None
    finally:
        db.close()


# SQLite only: PostgreSQL's lower() folds "É", so its unique index refuses the
# second account and the collision cannot arise there.
@pytest.mark.sqlite_only
def test_names_that_already_collide_resolve_deterministically():
    """Accounts created before folding existed may differ only by an accented
    capital. Sign-in prefers the exact spelling, then the one SQLite's lower()
    used to find, so each still reaches its own account."""
    from backend.usernames import find_by_username

    base = uuid.uuid4().hex[:6]
    upper, lower = f"Élan{base}", f"élan{base}"
    db = SessionLocal()
    try:
        first = User(username=upper, role="player")
        second = User(username=lower, role="player")
        db.add_all([first, second])
        db.commit()
        assert find_by_username(db, upper).id == first.id
        assert find_by_username(db, lower).id == second.id
        # Neither spelled exactly: the old lower() match wins ("élan…" here).
        assert find_by_username(db, f"éLAN{base}").id == second.id
        # Repeatable when nothing tells them apart either.
        picks = {find_by_username(db, f"ÉLAN{base}".upper()).id for _ in range(3)}
        assert len(picks) == 1
        db.delete(first)
        db.delete(second)
        db.commit()
    finally:
        db.close()


def test_oidc_username_matching_folds_too(client, admin_setup):
    from backend.routers.oidc._helpers import _resolve_user

    name = _accented()
    db = SessionLocal()
    try:
        existing = User(username=name, role="player")
        db.add(existing)
        db.commit()
        eff = {"oidc_match_by": "username", "oidc_groups_claim": "", "oidc_permissions_claim": "",
               "oidc_auto_register": False}
        sub = f"sub-{uuid.uuid4().hex[:8]}"
        user = _resolve_user(db, {"sub": sub, "preferred_username": name.lower()}, eff)
        assert user.id == existing.id
    finally:
        db.close()
