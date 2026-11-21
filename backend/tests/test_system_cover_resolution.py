"""Which book a system's card shows as its cover (``services.systems``).

``resolve_cover_book_ids`` picks every card's cover in a fixed number of queries,
for the library grid; ``resolve_cover_book_id`` is one system's entry of it. Who
may see which cover is tested through the API in ``test_access_control_api``.
"""
from backend.config import SessionLocal
from backend.models import GameSystem
from backend.services.systems import (
    resolve_cover_book_id,
    resolve_cover_book_ids,
    visible_cover_id,
    visible_cover_ids,
)
from backend.tests.conftest import make_book, make_game_system

ADMIN = type("Admin", (), {"id": "admin", "role": "admin"})()


def _covers(*systems: GameSystem) -> dict:
    db = SessionLocal()
    try:
        return resolve_cover_book_ids(db, systems, ADMIN)
    finally:
        db.close()


class TestAutoCover:
    def test_a_core_book_wins_over_an_earlier_title_elsewhere(self):
        system = make_game_system()
        make_book(system.id, title="Aardvark", category="adventures", has_thumbnail=True)
        core = make_book(system.id, title="Zebra", has_thumbnail=True)
        assert _covers(system) == {system.id: core.id}

    def test_first_title_among_core_books(self):
        system = make_game_system()
        make_book(system.id, title="Monsters", has_thumbnail=True)
        first = make_book(system.id, title="Core Rules", has_thumbnail=True)
        assert _covers(system)[system.id] == first.id

    def test_falls_back_to_any_book_when_no_core_book_has_a_thumbnail(self):
        system = make_game_system()
        make_book(system.id, title="Core Rules", has_thumbnail=False)
        other = make_book(system.id, title="Bestiary", category="supplements", has_thumbnail=True)
        assert _covers(system)[system.id] == other.id

    def test_skips_variants(self):
        system = make_game_system()
        main = make_book(system.id, title="Rules", has_thumbnail=True)
        make_book(system.id, title="A Printer Friendly", has_thumbnail=True, variant_parent_id=main.id)
        assert _covers(system)[system.id] == main.id

    def test_none_without_a_thumbnailed_book(self):
        system = make_game_system()
        make_book(system.id, has_thumbnail=False)
        assert _covers(system) == {system.id: None}

    def test_a_container_never_borrows_a_book(self):
        container = make_game_system(container_kind="parent")
        make_book(container.id, has_thumbnail=True)
        assert _covers(container) == {container.id: None}

    def test_each_system_gets_its_own_book(self):
        one, two, empty = make_game_system(), make_game_system(), make_game_system()
        a = make_book(one.id, has_thumbnail=True)
        b = make_book(two.id, has_thumbnail=True)
        assert _covers(one, two, empty) == {one.id: a.id, two.id: b.id, empty.id: None}


class TestExplicitCover:
    def test_wins_over_the_auto_cover(self):
        system = make_game_system()
        make_book(system.id, title="A Core", has_thumbnail=True)
        chosen = make_book(system.id, title="Z Chosen", category="art", has_thumbnail=False)
        system = make_game_system(cover_book_id=chosen.id)
        assert _covers(system)[system.id] == chosen.id

    def test_a_container_keeps_its_explicit_cover(self):
        donor = make_game_system()
        book = make_book(donor.id, has_thumbnail=True)
        container = make_game_system(container_kind="parent", cover_book_id=book.id)
        assert _covers(container)[container.id] == book.id

    def test_a_dangling_id_is_left_as_it_was(self):
        system = make_game_system(cover_book_id="no-such-book")
        player = type("Player", (), {"id": "nobody", "role": "player"})()
        db = SessionLocal()
        try:
            assert visible_cover_ids(db, ["no-such-book", None, ""], player) == {"no-such-book"}
            assert visible_cover_id(db, "no-such-book", player) == "no-such-book"
            assert visible_cover_id(db, None, player) is None
            assert resolve_cover_book_id(db, system, player) == "no-such-book"
        finally:
            db.close()


def test_no_systems_no_queries():
    db = SessionLocal()
    try:
        assert resolve_cover_book_ids(db, [], ADMIN) == {}
        assert visible_cover_ids(db, [], ADMIN) == set()
    finally:
        db.close()
