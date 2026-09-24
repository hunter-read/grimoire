"""Tests for field-scoped search and book title matching (issue #343).

Covers the query parser in isolation and the endpoint behaviour it drives: a
bare query now surfaces books by title alongside page hits, and a `field:`
filter narrows to metadata while suppressing the page-text search.
"""
import pytest
from sqlalchemy import text

from backend.config import SessionLocal
from backend.routers.search._query import parse_query, to_fts_query, year_bounds
from backend.tests.conftest import make_book, make_game_system, make_map


class TestParseQuery:
    def test_bare_query_is_free_text(self):
        parsed = parse_query("avatar legends")
        assert parsed.filters == {}
        assert parsed.free_text == "avatar legends"
        assert parsed.content_query == "avatar legends"

    def test_field_prefix_is_extracted(self):
        parsed = parse_query("title:avatar")
        assert parsed.filters == {"title": ["avatar"]}
        assert parsed.free_text == ""

    def test_metadata_filter_suppresses_content_search(self):
        # The heart of the issue: title: must not search page text.
        assert parse_query("title:avatar").content_query == ""
        assert parse_query("author:gygax").content_query == ""

    def test_text_field_forces_content_search(self):
        assert parse_query("text:fireball").content_query == "fireball"
        assert parse_query("content:fireball").content_query == "fireball"

    def test_text_field_combines_with_free_text(self):
        assert parse_query("text:fireball dragon").content_query == "fireball dragon"

    def test_quoted_phrase_stays_one_value(self):
        assert parse_query('title:"Avatar Legends"').filters == {"title": ["Avatar Legends"]}
        assert parse_query("title:'Avatar Legends'").filters == {"title": ["Avatar Legends"]}

    def test_quoted_free_text_reaches_fts_as_a_phrase(self):
        # Issue #473. The test above only ever covered a *field* filter, so it
        # passed while free-text phrases were flattened: the tokenizer consumed
        # the quotes, the value was joined into free_text, and to_fts_query
        # re-split it into two barewords — an implicit AND.
        assert parse_query('"lucky feat"').content_query == '"lucky feat"'
        assert parse_query("'lucky feat'").content_query == '"lucky feat"'

    def test_unquoted_words_still_and(self):
        # The counterpart the fix must not break: no quotes typed, no phrase.
        assert parse_query("lucky feat").content_query == "lucky feat"

    def test_phrase_keeps_its_boundary_alongside_barewords(self):
        parsed = parse_query('"opportunity attack" wizard')
        assert parsed.free_terms == ["opportunity attack", "wizard"]
        assert parsed.content_query == '"opportunity attack" wizard'

    def test_free_text_still_joins_terms(self):
        # free_text feeds the SQL LIKE branches in _books.py and _helpers.py,
        # which want the flat string. Only FTS5 needs the boundaries.
        assert parse_query('"lucky feat"').free_text == "lucky feat"

    def test_text_filter_phrase_reaches_fts_as_a_phrase(self):
        # text:/content:/page: is skipped by _apply_field_filters and routed to
        # FTS5, so it shared the defect. The LIKE-based filters did not.
        assert parse_query('text:"lucky feat"').content_query == '"lucky feat"'
        assert parse_query('content:"lucky feat" wizard').content_query == '"lucky feat" wizard'

    def test_repeated_field_collects_values(self):
        assert parse_query("tag:forest tag:swamp").filters == {"tag": ["forest", "swamp"]}

    def test_aliases_map_to_canonical_field(self):
        assert parse_query("name:x").filters == {"title": ["x"]}
        assert parse_query("sku:x").filters == {"code": ["x"]}
        assert parse_query("product_code:x").filters == {"code": ["x"]}
        assert parse_query("game:x").filters == {"system": ["x"]}
        assert parse_query("authors:x").filters == {"author": ["x"]}

    def test_unknown_prefix_falls_back_to_free_text(self):
        # A colon is ordinary punctuation in a book title; rejecting it would be
        # worse than searching for it literally.
        parsed = parse_query("Vaesen: Nordic Horror")
        assert parsed.filters == {}
        assert "Vaesen:" in parsed.free_text
        # Quoted into an FTS5 phrase: a bare "Vaesen:" would be a column filter.
        assert parsed.content_query == '"Vaesen:" Nordic Horror'

    def test_unknown_prefix_with_value_is_preserved_verbatim(self):
        assert parse_query("foo:bar").free_text == "foo:bar"

    def test_unknown_prefix_with_quoted_value_stays_one_literal(self):
        # Behaviour change from #473, pinned deliberately. The token keeps its
        # quotes and its spaces, so FTS5 gets one literal; the old whitespace
        # re-split tore it into 'foo:"bar' and 'baz"' and ANDed the halves.
        parsed = parse_query('foo:"bar baz"')
        assert parsed.free_terms == ['foo:"bar baz"']
        assert parsed.content_query == '"foo:""bar baz"""'

    def test_empty_value_after_prefix_is_ignored(self):
        assert parse_query('title:"" dragon').filters == {}
        assert parse_query('title:"" dragon').free_text == "dragon"

    def test_leftover_free_text_kept_alongside_filter(self):
        parsed = parse_query("title:avatar legends")
        assert parsed.filters == {"title": ["avatar"]}
        assert parsed.free_text == "legends"

    def test_books_only_detection(self):
        assert parse_query("author:gygax").books_only is True
        assert parse_query("year:1999").books_only is True
        assert parse_query("text:x").books_only is True
        assert parse_query("title:avatar").books_only is False
        assert parse_query("tag:forest").books_only is False
        assert parse_query("avatar").books_only is False

    def test_case_insensitive_prefix(self):
        assert parse_query("TITLE:avatar").filters == {"title": ["avatar"]}


