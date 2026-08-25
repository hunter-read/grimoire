"""Tests for resolving a manifest's self-declared author into a name and link.

The author string comes from a community repo anyone may contribute to, so the
important cases here are the ones that must *not* produce a link.
"""
import pytest

from backend.addons.authors import parse_author


class TestUsernames:
    @pytest.mark.parametrize(
        "raw",
        ["hunter-read", "@hunter-read", "octocat", "a", "a1-b2", "A" * 39],
    )
    def test_a_username_resolves_to_a_profile(self, raw):
        name, url = parse_author(raw)
        expected = raw.lstrip("@")
        assert name == expected
        assert url == f"https://github.com/{expected}"

    def test_a_leading_at_is_stripped_from_the_display_name(self):
        assert parse_author("@octocat") == ("octocat", "https://github.com/octocat")

    def test_surrounding_whitespace_is_ignored(self):
        assert parse_author("  octocat  ") == ("octocat", "https://github.com/octocat")

    def test_a_full_profile_url_is_accepted(self):
        assert parse_author("https://github.com/octocat") == (
            "octocat",
            "https://github.com/octocat",
        )

    def test_a_trailing_slash_is_tolerated(self):
        assert parse_author("https://github.com/octocat/") == (
            "octocat",
            "https://github.com/octocat",
        )


class TestNonUsernames:
    """Anything not provably a username renders as a plain, unlinked name."""

    def test_a_display_name_is_not_linked(self):
        assert parse_author("Jane Doe") == ("Jane Doe", "")

    def test_an_empty_author_yields_nothing(self):
        assert parse_author("") == ("", "")
        assert parse_author("   ") == ("", "")
        assert parse_author(None) == ("", "")

    @pytest.mark.parametrize(
        "raw",
        [
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "  javascript:alert(1)",
            "JavaScript:alert(1)",
        ],
    )
    def test_a_script_url_never_becomes_a_link(self, raw):
        """The whole point of deriving the URL: a manifest cannot supply one."""
        _, url = parse_author(raw)
        assert url == ""

    @pytest.mark.parametrize(
        "raw",
        [
            "https://evil.com/octocat",
            "https://github.com.evil.com/octocat",
            "https://notgithub.com/octocat",
        ],
    )
    def test_another_host_is_never_linked(self, raw):
        assert parse_author(raw)[1] == ""

    def test_a_repo_url_is_not_treated_as_a_profile(self):
        """Only a bare profile links; a deeper path could point anywhere."""
        assert parse_author("https://github.com/octocat/some-repo")[1] == ""

    @pytest.mark.parametrize("raw", ["-lead", "trail-", "a--b", "a" * 40, "has space", "a_b"])
    def test_a_malformed_username_is_not_linked(self, raw):
        assert parse_author(raw) == (raw, "")

    def test_the_display_name_keeps_the_authors_own_text(self):
        """A rejected value is still shown — just never as a link."""
        name, url = parse_author("Jane Doe (@jane)")
        assert name == "Jane Doe (@jane)"
        assert url == ""
