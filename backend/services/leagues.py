"""League standings, from the games logged.

Each game is between two members and ends in a win for one or a draw. A
member's league points come from the league's own scoring (``points_win`` /
``_draw`` / ``_loss``, 3/1/0 by default); ties on points break by the score
difference, then the score itself, then name, so the order is always stable.
"""
from __future__ import annotations

from typing import Any, Iterable, Optional

from ..models.leagues import RESULT_A, RESULT_B, RESULT_DRAW


class LeagueGameError(ValueError):
    """A game as submitted cannot be recorded. The message says why."""


def decide_result(score_a: Optional[int], score_b: Optional[int], result: Optional[str]) -> str:
    """The game's result: as given, or read from the scores when it was left out.

    Given both, they must agree - a 20-10 game is not a win for the player on 10.
    """
    from_scores: Optional[str] = None
    if score_a is not None and score_b is not None:
        if score_a > score_b:
            from_scores = RESULT_A
        elif score_b > score_a:
            from_scores = RESULT_B
        else:
            from_scores = RESULT_DRAW
    if result is None:
        if from_scores is None:
            raise LeagueGameError("Give both scores, or say who won")
        return from_scores
    if result not in (RESULT_A, RESULT_B, RESULT_DRAW):
        raise LeagueGameError("The result must be a, b or draw")
    if from_scores is not None and from_scores != result:
        raise LeagueGameError("The result does not match the scores")
    return result


def standings(
    members: Iterable[dict[str, Any]],
    games: Iterable[Any],
    points: tuple[int, int, int] = (3, 1, 0),
) -> list[dict[str, Any]]:
    """One row per member, best first.

    ``members`` are ``{user_id, name}`` dicts; ``games`` are ``LeagueGame``-like
    rows. ``points`` is (win, draw, loss). A game whose player has left the
    league still counts for their opponent.
    """
    win, draw, loss = points
    rows: dict[str, dict[str, Any]] = {
        m["user_id"]: {
            "user_id": m["user_id"],
            "name": m["name"],
            "played": 0,
            "won": 0,
            "drawn": 0,
            "lost": 0,
            "score_for": 0,
            "score_against": 0,
            "points": 0,
        }
        for m in members
    }

    def tally(user_id: str, outcome: str, scored: Optional[int], conceded: Optional[int]) -> None:
        row = rows.get(user_id)
        if row is None:
            return
        row["played"] += 1
        row[outcome] += 1
        row["points"] += {"won": win, "drawn": draw, "lost": loss}[outcome]
        row["score_for"] += scored or 0
        row["score_against"] += conceded or 0

    for game in games:
        a_outcome = {RESULT_A: "won", RESULT_B: "lost", RESULT_DRAW: "drawn"}[game.result]
        b_outcome = {"won": "lost", "lost": "won", "drawn": "drawn"}[a_outcome]
        tally(game.player_a_id, a_outcome, game.score_a, game.score_b)
        tally(game.player_b_id, b_outcome, game.score_b, game.score_a)

    return sorted(
        rows.values(),
        key=lambda r: (
            -r["points"],
            -(r["score_for"] - r["score_against"]),
            -r["score_for"],
            r["name"].lower(),
        ),
    )