class TestYearBounds:
    def test_exact_year(self):
        assert year_bounds(["1999"]) == (1999, 1999)

    def test_open_ranges(self):
        assert year_bounds([">1999"]) == (2000, None)
        assert year_bounds([">=1999"]) == (1999, None)
        assert year_bounds(["<2005"]) == (None, 2004)
        assert year_bounds(["<=2005"]) == (None, 2005)

    def test_closed_range(self):
        assert year_bounds(["1999-2005"]) == (1999, 2005)

    def test_unparseable_is_no_constraint(self):
        # A typo should not silently hide the whole library.
        assert year_bounds(["nineteen"]) == (None, None)
        assert year_bounds([]) == (None, None)


@pytest.fixture(scope="module")
def title_library():
    """A system with books whose titles/metadata are the thing under test."""
    system = make_game_system(name="Powered by the Apocalypse", slug="pbta")
    other = make_game_system(name="Dungeons & Dragons 5e", slug="dnd5e")

    core = make_book(
        system_id=system.id,
        title="Avatar Legends Core Rulebook",
        authors=["Magpie Games"],
        publisher="Magpie Games",
        year=2022,
        category="core",
    )
    # Mentions "avatar" in its text but not its title — the noise the issue is about.
    noisy = make_book(
        system_id=other.id,
        title="Monster Manual",
        authors=["Gary Gygax"],
        publisher="Wizards of the Coast",
        year=2014,
        category="supplement",
        tags=["bestiary"],
    )
    db = SessionLocal()
    try:
        for page, content in ((1, "the avatar state is a powerful thing"), (2, "avatar again")):
            db.execute(
                text(
                    "INSERT INTO book_search (book_id, page_number, content) "
                    "VALUES (:bid, :pn, :content)"
                ),
                {"bid": noisy.id, "pn": page, "content": content},
            )
        db.commit()
    finally:
        db.close()

    map_row = make_map(filename="Avatar Temple.png", relative_path="maps/temples/Avatar Temple.png")
    return {"system": system, "core": core, "noisy": noisy, "map": map_row}


