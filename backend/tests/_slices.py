"""How the suite is cut up for pytest-xdist workers and CI shards.

The tests share one database and one library folder, and plenty of them lean on
what earlier files left behind, so the suite is never dealt out file by file.
It is cut into contiguous slices of the files in their usual order, one per
worker (and, in CI, ``--shard I/N`` keeps one job's share of them), and each
slice runs exactly as a serial run would: only its first file loses its
predecessors.

The slices are sized by how long the files take, not by how many tests they
hold: a handful of files (the migration tests, the ones that start a second
Python) take as long as a thousand ordinary tests, and a slice that drew two of
them used to finish a minute after the rest. ``timings.json`` holds what the
slow files take and the average for everything else; ``--write-timings`` on a
full run rewrites it. A stale file only makes the slices uneven.
"""
import json
import os
from collections.abc import Iterable, Sequence

TIMINGS_PATH = os.path.join(os.path.dirname(__file__), "timings.json")

# Files quicker than this are not listed: they are costed at the average.
_LISTED_FROM = 1.0


def parse_shard(value: str) -> tuple[int, int]:
    """``"2/3"`` as ``(2, 3)``; an empty value is the whole suite, ``(1, 1)``."""
    if not value:
        return 1, 1
    try:
        index, _, count = value.partition("/")
        shard = int(index), int(count)
    except ValueError:
        shard = (0, 0)
    if not 1 <= shard[0] <= shard[1]:
        raise ValueError(f"--shard takes I/N with 1 <= I <= N, not {value!r}")
    return shard


def load_timings(path: str = TIMINGS_PATH) -> tuple[dict[str, float], float]:
    """``(seconds per listed file, seconds per test for the rest)``."""
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        # No timings: every test weighs the same, which sizes slices by count.
        return {}, 1.0
    return dict(data["files"]), float(data["per_test"])


def assign(
    files: Sequence[tuple[str, int]],
    slices: int,
    seconds: dict[str, float],
    per_test: float,
) -> dict[str, int]:
    """The slice each file falls in: ``files`` is ``(name, test count)`` in run order.

    A file goes where its midpoint lands on the suite's timeline, so the slice
    numbers never go backwards and a file is never split.
    """
    weights = [seconds.get(name, count * per_test) for name, count in files]
    per_slice = (sum(weights) / slices) or 1.0
    result: dict[str, int] = {}
    elapsed = 0.0
    for (name, _), weight in zip(files, weights):
        result[name] = min(slices - 1, int((elapsed + weight / 2) / per_slice))
        elapsed += weight
    return result


def file_of(nodeid: str) -> str:
    """``test_books.py`` for ``backend/tests/test_books.py::TestX::test_y``."""
    return os.path.basename(nodeid.split("::", 1)[0])


class Recorder:
    """Adds up what each file's tests took, for ``--write-timings``."""

    def __init__(self) -> None:
        self.seconds: dict[str, float] = {}
        self.tests: dict[str, set[str]] = {}

    def add(self, nodeid: str, duration: float) -> None:
        # xdist appends "@chunk-N" to the id; the file name is before any of it.
        name = file_of(nodeid)
        self.seconds[name] = self.seconds.get(name, 0.0) + duration
        self.tests.setdefault(name, set()).add(nodeid)

    def summary(self) -> dict:
        return summarise((name, len(self.tests[name]), took) for name, took in self.seconds.items())

    def write(self, path: str = TIMINGS_PATH) -> None:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self.summary(), fh, indent=2)
            fh.write("\n")


def summarise(files: Iterable[tuple[str, int, float]]) -> dict:
    """``timings.json``'s content from ``(name, test count, seconds)`` per file."""
    listed: dict[str, float] = {}
    other_seconds = 0.0
    other_tests = 0
    for name, count, took in sorted(files):
        if took >= _LISTED_FROM:
            listed[name] = round(took, 1)
        else:
            other_seconds += took
            other_tests += count
    per_test = round(other_seconds / other_tests, 4) if other_tests else 0.0
    return {"per_test": per_test, "files": listed}
