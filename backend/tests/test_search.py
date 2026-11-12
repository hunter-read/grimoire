"""Tests for the full-text search endpoint."""
import pytest
from backend.tests.conftest import make_game_system, make_book
from backend.config import SessionLocal
from backend.models import MapFolder, TokenFolder, AudioFolder
from sqlalchemy import text

from backend.services.search_query import MAX_FTS_TERMS, MAX_QUERY_LENGTH, to_fts_query


@pytest.fixture(scope="module")
def indexed_book():
    """Create a book and insert FTS content so search can find it."""
    sys = make_game_system()
    book = make_book(
        system_id=sys.id,
        title="Spell Compendium",
        indexed=True,
    )
    # Seed the FTS table so search results are findable
    db = SessionLocal()
    try:
        db.execute(
            text(
                "INSERT INTO book_pages (book_id, page_number, content) VALUES (:bid, :pn, :content)"
            ),
            {"bid": book.id, "pn": 1, "content": "fireball spell wizard evocation"},
        )
        db.execute(
            text(
                "INSERT INTO book_pages (book_id, page_number, content) VALUES (:bid, :pn, :content)"
            ),
            {"bid": book.id, "pn": 2, "content": "lightning bolt electricity storm"},
        )
        db.commit()
    finally:
        db.close()
    return book


