"""Duplicate detection: the signals, the grouping, and the dismissal memory."""
import pytest

from backend.config import SessionLocal
from backend.models import Book
from backend.models.duplicates import DuplicateGroup
from backend.services import duplicates, variants
from backend.services.duplicates import signals
from backend.services.duplicates.grouping import Edge, build_groups, group_key
from backend.tests.conftest import make_book, make_game_system, make_map

API = "/api/duplicates"


@pytest.fixture
def system():
    return make_game_system()


class TestGridHeuristic:
    @pytest.mark.parametrize(
        "name,expected",
        [
            ("Tavern_grid.png", True),
            ("Tavern (Gridded).png", True),
            ("Tavern_nogrid.png", False),
            ("Tavern_gridless.png", False),
            ("Tavern no grid.png", False),
            ("Map-ungridded.webp", False),
            ("Bridge.png", None),
            # "grid" appears inside a word, but not as a token.
            ("Gridiron Tavern.png", None),
        ],
    )
    def test_marker_detection(self, name, expected):
        assert duplicates.grid_marker(name) is expected

    def test_pairs_the_same_map(self):
        assert duplicates.is_grid_pair("Tavern_grid.png", 100, "Tavern_nogrid.png", 130)
        assert duplicates.is_grid_pair("Cellar (Gridded).jpg", 100, "Cellar.jpg", 90)

    def test_rejects_different_maps(self):
        assert not duplicates.is_grid_pair("Tavern_grid.png", 100, "Cellar_nogrid.png", 110)

    def test_rejects_a_wild_size_difference(self):
        """A 100x size gap is two different images, not a grid overlay."""
        assert not duplicates.is_grid_pair("Tavern_grid.png", 100, "Tavern_nogrid.png", 99999)

    def test_rejects_two_names_with_no_marker(self):
        assert not duplicates.is_grid_pair("Bridge.png", 100, "Bridge.png", 100)


class TestSignals:
    def test_normalize_strips_noise(self):
        n = signals.normalize_title
        assert n("The Player's Handbook") == "players handbook"
        assert n("Player's Handbook (Printer Friendly)") == "players handbook"
        assert n("Bestiary v1.0.1") == "bestiary"
        assert n("Bestiary (2)") == "bestiary"

    def test_title_similarity(self):
        assert signals.title_similarity("bestiary", "bestiary") == 1.0
        assert signals.title_similarity("bestiary", "") == 0.0
        assert signals.title_similarity("bestiary", "bestiary two") > 0.7

    def test_author_similarity_is_none_when_unknown(self):
        assert signals.author_similarity([], ["x"]) is None
        assert signals.author_similarity(["a"], ["a"]) == 1.0
        assert signals.author_similarity(["a"], ["b"]) == 0.0

    def test_metadata_score_pairs_near_titles(self, system):
        a = make_book(system_id=system.id, title="Curse of Strahd")
        b = make_book(system_id=system.id, title="Curse of Strahd (Printer Friendly)")
        assert signals.metadata_score(a, b) >= signals.METADATA_THRESHOLD

    def test_metadata_score_separates_different_books(self, system):
        a = make_book(system_id=system.id, title="Curse of Strahd")
        b = make_book(system_id=system.id, title="Tomb of Annihilation")
        assert signals.metadata_score(a, b) < signals.METADATA_THRESHOLD

    def test_hash_groups_finds_identical_files(self, system):
        a = make_book(system_id=system.id, content_hash="dupehash001")
        b = make_book(system_id=system.id, content_hash="dupehash001")
        make_book(system_id=system.id, content_hash="uniquehash002")
        db = SessionLocal()
        try:
            groups = signals.hash_groups(db, Book)
            found = [g for g in groups if a.id in g]
            assert found and set(found[0]) == {a.id, b.id}
        finally:
            db.close()

    def test_hash_groups_ignores_resolved_variants(self, system):
        a = make_book(system_id=system.id, content_hash="resolved003")
        b = make_book(system_id=system.id, content_hash="resolved003")
        db = SessionLocal()
        try:
            variants.link(db, Book, a.id, b.id, "other")
            db.commit()
            assert not [g for g in signals.hash_groups(db, Book) if a.id in g]
        finally:
            db.close()