class TestBookTitleMatching:
    def test_bare_query_returns_title_match(self, client, admin_headers, title_library):
        resp = client.get("/api/search?q=avatar", headers=admin_headers)
        assert resp.status_code == 200
        ids = [b["id"] for b in resp.json()["book_matches"]]
        assert title_library["core"].id in ids

    def test_bare_query_still_returns_page_hits(self, client, admin_headers, title_library):
        resp = client.get("/api/search?q=avatar", headers=admin_headers)
        page_ids = [r["id"] for r in resp.json()["results"]]
        assert title_library["noisy"].id in page_ids

    def test_title_filter_suppresses_page_hits(self, client, admin_headers, title_library):
        resp = client.get("/api/search?q=title:avatar", headers=admin_headers)
        body = resp.json()
        assert body["results"] == []
        assert [b["id"] for b in body["book_matches"]] == [title_library["core"].id]

    def test_book_match_shape_carries_cover_metadata(self, client, admin_headers, title_library):
        resp = client.get("/api/search?q=title:avatar", headers=admin_headers)
        hit = resp.json()["book_matches"][0]
        for key in ("id", "title", "game_system", "authors", "has_thumbnail", "tags", "page_count"):
            assert key in hit
        assert hit["authors"] == ["Magpie Games"]

    def test_author_filter_matches_json_list(self, client, admin_headers, title_library):
        resp = client.get("/api/search?q=author:gygax", headers=admin_headers)
        ids = [b["id"] for b in resp.json()["book_matches"]]
        assert title_library["noisy"].id in ids
        assert title_library["core"].id not in ids

    def test_system_filter_matches_name_or_slug(self, client, admin_headers, title_library):
        by_slug = client.get("/api/search?q=system:pbta", headers=admin_headers).json()
        assert title_library["core"].id in [b["id"] for b in by_slug["book_matches"]]
        by_name = client.get(
            "/api/search?q=system:Apocalypse", headers=admin_headers
        ).json()
        assert title_library["core"].id in [b["id"] for b in by_name["book_matches"]]

    def test_category_filter(self, client, admin_headers, title_library):
        resp = client.get("/api/search?q=category:supplement", headers=admin_headers)
        ids = [b["id"] for b in resp.json()["book_matches"]]
        assert title_library["noisy"].id in ids
        assert title_library["core"].id not in ids

    def test_year_filter_range(self, client, admin_headers, title_library):
        resp = client.get("/api/search?q=year:2020-2025", headers=admin_headers)
        ids = [b["id"] for b in resp.json()["book_matches"]]
        assert title_library["core"].id in ids
        assert title_library["noisy"].id not in ids

    def test_publisher_filter(self, client, admin_headers, title_library):
        resp = client.get("/api/search?q=publisher:Magpie", headers=admin_headers)
        ids = [b["id"] for b in resp.json()["book_matches"]]
        assert title_library["core"].id in ids

    def test_tag_filter_matches_books(self, client, admin_headers, title_library):
        resp = client.get("/api/search?q=tag:bestiary", headers=admin_headers)
        ids = [b["id"] for b in resp.json()["book_matches"]]
        assert title_library["noisy"].id in ids

    def test_unmatched_tag_returns_nothing_rather_than_everything(
        self, client, admin_headers, title_library
    ):
        resp = client.get("/api/search?q=tag:no-such-tag-anywhere", headers=admin_headers)
        assert resp.json()["book_matches"] == []

    def test_combined_filters_are_anded(self, client, admin_headers, title_library):
        resp = client.get(
            "/api/search?q=title:avatar%20category:supplement", headers=admin_headers
        )
        assert resp.json()["book_matches"] == []

    def test_exact_title_ranks_above_substring(self, client, admin_headers, title_library):
        system = title_library["system"]
        exact = make_book(system_id=system.id, title="Dragon")
        make_book(system_id=system.id, title="The Book of Many Dragons")
        resp = client.get("/api/search?q=title:dragon", headers=admin_headers)
        ids = [b["id"] for b in resp.json()["book_matches"]]
        assert ids[0] == exact.id

    def test_fields_echoed_back(self, client, admin_headers, title_library):
        resp = client.get("/api/search?q=title:avatar%20system:pbta", headers=admin_headers)
        assert resp.json()["fields"] == ["system", "title"]

    def test_book_scoped_search_returns_no_title_matches(
        self, client, admin_headers, title_library
    ):
        # Inside a book there is nothing to pin — the user is already there.
        resp = client.get(
            f"/api/search?q=avatar&book_id={title_library['noisy'].id}", headers=admin_headers
        )
        assert resp.json()["book_matches"] == []

    def test_variants_are_excluded_from_title_matches(self, client, admin_headers, title_library):
        parent = make_book(system_id=title_library["system"].id, title="Grimoire Primer")
        make_book(
            system_id=title_library["system"].id,
            title="Grimoire Primer (Printer Friendly)",
            variant_parent_id=parent.id,
        )
        resp = client.get("/api/search?q=title:Grimoire%20Primer", headers=admin_headers)
        ids = [b["id"] for b in resp.json()["book_matches"]]
        assert ids == [parent.id]


