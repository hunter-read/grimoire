"""Shared fixtures for the share-link tests (issue #541).

The conftest users are session-scoped, so anything a test changes about them -
their override, the role defaults - is put back afterwards.
"""
import datetime

import pytest
from PIL import Image

from backend.config import SessionLocal
from backend.models import AppSetting, ShareLink, User
from backend.tests.conftest import make_map


def png(path, size=(280, 140), color=(30, 40, 50)):
    Image.new("RGB", size, color).save(str(path))
    return str(path)


def set_override(user_id, value):
    db = SessionLocal()
    db.query(User).filter_by(id=user_id).update({"share_links_enabled": value})
    db.commit()
    db.close()


def set_role_default(role, value):
    db = SessionLocal()
    key = f"share_links_role_{role}"
    row = db.query(AppSetting).filter_by(key=key).first()
    if value is None:
        if row:
            db.delete(row)
    elif row:
        row.value = "true" if value else "false"
    else:
        db.add(AppSetting(key=key, value="true" if value else "false"))
    db.commit()
    db.close()


def set_link(link_id, **fields):
    db = SessionLocal()
    db.query(ShareLink).filter_by(id=link_id).update(fields)
    db.commit()
    db.close()


def past():
    return datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1)


@pytest.fixture(autouse=True)
def _restore_share_permissions(gm_id, player_id, admin_id):
    yield
    for uid in (gm_id, player_id, admin_id):
        set_override(uid, None)
    set_role_default("gm", None)
    set_role_default("player", None)
    db = SessionLocal()
    db.query(User).filter(User.id.in_([gm_id, player_id, admin_id])).update(
        {"allow_explicit": True}, synchronize_session=False
    )
    db.commit()
    db.close()


@pytest.fixture
def shared_map(tmp_path):
    path = png(tmp_path / "Old Tavern.png")
    return make_map(filename="Old Tavern.png", filepath=path, relative_path="DnD/Maps/Old Tavern.png")


def create(client, headers, resource_type, resource_id, **body):
    return client.post(
        "/api/share-links",
        json={"resource_type": resource_type, "resource_id": resource_id, **body},
        headers=headers,
    )


def token_of(link):
    return link["url"].rsplit("/", 1)[-1]