class TestGrouping:
    def test_transitive_edges_form_one_group(self):
        groups = build_groups(
            [Edge("a", "b", "hash", 1.0), Edge("b", "c", "metadata", 0.9)]
        )
        assert len(groups) == 1
        assert groups[0].member_ids == ["a", "b", "c"]
        assert groups[0].confidence == 1.0
        assert groups[0].reasons == ["hash", "metadata"]

    def test_separate_clusters_stay_separate(self):
        groups = build_groups(
            [Edge("a", "b", "hash", 1.0), Edge("c", "d", "metadata", 0.85)]
        )
        assert len(groups) == 2
        # Strongest first.
        assert groups[0].confidence == 1.0

    def test_group_key_is_order_independent(self):
        assert group_key(["b", "a"]) == group_key(["a", "b"])
        assert group_key(["a", "b"]) != group_key(["a", "c"])

    def test_dismissed_pairs_drop_edges(self):
        edges = [Edge("a", "b", "hash", 1.0)]
        assert build_groups(edges, {frozenset(("a", "b"))}) == []

    def test_oversized_components_are_split(self):
        edges = [Edge("n0", f"n{i}", "metadata", 0.83) for i in range(1, 20)]
        groups = build_groups(edges)
        assert all(len(g.member_ids) <= 12 for g in groups)
        assert len(groups) > 1

    def test_no_edges_means_no_groups(self):
        assert build_groups([]) == []


class TestDismissals:
    def test_dismissal_suppresses_the_pair(self, client, admin_headers, system):
        a = make_book(system_id=system.id, content_hash="dismiss010")
        b = make_book(system_id=system.id, content_hash="dismiss010")
        resp = client.post(
            f"{API}/dismiss",
            headers=admin_headers,
            json={"resource_type": "book", "member_ids": [a.id, b.id]},
        )
        assert resp.status_code == 200

        db = SessionLocal()
        try:
            pairs = duplicates.dismissed_pairs(db, "book")
            assert frozenset((a.id, b.id)) in pairs
            # The rejected edge never becomes a group.
            edges = [Edge(a.id, b.id, "hash", 1.0)]
            assert build_groups(edges, pairs) == []
        finally:
            db.close()

    def test_a_third_copy_still_surfaces(self, client, admin_headers, system):
        """Dismissing {A,B} must not hide C when it turns up later."""
        a = make_book(system_id=system.id)
        b = make_book(system_id=system.id)
        c = make_book(system_id=system.id)
        client.post(
            f"{API}/dismiss",
            headers=admin_headers,
            json={"resource_type": "book", "member_ids": [a.id, b.id]},
        )
        db = SessionLocal()
        try:
            pairs = duplicates.dismissed_pairs(db, "book")
            groups = build_groups(
                [
                    Edge(a.id, b.id, "hash", 1.0),
                    Edge(a.id, c.id, "hash", 1.0),
                ],
                pairs,
            )
            # A-B is gone; A-C survives.
            assert len(groups) == 1
            assert set(groups[0].member_ids) == {a.id, c.id}
        finally:
            db.close()

    def test_dismissing_twice_updates_rather_than_duplicating(
        self, client, admin_headers, system
    ):
        a, b = make_book(system_id=system.id), make_book(system_id=system.id)
        payload = {"resource_type": "book", "member_ids": [a.id, b.id], "note": "first"}
        first = client.post(f"{API}/dismiss", headers=admin_headers, json=payload).json()
        payload["note"] = "second"
        second = client.post(f"{API}/dismiss", headers=admin_headers, json=payload).json()
        assert first["id"] == second["id"]

    def test_undismiss(self, client, admin_headers, system):
        a, b = make_book(system_id=system.id), make_book(system_id=system.id)
        created = client.post(
            f"{API}/dismiss",
            headers=admin_headers,
            json={"resource_type": "book", "member_ids": [a.id, b.id]},
        ).json()
        assert client.delete(
            f"{API}/dismissals/{created['id']}", headers=admin_headers
        ).status_code == 200
        listed = client.get(f"{API}/dismissals", headers=admin_headers).json()
        assert created["id"] not in [d["id"] for d in listed["dismissals"]]

    def test_undismiss_missing_404s(self, client, admin_headers):
        assert client.delete(f"{API}/dismissals/nope", headers=admin_headers).status_code == 404

    def test_stale_dismissals_are_swept(self, system):
        a, b = make_book(system_id=system.id), make_book(system_id=system.id)
        db = SessionLocal()
        try:
            duplicates.dismiss(db, "book", [a.id, b.id])
            db.commit()
            # One member disappears, so the dismissal describes a group that can
            # never recur - and a recycled id must not inherit the judgement.
            db.delete(db.query(Book).filter_by(id=b.id).first())
            db.commit()
            assert duplicates.sweep_stale(db) >= 1
            db.commit()
            assert frozenset((a.id, b.id)) not in duplicates.dismissed_pairs(db, "book")
        finally:
            db.close()