class TestMediaFieldFilters:
    def test_title_filter_matches_map_filename(self, client, admin_headers, title_library):
        resp = client.get("/api/search?q=title:avatar", headers=admin_headers)
        ids = [m["id"] for m in resp.json()["maps"]]
        assert title_library["map"].id in ids

    def test_book_only_filter_suppresses_media(self, client, admin_headers, title_library):
        # "author:" cannot describe a map, so returning every map would read as
        # though the filter had been ignored.
        body = client.get("/api/search?q=author:gygax", headers=admin_headers).json()
        assert body["maps"] == []
        assert body["tokens"] == []
        assert body["audio"] == []

    def test_bare_query_still_matches_media(self, client, admin_headers, title_library):
        ids = [m["id"] for m in client.get("/api/search?q=avatar", headers=admin_headers).json()["maps"]]
        assert title_library["map"].id in ids

    def test_maps_include_thumbnail_flag(self, client, admin_headers, title_library):
        maps = client.get("/api/search?q=avatar", headers=admin_headers).json()["maps"]
        assert "has_thumbnail" in maps[0]


class TestSearchFieldsEndpoint:
    def test_lists_fields_with_aliases(self, client, admin_headers):
        resp = client.get("/api/search/fields", headers=admin_headers)
        assert resp.status_code == 200
        fields = resp.json()["fields"]
        by_name = {f["field"]: f["aliases"] for f in fields}
        assert "title" in by_name
        assert "name" in by_name["title"]
        assert "text" in by_name
        # A field is never listed as its own alias.
        assert all(f["field"] not in f["aliases"] for f in fields)


class TestRemainingFieldFilters:
    """The filter branches the main fixture does not exercise."""

    @pytest.fixture(scope="class")
    def detailed_book(self, title_library):
        return make_book(
            system_id=title_library["system"].id,
            title="Field Coverage Compendium",
            filename="field-coverage-compendium.pdf",
            artists=["Ada Lovelace"],
            isbn="9781234567897",
            language="en",
            description="A compendium about arcane cartography.",
        )

    def test_artist_filter(self, client, admin_headers, detailed_book):
        ids = [
            b["id"]
            for b in client.get("/api/search?q=artist:Lovelace", headers=admin_headers).json()[
                "book_matches"
            ]
        ]
        assert detailed_book.id in ids

    def test_isbn_filter(self, client, admin_headers, detailed_book):
        ids = [
            b["id"]
            for b in client.get(
                "/api/search?q=isbn:9781234567897", headers=admin_headers
            ).json()["book_matches"]
        ]
        assert detailed_book.id in ids

    def test_language_filter(self, client, admin_headers, detailed_book):
        ids = [
            b["id"]
            for b in client.get("/api/search?q=language:en", headers=admin_headers).json()[
                "book_matches"
            ]
        ]
        assert detailed_book.id in ids

    def test_description_filter(self, client, admin_headers, detailed_book):
        ids = [
            b["id"]
            for b in client.get(
                "/api/search?q=description:cartography", headers=admin_headers
            ).json()["book_matches"]
        ]
        assert detailed_book.id in ids

    def test_filename_filter(self, client, admin_headers, detailed_book):
        ids = [
            b["id"]
            for b in client.get(
                "/api/search?q=filename:field-coverage", headers=admin_headers
            ).json()["book_matches"]
        ]
        assert detailed_book.id in ids

    def test_bare_query_matches_filename(self, client, admin_headers, detailed_book):
        # A book whose title never got cleaned up is still findable by disk name.
        ids = [
            b["id"]
            for b in client.get(
                "/api/search?q=field-coverage-compendium", headers=admin_headers
            ).json()["book_matches"]
        ]
        assert detailed_book.id in ids

    def test_impossible_year_range_returns_nothing(self, client, admin_headers, detailed_book):
        resp = client.get("/api/search?q=year:2020-1990", headers=admin_headers)
        assert resp.json()["book_matches"] == []

    def test_open_ended_year_filter(self, client, admin_headers, title_library):
        ids = [
            b["id"]
            for b in client.get("/api/search?q=year:>2020", headers=admin_headers).json()[
                "book_matches"
            ]
        ]
        assert title_library["core"].id in ids
        assert title_library["noisy"].id not in ids

    def test_media_only_filter_returns_no_books(self, client, admin_headers, title_library):
        # "album:" describes audio; no book should be invented to satisfy it.
        body = client.get("/api/search?q=album:nothing-here", headers=admin_headers).json()
        assert body["book_matches"] == []


