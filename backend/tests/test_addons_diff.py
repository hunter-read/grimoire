"""Tests for the non-destructive diff between fetched and current metadata."""
import pytest

from backend.addons import diff
from backend.models import GameSystem


def _system(**kwargs):
    defaults = dict(
        id="sys-1",
        name="Demo",
        slug="demo",
        description="",
        publishers=[],
        genres=[],
        dice_materials=[],
        system_family="",
        edition="",
        license="",
        year=None,
        urls=[],
    )
    defaults.update(kwargs)
    return GameSystem(**defaults)


def _row(rows, field):
    return next(r for r in rows if r["field"] == field)


class TestStatus:
    def test_empty_current_is_only_incoming(self):
        rows = diff.build(_system(), {"license": "OGL"})
        assert _row(rows, "license")["status"] == diff.STATUS_ONLY_INCOMING

    def test_matching_value_is_same(self):
        rows = diff.build(_system(license="OGL"), {"license": "OGL"})
        assert _row(rows, "license")["status"] == diff.STATUS_SAME

    def test_conflicting_value_is_differs(self):
        rows = diff.build(_system(license="ORC"), {"license": "OGL"})
        assert _row(rows, "license")["status"] == diff.STATUS_DIFFERS

    def test_comparison_ignores_case_and_whitespace(self):
        rows = diff.build(_system(license=" ogl "), {"license": "OGL"})
        assert _row(rows, "license")["status"] == diff.STATUS_SAME

    @pytest.mark.parametrize("blank", ["", "   ", None])
    def test_blank_current_counts_as_empty(self, blank):
        rows = diff.build(_system(license=blank), {"license": "OGL"})
        assert _row(rows, "license")["status"] == diff.STATUS_ONLY_INCOMING

    def test_empty_incoming_values_are_not_offered(self):
        """A source with nothing to say must never propose blanking a field."""
        rows = diff.build(
            _system(license="OGL"),
            {"license": "", "description": None, "genres": [], "publishers": []},
        )
        assert rows == []


class TestListFields:
    def test_same_members_in_a_different_order_are_same(self):
        rows = diff.build(_system(genres=["Fantasy", "Horror"]), {"genres": ["Horror", "Fantasy"]})
        assert _row(rows, "genres")["status"] == diff.STATUS_SAME

    def test_different_members_differ(self):
        rows = diff.build(_system(genres=["Fantasy"]), {"genres": ["Sci-Fi"]})
        assert _row(rows, "genres")["status"] == diff.STATUS_DIFFERS

    def test_case_insensitive_membership(self):
        rows = diff.build(_system(genres=["fantasy"]), {"genres": ["Fantasy"]})
        assert _row(rows, "genres")["status"] == diff.STATUS_SAME

    def test_empty_list_is_only_incoming(self):
        rows = diff.build(_system(genres=[]), {"genres": ["Fantasy"]})
        assert _row(rows, "genres")["status"] == diff.STATUS_ONLY_INCOMING


class TestStructuredFields:
    def test_publishers_compare_by_name(self):
        current = [{"name": "Evil Hat", "url": "https://evilhat.com"}]
        rows = diff.build(_system(publishers=current), {"publishers": [{"name": "Evil Hat", "url": ""}]})
        assert _row(rows, "publishers")["status"] == diff.STATUS_SAME

    def test_different_publishers_differ(self):
        rows = diff.build(
            _system(publishers=[{"name": "Paizo", "url": ""}]),
            {"publishers": [{"name": "Evil Hat", "url": ""}]},
        )
        assert _row(rows, "publishers")["status"] == diff.STATUS_DIFFERS

    def test_urls_compare_by_url_not_label(self):
        current = [{"label": "Homepage", "url": "https://example.com"}]
        incoming = [{"label": "Official site", "url": "https://example.com"}]
        rows = diff.build(_system(urls=current), {"urls": incoming})
        assert _row(rows, "urls")["status"] == diff.STATUS_SAME

    def test_year_compares_numerically(self):
        rows = diff.build(_system(year=2017), {"year": 2017})
        assert _row(rows, "year")["status"] == diff.STATUS_SAME

    def test_year_mismatch_differs(self):
        rows = diff.build(_system(year=2016), {"year": 2017})
        assert _row(rows, "year")["status"] == diff.STATUS_DIFFERS