class TestDetectionRun:
    def test_finds_identical_and_near_matches(self, system):
        make_book(system_id=system.id, title="Zephyr Codex", content_hash="rundet020")
        make_book(system_id=system.id, title="Zephyr Codex", content_hash="rundet020")
        make_book(system_id=system.id, title="Zephyr Codex Printer Friendly")

        db = SessionLocal()
        try:
            edges = duplicates.detect_edges(db, "book")
            reasons = {e.reason for e in edges}
            assert "hash" in reasons
            assert "metadata" in reasons
        finally:
            db.close()

    def test_grid_pairs_are_detected_for_maps(self):
        make_map(filename="Zzcavern_grid.png", relative_path="maps/Zzcavern_grid.png",
                 file_size=1000)
        make_map(filename="Zzcavern_nogrid.png", relative_path="maps/Zzcavern_nogrid.png",
                 file_size=1200)
        db = SessionLocal()
        try:
            edges = duplicates.detect_edges(db, "map")
            assert any(e.reason == "grid" for e in edges)
        finally:
            db.close()

    def test_full_run_persists_groups(self, system):
        a = make_book(system_id=system.id, title="Persist Tome", content_hash="persist030")
        b = make_book(system_id=system.id, title="Persist Tome", content_hash="persist030")
        status = duplicates.run_detection_sync(["book"])
        assert status["running"] is False
        assert status["error"] is None

        db = SessionLocal()
        try:
            groups = db.query(DuplicateGroup).filter_by(resource_type="book").all()
            mine = [g for g in groups if a.id in (g.member_ids or [])]
            assert mine, "expected the identical pair to be recorded"
            assert set(mine[0].member_ids) == {a.id, b.id}
            assert mine[0].confidence == 1.0
            assert "hash" in mine[0].reasons
        finally:
            db.close()

    def test_groups_endpoint_lists_them(self, client, admin_headers, system):
        a = make_book(system_id=system.id, title="Listed Tome", content_hash="listed040")
        make_book(system_id=system.id, title="Listed Tome", content_hash="listed040")
        duplicates.run_detection_sync(["book"])

        body = client.get(f"{API}/groups?resource_type=book", headers=admin_headers).json()
        mine = [g for g in body["groups"] if any(m["id"] == a.id for m in g["members"])]
        assert mine
        group = mine[0]
        assert group["confidence"] == 1.0
        assert group["reason_text"] == "identical files"
        assert group["suggested_parent_id"] in [m["id"] for m in group["members"]]
        assert "favorites" in group["members"][0]["reference_counts"]

    def test_resolved_groups_drop_out_of_the_listing(self, client, admin_headers, system):
        a = make_book(system_id=system.id, title="Resolved Tome", content_hash="resolv050")
        b = make_book(system_id=system.id, title="Resolved Tome", content_hash="resolv050")
        duplicates.run_detection_sync(["book"])

        def mine():
            body = client.get(f"{API}/groups?resource_type=book", headers=admin_headers).json()
            return [g for g in body["groups"] if any(m["id"] == a.id for m in g["members"])]

        assert mine()
        client.post(
            f"{API}/link",
            headers=admin_headers,
            json={
                "resource_type": "book",
                "parent_id": a.id,
                "children": [{"id": b.id, "kind": "other"}],
            },
        )
        assert not mine(), "a collapsed family is no longer an open question"

    def test_status_and_cancel_endpoints(self, client, admin_headers):
        status = client.get(f"{API}/scan-status", headers=admin_headers).json()
        assert status["running"] is False
        # Nothing running, so cancel is a no-op rather than an error.
        assert client.post(
            f"{API}/cancel-scan", headers=admin_headers
        ).json()["status"] == "not_running"

    def test_scan_requires_admin(self, client, player_headers):
        assert client.post(f"{API}/scan", headers=player_headers, json={}).status_code == 403
        assert client.get(f"{API}/scan-status", headers=player_headers).status_code == 403

    def test_scan_is_refused_during_a_library_scan(self, client, admin_headers, monkeypatch):
        from backend.routers.library import _helpers as lib

        monkeypatch.setattr(lib, "_get_status", lambda: {"running": True})
        resp = client.post(f"{API}/scan", headers=admin_headers, json={})
        assert resp.status_code == 409
        assert "library scan" in resp.json()["detail"]


