"""Tests for backend.text.align.map_offsets, the alignment behind merge_gm_secrets."""

import random
import time

import pytest

from backend.text import align
from backend.text.align import map_offsets


class TestCommonEnds:
    def test_an_unchanged_text_maps_every_offset_to_itself(self):
        text = "Para A.\n\nPara B.\n"
        assert map_offsets(text, text, list(range(len(text) + 1))) == list(
            range(len(text) + 1)
        )

    def test_an_edit_in_one_place_shifts_only_what_follows_it(self):
        old = "intro. middle. outro."
        new = "intro. a longer middle. outro."
        # Before the edit, at its far edge, and after it.
        assert map_offsets(old, new, [3, 14, 18]) == [3, 23, 27]

    def test_an_offset_in_text_rewritten_on_both_sides_is_lost(self):
        assert map_offsets("abcXYZdef", "abc123def", [4]) == [None]

    def test_a_pure_insertion_keeps_the_offset_before_it(self):
        # Where two matched runs meet, the earlier one wins.
        assert map_offsets("abcdef", "abcNEWdef", [3]) == [3]

    def test_a_pure_deletion_maps_both_edges_to_one_spot(self):
        assert map_offsets("abcGONEdef", "abcdef", [3, 7]) == [3, 3]

    def test_the_end_of_the_text_maps_to_the_end(self):
        assert map_offsets("abc", "xyz", [3]) == [3]

    def test_completely_different_text_loses_the_offset(self):
        assert map_offsets("Original A. Original B.", "Nothing alike here!", [12]) == [None]

    def test_an_empty_new_text(self):
        assert map_offsets("abc", "", [0, 1, 3]) == [None, None, 0]


class TestLineStage:
    def _page(self, n):
        return "".join(f"Line {i} of the page.\n" for i in range(n))

    def test_edits_at_both_ends_keep_offsets_between_them(self):
        old = self._page(200)
        new = "A new first line.\n" + old[len("Line 0 of the page.\n") : -2] + "!\n"
        target = old.index("Line 100")
        [mapped] = map_offsets(old, new, [target])
        assert new[mapped:].startswith("Line 100 of the page.")

    def test_an_offset_inside_an_edited_line_between_two_edits(self):
        old = self._page(50)
        middle = old.index("Line 25 of") + len("Line 25 ")
        new = ("first\n" + old[len("Line 0 of the page.\n") :]).replace(
            "Line 25 of", "Line 25 (renamed) of"
        )
        new = new[:-2] + "?\n"
        [mapped] = map_offsets(old, new, [middle])
        # The offset sat before "of": the words inserted there follow it, since
        # the earlier of two runs that meet wins.
        assert new[:mapped].endswith("\nLine 25 ")
        assert new[mapped:].startswith("(renamed) of the page.")

    def test_repeated_lines_between_anchors_are_matched_by_characters(self):
        old = "top\n\n\n\nblank lines\n\n\n\nbottom\n"
        new = "TOP\n\n\n\nblank lines\n\n\n\n\nbottom!\n"
        # 25 is inside "bottom", which moved down one place.
        assert map_offsets(old, new, [6, 25]) == [6, 26]

    def test_runs_merge_over_anchors_they_already_cover(self):
        # Unique lines a, b, c are all anchors; growing a's run takes in b and c.
        old = "start\na\nb\nc\nend\n"
        new = "START\na\nb\nc\nEND\n"
        assert map_offsets(old, new, [8, 10]) == [8, 10]

    def test_an_offset_on_a_stretch_edge_is_placed(self):
        old = "x\nsame\ny\n"
        new = "X\nsame\nY\n"
        # Offset 2 is where "same" starts; 7 is where it ends.
        assert map_offsets(old, new, [2, 7]) == [2, 7]


class TestBudget:
    def test_a_rewrite_past_the_budget_is_lost_not_slow(self, monkeypatch):
        monkeypatch.setattr(align, "CHAR_DIFF_BUDGET", 10)
        old = "start " + "a" * 50 + " end"
        new = "START " + "b" * 50 + " END"
        assert map_offsets(old, new, [20]) == [None]

    def test_matched_ends_still_count_past_the_budget(self, monkeypatch):
        monkeypatch.setattr(align, "CHAR_DIFF_BUDGET", 10)
        old = "S1\nanchor\nkeep this " + "a" * 40 + "\nE1\n"
        new = "S2\nanchor\nkeep this " + "b" * 40 + "\nE2\n"
        # The stretch after "anchor" starts the same on both sides, and that
        # much is matched without a character diff.
        off = old.index("this")
        assert map_offsets(old, new, [off]) == [off]

    def test_too_many_lines_skips_the_line_match(self, monkeypatch):
        monkeypatch.setattr(align, "MAX_DIFF_LINES", 3)
        old = "a\nb\nc\nd\n"
        new = "A\nb\nc\nD\n"
        assert map_offsets(old, new, [3]) == [None]

    def test_the_budget_is_shared_across_stretches(self, monkeypatch):
        # Two separate rewritten stretches, each needing a character diff.
        # Each needs a character diff: the first costs 67 units, the second 84.
        old = "top\nXbeta1\nmid\nXgamma1\nend\n"
        new = "top\nZbeta2\nmid\nZgamma2\nend\n"
        offsets = [old.index("beta") + 2, old.index("gamma") + 2]
        assert map_offsets(old, new, offsets) == offsets
        monkeypatch.setattr(align, "CHAR_DIFF_BUDGET", 70)
        first, second = map_offsets(old, new, offsets)
        assert first == offsets[0]
        assert second is None

    @pytest.mark.parametrize(
        "old, new",
        [
            ("xy" * 100_000, "xz" * 100_000),
            ("".join(random.Random(1).choice("ab \n") for _ in range(200_000)),
             "".join(random.Random(2).choice("ab \n") for _ in range(200_000))),
        ],
        ids=["repeating", "random"],
    )
    def test_a_long_rewrite_maps_quickly(self, old, new):
        start = time.perf_counter()
        map_offsets(old, new, [len(old) // 2, len(old) // 3])
        assert time.perf_counter() - start < 2
