"""Unit tests for the pure schedule/snippet helpers in the campaigns package.

These functions are otherwise only exercised indirectly through the schedule
endpoints; testing them directly covers the monthly/biweekly/custom branches
and the date arithmetic in nth_weekday_of_month.
"""
import datetime
import random
import re

import pytest
from fastapi import HTTPException

from backend.routers.campaigns._helpers import (
    escape_player_pipes,
    extract_snippet,
    merge_gm_secrets,
    strip_gm_secrets,
)
from backend.services.campaigns.schedule import compute_next_sessions, nth_weekday_of_month


class TestComputeNextSessions:
    def test_weekly_returns_requested_count_on_given_weekdays(self):
        # Mondays (0) and Thursdays (3).
        result = compute_next_sessions({"frequency": "weekly", "days": [0, 3]}, n=4)
        assert len(result) == 4
        for iso in result:
            wd = datetime.date.fromisoformat(iso).weekday()
            assert wd in (0, 3)
        # Strictly increasing.
        assert result == sorted(result)

    def test_no_days_returns_empty(self):
        assert compute_next_sessions({"frequency": "weekly", "days": []}) == []

    def test_custom_dates_only_future_and_sorted(self):
        yesterday = (datetime.date.today() - datetime.timedelta(days=5)).isoformat()
        soon = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()
        later = (datetime.date.today() + datetime.timedelta(days=30)).isoformat()
        result = compute_next_sessions(
            {"frequency": "custom", "custom_dates": [later, yesterday, soon]}, n=10
        )
        assert result == [soon, later]

    def test_custom_with_no_dates(self):
        assert compute_next_sessions({"frequency": "custom", "custom_dates": []}) == []

    def test_biweekly_with_reference_keeps_alternating_weeks(self):
        # Reference anchored well in the past so alternation is deterministic.
        ref = (datetime.date.today() - datetime.timedelta(weeks=6)).isoformat()
        result = compute_next_sessions(
            {"frequency": "biweekly", "days": [2], "biweekly_reference": ref}, n=3
        )
        assert len(result) == 3
        dates = [datetime.date.fromisoformat(d) for d in result]
        # Each successive session is two weeks apart (same weekday, biweekly).
        for a, b in zip(dates, dates[1:]):
            assert (b - a).days == 14

    def test_biweekly_with_bad_reference_falls_back(self):
        # An unparseable reference must not raise; it falls back to this week.
        result = compute_next_sessions(
            {"frequency": "biweekly", "days": [4], "biweekly_reference": "not-a-date"},
            n=2,
        )
        assert len(result) == 2

    def test_monthly_nth_weekday(self):
        # 2nd Tuesday (weekday 1, week 2) of each month.
        result = compute_next_sessions(
            {"frequency": "monthly", "days": [1], "monthly_week": 2}, n=3
        )
        assert len(result) == 3
        for iso in result:
            d = datetime.date.fromisoformat(iso)
            assert d.weekday() == 1
            # A 2nd occurrence always lands on day 8-14.
            assert 8 <= d.day <= 14

    def test_monthly_last_weekday(self):
        result = compute_next_sessions(
            {"frequency": "monthly", "days": [4], "monthly_week": -1}, n=2
        )
        assert len(result) == 2
        for iso in result:
            d = datetime.date.fromisoformat(iso)
            assert d.weekday() == 4
            # The last occurrence has no same weekday 7 days later in the month.
            assert (d + datetime.timedelta(days=7)).month != d.month


class TestNthWeekdayOfMonth:
    def test_first_monday_of_january_2026(self):
        # 2026-01-01 is a Thursday; the first Monday is the 5th.
        d = nth_weekday_of_month(2026, 1, 0, 1)
        assert d == datetime.date(2026, 1, 5)

    def test_last_friday_of_february_2026(self):
        d = nth_weekday_of_month(2026, 2, 4, -1)
        assert d == datetime.date(2026, 2, 27)

    def test_fifth_occurrence_overflows_to_none(self):
        # There is no 5th Monday in Feb 2026.
        assert nth_weekday_of_month(2026, 2, 0, 5) is None


