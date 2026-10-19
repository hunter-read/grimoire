"""Structural guards: every router reading books or game systems goes through the
access rules, and every reference to a user is handled when one is deleted.

These fail on a new module that skips the shared guard, which is how a bulk or
helper route used to end up seeing more than the single-item route beside it.
A module that has a real reason to read books or systems directly is listed
below with that reason; review it before adding one.
"""
import ast
import pathlib

import pytest

from backend.models import Base

ROUTERS = pathlib.Path(__file__).resolve().parents[1] / "routers"

# Names that mean a module applies the access rules (backend/services/access_control.py
# and the book/system helpers built on it).
GUARDS = {
    "visible_books",
    "visible_systems",
    "visible_book_ids",
    "restricted_book_ids",
    "can_access_book",
    "can_access_system",
    "_assert_book_access",
    "_can_read_book",
    "access_control",
}

# Module (relative to backend/routers) -> why it may read books/systems unguarded.
ALLOWED_UNGUARDED = {
    "campaigns/core.py": "admin view of a user's campaigns: system names only",
    "campaigns/resources.py": "names of resources a GM already linked; campaign visibility applies",
    "campaigns/wiki_templates.py": "the campaign's own system, by id",
    "duplicates/_helpers.py": "admin-only duplicate finder",
    "library/_helpers.py": "admin-only library scan and file management",
    "lookups/_helpers.py": "metadata autocomplete counts, no titles or ids",
    "maintenance/_helpers.py": "admin-only maintenance",
    "tags/_helpers.py": "enriches ids its caller (tags/items.py) already filtered",
}

_MODELS = {"Book", "GameSystem"}


def _queried_model(node: ast.Call) -> str | None:
    """'Book' for ``x.query(Book...)`` / ``x.query(Book.id)``, else None."""
    if not (isinstance(node.func, ast.Attribute) and node.func.attr == "query" and node.args):
        return None
    arg = node.args[0]
    while isinstance(arg, ast.Attribute):
        arg = arg.value
    return arg.id if isinstance(arg, ast.Name) and arg.id in _MODELS else None


