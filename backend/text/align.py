"""Map positions in one version of a text to the matching spots in another.

``map_offsets`` is what keeps a wiki page's GM secrets where the GM put them
when a player saves an edit (see ``merge_gm_secrets``). The work is kept in
proportion to what changed, so a long page saves as quickly as a short one:

* The common prefix and suffix are matched first, in one linear pass each. An
  edit in one place leaves only that place to compare.
* What is left in between is matched line by line on the lines that occur
  exactly once on each side (patience diff), which takes ``O(n log n)`` however
  the text was changed.
* Only a stretch between matched lines that holds an offset is compared
  character by character, by ``difflib.SequenceMatcher``. Those comparisons
  share a fixed budget of work. Past it a stretch is left unmatched, and an
  offset inside it maps to ``None``, as one in rewritten text does.
"""

from bisect import bisect_left
from collections import Counter
from difflib import Match, SequenceMatcher
from itertools import accumulate
from typing import Optional, Sequence

# Units of character comparison all the character diffs of one call may share.
# Each ``SequenceMatcher`` search is charged the most steps it can take (see
# ``_BudgetedMatcher``), so the whole call stays well under a second even on the
# slowest input it can be given (text made of a few characters, repeated).
CHAR_DIFF_BUDGET = 4_000_000

# Above this many lines in the changed middle (both sides together), the line
# match is skipped too, and every offset in the middle maps to ``None``.
MAX_DIFF_LINES = 400_000

# A matched run: (start in old, start in new, length), as difflib's ``Match``.
Block = tuple[int, int, int]


class _OverBudget(Exception):
    """The character diff would need more work than the budget has left."""


class _Budget:
    def __init__(self, units: int) -> None:
        self.left = units

    def spend(self, units: int) -> None:
        if units > self.left:
            raise _OverBudget
        self.left -= units


class _BudgetedMatcher(SequenceMatcher[str]):
    """A ``SequenceMatcher`` that charges each search to a shared ``_Budget``.

    The matching itself is difflib's, unchanged; a search the budget can't pay
    for raises ``_OverBudget`` before it starts.
    """

    def __init__(self, a: str, b: str, budget: _Budget) -> None:
        self._budget = budget
        self._a_len, self._b_len = len(a), len(b)
        super().__init__(None, a, b, autojunk=False)

    def find_longest_match(
        self, alo: int = 0, ahi: Optional[int] = None, blo: int = 0, bhi: Optional[int] = None
    ) -> Match:
        a_end = self._a_len if ahi is None else ahi
        b_end = self._b_len if bhi is None else bhi
        # The search walks, for each position in its stretch of ``a``, the
        # places that character occurs in ``b`` up to ``b_end`` - before
        # ``blo`` too, which it skips one by one.
        self._budget.spend((max(a_end - alo, 0) + 1) * (b_end + 1))
        return super().find_longest_match(alo, a_end, blo, b_end)


def _common_ends(a: str, b: str) -> tuple[int, int]:
    """The lengths of the longest common prefix and suffix, not overlapping."""
    limit = min(len(a), len(b))
    prefix = 0
    while prefix < limit and a[prefix] == b[prefix]:
        prefix += 1
    suffix = 0
    while suffix < limit - prefix and a[-1 - suffix] == b[-1 - suffix]:
        suffix += 1
    return prefix, suffix


def _char_blocks(a: str, b: str, budget: _Budget) -> list[Block]:
    """Matching character runs between ``a`` and ``b``.

    The common ends always match. The rest is diffed by ``SequenceMatcher``
    when the budget allows it, and left unmatched when it doesn't.
    """
    prefix, suffix = _common_ends(a, b)
    blocks: list[Block] = []
    if prefix:
        blocks.append((0, 0, prefix))
    a_mid, b_mid = a[prefix : len(a) - suffix], b[prefix : len(b) - suffix]
    if a_mid and b_mid:
        try:
            matched = _BudgetedMatcher(a_mid, b_mid, budget).get_matching_blocks()
        except _OverBudget:
            matched = []
        blocks.extend((prefix + i, prefix + j, n) for i, j, n in matched if n)
    if suffix:
        blocks.append((len(a) - suffix, len(b) - suffix, suffix))
    return blocks