class TestExtractSnippet:
    def test_centres_on_first_match(self):
        content = "alpha beta gamma delta epsilon zeta"
        snippet = extract_snippet(content, "gamma", window=10)
        assert "gamma" in snippet
        assert snippet.startswith("…")
        assert snippet.endswith("…")

    def test_no_match_returns_head_with_ellipsis(self):
        content = "x" * 200
        snippet = extract_snippet(content, "missing", window=50)
        assert snippet == "x" * 50 + "…"

    def test_no_match_short_content_no_ellipsis(self):
        snippet = extract_snippet("short", "missing", window=50)
        assert snippet == "short"

    def test_match_near_start_has_no_leading_ellipsis(self):
        snippet = extract_snippet("gamma tail here", "gamma", window=100)
        assert not snippet.startswith("…")


class TestStripGmSecrets:
    def test_removes_paired_spans(self):
        assert strip_gm_secrets("visible ||hidden|| tail") == "visible  tail"

    def test_leaves_unterminated_marker(self):
        assert strip_gm_secrets("open ||dangling") == "open ||dangling"

    def test_none_body_returns_empty(self):
        assert strip_gm_secrets(None) == ""

    def test_a_code_marker_does_not_pair_with_prose(self):
        # The ER cardinality has no partner in its fence, so it stays code and
        # the prose secret after it pairs with its own closing marker.
        fence = "```mermaid\nerDiagram\n  A ||--o{ B : has\n```"
        body = f"{fence}\n\nThe duke ||is a vampire|| indeed."
        assert strip_gm_secrets(body) == f"{fence}\n\nThe duke  indeed."

    def test_leftover_markers_pair_across_a_fence(self):
        # Neither marker has a partner in its own stretch, so they pair with
        # each other: the GM may have meant a secret around the fence line.
        body = "Odd || out\n\n```js\nx || y\n```"
        assert strip_gm_secrets(body) == "Odd  y\n```"

    def test_a_secret_around_an_unclosed_fence_is_stripped(self):
        body = "Intro\n||The vault code is\n```\nSWORDFISH\n|| public tail\n"
        assert strip_gm_secrets(body) == "Intro\n public tail\n"

    def test_a_fence_opened_above_a_wrapped_fence_keeps_it_hidden(self):
        # The new opening line is closed by the secret's own closing fence, so
        # the secret's markers end up one in that fence and one in the prose.
        body = "```\nPublic intro\n||\n```mermaid\nflowchart LR\n  A --> Vault\n```\n||\nOutro\n"
        assert strip_gm_secrets(body) == "```\nPublic intro\n\nOutro\n"

    def test_a_lone_leftover_after_a_secret_stays_literal(self):
        body = "a ||s|| b\n\n```\nx || y\n```"
        assert strip_gm_secrets(body) == "a  b\n\n```\nx || y\n```"

    def test_a_secret_inside_a_fence_is_stripped(self):
        body = "```mermaid\nflowchart LR\n  A --> B\n  ||B --> Traitor||\n```"
        assert strip_gm_secrets(body) == "```mermaid\nflowchart LR\n  A --> B\n  \n```"

    def test_a_prose_secret_takes_the_fences_it_wraps(self):
        body = "a\n||\n```\nx || y\n```\n||\nb"
        assert strip_gm_secrets(body) == "a\n\nb"


