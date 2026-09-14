"""Tests for the changelog parser and its endpoint."""
import os

from backend.services.changelog import load_changelog, parse_changelog, reset_cache

SAMPLE = """# Changelog

Preamble prose that belongs to no release.

## [Unreleased]

### Added

- A thing that has not shipped

## [1.2.0] - 2026-04-15

A lead paragraph describing the release.

### Added

- First feature
- Second feature

### Fixed

- A bug

## [1.0.0] - 2026-04-06

### Added

- Initial release

[1.2.0]: https://example.invalid/compare/v1.0.0...v1.2.0
[1.0.0]: https://example.invalid/releases/tag/v1.0.0
"""


class TestParse:
    def test_parses_versions_dates_and_entries(self):
        releases = parse_changelog(SAMPLE)
        assert [r["version"] for r in releases] == ["Unreleased", "1.2.0", "1.0.0"]

        unreleased, v120, v100 = releases
        # Unreleased has no date, which is the point of the heading.
        assert unreleased["date"] is None
        assert v120["date"] == "2026-04-15"
        assert v100["date"] == "2026-04-06"

        assert v120["summary"] == "A lead paragraph describing the release."
        assert [s["title"] for s in v120["sections"]] == ["Added", "Fixed"]
        assert v120["sections"][0]["entries"] == ["First feature", "Second feature"]
        assert v120["sections"][1]["entries"] == ["A bug"]

    def test_preamble_and_link_definitions_are_not_content(self):
        """Text above the first heading, and the reference links at the foot, are plumbing."""
        releases = parse_changelog(SAMPLE)
        assert all("Preamble" not in (r["summary"] or "") for r in releases)
        every_entry = [e for r in releases for s in r["sections"] for e in s["entries"]]
        assert not any("example.invalid" in e for e in every_entry)

    def test_a_release_without_a_summary_reports_none(self):
        releases = parse_changelog(SAMPLE)
        assert releases[2]["summary"] is None

    def test_unbracketed_headings_and_emoji_sections_parse(self):
        """Keep a Changelog's brackets are link syntax, and a category may be decorated."""
        releases = parse_changelog(
            "## 2.0.0 - 2026-01-01\n\n### ⚠ Breaking\n\n- Removed a thing\n"
        )
        assert releases[0]["version"] == "2.0.0"
        assert releases[0]["date"] == "2026-01-01"
        assert releases[0]["sections"][0]["title"] == "⚠ Breaking"

    def test_a_bullet_with_no_category_is_kept_under_an_unnamed_section(self):
        releases = parse_changelog("## 1.0.0 - 2026-01-01\n\n- Loose bullet\n")
        assert releases[0]["sections"] == [{"title": "", "entries": ["Loose bullet"]}]

    def test_an_empty_heading_is_dropped(self):
        """A version with neither prose nor bullets has nothing to render."""
        assert parse_changelog("## [9.9.9] - 2026-01-01\n") == []

    def test_empty_input_yields_no_releases(self):
        assert parse_changelog("") == []

    def test_malformed_content_costs_only_itself(self):
        """Documentation, not input: a bad line must not take the dialog down."""
        releases = parse_changelog(
            "## [1.0.0] - not-a-date\n\n### Added\n\n- Kept\n\n#### Too deep\n"
        )
        # The unparseable date is simply absent; the entry still arrives.
        assert releases[0]["version"] == "1.0.0"
        assert releases[0]["date"] is None
        assert releases[0]["sections"][0]["entries"] == ["Kept"]


class TestLoad:
    def test_reads_and_parses_a_file(self, tmp_path):
        path = tmp_path / "CHANGELOG.md"
        path.write_text(SAMPLE, encoding="utf-8")
        releases = load_changelog(str(path))
        assert [r["version"] for r in releases] == ["Unreleased", "1.2.0", "1.0.0"]

    def test_a_missing_file_is_not_an_error(self, tmp_path):
        """`.dockerignore` excludes markdown by default — absence is a supported state."""
        assert load_changelog(str(tmp_path / "nope.md")) == []

    def test_an_unreadable_file_is_not_an_error(self, tmp_path):
        path = tmp_path / "CHANGELOG.md"
        path.write_text(SAMPLE, encoding="utf-8")
        os.chmod(path, 0o000)
        try:
            # Root ignores the mode bit, so only assert the call is survivable.
            assert isinstance(load_changelog(str(path)), list)
        finally:
            os.chmod(path, 0o644)

    def test_the_default_path_is_cached(self):
        reset_cache()
        first = load_changelog()
        second = load_changelog()
        assert first is second, "the default read should be cached, not re-parsed"

    def test_the_repos_own_changelog_parses(self):
        """The shipped file is the one this feature exists to render."""
        reset_cache()
        releases = load_changelog()
        # The repo has a changelog; if this ever runs somewhere it does not, the
        # empty-list contract is covered above rather than here.
        assert releases, "expected the repo's CHANGELOG.md to parse"
        assert all(r["version"] for r in releases)
        assert all(s["entries"] or s["title"] for r in releases for s in r["sections"])


class TestEndpoint:
    def test_returns_releases(self, client, admin_headers):
        r = client.get("/api/changelog", headers=admin_headers)
        assert r.status_code == 200
        releases = r.json()["releases"]
        assert releases and releases[0]["version"]
        assert "sections" in releases[0]

    def test_any_logged_in_user_may_read_it(self, client, player_headers):
        """Build information, not an admin secret — the dialog is in everyone's UI."""
        assert client.get("/api/changelog", headers=player_headers).status_code == 200

    def test_requires_login(self, client):
        assert client.get("/api/changelog").status_code == 401