def _line_runs(a_lines: Sequence[str], b_lines: Sequence[str]) -> list[Block]:
    """Matching runs of whole lines, anchored on lines unique to both sides.

    The anchors are the longest chain of such lines in the same order on both
    sides; each is then grown over the equal lines around it. ``(i, j, n)``
    counts lines, not characters.
    """
    a_count, b_count = Counter(a_lines), Counter(b_lines)
    b_index = {line: j for j, line in enumerate(b_lines) if b_count[line] == 1}
    pairs = [
        (i, b_index[line])
        for i, line in enumerate(a_lines)
        if a_count[line] == 1 and line in b_index
    ]
    # Longest increasing chain of new-side positions (patience sorting).
    tails: list[int] = []  # tails[k]: index into pairs ending a chain of length k+1
    tail_js: list[int] = []  # the new-side position each of those ends on
    parent: list[int] = [-1] * len(pairs)
    for p, (_, j) in enumerate(pairs):
        k = bisect_left(tail_js, j)
        if k:
            parent[p] = tails[k - 1]
        if k == len(tails):
            tails.append(p)
            tail_js.append(j)
        else:
            tails[k] = p
            tail_js[k] = j
    anchors: list[tuple[int, int]] = []
    p = tails[-1] if tails else -1
    while p != -1:
        anchors.append(pairs[p])
        p = parent[p]
    anchors.reverse()

    runs: list[Block] = []
    a_done = b_done = 0  # lines before these are already in a run
    for i, j in anchors:
        if i < a_done:
            continue  # taken in by the run before
        start_i, start_j = i, j
        while start_i > a_done and start_j > b_done and a_lines[start_i - 1] == b_lines[start_j - 1]:
            start_i -= 1
            start_j -= 1
        end_i, end_j = i + 1, j + 1
        while end_i < len(a_lines) and end_j < len(b_lines) and a_lines[end_i] == b_lines[end_j]:
            end_i += 1
            end_j += 1
        runs.append((start_i, start_j, end_i - start_i))
        a_done, b_done = end_i, end_j
    return runs


def _starts(lines: Sequence[str]) -> list[int]:
    """The character offset each line starts at, plus the total length."""
    return list(accumulate(map(len, lines), initial=0))


def _middle_blocks(a: str, b: str, offsets: Sequence[int], budget: _Budget) -> list[Block]:
    """Matching character runs between two texts that differ at both ends.

    Lines are matched first; each stretch between matched lines that holds one
    of ``offsets`` (relative to ``a``) is then diffed character by character.
    """
    a_lines, b_lines = a.splitlines(keepends=True), b.splitlines(keepends=True)
    if len(a_lines) + len(b_lines) > MAX_DIFF_LINES:
        return []
    a_at, b_at = _starts(a_lines), _starts(b_lines)
    blocks: list[Block] = []
    a_prev = b_prev = 0  # character offsets where the last line run ended
    ordered = sorted(offsets)
    for i, j, n in [*_line_runs(a_lines, b_lines), (len(a_lines), len(b_lines), 0)]:
        a_lo, b_lo = a_at[i], b_at[j]
        # The stretch before this run is only worth diffing if an offset falls
        # in it (an offset on its edge may match inside it, so that counts).
        k = bisect_left(ordered, a_prev)
        if k < len(ordered) and ordered[k] <= a_lo:
            gap = _char_blocks(a[a_prev:a_lo], b[b_prev:b_lo], budget)
            blocks.extend((a_prev + x, b_prev + y, m) for x, y, m in gap)
        if n:
            blocks.append((a_lo, b_lo, a_at[i + n] - a_lo))
        a_prev, b_prev = a_at[i + n], b_at[j + n]
    return blocks


def map_offsets(old: str, new: str, offsets: Sequence[int]) -> list[Optional[int]]:
    """Where each offset in ``old`` lands in ``new``, or ``None`` if it's lost.

    An offset inside or at either edge of text that is unchanged maps to the
    same spot in that text in ``new``; where two matched runs meet, it goes with
    the earlier one. An offset with changed text on both sides of it has no
    place in ``new`` and maps to ``None``, as does one in a stretch too large to
    compare within the budget (see the module docstring).
    """
    prefix, suffix = _common_ends(old, new)
    blocks: list[Block] = []
    if prefix:
        blocks.append((0, 0, prefix))
    old_end, new_end = len(old) - suffix, len(new) - suffix
    # The prefix run places an offset at its own end; any other offset from the
    # prefix's end to the suffix's start may match inside the middle.
    inner = [
        off - prefix for off in offsets if prefix <= off <= old_end and not (prefix and off == prefix)
    ]
    if inner and prefix < old_end and prefix < new_end:
        budget = _Budget(CHAR_DIFF_BUDGET)
        middle = _middle_blocks(old[prefix:old_end], new[prefix:new_end], inner, budget)
        blocks.extend((prefix + i, prefix + j, n) for i, j, n in middle)
    if suffix:
        blocks.append((old_end, new_end, suffix))
    blocks.append((len(old), len(new), 0))

    ends = [i + n for i, _, n in blocks]
    out: list[Optional[int]] = []
    for off in offsets:
        k = bisect_left(ends, off)
        if k < len(blocks) and blocks[k][0] <= off:
            out.append(blocks[k][1] + off - blocks[k][0])
        else:
            out.append(None)
    return out