class TestMergeGmSecrets:
    """merge_gm_secrets re-weaves stored ||secrets|| into a body the player edited.

    A non-owner edits ``strip_gm_secrets(stored)`` — a fully clean body with no
    secret text and no marker of any kind. So every ``new`` here is built by
    editing that stripped view, mirroring what the player actually sends back.
    """

    def _seen(self, stored):
        """The clean body the player was shown (what they edit)."""
        return strip_gm_secrets(stored)

    def test_no_stored_secrets_returns_new_body_verbatim(self):
        assert merge_gm_secrets("plain stored", "player edit") == "player edit"

    def test_unedited_clean_body_restores_secret_in_place(self):
        stored = "Para A. ||secret|| Para B."
        # Player saved without touching anything.
        assert merge_gm_secrets(stored, self._seen(stored)) == stored

    def test_edit_above_secret_keeps_it_in_place(self):
        stored = "Para A. ||secret|| Para B."
        new = self._seen(stored).replace("Para A.", "Para A edited.")
        assert merge_gm_secrets(stored, new) == "Para A edited. ||secret|| Para B."

    def test_edit_below_secret_keeps_it_in_place(self):
        stored = "Para A. ||secret|| Para B."
        new = self._seen(stored).replace("Para B.", "Para B edited.")
        assert merge_gm_secrets(stored, new) == "Para A. ||secret|| Para B edited."

    def test_edit_both_sides_keeps_secret_between_them(self):
        # The reporter's 3-paragraph case: the secret must NOT drift below the
        # second block when the text above AND below it is edited.
        stored = "Para A.\n\n||secret||\n\nPara B."
        new = self._seen(stored).replace("Para A.", "A2.").replace("Para B.", "B2.")
        assert merge_gm_secrets(stored, new) == "A2.\n\n||secret||\n\nB2."

    def test_secret_does_not_move_below_following_paragraph(self):
        stored = "First paragraph here. ||twist|| Second paragraph here."
        # Player rewrote the first paragraph but left the second intact.
        new = self._seen(stored).replace(
            "First paragraph here.", "A different first paragraph."
        )
        merged = merge_gm_secrets(stored, new)
        assert merged.index("||twist||") < merged.index("Second paragraph")

    def test_rewriting_both_sides_appends_secret_so_it_survives(self):
        # When the anchor text on both sides of the secret is gone, the position
        # can't be recovered — the secret is appended rather than lost.
        stored = "Original A. ||the twist|| Original B."
        new = "Completely different content with nothing in common."
        merged = merge_gm_secrets(stored, new)
        assert merged.startswith("Completely different content")
        assert "||the twist||" in merged

    def test_multiple_secrets_all_kept_in_order(self):
        stored = "aaaa ||one|| bbbb ||two|| cccc"
        assert merge_gm_secrets(stored, self._seen(stored)) == stored

    def test_multiple_secrets_survive_edits_around_each(self):
        stored = "A ||one|| B ||two|| C"
        new = self._seen(stored).replace("A ", "A! ").replace(" C", " C?")
        merged = merge_gm_secrets(stored, new)
        assert "||one||" in merged and "||two||" in merged
        assert merged.index("one") < merged.index("two")

    def test_adjacent_secrets_kept_in_document_order(self):
        stored = "x ||one||||two|| y"
        assert merge_gm_secrets(stored, self._seen(stored)) == stored

    def test_multiline_secret_restored_intact(self):
        stored = "Intro.\n||line one\nline two||\nOutro."
        assert merge_gm_secrets(stored, self._seen(stored)) == stored

    def test_secret_at_start_of_body(self):
        stored = "||opening|| then visible."
        new = self._seen(stored).replace("visible", "visible text")
        assert merge_gm_secrets(stored, new) == "||opening|| then visible text."

    def test_secret_at_end_of_body(self):
        stored = "Visible lead-in. ||closing||"
        new = self._seen(stored).replace("Visible", "The visible")
        assert merge_gm_secrets(stored, new) == "The visible lead-in. ||closing||"

    def test_none_new_body_still_preserves_secret(self):
        merged = merge_gm_secrets("x ||secret||", None)
        assert "||secret||" in merged

    def test_no_marker_or_secret_text_ever_shown_to_player(self):
        # The player's copy leaks nothing: not the text, not a placeholder token.
        stored = "Visible ||the duke is a doppelganger|| more"
        seen = self._seen(stored)
        assert "doppelganger" not in seen
        assert "||" not in seen
        assert "⟦" not in seen and "GM·" not in seen

    def test_restores_secrets_in_and_around_a_fence(self):
        stored = (
            "Intro ||prose secret|| text.\n\n"
            "```mermaid\nflowchart LR\n  A --> B\n  ||B --> Traitor||\n  C ||--o{ D\n```\n\nEnd."
        )
        new = self._seen(stored).replace("End.", "The end.")
        assert merge_gm_secrets(stored, new) == stored.replace("End.", "The end.")

    def test_a_fence_opened_above_a_wrapped_fence_keeps_the_secret(self):
        stored = "Public intro\n||\n```mermaid\nflowchart LR\n  A --> Vault\n```\n||\nOutro\n"
        merged = merge_gm_secrets(stored, "```\n" + self._seen(stored))
        assert merged == "```\n" + stored
        assert "Vault" not in strip_gm_secrets(merged)

    def test_refuses_a_fence_that_re_cuts_a_secret(self):
        # The new fence holds the secret's opening marker and the diagram's
        # own, which pair with each other and leave the closing one alone.
        stored = (
            "Public intro\n||\n```mermaid\nerDiagram\n  STEWARD ||--o{ TRAITOR : hides\n```\n"
            "||\nOutro\n"
        )
        with pytest.raises(HTTPException) as err:
            merge_gm_secrets(stored, "```\n" + self._seen(stored))
        assert err.value.status_code == 400

    def test_a_closed_code_block_above_a_secret_is_fine(self):
        stored = "Public intro\n||\n```mermaid\nflowchart LR\n```\n||\nOutro\n"
        new = "```\ncode\n```\n" + self._seen(stored)
        assert merge_gm_secrets(stored, new) == "```\ncode\n```\n" + stored