class TestFtsSafety:
    """Punctuation in a search box must not reach FTS5 as an operator.

    Book titles are full of the characters FTS5 bareword syntax reserves — "D&D",
    "Star Wars - Edge of the Empire" — and each of them made the endpoint return
    500 before the query was quoted into phrases.
    """

    def test_bareword_is_left_unquoted(self):
        assert to_fts_query("fireball") == "fireball"

    def test_prefix_search_survives(self):
        # FTS5 prefix matching is worth preserving; quoting would kill it.
        assert to_fts_query("fire*") == "fire*"

    def test_hyphenated_token_is_quoted(self):
        assert to_fts_query("edge-of-empire") == '"edge-of-empire"'

    def test_ampersand_is_quoted(self):
        assert to_fts_query("D&D") == '"D&D"'

    def test_embedded_quote_is_doubled(self):
        assert to_fts_query('say"hi') == '"say""hi"'

    def test_empty_input(self):
        assert to_fts_query("") == ""

    def test_well_formed_boolean_operators_are_preserved(self):
        # "fireball OR lightning" is a genuinely useful query and must keep working.
        assert to_fts_query("fireball OR lightning") == "fireball OR lightning"
        assert to_fts_query("fireball AND wizard") == "fireball AND wizard"

    def test_dangling_operators_become_literals(self):
        assert to_fts_query("trailing AND") == 'trailing "AND"'
        assert to_fts_query("AND leading") == '"AND" leading'
        assert to_fts_query("a AND OR b") == 'a "AND" "OR" b'

    # Every case above passes a single token. Issue #473 turned on what the
    # function does with multi-word input, which it had never been asked.

    def test_multi_word_token_becomes_a_phrase(self):
        assert to_fts_query(["lucky feat"]) == '"lucky feat"'
        assert to_fts_query(["opportunity attack", "wizard"]) == '"opportunity attack" wizard'

    def test_string_input_still_splits_on_whitespace(self):
        # The str form keeps its old meaning, so a caller that has no token
        # boundaries to offer behaves exactly as it did before.
        assert to_fts_query("lucky feat") == "lucky feat"

    def test_operators_survive_a_token_sequence(self):
        assert to_fts_query(["fireball", "OR", "lightning"]) == "fireball OR lightning"
        assert to_fts_query(["trailing", "AND"]) == 'trailing "AND"'

    def test_operator_inside_a_phrase_is_not_an_operator(self):
        # "AND" is an operator only as a whole token. Inside a phrase it is text.
        assert to_fts_query(["hold the line AND wait"]) == '"hold the line AND wait"'

    def test_embedded_quote_inside_a_phrase_is_doubled(self):
        assert to_fts_query(['say "hi" now']) == '"say ""hi"" now"'

    @pytest.mark.parametrize(
        "query",
        [
            "D&D",
            "edge-of-the-empire",
            "trailing AND",
            "NEAR(",
            'quote"inside',
            "colon:in:middle",
            "(unbalanced",
        ],
    )
    def test_punctuation_queries_do_not_500(self, client, admin_headers, query, title_library):
        resp = client.get("/api/search", params={"q": query}, headers=admin_headers)
        assert resp.status_code == 200

    def test_hyphenated_free_text_finds_book_by_filename(
        self, client, admin_headers, title_library
    ):
        book = make_book(
            system_id=title_library["system"].id,
            title="Edge of the Empire",
            filename="edge-of-the-empire.pdf",
        )
        resp = client.get("/api/search", params={"q": "edge-of-the-empire"}, headers=admin_headers)
        assert resp.status_code == 200
        assert book.id in [b["id"] for b in resp.json()["book_matches"]]