def _scan(path: pathlib.Path) -> tuple[bool, bool]:
    """(queries Book/GameSystem, references a guard) for one module."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    queries = guarded = False
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _queried_model(node):
            queries = True
        elif isinstance(node, ast.Name) and node.id in GUARDS:
            guarded = True
        elif isinstance(node, ast.Attribute) and node.attr in GUARDS:
            guarded = True
        elif isinstance(node, ast.alias) and node.name.split(".")[-1] in GUARDS:
            guarded = True
    return queries, guarded


def _modules():
    for path in sorted(ROUTERS.rglob("*.py")):
        yield path.relative_to(ROUTERS).as_posix(), path


def test_routers_reading_books_or_systems_apply_access_rules():
    unguarded = []
    for name, path in _modules():
        queries, guarded = _scan(path)
        if queries and not guarded and name not in ALLOWED_UNGUARDED:
            unguarded.append(name)
    assert not unguarded, (
        "These router modules query Book/GameSystem without the access rules "
        "(visible_books / visible_systems / _assert_book_access ...). Apply them, "
        f"or add the module to ALLOWED_UNGUARDED with the reason: {unguarded}"
    )


def test_allowlist_has_no_stale_entries():
    """An entry whose module is gone or now guarded should be removed."""
    scanned = dict(_modules())
    stale = []
    for name in ALLOWED_UNGUARDED:
        path = scanned.get(name)
        if path is None:
            stale.append(f"{name} (no such module)")
            continue
        queries, guarded = _scan(path)
        if not queries or guarded:
            stale.append(f"{name} (no longer needs it)")
    assert not stale, stale


def test_the_scanner_sees_a_query():
    """Guards the test itself: a walk that found nothing would pass vacuously."""
    found = sum(1 for _, path in _modules() if _scan(path)[0])
    assert found >= 20


# ---------------------------------------------------------------------------
# Every reference to users.id is handled on deletion
# ---------------------------------------------------------------------------

# Columns referencing users.id that the delete and merge paths in
# routers/campaigns/_helpers.py don't list in their tables, with where they are
# handled instead. Nothing references users.id with ON DELETE, so every column
# needs handling in code: SQLite runs with foreign_keys=ON and a delete that
# misses one fails.
HANDLED_ELSEWHERE = {
    "auth_sessions.user_id": "delete_user_sessions, on both delete and merge",
    "campaigns.owner_id": "purge_user_data deletes / reassign_user_data moves owned campaigns",
    "rulesets.owner_id": "purge_user_data deletes / reassign_user_data moves personal rulesets",
}


def _user_foreign_keys() -> set[str]:
    return {
        f"{table.name}.{column.name}"
        for table in Base.metadata.sorted_tables
        for column in table.columns
        for fk in column.foreign_keys
        if fk.column.table.name == "users" and fk.column.name == "id"
    }


def _listed() -> tuple[set[str], set[str]]:
    """(columns user deletion handles, columns guest merge handles)."""
    from backend.routers.campaigns import _helpers as h

    scoped = {f"{t}.user_id" for t in h._USER_SCOPED_TABLES}
    delete_only = {f"{t}.user_id" for t in h._USER_DELETE_ONLY_TABLES}
    attribution = {f"{t}.{c}" for t, c in h._USER_ATTRIBUTION_COLUMNS}
    elsewhere = set(HANDLED_ELSEWHERE)
    return scoped | delete_only | attribution | elsewhere, scoped | attribution | elsewhere


def test_user_deletion_handles_every_foreign_key():
    """A table pointing at users.id that deletion doesn't know about makes
    deleting any user who has a row there fail."""
    deleted, _ = _listed()
    missing = sorted(_user_foreign_keys() - deleted)
    assert not missing, (
        "Deleting a user doesn't handle these; add them to the lists in "
        f"routers/campaigns/_helpers.py: {missing}"
    )


def test_guest_merge_moves_every_foreign_key_except_delete_only():
    """Merging a guest into an account moves their rows; only the deliberate
    delete-only tables (credentials and grants) may be left to deletion."""
    from backend.routers.campaigns import _helpers as h

    _, merged = _listed()
    delete_only = {f"{t}.user_id" for t in h._USER_DELETE_ONLY_TABLES}
    missing = sorted(_user_foreign_keys() - merged - delete_only)
    assert not missing, f"Guest merge doesn't move these: {missing}"


def test_no_stale_entries():
    deleted, _ = _listed()
    assert not sorted(deleted - _user_foreign_keys())


def _user_unique_scopes(table) -> set[frozenset[str]]:
    """The columns each user_id-bearing unique constraint or index on ``table``
    scopes alongside user_id."""
    from sqlalchemy import UniqueConstraint

    column_sets = [
        {c.name for c in constraint.columns}
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    ] + [{c.name for c in index.columns} for index in table.indexes if index.unique]
    return {frozenset(cols - {"user_id"}) for cols in column_sets if "user_id" in cols}


def test_guest_merge_knows_every_per_user_unique_constraint():
    """Merging moves rows with a blanket UPDATE of user_id, so a unique
    constraint it doesn't drop collisions for first fails the whole merge
    whenever both accounts hold the same row."""
    from backend.routers.campaigns import _helpers as h

    listed = {
        (table, frozenset(c.strip() for c in scope.split(",")))
        for table, scope in h._USER_SCOPED_UNIQUE
    }
    required = {
        (name, scope)
        for name in h._USER_SCOPED_TABLES
        for scope in _user_unique_scopes(Base.metadata.tables[name])
    }
    assert not sorted(required - listed), "add these to _USER_SCOPED_UNIQUE"
    assert not sorted(listed - required), "stale _USER_SCOPED_UNIQUE entries"


def test_deleting_a_user_with_rows_everywhere(client, admin_headers):
    """End to end: one row in every user-referencing table, then delete."""
    import uuid

    from sqlalchemy import insert

    from backend.config import SessionLocal
    from backend.models import User

    created = client.post(
        "/api/users",
        json={"username": f"fk-{uuid.uuid4().hex[:6]}", "password": "fk-test-passphrase",
              "role": "player"},
        headers=admin_headers,
    )
    uid = created.json()["id"]
    db = SessionLocal()
    try:
        db.execute(insert(Base.metadata.tables["user_themes"]).values(
            id=str(uuid.uuid4()), user_id=uid, theme_id="t", name="T", **_required(
                "user_themes", {"id", "user_id", "theme_id", "name"})))
        db.execute(insert(Base.metadata.tables["user_importers"]).values(
            id=str(uuid.uuid4()), user_id=uid, importer_id="i", **_required(
                "user_importers", {"id", "user_id", "importer_id"})))
        db.execute(insert(Base.metadata.tables["audio_sets"]).values(
            id=str(uuid.uuid4()), user_id=uid, kind="playlist", name="n", **_required(
                "audio_sets", {"id", "user_id", "kind", "name"})))
        db.commit()
    finally:
        db.close()
    assert client.delete(f"/api/users/{uid}", headers=admin_headers).status_code in (200, 204)
    db = SessionLocal()
    try:
        assert db.query(User).filter_by(id=uid).first() is None
    finally:
        db.close()


def _required(table: str, given: set[str]) -> dict:
    """Placeholder values for the NOT NULL columns without a default."""
    out = {}
    for column in Base.metadata.tables[table].columns:
        if column.name in given or column.nullable or column.default is not None:
            continue
        if column.server_default is not None or column.primary_key:
            continue
        python_type = getattr(column.type, "python_type", str)
        out[column.name] = 0 if python_type in (int, float) else (
            False if python_type is bool else "{}" if python_type in (dict, list) else "x")
    return out


# ---------------------------------------------------------------------------
# Files are served through the shared helpers
# ---------------------------------------------------------------------------

# Router modules allowed to build a FileResponse themselves, and why.
FILE_RESPONSE_ALLOWED = {
    "_user_files.py": "the helper itself",
    "backups/core.py": "admin download of a backup zip Grimoire wrote",
}


def test_routers_serve_files_through_the_shared_helpers():
    """serve_user_file (and file_cache.cached_file_response) always add the
    inert headers an SVG needs; a route building its own FileResponse can
    forget them."""
    offenders = []
    for name, path in _modules():
        if name in FILE_RESPONSE_ALLOWED:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "FileResponse"
            ):
                offenders.append(f"{name}:{node.lineno}")
    assert not offenders, f"Use routers/_user_files.serve_user_file instead: {offenders}"


@pytest.mark.parametrize("serve", ["helper", "cached"])
def test_svg_is_served_inert(tmp_path, serve):
    from starlette.requests import Request

    from backend.file_cache import cached_file_response
    from backend.routers._user_files import serve_user_file
    from backend.security import INERT_DOCUMENT_CSP

    svg = tmp_path / "x.svg"
    svg.write_text("<svg xmlns='http://www.w3.org/2000/svg'/>")
    if serve == "helper":
        resp = serve_user_file(str(svg), headers={"Content-Security-Policy": "default-src *"})
    else:
        resp = cached_file_response(
            Request({"type": "http", "headers": []}), str(svg), media_type="image/svg+xml"
        )
    assert resp.headers["content-security-policy"] == INERT_DOCUMENT_CSP


def test_media_type_is_guessed_from_the_extension(tmp_path):
    from backend.routers._user_files import guess_media_type, serve_user_file

    assert guess_media_type("a/b.webp") == "image/webp"
    assert guess_media_type("a/b.SVG") == "image/svg+xml"
    assert guess_media_type("a/noext") == "application/octet-stream"
    png = tmp_path / "p.png"
    png.write_bytes(b"\x89PNG")
    resp = serve_user_file(str(png))
    assert resp.media_type == "image/png"
    assert "content-security-policy" not in resp.headers