class TestTags:
    def test_tags_come_from_the_shared_tables_not_a_column(self):
        rows = diff.build(_system(), {"tags": ["Heist"]}, current_tags=["Heist"])
        assert _row(rows, "tags")["status"] == diff.STATUS_SAME

    def test_new_tags_are_only_incoming(self):
        rows = diff.build(_system(), {"tags": ["Heist"]}, current_tags=[])
        assert _row(rows, "tags")["status"] == diff.STATUS_ONLY_INCOMING


class TestShape:
    def test_rows_carry_current_and_incoming(self):
        row = _row(diff.build(_system(license="ORC"), {"license": "OGL"}), "license")
        assert row["current"] == "ORC" and row["incoming"] == "OGL"

    def test_empty_current_is_reported_as_none(self):
        row = _row(diff.build(_system(), {"license": "OGL"}), "license")
        assert row["current"] is None

    def test_fields_to_fill_in_are_ordered_first(self):
        """The UI pre-selects only safe changes, so they should read first."""
        rows = diff.build(
            _system(license="ORC", edition="1st"),
            {"license": "OGL", "edition": "1st", "system_family": "Fate"},
        )
        assert [r["status"] for r in rows] == [
            diff.STATUS_ONLY_INCOMING,
            diff.STATUS_DIFFERS,
            diff.STATUS_SAME,
        ]

    def test_no_incoming_fields_yields_no_rows(self):
        assert diff.build(_system(), {}) == []


class TestLinkMerging:
    """Links accumulate; a fetch must never drop one the user added."""

    WIKI = {"label": "TTRPG Wiki", "url": "https://ttrpgwiki.com/systems/blades"}
    MINE = {"label": "My notes", "url": "https://mynotes.example/blades"}

    def _row(self, current, incoming, field="urls"):
        rows = diff.build(_system(**{field: current}), {field: incoming})
        return next((r for r in rows if r["field"] == field), None)

    def test_a_source_link_is_added_to_an_empty_list(self):
        row = self._row([], [self.WIKI])
        assert row["incoming"] == [self.WIKI]
        assert row["status"] == diff.STATUS_ONLY_INCOMING

    def test_the_users_own_links_are_preserved(self):
        """The regression this exists for: applying must not wipe My notes."""
        row = self._row([self.MINE], [self.WIKI])
        assert row["incoming"] == [self.MINE, self.WIKI]

    def test_new_links_are_pre_selected_not_a_conflict(self):
        """Marked only_incoming so the source link actually lands by default."""
        row = self._row([self.MINE], [self.WIKI])
        assert row["status"] == diff.STATUS_ONLY_INCOMING

    def test_the_users_links_come_first(self):
        row = self._row([self.MINE], [self.WIKI])
        assert row["incoming"][0] == self.MINE

    def test_re_fetching_is_idempotent(self):
        row = self._row([self.WIKI], [self.WIKI])
        assert row["status"] == diff.STATUS_SAME

    def test_a_renamed_link_keeps_the_users_label(self):
        """Someone who relabelled a link should not have it renamed back."""
        renamed = {"label": "Wiki (mine)", "url": self.WIKI["url"]}
        row = self._row([renamed], [self.WIKI])
        assert row["incoming"] == [renamed]
        assert row["status"] == diff.STATUS_SAME

    def test_urls_match_case_insensitively(self):
        upper = {"label": "X", "url": self.WIKI["url"].upper()}
        row = self._row([upper], [self.WIKI])
        assert len(row["incoming"]) == 1

    def test_entries_without_a_url_are_dropped(self):
        row = self._row([{"label": "empty", "url": "  "}], [self.WIKI])
        assert row["incoming"] == [self.WIKI]

    def test_character_builder_urls_merge_the_same_way(self):
        row = self._row([self.MINE], [self.WIKI], field="character_builder_urls")
        assert row["incoming"] == [self.MINE, self.WIKI]

    def test_non_link_lists_still_replace(self):
        """Only link lists are additive — genres remain a straight comparison."""
        rows = diff.build(_system(genres=["Fantasy"]), {"genres": ["Sci-Fi"]})
        row = next(r for r in rows if r["field"] == "genres")
        assert row["incoming"] == ["Sci-Fi"]
        assert row["status"] == diff.STATUS_DIFFERS