class TestSearchAccuracy:
    """Exact-only versus the fuzzier levels (the Stash-style accuracy control)."""

    def test_exact_finds_byte_identical_only(self, system):
        # Same bytes -> found. Similar titles, different bytes -> not found.
        a = make_book(system_id=system.id, title="Dupe Fixture Handbook", content_hash="same")
        b = make_book(system_id=system.id, title="Totally Different", content_hash="same")
        c = make_book(system_id=system.id, title="Dupe Fixture Handbook (Copy)", content_hash="x1")
        d = make_book(system_id=system.id, title="Dupe Fixture Handbook (Dup)", content_hash="x2")
        db = SessionLocal()
        try:
            edges = duplicates.detect_edges(db, "book", accuracy="exact")
            pairs = {e.pair for e in edges}
            assert frozenset((a.id, b.id)) in pairs
            assert frozenset((c.id, d.id)) not in pairs
            assert all(e.reason == "hash" for e in edges)
        finally:
            db.close()

    def test_looser_levels_catch_similar_titles(self, system):
        make_book(system_id=system.id, title="Dupe Fixture Handbook", content_hash="p1")
        make_book(system_id=system.id, title="Dupe Fixture Handbook", content_hash="p2")
        db = SessionLocal()
        try:
            exact = duplicates.detect_edges(db, "book", accuracy="exact")
            medium = duplicates.detect_edges(db, "book", accuracy="medium")
            assert len(medium) > len(exact)
        finally:
            db.close()

    def test_unknown_accuracy_falls_back_to_the_default(self):
        assert signals.thresholds_for("nonsense") == signals.thresholds_for(
            signals.DEFAULT_ACCURACY
        )

    def test_exact_disables_the_fuzzy_signals_outright(self):
        cutoffs = signals.thresholds_for("exact")
        # None means "skip this pass", not "accept everything" — the distinction
        # is what makes exact fast rather than maximally permissive.
        assert cutoffs["metadata"] is None and cutoffs["text"] is None

    def test_low_is_more_permissive_than_high(self):
        assert signals.thresholds_for("low")["metadata"] < (
            signals.thresholds_for("high")["metadata"]
        )


class TestScanProgress:
    """The bar has to move: every expensive pass lives inside detect_edges."""

    def test_reports_progress_during_the_metadata_pass(self, system):
        for i in range(6):
            make_book(system_id=system.id, title=f"Dupe Fixture Handbook {i}", content_hash=f"h{i}")
        seen = []
        db = SessionLocal()
        try:
            duplicates.detect_edges(
                db, "book", accuracy="low", on_progress=lambda d, t: seen.append((d, t))
            )
        finally:
            db.close()
        assert seen, "detect_edges never reported progress"
        # Bounded: a bar past 100% is worse than none at all.
        assert all(d <= t for d, t in seen)
        # Monotonic *within* a phase. The count restarts when the text pass
        # begins — two passes with different totals — so the sequence as a whole
        # is expected to step back exactly once per phase change, not never.
        runs, current = [], [seen[0]]
        for prev, item in zip(seen, seen[1:]):
            (current.append(item) if item[0] >= prev[0] else runs.append(current))
            if item[0] < prev[0]:
                current = [item]
        runs.append(current)
        for run in runs:
            assert [d for d, _ in run] == sorted(d for d, _ in run)
        # And it must actually reach the end of a phase, not stall part-way.
        assert any(d == t for d, t in seen)

    def test_progress_is_optional(self, system):
        make_book(system_id=system.id, title="Solo", content_hash="s1")
        db = SessionLocal()
        try:
            duplicates.detect_edges(db, "book")  # no callback, must not raise
        finally:
            db.close()


class TestEdgesSurviveGrouping:
    """Edges are what review works in — the cluster alone loses information."""

    def test_group_carries_the_pairs_it_was_built_from(self):
        # D resembles A, B and C; the only real duplicate is A-B. Union-find
        # puts all four in one cluster, so without edges a reviewer cannot tell
        # which comparisons actually fired.
        edges = [
            Edge("A", "B", "hash", 1.0),
            Edge("D", "A", "metadata", 0.8),
            Edge("D", "B", "metadata", 0.8),
            Edge("D", "C", "metadata", 0.8),
        ]
        groups = build_groups(edges)
        assert len(groups) == 1
        pairs = {frozenset((e.a, e.b)) for e in groups[0].edges}
        assert frozenset(("A", "B")) in pairs
        # And never a pair that was only ever transitive.
        assert frozenset(("A", "C")) not in pairs

    def test_oversized_split_keeps_its_edge(self):
        edges = [Edge(f"x{i}", f"y{i}", "metadata", 0.9) for i in range(20)]
        for group in build_groups(edges):
            assert group.edges, "a split group lost the edge it came from"


