"""How the suite is cut into slices for xdist workers and CI shards (_slices.py)."""
import json

import pytest

from backend.tests import _slices


def test_slices_are_contiguous_and_cover_every_file():
    files = [(f"test_{i:02d}.py", 10) for i in range(20)]
    slice_of = _slices.assign(files, 4, {}, 1.0)
    order = [slice_of[name] for name, _ in files]
    assert order == sorted(order)
    assert [order.count(n) for n in range(4)] == [5, 5, 5, 5]


def test_a_slow_file_counts_for_what_it_takes_not_its_tests():
    # One file as long as the other eight together: it gets a slice to itself.
    files = [("test_slow.py", 1)] + [(f"test_{i}.py", 10) for i in range(8)]
    slice_of = _slices.assign(files, 2, {"test_slow.py": 80.0}, 1.0)
    assert slice_of["test_slow.py"] == 0
    assert {slice_of[f"test_{i}.py"] for i in range(8)} == {1}


def test_an_unlisted_file_is_costed_per_test():
    files = [("test_a.py", 30), ("test_b.py", 10), ("test_c.py", 10), ("test_d.py", 10)]
    assert _slices.assign(files, 2, {}, 0.5) == {
        "test_a.py": 0,
        "test_b.py": 1,
        "test_c.py": 1,
        "test_d.py": 1,
    }


def test_more_slices_than_files_leaves_none_out_of_range():
    slice_of = _slices.assign([("test_a.py", 1), ("test_b.py", 1)], 8, {}, 1.0)
    assert all(0 <= n < 8 for n in slice_of.values())
    assert _slices.assign([("test_a.py", 0)], 3, {}, 1.0) == {"test_a.py": 0}


@pytest.mark.parametrize("value, shard", [("", (1, 1)), ("1/2", (1, 2)), ("3/3", (3, 3))])
def test_parse_shard(value, shard):
    assert _slices.parse_shard(value) == shard


@pytest.mark.parametrize("value", ["0/2", "3/2", "2", "a/b", "1/0"])
def test_parse_shard_refuses_nonsense(value):
    with pytest.raises(ValueError):
        _slices.parse_shard(value)


def test_file_of_ignores_the_test_and_the_xdist_group():
    nodeid = "backend/tests/test_books.py::TestX::test_y[a::b]@chunk-3"
    assert _slices.file_of(nodeid) == "test_books.py"


def test_recorded_timings_round_trip(tmp_path):
    recorder = _slices.Recorder()
    # Setup, call and teardown of one test are three reports, one test.
    for duration in (0.5, 2.0, 0.1):
        recorder.add("backend/tests/test_slow.py::test_one", duration)
    recorder.add("backend/tests/test_quick.py::test_one", 0.01)
    recorder.add("backend/tests/test_quick.py::test_two", 0.03)
    path = str(tmp_path / "timings.json")
    recorder.write(path)
    assert json.loads((tmp_path / "timings.json").read_text()) == {
        "per_test": 0.02,
        "files": {"test_slow.py": 2.6},
    }
    assert _slices.load_timings(path) == ({"test_slow.py": 2.6}, 0.02)


def test_without_a_timings_file_every_test_weighs_the_same(tmp_path):
    assert _slices.load_timings(str(tmp_path / "missing.json")) == ({}, 1.0)


def test_the_committed_timings_load():
    seconds, per_test = _slices.load_timings()
    assert per_test > 0
    assert all(name.startswith("test_") and took > 0 for name, took in seconds.items())
