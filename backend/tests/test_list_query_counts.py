"""List endpoints run a fixed number of queries, however many rows they return (issue #707).

The campaign list used to query every member's campaign, the whole users table,
the owner, the schedule and the linked system once per campaign, and the admin
users list read the share-link role defaults once per user. Each test lists, adds
more rows, and lists again: the statement count must not move.

The handlers are called directly with a session of their own, and only that
session's connection is counted, so the app's background threads can't add noise.
"""
import uuid
from contextlib import contextmanager

from sqlalchemy import event

from backend.auth import CurrentUser
from backend.config import SessionLocal
from backend.models import CampaignMember, CampaignSchedule, User
from backend.models.access import LEVEL_ADMIN, LEVEL_GM
from backend.routers.campaigns.core import list_campaigns
from backend.routers.users.core import list_users
from backend.tests.conftest import make_campaign, make_game_system


@contextmanager
def _counted(db):
    """Yield a list that fills with every statement ``db`` sends to the database."""
    statements: list[str] = []
    conn = db.connection()

    def record(_conn, _cursor, statement, *_args):
        statements.append(statement)

    event.listen(conn, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(conn, "before_cursor_execute", record)


def _user(role: str = "player", **kwargs) -> User:
    db = SessionLocal()
    try:
        user = User(username=f"q-{role}-{uuid.uuid4().hex[:8]}", role=role, **kwargs)
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()


def _campaign_with_everything(owner_id: str) -> None:
    """A campaign carrying each thing the list looks up per row."""
    restricted = make_game_system(access_level=LEVEL_ADMIN)
    open_system = make_game_system()
    gm_only = make_game_system(access_level=LEVEL_GM, is_explicit=True)
    for system in (restricted, open_system, gm_only):
        campaign = make_campaign(owner_id, system_id=system.id, is_gm_campaign=True)
        db = SessionLocal()
        try:
            for status in ("accepted", "invited"):
                db.add(
                    CampaignMember(
                        campaign_id=campaign.id, user_id=_user().id, status=status
                    )
                )
            db.add(CampaignSchedule(campaign_id=campaign.id, enabled=True, definition={}))
            db.commit()
        finally:
            db.close()


def _list_campaign_queries(viewer: CurrentUser) -> tuple[int, int]:
    db = SessionLocal()
    try:
        with _counted(db) as statements:
            rows = list_campaigns(include_archived=True, current_user=viewer, db=db)
        return len(statements), len(rows)
    finally:
        db.close()


class TestCampaignList:
    def test_query_count_does_not_grow_with_campaigns(self):
        owner = _user("gm")
        viewer = CurrentUser(id=owner.id, username=owner.username, role="gm")
        _campaign_with_everything(owner.id)
        before, listed = _list_campaign_queries(viewer)

        _campaign_with_everything(owner.id)
        _campaign_with_everything(owner.id)
        after, listed_after = _list_campaign_queries(viewer)

        assert listed_after == listed + 6
        assert after == before

    def test_campaigns_the_viewer_belongs_to_are_batched_too(self):
        owner = _user("gm")
        player = _user("player")
        viewer = CurrentUser(id=player.id, username=player.username, role="player")

        def join_another() -> None:
            campaign = make_campaign(owner.id, system_id=make_game_system().id)
            db = SessionLocal()
            try:
                db.add(CampaignMember(campaign_id=campaign.id, user_id=player.id, status="accepted"))
                db.add(CampaignMember(campaign_id=campaign.id, user_id=_user().id, status="accepted"))
                db.commit()
            finally:
                db.close()

        join_another()
        before, _ = _list_campaign_queries(viewer)
        for _ in range(4):
            join_another()
        after, listed = _list_campaign_queries(viewer)

        assert listed == 5
        assert after == before


class TestAdminUserList:
    def test_query_count_does_not_grow_with_users(self):
        admin = CurrentUser(id="admin", username="admin", role="admin")

        def count() -> int:
            db = SessionLocal()
            try:
                with _counted(db) as statements:
                    list_users(admin, db=db)
                return len(statements)
            finally:
                db.close()

        _user("gm")
        _user("player")
        before = count()
        for role in ("gm", "player", "gm", "player"):
            _user(role)
        assert count() == before
