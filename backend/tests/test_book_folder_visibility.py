"""A tagged book folder is listed, retagged or deleted only by someone who can
see a book in it, as the book groups show it. A folder holding no books hides
nothing.
"""
import uuid

import pytest

from backend.config import SessionLocal
from backend.models import BookFolder, FolderAccessRule

from .conftest import make_book, make_game_system


@pytest.fixture
def shelf():
    """A system with three tagged subfolders of core: Open (a visible book),
    Secret (an admin-only book) and Ruled (a book under an admin-only folder rule).
    """
    uid = uuid.uuid4().hex[:8]
    name = f"Shelf {uid}"
    system = make_game_system(name=name)
    rule = f"books/{name}/Core/Ruled"
    make_book(system.id, relative_path=f"books/{name}/Core/Open/a.pdf")
    make_book(system.id, relative_path=f"books/{name}/Core/Secret/b.pdf", access_level="admin")
    make_book(system.id, relative_path=f"{rule}/c.pdf")
    paths = {sub: f"{system.id}/core/{sub}" for sub in ("Open", "Secret", "Ruled", "Empty")}
    db = SessionLocal()
    try:
        for path in paths.values():
            db.add(BookFolder(path=path, tags=["zqfoldertag"]))
        db.add(FolderAccessRule(path=rule, level="admin"))
        db.commit()
    finally:
        db.close()
    yield system, paths
    db = SessionLocal()
    try:
        db.query(FolderAccessRule).filter_by(path=rule).delete()
        db.commit()
    finally:
        db.close()


def _listed(client, headers, system_id):
    resp = client.get(f"/api/systems/{system_id}/book-folders", headers=headers)
    assert resp.status_code == 200, resp.text
    return {f["path"] for f in resp.json()["folders"]}


def test_a_folder_of_hidden_books_is_not_listed(
    client, player_headers, gm_headers, admin_headers, shelf
):
    system, paths = shelf
    seen = {paths["Open"], paths["Empty"]}
    assert _listed(client, player_headers, system.id) == seen
    assert _listed(client, gm_headers, system.id) == seen
    assert _listed(client, admin_headers, system.id) == set(paths.values())


def test_a_gm_cannot_change_a_folder_of_hidden_books(client, gm_headers, admin_headers, shelf):
    system, paths = shelf
    url = f"/api/systems/{system.id}/book-folders"
    for sub in ("Secret", "Ruled"):
        patched = client.patch(url, json={"path": paths[sub], "tags": ["x"]}, headers=gm_headers)
        assert patched.status_code == 404, sub
        deleted = client.delete(url, params={"path": paths[sub]}, headers=gm_headers)
        assert deleted.status_code == 404, sub
    for sub in ("Open", "Empty"):
        patched = client.patch(url, json={"path": paths[sub], "tags": ["x"]}, headers=gm_headers)
        assert patched.status_code == 200, sub
    assert client.patch(
        url, json={"path": paths["Secret"], "tags": ["x"]}, headers=admin_headers
    ).status_code == 200
    assert client.delete(url, params={"path": paths["Ruled"]}, headers=admin_headers).status_code == 200