@pytest.fixture(scope="module")
def phrase_library():
    """Pages that tell a real phrase match apart from a mere co-occurrence.

    Page 1 has the words adjacent; pages 2 and 3 have both words far apart. A
    phrase query must return only page 1, an unquoted query all three. That gap
    is what issue #473 measured against a live library — the endpoint returned
    the co-occurrence count every time.
    """
    system = make_game_system(name="Phrase Probe System", slug="phrase-probe")
    book = make_book(
        system_id=system.id,
        title="Phrase Probe",
        filename="phrase-probe.pdf",
    )
    db = SessionLocal()
    try:
        pages = (
            (1, "you may reroll once per rest using the lucky feat"),
            (2, "a lucky roll can beat almost any feat of strength"),
            (3, "the feat list is lucky to be as short as it is"),
        )
        for page, content in pages:
            db.execute(
                text(
                    "INSERT INTO book_search (book_id, page_number, content) "
                    "VALUES (:bid, :pn, :content)"
                ),
                {"bid": book.id, "pn": page, "content": content},
            )
        db.commit()
    finally:
        db.close()
    return {"system": system, "book": book}


class TestQuotedPhraseSearch:
    """Phrase matching end to end against real FTS5 (issue #473).

    The parser tests prove the right query string is built; these prove SQLite
    agrees. Both existing layers of coverage asserted on parser output alone,
    which is how a builder that never asked FTS5 for a phrase went unnoticed.
    """

    def _pages(self, client, headers, q):
        resp = client.get("/api/search", params={"q": q}, headers=headers)
        assert resp.status_code == 200
        return sorted(r["page_number"] for r in resp.json()["results"])

    def test_quoted_phrase_matches_only_adjacent_words(self, client, admin_headers, phrase_library):
        assert self._pages(client, admin_headers, '"lucky feat"') == [1]

    def test_single_quoted_phrase_behaves_the_same(self, client, admin_headers, phrase_library):
        assert self._pages(client, admin_headers, "'lucky feat'") == [1]

    def test_unquoted_words_still_match_co_occurrence(self, client, admin_headers, phrase_library):
        # The AND is correct when nobody asked for a phrase. It was only wrong
        # as a silent substitute for one.
        assert self._pages(client, admin_headers, "lucky feat") == [1, 2, 3]

    def test_text_filter_phrase_matches_only_adjacent_words(
        self, client, admin_headers, phrase_library
    ):
        assert self._pages(client, admin_headers, 'text:"lucky feat"') == [1]


class TestProductCodeSearch:
    """The publisher's catalogue number is searchable (issue #479)."""

    @pytest.fixture(scope="class")
    def coded(self, title_library):
        system_id = title_library["system"].id
        return {
            "paizo": make_book(
                system_id=system_id,
                title="Monster Compendium Volume",
                filename="monsters.pdf",
                product_code="PZO9001",
            ),
            "tsr": make_book(
                system_id=system_id,
                title="Castle on the Hill",
                filename="castle.pdf",
                product_code="TSR 9247",
            ),
        }

    def _ids(self, client, headers, q):
        resp = client.get("/api/search", params={"q": q}, headers=headers)
        assert resp.status_code == 200
        return {b["id"] for b in resp.json()["book_matches"]}

    def test_code_filter(self, client, admin_headers, coded):
        ids = self._ids(client, admin_headers, "code:pzo9001")
        assert ids == {coded["paizo"].id}

    def test_sku_alias(self, client, admin_headers, coded):
        assert coded["paizo"].id in self._ids(client, admin_headers, "sku:PZO9001")

    def test_bare_query_finds_the_code(self, client, admin_headers, coded):
        # Searching the code printed on a cover finds the book, not just titles.
        assert coded["paizo"].id in self._ids(client, admin_headers, "PZO9001")

    def test_separators_are_ignored(self, client, admin_headers, coded):
        # "TSR 9247" on the cover, "TSR9247" in a store listing: one code.
        assert coded["tsr"].id in self._ids(client, admin_headers, "code:TSR9247")
        assert coded["tsr"].id in self._ids(client, admin_headers, "TSR-9247")

    def test_match_carries_the_code(self, client, admin_headers, coded):
        resp = client.get("/api/search", params={"q": "code:PZO9001"}, headers=admin_headers)
        (match,) = resp.json()["book_matches"]
        assert match["product_code"] == "PZO9001"

    def test_separator_only_term_does_not_match_everything(
        self, client, admin_headers, coded
    ):
        assert self._ids(client, admin_headers, 'code:"-"') == set()

    def test_code_is_a_book_only_field(self):
        assert parse_query("code:PZO9001").books_only
