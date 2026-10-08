"""A system's shelf, browsed a page at a time (issue #221).

``/systems/{id}/book-groups``, ``/books`` and ``/book-facets`` replace the whole
book list ``GET /systems/{id}`` used to carry. They must reproduce what the
detail view did in the browser: group by category and subfolder (the part of
the path below the category directory), sort like ``bookComparator``, and apply
the filter bar's genre, product-code, tag, favourite, explicit and recency
filters - while still hiding what the user may not open.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

from backend.config import SessionLocal
from backend.models import Book
from backend.tests.conftest import make_book, make_game_system


def _uid(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


def _system(**kwargs):
    name = _uid("Sys")
    return make_game_system(name=name, slug=name.lower(), **kwargs), name


def _book(system, name, title, category="core", sub="", **kwargs):
    folder = f"{sub}/" if sub else ""
    return make_book(
        system.id,
        title=title,
        filename=f"{title}.pdf",
        relative_path=f"books/{name}/{category.title()}/{folder}{title}.pdf",
        category=category,
        **kwargs,
    )


def _get(client, headers, system, endpoint, **params):
    resp = client.get(f"/api/systems/{system.id}/{endpoint}", params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _titles(body) -> list:
    return [b["title"] for b in body["books"]]


class TestGroups:
    def test_categories_and_subfolders_with_counts(self, client, admin_headers):
        system, name = _system()
        _book(system, name, "A")
        _book(system, name, "B", sub="Monsters")
        _book(system, name, "C", sub="Monsters/Deep")
        _book(system, name, "D", category="adventures")
        body = _get(client, admin_headers, system, "book-groups")
        assert body["total"] == 4
        assert [(g["category"], g["path"], g["count"]) for g in body["groups"]] == [
            ("adventures", "", 1),
            ("core", "", 1),
            ("core", "Monsters", 1),
            ("core", "Monsters/Deep", 1),
        ]
        assert body["groups"][2]["dir"] == f"books/{name}/Core/Monsters"

    def test_first_value_follows_the_sort(self, client, admin_headers):
        system, name = _system()
        _book(system, name, "Old", sub="F", year=1990)
        _book(system, name, "New", sub="F", year=2010)
        asc = _get(client, admin_headers, system, "book-groups", sort="year")
        desc = _get(client, admin_headers, system, "book-groups", sort="year", order="desc")
        assert asc["groups"][0]["first"] == 1990
        assert desc["groups"][0]["first"] == 2010
        assert _get(client, admin_headers, system, "book-groups")["groups"][0]["first"] is None

    def test_first_product_code_is_natural(self, client, admin_headers):
        system, name = _system()
        _book(system, name, "A", sub="F", product_code="PZO10000")
        _book(system, name, "B", sub="F", product_code="PZO9001")
        body = _get(client, admin_headers, system, "book-groups", sort="product_code")
        assert body["groups"][0]["first"] == "PZO9001"

    def test_a_container_child_reads_its_category_one_level_deeper(self, client, admin_headers):
        parent, parent_name = _system(container_kind="edition")
        child = make_game_system(name=_uid("Child"), slug=_uid("child"), parent_id=parent.id)
        make_book(
            child.id,
            title="Nested",
            filename="Nested.pdf",
            relative_path=f"books/{parent_name}/{child.name}/Core/Sub/Nested.pdf",
            category="core",
        )
        body = _get(client, admin_headers, child, "book-groups")
        assert [(g["category"], g["path"]) for g in body["groups"]] == [("core", "Sub")]


class TestPages:
    def test_one_folder_only(self, client, admin_headers):
        system, name = _system()
        _book(system, name, "Root")
        _book(system, name, "Inside", sub="Monsters")
        _book(system, name, "Deeper", sub="Monsters/Deep")
        root = _get(client, admin_headers, system, "books", category="core", folder="")
        sub = _get(client, admin_headers, system, "books", category="core", folder="Monsters")
        assert _titles(root) == ["Root"]
        assert _titles(sub) == ["Inside"]

    def test_title_is_natural_and_pages_do_not_overlap(self, client, admin_headers):
        system, name = _system()
        for n in (10, 2, 1, 3):
            _book(system, name, f"Vol {n}")
        first = _get(client, admin_headers, system, "books", limit=2, offset=0)
        second = _get(client, admin_headers, system, "books", limit=2, offset=2)
        assert first["total"] == 4
        assert _titles(first) + _titles(second) == ["Vol 1", "Vol 2", "Vol 3", "Vol 10"]

    def test_year_puts_undated_last_both_ways(self, client, admin_headers):
        system, name = _system()
        _book(system, name, "A", year=2000)
        _book(system, name, "B", year=1980)
        _book(system, name, "C", year=None)
        asc = _get(client, admin_headers, system, "books", sort="year")
        desc = _get(client, admin_headers, system, "books", sort="year", order="desc")
        assert _titles(asc) == ["B", "A", "C"]
        assert _titles(desc) == ["A", "B", "C"]

    def test_product_code_is_natural_with_blanks_last(self, client, admin_headers):
        system, name = _system()
        _book(system, name, "Big", product_code="PZO10000")
        _book(system, name, "Small", product_code="PZO9001")
        _book(system, name, "None")
        body = _get(client, admin_headers, system, "books", sort="product_code")
        assert _titles(body) == ["Small", "Big", "None"]

    def test_folder_needs_a_category(self, client, admin_headers):
        system, _ = _system()
        resp = client.get(f"/api/systems/{system.id}/books?folder=x", headers=admin_headers)
        assert resp.status_code == 400

    def test_unknown_sort_is_rejected(self, client, admin_headers):
        system, _ = _system()
        resp = client.get(f"/api/systems/{system.id}/books?sort=colour", headers=admin_headers)
        assert resp.status_code == 422


class TestFilters:
    def _ids(self, client, headers, system, **params):
        return {b["id"] for b in _get(client, headers, system, "books", **params)["books"]}

    def test_genre_value_and_sentinels(self, client, admin_headers):
        system, name = _system()
        horror = _book(system, name, "H", genres=["Horror"])
        _book(system, name, "F", genres=["Fantasy"])
        bare = _book(system, name, "N", genres=[])
        assert self._ids(client, admin_headers, system, genre="horror") == {horror.id}
        assert self._ids(client, admin_headers, system, genre="__grim:none__") == {bare.id}
        assert len(self._ids(client, admin_headers, system, genre="__grim:any__")) == 2

    def test_product_code_prefix_and_sentinels(self, client, admin_headers):
        system, name = _system()
        pzo = _book(system, name, "P", product_code="PZO9001")
        _book(system, name, "T", product_code="TSR 9247")
        bare = _book(system, name, "N")
        assert self._ids(client, admin_headers, system, product_code="pzo") == {pzo.id}
        assert self._ids(client, admin_headers, system, product_code="__grim:none__") == {bare.id}

    def test_tags(self, client, admin_headers):
        system, name = _system()
        tag = _uid("tag")
        tagged = _book(system, name, "T", tags=[tag])
        untagged = _book(system, name, "U")
        assert self._ids(client, admin_headers, system, tags=json.dumps([tag])) == {tagged.id}
        none = json.dumps(["__grim:none__"])
        assert self._ids(client, admin_headers, system, tags=none) == {untagged.id}

    def test_search_text_and_field_prefixes(self, client, admin_headers):
        system, name = _system()
        dragon = _book(system, name, "Dragon Lair", authors=["Ann Author"])
        _book(system, name, "Goblin Den")
        assert self._ids(client, admin_headers, system, q="dragon") == {dragon.id}
        assert self._ids(client, admin_headers, system, q="author:ann") == {dragon.id}
        assert self._ids(client, admin_headers, system, q="year:1700") == set()

    def test_bare_text_also_matches_the_product_code(self, client, admin_headers):
        system, name = _system()
        coded = _book(system, name, "Plain", product_code="TSR 9247")
        _book(system, name, "Other")
        assert self._ids(client, admin_headers, system, q="tsr9247") == {coded.id}

    def test_explicit_favorites_and_recent(self, client, admin_headers):
        system, name = _system()
        spicy = _book(system, name, "S", is_explicit=True)
        liked = _book(system, name, "L")
        old = _book(system, name, "O")
        db = SessionLocal()
        try:
            db.query(Book).filter_by(id=old.id).update(
                {"added_at": datetime.now(timezone.utc) - timedelta(days=60)}
            )
            db.commit()
        finally:
            db.close()
        client.post("/api/favorites", json={"item_type": "book", "item_id": liked.id}, headers=admin_headers)
        assert self._ids(client, admin_headers, system, explicit="true") == {spicy.id}
        assert self._ids(client, admin_headers, system, favorites="true") == {liked.id}
        since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        assert old.id not in self._ids(client, admin_headers, system, added_since=since)

    def test_groups_take_the_same_filters(self, client, admin_headers):
        system, name = _system()
        _book(system, name, "H", sub="A", genres=["Horror"])
        _book(system, name, "F", sub="B", genres=["Fantasy"])
        body = _get(client, admin_headers, system, "book-groups", genre="Horror")
        assert [(g["path"], g["count"]) for g in body["groups"]] == [("A", 1)]


class TestVisibility:
    def test_restricted_books_are_left_out_for_a_player(
        self, client, admin_headers, player_headers
    ):
        system, name = _system()
        _book(system, name, "Open")
        _book(system, name, "Secret", access_level="gm")
        assert _get(client, admin_headers, system, "books")["total"] == 2
        assert _titles(_get(client, player_headers, system, "books")) == ["Open"]
        assert _get(client, player_headers, system, "book-groups")["total"] == 1

    def test_a_restricted_system_is_404(self, client, player_headers):
        system, _ = _system(access_level="gm")
        resp = client.get(f"/api/systems/{system.id}/books", headers=player_headers)
        assert resp.status_code == 404


class TestFacets:
    def test_values_across_the_whole_shelf(self, client, admin_headers):
        system, name = _system()
        tag = _uid("Facet")
        _book(system, name, "A", genres=["Horror"], product_code="PZO1", tags=[tag])
        _book(system, name, "B", category="adventures", genres=["Fantasy"], product_code="tsr 2")
        body = _get(client, admin_headers, system, "book-facets")
        assert body["categories"] == ["adventures", "core"]
        assert body["genres"] == ["Fantasy", "Horror"]
        assert body["product_code_prefixes"] == ["PZO", "TSR"]
        assert body["tags"] == [tag]


class TestSummary:
    def test_summary_without_books(self, client, admin_headers):
        system, name = _system()
        cover = _book(system, name, "Core Book", page_count=100, has_thumbnail=True)
        _book(system, name, "Other", category="adventures", page_count=50)
        body = client.get(
            f"/api/systems/{system.id}?include_books=false", headers=admin_headers
        ).json()
        assert body["books"] == []
        assert body["book_count"] == 2
        assert body["total_page_count"] == 150
        assert body["cover_book_id"] == cover.id
        assert body["scope_path"] == f"books/{name}"
