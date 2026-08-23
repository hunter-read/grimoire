"""Unit tests for the book access-control resolver (issue #258).

The centrepiece is ``test_filter_matches_resolver``: it builds every
combination of book level, system level, and category default, then asserts the
SQL filter in ``visible_books`` selects exactly the set that per-row
``can_access_book`` allows. The two implement the same rule twice — once in
Python for a single row, once in SQL for a whole list — and this is what stops
them drifting apart.
"""
import json
import uuid

import pytest

from backend.config import SessionLocal
from backend.models import AppSetting, Book, GameSystem, UserAccessGrant
from backend.models.access import (
    CATEGORY_DEFAULTS_KEY,
    LEVEL_ADMIN,
    LEVEL_GM,
    LEVEL_OPEN,
    SCOPE_BOOK,
    SCOPE_SYSTEM,
    is_inherit,
    most_restrictive,
    normalize,
    rank,
)
from backend.services import access_control as ac
from backend.services.access_control import AccessError

from .conftest import make_book, make_game_system


class _FakeUser:
    """Stand-in for CurrentUser — access decisions only read ``id`` and ``role``.

    Used for the cases that never touch the grants table. Anything that inserts
    a grant needs the ``real_user`` fixture instead, because
    ``user_access_grants`` carries a real foreign key to ``users``.
    """

    def __init__(self, role, id=None):
        self.role = role
        self.id = id or f"user-{uuid.uuid4()}"