# Pieces of a random wiki body: markers, fence lines and filler. Each body also
# gets numbered words, so the test can tell which text a secret hides.
_PIECES = ["||", "||", "```\n", "```mermaid\n", "~~~\n", "\n", " ", "- ```\n", "````\n"]
_FENCE_LINES = ["```\n", "~~~\n", "```js\n", "````\n"]


def _random_body(rng):
    parts = []
    for i in range(rng.randint(2, 18)):
        parts.append(rng.choice(_PIECES))
        if rng.random() < 0.5:
            parts.append(f"W{i} ")
    return "".join(parts)


def _hidden_words(body):
    """The numbered words in ``body`` that a player is not shown."""
    seen = strip_gm_secrets(body)
    return {w for w in re.findall(r"W\d+", body) if not re.search(rf"\b{w}\b", seen)}


def _fence_edit(rng, seen):
    """``seen`` with a fence line added at, or one removed from, a line start."""
    starts = [0] + [i + 1 for i, ch in enumerate(seen) if ch == "\n"]
    lines = [m.span() for m in re.finditer(r"^[ \t>*+-]*([`~])\1{2,}[^\n]*\n?", seen, re.M)]
    if lines and rng.random() < 0.3:
        start, end = rng.choice(lines)
        return seen[:start] + seen[end:]
    at = rng.choice(starts)
    return seen[:at] + rng.choice(_FENCE_LINES) + seen[at:]


class TestSecretsAcrossFences:
    """A player can move fence lines; the GM's secrets must stay hidden anyway."""

    @pytest.mark.parametrize("seed", range(8))
    def test_a_fence_edit_never_reveals_a_hidden_word(self, seed):
        rng = random.Random(seed)
        for _ in range(400):
            stored = _random_body(rng)
            hidden = _hidden_words(stored)
            seen = strip_gm_secrets(stored)
            # Saving the page untouched always works and changes nothing.
            assert merge_gm_secrets(stored, seen) == stored
            new = escape_player_pipes(_fence_edit(rng, seen))
            try:
                merged = merge_gm_secrets(stored, new)
            except HTTPException:
                continue
            served = strip_gm_secrets(merged)
            leaked = {w for w in hidden if re.search(rf"\b{w}\b", served)}
            assert not leaked, (stored, new, merged)