class TestSearch:
    def test_search_returns_results(self, client, admin_headers, indexed_book):
        resp = client.get("/api/search?q=fireball", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "results" in body
        assert isinstance(body["results"], list)

    def test_search_finds_indexed_content(self, client, admin_headers, indexed_book):
        resp = client.get("/api/search?q=fireball", headers=admin_headers)
        results = resp.json()["results"]
        book_ids = [r["id"] for r in results]
        assert indexed_book.id in book_ids

    def test_search_result_shape(self, client, admin_headers, indexed_book):
        resp = client.get("/api/search?q=fireball", headers=admin_headers)
        result = next(r for r in resp.json()["results"] if r["id"] == indexed_book.id)
        assert "id" in result
        assert "title" in result
        assert "page_number" in result
        assert "snippet" in result
        assert "category" in result
        assert "game_system_id" in result

    def test_search_hit_carries_what_a_page_prefetch_needs(
        self, client, admin_headers, indexed_book
    ):
        # The client warms the reader's page image for a hit (issue #640), and
        # must ask for the reader's exact URL: the same content token, and no
        # page image at all for a text document or past the last page.
        detail = client.get(f"/api/books/{indexed_book.id}", headers=admin_headers).json()
        resp = client.get("/api/search?q=fireball", headers=admin_headers)
        result = next(r for r in resp.json()["results"] if r["id"] == indexed_book.id)
        assert result["content_token"] == detail["content_token"]
        assert result["mime_type"] == detail["mime_type"]
        assert result["page_count"] == detail["page_count"]

    def test_search_scoped_to_book(self, client, admin_headers, indexed_book):
        resp = client.get(
            f"/api/search?q=fireball&book_id={indexed_book.id}",
            headers=admin_headers,
        )
        assert resp.status_code == 200
        results = resp.json()["results"]
        assert all(r["id"] == indexed_book.id for r in results)

    def test_search_no_results_for_unknown_term(self, client, admin_headers):
        resp = client.get("/api/search?q=xyznonexistenttermqwerty", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["results"] == []

    def test_search_requires_query_param(self, client, admin_headers):
        resp = client.get("/api/search", headers=admin_headers)
        assert resp.status_code == 422

    def test_player_can_search(self, client, player_headers, indexed_book):
        resp = client.get("/api/search?q=fireball", headers=player_headers)
        assert resp.status_code == 200

    def test_unauthenticated_denied(self, client):
        resp = client.get("/api/search?q=fireball")
        assert resp.status_code == 401

    def test_global_search_includes_maps_and_tokens_keys(self, client, admin_headers, indexed_book):
        """Global search response always includes maps and tokens arrays."""
        resp = client.get("/api/search?q=fireball", headers=admin_headers)
        body = resp.json()
        assert "maps" in body
        assert "tokens" in body
        assert isinstance(body["maps"], list)
        assert isinstance(body["tokens"], list)

    def test_global_search_finds_map_by_filename(self, client, admin_headers):
        from backend.tests.conftest import make_map

        m = make_map(filename="dragonlair-battlemap.png", relative_path="dragonlair-battlemap.png")
        resp = client.get("/api/search?q=dragonlair", headers=admin_headers)
        body = resp.json()
        assert any(item["id"] == m.id for item in body["maps"])

    def test_global_search_finds_token_by_filename(self, client, admin_headers):
        from backend.tests.conftest import make_token

        t = make_token(filename="shadowgoblintoken.png", relative_path="shadowgoblintoken.png")
        resp = client.get("/api/search?q=shadowgoblintoken", headers=admin_headers)
        body = resp.json()
        assert any(item["id"] == t.id for item in body["tokens"])

    def test_global_search_includes_audio_key(self, client, admin_headers, indexed_book):
        resp = client.get("/api/search?q=fireball", headers=admin_headers)
        body = resp.json()
        assert "audio" in body
        assert isinstance(body["audio"], list)

    def test_global_search_finds_audio_by_title(self, client, admin_headers):
        from backend.tests.conftest import make_audio

        a = make_audio(
            filename="track-xyz.mp3",
            relative_path="track-xyz.mp3",
            title="Mystic Cavern Drone",
        )
        resp = client.get("/api/search?q=mystic+cavern", headers=admin_headers)
        body = resp.json()
        assert any(item["id"] == a.id for item in body["audio"])

    def test_global_search_finds_map_via_folder_tag(self, client, admin_headers):
        from backend.tests.conftest import make_map

        db = SessionLocal()
        try:
            db.add(MapFolder(path="Swamplands", tags=["bayoutag"]))
            db.commit()
        finally:
            db.close()
        m = make_map(filename="nondescript.png", relative_path="maps/Swamplands/nondescript.png")
        resp = client.get("/api/search?q=bayoutag", headers=admin_headers)
        assert any(item["id"] == m.id for item in resp.json()["maps"])

    def test_global_search_finds_token_via_folder_path(self, client, admin_headers):
        from backend.tests.conftest import make_token

        db = SessionLocal()
        try:
            db.add(TokenFolder(path="Gnolltribe", tags=["pack"]))
            db.commit()
        finally:
            db.close()
        tk = make_token(filename="plain.png", relative_path="tokens/Gnolltribe/plain.png")
        resp = client.get("/api/search?q=gnolltribe", headers=admin_headers)
        assert any(item["id"] == tk.id for item in resp.json()["tokens"])

    def test_global_search_finds_audio_via_folder_tag(self, client, admin_headers):
        from backend.tests.conftest import make_audio

        db = SessionLocal()
        try:
            db.add(AudioFolder(path="Soundscapes", tags=["windswept"]))
            db.commit()
        finally:
            db.close()
        a = make_audio(filename="plain.mp3", relative_path="audio/Soundscapes/plain.mp3", title="")
        resp = client.get("/api/search?q=windswept", headers=admin_headers)
        assert any(item["id"] == a.id for item in resp.json()["audio"])

    def test_scoped_search_returns_empty_maps_tokens(self, client, admin_headers, indexed_book):
        """When scoped to a system or book, maps and tokens are always empty."""
        resp = client.get(
            f"/api/search?q=fireball&system_id={indexed_book.game_system_id}",
            headers=admin_headers,
        )
        body = resp.json()
        assert body.get("maps", []) == []
        assert body.get("tokens", []) == []

    def test_game_system_id_value_matches_book(self, client, admin_headers, indexed_book):
        """game_system_id in results must equal the book's actual game_system_id."""
        resp = client.get("/api/search?q=fireball", headers=admin_headers)
        result = next(r for r in resp.json()["results"] if r["id"] == indexed_book.id)
        assert result["game_system_id"] == indexed_book.game_system_id

    def test_game_system_name_present(self, client, admin_headers, indexed_book):
        """game_system field should be non-empty when the book belongs to a system."""
        resp = client.get("/api/search?q=fireball", headers=admin_headers)
        result = next(r for r in resp.json()["results"] if r["id"] == indexed_book.id)
        assert result["game_system"] != ""

    def test_multiple_pages_from_same_book_all_returned(self, client, admin_headers, indexed_book):
        """Both indexed pages from the same book should appear as separate result rows."""
        resp = client.get("/api/search?q=fireball OR lightning", headers=admin_headers)
        results = resp.json()["results"]
        book_results = [r for r in results if r["id"] == indexed_book.id]
        page_numbers = {r["page_number"] for r in book_results}
        assert 1 in page_numbers, "page 1 (fireball) should be in results"
        assert 2 in page_numbers, "page 2 (lightning bolt) should be in results"

    def test_search_limit_param_respected(self, client, admin_headers, indexed_book):
        """Passing limit=1 should return at most 1 result."""
        resp = client.get("/api/search?q=fireball&limit=1", headers=admin_headers)
        assert resp.status_code == 200
        assert len(resp.json()["results"]) <= 1

    def test_scoped_to_nonexistent_system_returns_empty(self, client, admin_headers):
        """Searching within a system_id that has no books should return empty results."""
        resp = client.get("/api/search?q=fireball&system_id=nonexistent-system-id", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["results"] == []


@pytest.fixture(scope="module")
def booby_trapped_book():
    """A book whose PDF text layer contains raw HTML/JS markup.

    The snippet is rendered via dangerouslySetInnerHTML on the client, so the
    surrounding source text must be HTML-escaped server-side; only the highlight
    <mark> tags we inject should survive as real markup.
    """
    sys = make_game_system()
    book = make_book(system_id=sys.id, title="Cursed Tome", indexed=True)
    payload = (
        'necromancy <script>alert(document.cookie)</script> ritual '
        '<img src=x onerror=alert(1)> and <b>bold</b> incantations & sigils'
    )
    db = SessionLocal()
    try:
        db.execute(
            text(
                "INSERT INTO book_pages (book_id, page_number, content) "
                "VALUES (:bid, :pn, :content)"
            ),
            {"bid": book.id, "pn": 1, "content": payload},
        )
        db.commit()
    finally:
        db.close()
    return book


class TestSnippetEscaping:
    def _snippet(self, client, admin_headers, book_id, query):
        resp = client.get(f"/api/search?q={query}", headers=admin_headers)
        assert resp.status_code == 200
        row = next(r for r in resp.json()["results"] if r["id"] == book_id)
        return row["snippet"]

    def test_source_markup_is_escaped(self, client, admin_headers, booby_trapped_book):
        snippet = self._snippet(client, admin_headers, booby_trapped_book.id, "necromancy")
        # Raw tags from the PDF text layer must not survive as live markup.
        assert "\ue000" not in snippet
        assert "\ue001" not in snippet
        assert "<b>" not in snippet
        # They are present, but escaped.
        assert "&lt;script&gt;" in snippet
        assert "&lt;img" in snippet
        assert "onerror" in snippet  # kept as inert text, not an attribute
        # Ampersands in source text are escaped too.
        assert "&amp; sigils" in snippet

    def test_highlight_marks_are_preserved(self, client, admin_headers, booby_trapped_book):
        snippet = self._snippet(client, admin_headers, booby_trapped_book.id, "necromancy")
        # The matched term is still wrapped in a real <mark> highlight.
        assert "<mark>" in snippet and "</mark>" in snippet
        assert "<mark>necromancy</mark>" in snippet.lower()

    def test_no_raw_sentinel_leaks(self, client, admin_headers, booby_trapped_book):
        """The internal highlight sentinels must never appear in the response."""
        snippet = self._snippet(client, admin_headers, booby_trapped_book.id, "ritual")
        assert "" not in snippet
        assert "" not in snippet


@pytest.fixture(scope="module")
def bracketed_book():
    """Page text with words inside angle brackets and an HTML-style entity."""
    sys = make_game_system()
    book = make_book(system_id=sys.id, title="Bracketed Lore", indexed=True)
    db = SessionLocal()
    try:
        db.execute(
            text(
                "INSERT INTO book_pages (book_id, page_number, content) "
                "VALUES (:bid, 1, :content)"
            ),
            {
                "bid": book.id,
                "content": "Roll on the <quasitronic engine> table, then "
                "<b>hexwardens</b> and the zorblax&amp;glimmerfen rite",
            },
        )
        db.commit()
    finally:
        db.close()
    return book


class TestBracketedText:
    """Text inside <...> is found on both databases.

    SQLite's FTS5 tokenizer treats ``<`` and ``>`` as separators; PostgreSQL's
    parser took ``<quasitronic engine>`` for an XML tag and indexed nothing of it.
    """

    def _hits(self, client, admin_headers, query):
        resp = client.get("/api/search", params={"q": query}, headers=admin_headers)
        assert resp.status_code == 200
        return {r["id"]: r for r in resp.json()["results"]}

    @pytest.mark.parametrize(
        "query",
        ["quasitronic", "engine", "hexwarden", '"quasitronic engine"', "<quasitronic",
         "glimmerfen", "zorblax", "amp"],
    )
    def test_words_in_brackets_are_found(self, client, admin_headers, bracketed_book, query):
        assert bracketed_book.id in self._hits(client, admin_headers, query)

    def test_the_snippet_marks_them(self, client, admin_headers, bracketed_book):
        hit = self._hits(client, admin_headers, "quasitronic")[bracketed_book.id]
        assert "&lt;<mark>quasitronic</mark> engine&gt;" in hit["snippet"]
        hit = self._hits(client, admin_headers, "glimmerfen")[bracketed_book.id]
        assert "zorblax&amp;amp;<mark>glimmerfen</mark>" in hit["snippet"]


@pytest.fixture(scope="module")
def joined_book():
    """Page text whose words are joined by punctuation rather than spaces."""
    sys = make_game_system()
    book = make_book(system_id=sys.id, title="Joined Lore", indexed=True)
    db = SessionLocal()
    try:
        db.execute(
            text(
                "INSERT INTO book_pages (book_id, page_number, content) "
                "VALUES (:bid, 1, :content)"
            ),
            {
                "bid": book.id,
                "content": "Wield a vorpalsword/gleamshield or a krenlance.The ogrekin "
                "strikes at -7731.Thenceforth see www.zympaizo.com or "
                "orc@quexample.com for a +8842 bonus, a snake_cased~tildeword, "
                "C:\\dungeonfile and a half-quillon.",
            },
        )
        db.commit()
    finally:
        db.close()
    return book


class TestJoinedWords:
    """Words joined by a slash, a full stop and the like are found on both databases.

    SQLite's FTS5 tokenizer splits on any punctuation. PostgreSQL's parser read
    ``vorpalsword/gleamshield`` as a file path, ``krenlance.The`` as a host name
    and ``-7731`` as a signed number, and indexed each whole and nothing else.
    """

    def _hits(self, client, admin_headers, query):
        resp = client.get("/api/search", params={"q": query}, headers=admin_headers)
        assert resp.status_code == 200
        return {r["id"]: r for r in resp.json()["results"]}

    @pytest.mark.parametrize(
        "query",
        ["vorpalsword", "gleamshield", "krenlance", "ogrekin", "7731", "Thenceforth",
         "zympaizo", "quexample", "8842", "snake", "cased", "tildeword", "dungeonfile",
         "quillon", "half-quillon", "vorpalsword/gleamshield", "www.zympaizo.com",
         "orc@quexample.com", '"krenlance the ogrekin"', "snake_cas*", "zympa*"],
    )
    def test_each_word_is_found(self, client, admin_headers, joined_book, query):
        assert joined_book.id in self._hits(client, admin_headers, query)

    def test_the_snippet_marks_them(self, client, admin_headers, joined_book):
        hit = self._hits(client, admin_headers, "gleamshield")[joined_book.id]
        assert "vorpalsword/<mark>gleamshield</mark> or" in hit["snippet"]
        hit = self._hits(client, admin_headers, "zympaizo")[joined_book.id]
        assert "www.<mark>zympaizo</mark>.com" in hit["snippet"]
        # The page's closing full stop is its own, not a cut.
        assert hit["snippet"].endswith("half-quillon.")


class TestLongQueries:
    """A long query is refused or cut short, never a database error (a 500).

    Unbounded, a chain of a few hundred NOTs nests too deep for FTS5 ("fts5
    expression tree is too large") and a few thousand terms exhaust
    PostgreSQL's stack while it builds the tsquery.
    """

    @pytest.mark.parametrize(
        "query",
        ["x NOT " * 400 + "x", " ".join(["x"] * 4100), "x" * (MAX_QUERY_LENGTH + 1)],
    )
    def test_an_over_long_query_is_refused(self, client, admin_headers, query):
        resp = client.get("/api/search", params={"q": query}, headers=admin_headers)
        assert resp.status_code == 422

    def test_the_longest_query_allowed_still_runs(self, client, admin_headers, indexed_book):
        # As many chained NOTs as fit: the term cap keeps the expression shallow.
        query = ("fireball NOT " * 100)[:MAX_QUERY_LENGTH]
        resp = client.get("/api/search", params={"q": query}, headers=admin_headers)
        assert resp.status_code == 200, resp.text

    def test_terms_past_the_cap_are_dropped(self):
        assert to_fts_query("x " * (MAX_FTS_TERMS + 10)).split() == ["x"] * MAX_FTS_TERMS

    def test_a_not_left_at_the_cut_is_quoted(self):
        tokens = to_fts_query("x NOT " * MAX_FTS_TERMS).split()
        assert len(tokens) == MAX_FTS_TERMS
        assert tokens[-1] == '"NOT"'

    def test_a_query_the_database_cannot_run_is_a_400(
        self, client, admin_headers, indexed_book, monkeypatch
    ):
        # Lift the cap and feed a query past both engines' limits, as though the
        # caps had missed one: the error is the user's to fix, not a 500.
        from backend.routers.search import core as search_core
        from backend.services import search_query

        monkeypatch.setattr(search_query, "MAX_FTS_TERMS", 1_000_000)
        too_deep = "fireball NOT " * 6000 + "fireball"
        monkeypatch.setattr(search_core, "parse_query", lambda _q: search_query.parse_query(too_deep))
        resp = client.get("/api/search", params={"q": "fireball"}, headers=admin_headers)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Search query is too complex"
        # Search works again straight after (PostgreSQL aborts the transaction).
        monkeypatch.undo()
        resp = client.get("/api/search", params={"q": "fireball"}, headers=admin_headers)
        assert resp.status_code == 200