@pytest.fixture
def real_user(client, admin_headers):
    """Factory for a real account, created through the API.

    ``user_access_grants.user_id`` is a genuine foreign key, so any test that
    inserts a grant needs a user row that actually exists. It has to go through
    the API rather than a direct INSERT: the app treats "no users yet" as
    "needs first-run setup", and a hand-inserted row makes the session-scoped
    admin fixture fail with "Server is already initialized".
    """

    def _make(role):
        uid = str(uuid.uuid4())[:8]
        resp = client.post(
            "/api/users",
            json={
                "username": f"{role}-{uid}",
                "password": "accesstestpass123",
                "role": role,
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201, resp.text
        return _FakeUser(role, id=resp.json()["id"])

    return _make


ADMIN = _FakeUser("admin")
GM = _FakeUser("gm")
PLAYER = _FakeUser("player")
GUEST = _FakeUser("guest")


@pytest.fixture
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture(autouse=True)
def clear_category_defaults(db):
    """Undo this module's global side effects after every test.

    Two kinds of state here outlive a test and would otherwise change what
    *other* modules see, since the suite shares one database: the
    ``restricted_categories`` app setting, and any book or system this module
    restricted. Both are cleared rather than merely reset, so a test elsewhere
    that lists books cannot start failing because this file ran first.

    Autouse rather than opt-in: the failure mode is a confusing failure in an
    unrelated file, which is exactly the kind of thing nobody remembers to
    annotate for.
    """
    before = {row[0] for row in db.query(Book.id).all()}
    yield
    db.query(AppSetting).filter_by(key=CATEGORY_DEFAULTS_KEY).delete()
    db.query(UserAccessGrant).delete()
    # Drop the rows this test created outright. Merely un-restricting them is
    # not enough: the exhaustive cascade test inserts 36 books per run, which is
    # sizeable next to the default page of /api/books, and leaving them behind
    # pushes other modules' fixtures off the first page.
    created = [row[0] for row in db.query(Book.id).filter(~Book.id.in_(before)).all()] if before else []
    if created:
        db.query(Book).filter(Book.id.in_(created)).delete(synchronize_session=False)
    db.query(GameSystem).filter(GameSystem.access_level != "").update(
        {GameSystem.access_level: ""}, synchronize_session=False
    )
    db.commit()


def _set_category_defaults(db, mapping):
    db.query(AppSetting).filter_by(key=CATEGORY_DEFAULTS_KEY).delete()
    db.add(AppSetting(key=CATEGORY_DEFAULTS_KEY, value=json.dumps(mapping)))
    db.commit()


# ---------------------------------------------------------------------------
# Level vocabulary
# ---------------------------------------------------------------------------


class TestLevelVocabulary:
    def test_normalize_treats_none_and_empty_as_open(self):
        assert normalize(None) == LEVEL_OPEN
        assert normalize("") == LEVEL_OPEN

    def test_normalize_fails_open_on_junk(self):
        assert normalize("superuser") == LEVEL_OPEN

    def test_is_inherit_distinguishes_null_from_explicit_open(self):
        assert is_inherit(None) is True
        assert is_inherit("") is False
        assert is_inherit(LEVEL_GM) is False

    def test_rank_is_ordered(self):
        assert rank(LEVEL_OPEN) < rank(LEVEL_GM) < rank(LEVEL_ADMIN)

    def test_most_restrictive(self):
        assert most_restrictive(LEVEL_OPEN, LEVEL_ADMIN, LEVEL_GM) == LEVEL_ADMIN
        assert most_restrictive() == LEVEL_OPEN
        assert most_restrictive(None, "") == LEVEL_OPEN


class TestRoleCeiling:
    def test_admin_sees_everything(self):
        assert ac.role_ceiling("admin") == LEVEL_ADMIN
        assert ac.sees_everything(ADMIN) is True

    def test_gm_reaches_gm_level(self):
        assert ac.role_ceiling("gm") == LEVEL_GM
        assert ac.sees_everything(GM) is False

    def test_players_and_guests_reach_only_open(self):
        assert ac.role_ceiling("player") == LEVEL_OPEN
        assert ac.role_ceiling("guest") == LEVEL_OPEN

    def test_unknown_role_is_locked_down(self):
        assert ac.role_ceiling("wizard") == LEVEL_OPEN
        assert ac.role_ceiling(None) == LEVEL_OPEN

    def test_only_gms_can_receive_grants(self):
        assert ac.can_receive_grants("gm") is True
        assert ac.can_receive_grants("admin") is False
        assert ac.can_receive_grants("player") is False
        assert ac.can_receive_grants("guest") is False


# ---------------------------------------------------------------------------
# Cascade
# ---------------------------------------------------------------------------


class TestResolveLevel:
    def test_open_by_default(self, db):
        system = make_game_system()
        book = make_book(system.id)
        assert ac.resolve_level(db, book) == LEVEL_OPEN

    def test_book_level_wins(self, db):
        system = make_game_system(access_level=LEVEL_GM)
        book = make_book(system.id, access_level=LEVEL_ADMIN)
        assert ac.resolve_level(db, book) == LEVEL_ADMIN

    def test_explicit_open_book_overrides_restricted_system(self, db):
        """The whole point of the three-state column."""
        system = make_game_system(access_level=LEVEL_ADMIN)
        book = make_book(system.id, access_level=LEVEL_OPEN)
        assert ac.resolve_level(db, book) == LEVEL_OPEN

    def test_inherits_system_level(self, db):
        system = make_game_system(access_level=LEVEL_ADMIN)
        book = make_book(system.id, access_level=None)
        assert ac.resolve_level(db, book) == LEVEL_ADMIN

    def test_falls_through_to_category_default(self, db, clear_category_defaults):
        _set_category_defaults(db, {"adventure": LEVEL_GM})
        system = make_game_system()
        book = make_book(system.id, category="adventure", access_level=None)
        assert ac.resolve_level(db, book) == LEVEL_GM

    def test_system_outranks_category_default(self, db, clear_category_defaults):
        _set_category_defaults(db, {"adventure": LEVEL_GM})
        system = make_game_system(access_level=LEVEL_ADMIN)
        book = make_book(system.id, category="adventure", access_level=None)
        assert ac.resolve_level(db, book) == LEVEL_ADMIN

    def test_book_with_no_system_uses_category_default(self, db, clear_category_defaults):
        _set_category_defaults(db, {"handout": LEVEL_ADMIN})
        book = make_book(None, category="handout", access_level=None)
        assert ac.resolve_level(db, book) == LEVEL_ADMIN


class TestCategoryDefaults:
    def test_absent_setting_is_empty(self, db, clear_category_defaults):
        db.query(AppSetting).filter_by(key=CATEGORY_DEFAULTS_KEY).delete()
        db.commit()
        assert ac.category_defaults(db) == {}

    def test_corrupt_json_fails_open(self, db, clear_category_defaults):
        db.add(AppSetting(key=CATEGORY_DEFAULTS_KEY, value="{not json"))
        db.commit()
        assert ac.category_defaults(db) == {}

    def test_non_object_json_fails_open(self, db, clear_category_defaults):
        db.add(AppSetting(key=CATEGORY_DEFAULTS_KEY, value='["adventure"]'))
        db.commit()
        assert ac.category_defaults(db) == {}

    def test_unrestrictable_categories_are_dropped_on_read(self, db, clear_category_defaults):
        _set_category_defaults(db, {"core": LEVEL_ADMIN, "adventure": LEVEL_GM})
        assert ac.category_defaults(db) == {"adventure": LEVEL_GM}

    def test_invalid_level_dropped_on_read(self, db, clear_category_defaults):
        _set_category_defaults(db, {"adventure": "wizard"})
        assert ac.category_defaults(db) == {}

    def test_validate_rejects_core(self):
        with pytest.raises(AccessError, match="cannot be restricted"):
            ac.validate_category_defaults({"core": LEVEL_ADMIN})

    def test_validate_rejects_character_sheet(self):
        with pytest.raises(AccessError, match="cannot be restricted"):
            ac.validate_category_defaults({"character-sheet": LEVEL_GM})

    def test_validate_rejects_bad_level(self):
        with pytest.raises(AccessError, match="invalid access level"):
            ac.validate_category_defaults({"adventure": "everyone"})

    def test_validate_rejects_non_object(self):
        with pytest.raises(AccessError):
            ac.validate_category_defaults(["adventure"])

    def test_validate_rejects_blank_category(self):
        with pytest.raises(AccessError):
            ac.validate_category_defaults({"  ": LEVEL_GM})

    def test_validate_drops_open_entries(self):
        assert ac.validate_category_defaults({"adventure": LEVEL_OPEN}) == {}
        assert ac.validate_category_defaults({"adventure": None}) == {}

    def test_validate_accepts_valid(self):
        assert ac.validate_category_defaults({"adventure": LEVEL_GM}) == {"adventure": LEVEL_GM}


class TestValidateLevel:
    def test_none_is_inherit_for_books(self):
        assert ac.validate_level(None) is None

    def test_none_becomes_open_when_inherit_disallowed(self):
        assert ac.validate_level(None, allow_inherit=False) == LEVEL_OPEN

    def test_rejects_junk(self):
        with pytest.raises(AccessError):
            ac.validate_level("superuser")

    def test_accepts_each_level(self):
        for level in (LEVEL_OPEN, LEVEL_GM, LEVEL_ADMIN):
            assert ac.validate_level(level) == level


# ---------------------------------------------------------------------------
# Per-user decisions
# ---------------------------------------------------------------------------


class TestCanAccessBook:
    def test_open_book_visible_to_all(self, db):
        book = make_book(make_game_system().id)
        for user in (ADMIN, GM, PLAYER, GUEST):
            assert ac.can_access_book(db, user, book) is True

    def test_gm_restricted_hides_players_and_guests(self, db):
        book = make_book(make_game_system().id, access_level=LEVEL_GM)
        assert ac.can_access_book(db, ADMIN, book) is True
        assert ac.can_access_book(db, GM, book) is True
        assert ac.can_access_book(db, PLAYER, book) is False
        assert ac.can_access_book(db, GUEST, book) is False

    def test_admin_only_hides_gms_too(self, db):
        book = make_book(make_game_system().id, access_level=LEVEL_ADMIN)
        assert ac.can_access_book(db, ADMIN, book) is True
        assert ac.can_access_book(db, GM, book) is False
        assert ac.can_access_book(db, PLAYER, book) is False


class TestGrants:
    def _grant(self, db, user, scope_type, scope_id, level):
        db.add(
            UserAccessGrant(
                user_id=user.id, scope_type=scope_type, scope_id=scope_id, level=level
            )
        )
        db.commit()

    def test_book_grant_opens_admin_only_book_for_gm(self, real_user, db):
        gm = real_user("gm")
        book = make_book(make_game_system().id, access_level=LEVEL_ADMIN)
        assert ac.can_access_book(db, gm, book) is False
        self._grant(db, gm, SCOPE_BOOK, book.id, LEVEL_ADMIN)
        assert ac.can_access_book(db, gm, book) is True

    def test_system_grant_covers_its_books(self, real_user, db):
        gm = real_user("gm")
        system = make_game_system(access_level=LEVEL_ADMIN)
        book = make_book(system.id, access_level=None)
        assert ac.can_access_book(db, gm, book) is False
        self._grant(db, gm, SCOPE_SYSTEM, system.id, LEVEL_ADMIN)
        assert ac.can_access_book(db, gm, book) is True

    def test_book_grant_outranks_system_grant(self, real_user, db):
        gm = real_user("gm")
        system = make_game_system()
        book = make_book(system.id, access_level=LEVEL_ADMIN)
        self._grant(db, gm, SCOPE_SYSTEM, system.id, LEVEL_ADMIN)
        self._grant(db, gm, SCOPE_BOOK, book.id, LEVEL_GM)
        # The book-scoped grant is the more specific statement, and gm < admin.
        assert ac.can_access_book(db, gm, book) is False

    def test_grants_do_not_help_players(self, real_user, db):
        player = real_user("player")
        book = make_book(make_game_system().id, access_level=LEVEL_GM)
        self._grant(db, player, SCOPE_BOOK, book.id, LEVEL_ADMIN)
        assert ac.can_access_book(db, player, book) is False

    def test_grants_do_not_help_guests(self, real_user, db):
        """A guest stays at the player ceiling even holding a maximal grant.

        The grant row is hung off a real account that is then evaluated *as* a
        guest, rather than creating a guest account: a real guest row would join
        the campaign eligible-members pool and break unrelated fixtures, and the
        role is all this path reads.
        """
        account = real_user("player")
        book = make_book(make_game_system().id, access_level=LEVEL_GM)
        self._grant(db, account, SCOPE_BOOK, book.id, LEVEL_ADMIN)
        guest = _FakeUser("guest", id=account.id)
        assert ac.can_access_book(db, guest, book) is False

    def test_insufficient_grant_level_still_denies(self, real_user, db):
        gm = real_user("gm")
        book = make_book(make_game_system().id, access_level=LEVEL_ADMIN)
        self._grant(db, gm, SCOPE_BOOK, book.id, LEVEL_GM)
        assert ac.can_access_book(db, gm, book) is False

    def test_granted_level_open_without_grants(self, real_user, db):
        gm = real_user("gm")
        book = make_book(make_game_system().id)
        assert ac.granted_level(db, gm, book) == LEVEL_OPEN


class TestCanAccessSystem:
    def test_open_system_visible_to_all(self, db):
        system = make_game_system()
        for user in (ADMIN, GM, PLAYER, GUEST):
            assert ac.can_access_system(db, user, system) is True

    def test_restricted_system_hidden(self, db):
        system = make_game_system(access_level=LEVEL_ADMIN)
        assert ac.can_access_system(db, ADMIN, system) is True
        assert ac.can_access_system(db, GM, system) is False
        assert ac.can_access_system(db, PLAYER, system) is False

    def test_grant_reveals_system_to_gm(self, real_user, db):
        gm = real_user("gm")
        system = make_game_system(access_level=LEVEL_ADMIN)
        db.add(
            UserAccessGrant(
                user_id=gm.id, scope_type=SCOPE_SYSTEM, scope_id=system.id, level=LEVEL_ADMIN
            )
        )
        db.commit()
        assert ac.can_access_system(db, gm, system) is True

    def test_grant_does_not_reveal_system_to_player(self, real_user, db):
        player = real_user("player")
        system = make_game_system(access_level=LEVEL_GM)
        db.add(
            UserAccessGrant(
                user_id=player.id, scope_type=SCOPE_SYSTEM, scope_id=system.id, level=LEVEL_ADMIN
            )
        )
        db.commit()
        assert ac.can_access_system(db, player, system) is False


# ---------------------------------------------------------------------------
# The SQL filter must agree with the per-row resolver
# ---------------------------------------------------------------------------


class TestVisibleBooksFilter:
    @pytest.mark.parametrize("role", ["admin", "gm", "player", "guest"])
    def test_filter_matches_resolver(self, db, clear_category_defaults, role):
        """Exhaustive cross-check of the SQL filter against can_access_book.

        Every (book level x system level x category) combination is created and
        both implementations are asked about it. Any divergence — a book the
        list hides but the detail route allows, or worse the reverse — fails here.
        """
        _set_category_defaults(db, {"adventure": LEVEL_GM, "handout": LEVEL_ADMIN})
        user = _FakeUser(role)

        levels = [None, LEVEL_OPEN, LEVEL_GM, LEVEL_ADMIN]
        made = []
        for sys_level in (LEVEL_OPEN, LEVEL_GM, LEVEL_ADMIN):
            system = make_game_system(access_level=sys_level)
            for book_level in levels:
                for category in ("core", "adventure", "handout"):
                    made.append(
                        make_book(system.id, access_level=book_level, category=category)
                    )

        made_ids = {b.id for b in made}
        expected = {b.id for b in made if ac.can_access_book(db, user, b)}

        filtered = ac.visible_books(db, db.query(Book), user).all()
        actual = {b.id for b in filtered if b.id in made_ids}

        assert actual == expected, (
            f"role={role}: filter and resolver disagree on "
            f"{sorted(actual ^ expected)}"
        )

    def test_admin_query_is_unfiltered(self, db):
        q = db.query(Book)
        assert ac.visible_books(db, q, ADMIN) is q

    def test_grant_widens_the_filter(self, real_user, db):
        gm = real_user("gm")
        system = make_game_system(access_level=LEVEL_ADMIN)
        book = make_book(system.id, access_level=None)

        visible = {b.id for b in ac.visible_books(db, db.query(Book), gm).all()}
        assert book.id not in visible

        db.add(
            UserAccessGrant(
                user_id=gm.id, scope_type=SCOPE_SYSTEM, scope_id=system.id, level=LEVEL_ADMIN
            )
        )
        db.commit()
        visible = {b.id for b in ac.visible_books(db, db.query(Book), gm).all()}
        assert book.id in visible

    def test_book_grant_widens_the_filter(self, real_user, db):
        gm = real_user("gm")
        book = make_book(make_game_system().id, access_level=LEVEL_ADMIN)
        db.add(
            UserAccessGrant(
                user_id=gm.id, scope_type=SCOPE_BOOK, scope_id=book.id, level=LEVEL_ADMIN
            )
        )
        db.commit()
        assert book.id in {b.id for b in ac.visible_books(db, db.query(Book), gm).all()}

    def test_visible_book_ids_matches_filter(self, real_user, db):
        gm = real_user("gm")
        book = make_book(make_game_system().id, access_level=LEVEL_ADMIN)
        assert book.id not in ac.visible_book_ids(db, gm)


class TestVisibleSystemsFilter:
    def test_restricted_system_excluded(self, db):
        system = make_game_system(access_level=LEVEL_ADMIN)
        assert system.id not in {
            s.id for s in ac.visible_systems(db, db.query(GameSystem), GM).all()
        }
        assert system.id in {
            s.id for s in ac.visible_systems(db, db.query(GameSystem), ADMIN).all()
        }

    def test_admin_query_is_unfiltered(self, db):
        q = db.query(GameSystem)
        assert ac.visible_systems(db, q, ADMIN) is q

    def test_grant_widens_the_filter(self, real_user, db):
        gm = real_user("gm")
        system = make_game_system(access_level=LEVEL_ADMIN)
        db.add(
            UserAccessGrant(
                user_id=gm.id, scope_type=SCOPE_SYSTEM, scope_id=system.id, level=LEVEL_ADMIN
            )
        )
        db.commit()
        assert system.id in {
            s.id for s in ac.visible_systems(db, db.query(GameSystem), gm).all()
        }
