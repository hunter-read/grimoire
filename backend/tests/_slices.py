"""How the suite is cut up for pytest-xdist workers and CI shards.

The tests share one database and one library folder, and plenty of them lean on
what earlier files left behind, so the suite is never dealt out file by file.
It is cut into contiguous slices of the files in their usual order, one per
worker, and each slice runs exactly as a serial run would: only its first file
loses its predecessors. In CI ``--shard I/N`` first cuts the files into N
contiguous parts, one per job, which a job then slices among its workers.

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


class Timings:
    """What ``timings.json`` holds: seconds for each listed (slow) file, and the
    averages every other file is costed at."""

    def __init__(self, files: dict[str, float], per_test: float, per_file: float) -> None:
        self.files = files
        self.per_test = per_test
        self.per_file = per_file

    def of_file(self, name: str, tests: int | None = None) -> float:
        """What ``name`` takes; by its test count when that is known."""
        if name in self.files:
            return self.files[name]
        return self.per_file if tests is None else tests * self.per_test


def load_timings(path: str = TIMINGS_PATH) -> Timings:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        # No timings: every test weighs the same, which sizes slices by count.
        return Timings({}, 1.0, 1.0)
    return Timings(dict(data["files"]), float(data["per_test"]), float(data["per_file"]))


def assign(files: Sequence[tuple[str, float]], slices: int) -> dict[str, int]:
    """The slice each file falls in: ``files`` is ``(name, seconds)`` in run order.

    A file goes where its midpoint lands on the timeline, so the slice numbers
    never go backwards and a file is never split.
    """
    per_slice = (sum(weight for _, weight in files) / slices) or 1.0
    result: dict[str, int] = {}
    elapsed = 0.0
    for name, weight in files:
        result[name] = min(slices - 1, int((elapsed + weight / 2) / per_slice))
        elapsed += weight
    return result


def shard_files(directory: str, shards: int, timings: Timings) -> dict[str, int]:
    """Which shard (from 0) each test file in ``directory`` belongs to.

    Decided from the file names alone, before anything is collected, so a
    shard never imports the files it leaves to the others.
    """
    names = sorted(
        name for name in os.listdir(directory) if name.startswith("test_") and name.endswith(".py")
    )
    return assign([(name, timings.of_file(name)) for name in names], shards)


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
    other_files = 0
    for name, count, took in sorted(files):
        if took >= _LISTED_FROM:
            listed[name] = round(took, 1)
        else:
            other_seconds += took
            other_tests += count
            other_files += 1
    return {
        "per_test": round(other_seconds / other_tests, 4) if other_tests else 0.0,
        "per_file": round(other_seconds / other_files, 3) if other_files else 0.0,
        "files": listed,
    }