class TestDismissalRemovesTheRelationship:
    """Dismissing a pair has to end that pairing for good."""

    def test_dismissed_pair_cannot_return_through_a_transitive_chain(self):
        # A-B are true duplicates; D falsely matches all three. Rejecting D-A
        # must not leave A sitting beside D again via D-B-A.
        edges = [
            Edge("A", "B", "hash", 1.0),
            Edge("D", "A", "metadata", 0.8),
            Edge("D", "B", "metadata", 0.8),
            Edge("D", "C", "metadata", 0.8),
        ]
        groups = build_groups(edges, {frozenset(("D", "A"))})
        for group in groups:
            pairs = {frozenset((e.a, e.b)) for e in group.edges}
            assert frozenset(("D", "A")) not in pairs


def next_name(_c=[0]):
    """Unique system names: the test DB is shared and enforces uniqueness."""
    _c[0] += 1
    return f"Cross System Fixture {_c[0]}"


class TestCrossSystemMatching:
    """A shared title across two game systems is weak evidence, not strong."""

    def test_short_generic_handout_never_matches_across_systems(self, system):
        # "Character Sheet.pdf" exists once per system. At a couple of pages
        # there is not enough document for a title match to mean anything.
        other = make_game_system(name=next_name())
        a = make_book(system_id=system.id, title="Character Sheet", page_count=2)
        b = make_book(system_id=other.id, title="Character Sheet", page_count=2)
        assert signals.metadata_score(a, b) == 0.0

    def test_the_same_short_handout_still_matches_inside_one_system(self, system):
        a = make_book(system_id=system.id, title="Character Sheet", page_count=2)
        b = make_book(system_id=system.id, title="Character Sheet", page_count=2)
        assert signals.metadata_score(a, b) > 0

    def test_long_books_still_match_across_systems_but_not_at_full_confidence(
        self, system
    ):
        other = make_game_system(name=next_name())
        a = make_book(system_id=system.id, title="Dupe Fixture Handbook", page_count=320)
        b = make_book(system_id=other.id, title="Dupe Fixture Handbook", page_count=320)
        same = make_book(system_id=system.id, title="Dupe Fixture Handbook", page_count=320)

        cross = signals.metadata_score(a, b)
        within = signals.metadata_score(a, same)
        assert 0 < cross < within
        # The specific complaint: it must not read as certain.
        assert cross < 1.0

    def test_a_missing_system_is_not_treated_as_a_different_one(self, system):
        # Maps and tokens are routinely system-agnostic; penalising them for an
        # unset field would suppress genuine duplicates.
        a = make_map(filename="Tavern.png", relative_path="maps/Tavern.png")
        b = make_map(filename="Tavern.png", relative_path="maps/Tavern2.png")
        assert signals.metadata_score(a, b) > 0

    def test_page_threshold_is_the_shorter_of_the_two(self, system):
        other = make_game_system(name=next_name())
        long_book = make_book(system_id=system.id, title="Guide", page_count=400)
        short_book = make_book(system_id=other.id, title="Guide", page_count=3)
        # One long side does not rescue a short one: the short file is still the
        # generic handout the rule exists for.
        assert signals.metadata_score(long_book, short_book) == 0.0

    def test_an_unknown_page_count_is_not_treated_as_a_short_handout(self, system):
        # Only paged formats report a page count (see indexer.formats.
        # has_page_count) - a CBZ, an MP3, or a book that has not been indexed
        # yet has None. Reading that as "0 pages" silently dropped every
        # cross-system pair of those formats.
        other = make_game_system(name=next_name())
        a = make_book(system_id=system.id, title="Dupe Fixture Handbook", page_count=None)
        b = make_book(system_id=other.id, title="Dupe Fixture Handbook", page_count=None)
        assert signals.metadata_score(a, b) > 0

    def test_one_unknown_page_count_does_not_drop_the_pair(self, system):
        other = make_game_system(name=next_name())
        a = make_book(system_id=system.id, title="Dupe Fixture Handbook", page_count=320)
        b = make_book(system_id=other.id, title="Dupe Fixture Handbook", page_count=None)
        assert signals.metadata_score(a, b) > 0

    def test_a_cross_system_match_survives_the_default_accuracy(self, system):
        # The penalty must not push a genuine identical-title match under the
        # cutoff of the level it is scanned at, or the pair is simply lost.
        other = make_game_system(name=next_name())
        a = make_book(system_id=system.id, title="Dupe Fixture Handbook", page_count=320)
        b = make_book(system_id=other.id, title="Dupe Fixture Handbook", page_count=320)
        score = signals.metadata_score(a, b)
        for level in ("low", "medium"):
            assert score >= signals.thresholds_for(level)["metadata"], level
