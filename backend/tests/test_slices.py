"""How the suite is cut into slices for xdist workers and CI shards (_slices.py)."""
import json
import os

import pytest

from backend.tests import _slices


def test_slices_are_contiguous_and_cover_every_file():
    files = [(f"test_{i:02d}.py", 10.0) for i in range(20)]
    slice_of = _slices.assign(files, 4)
    order = [slice_of[name] for name, _ in files]
    assert order == sorted(order)
    assert [order.count(n) for n in range(4)] == [5, 5, 5, 5]


def test_a_slow_file_counts_for_what_it_takes():
    # One file as long as the other eight together: it gets a slice to itself.
    files = [("test_slow.py", 80.0)] + [(f"test_{i}.py", 10.0) for i in range(8)]
    slice_of = _slices.assign(files, 2)
    assert slice_of["test_slow.py"] == 0
    assert {slice_of[f"test_{i}.py"] for i in range(8)} == {1}


def test_more_slices_than_files_leaves_none_out_of_range():
    slice_of = _slices.assign([("test_a.py", 1.0), ("test_b.py", 1.0)], 8)
    assert all(0 <= n < 8 for n in slice_of.values())
    assert _slices.assign([("test_a.py", 0.0)], 3) == {"test_a.py": 0}


def test_a_file_is_costed_by_its_listing_then_its_tests_then_the_average():
    timings = _slices.Timings({"test_slow.py": 40.0}, per_test=0.5, per_file=3.0)
    assert timings.of_file("test_slow.py", 2) == 40.0
    assert timings.of_file("test_quick.py", 10) == 5.0
    assert timings.of_file("test_quick.py") == 3.0


def test_shards_are_cut_from_the_file_names_alone(tmp_path):
    for name in ("test_a.py", "test_b.py", "test_c.py", "test_d.py", "conftest.py", "notes.txt"):
        (tmp_path / name).write_text("")
    timings = _slices.Timings({"test_a.py": 3.0}, per_test=0.1, per_file=1.0)
    assert _slices.shard_files(str(tmp_path), 2, timings) == {
        "test_a.py": 0,
        "test_b.py": 1,
        "test_c.py": 1,
        "test_d.py": 1,
    }


def test_every_test_file_falls_in_exactly_one_shard():
    shard_of = _slices.shard_files(os.path.dirname(__file__), 2, _slices.load_timings())
    assert set(shard_of.values()) == {0, 1}
    assert "test_slices.py" in shard_of


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
        "per_file": 0.04,
        "files": {"test_slow.py": 2.6},
    }
    loaded = _slices.load_timings(path)
    assert (loaded.files, loaded.per_test, loaded.per_file) == ({"test_slow.py": 2.6}, 0.02, 0.04)


def test_without_a_timings_file_every_test_weighs_the_same(tmp_path):
    timings = _slices.load_timings(str(tmp_path / "missing.json"))
    assert timings.of_file("test_a.py", 7) == 7.0


def test_the_committed_timings_load():
    timings = _slices.load_timings()
    assert timings.per_test > 0 and timings.per_file > 0
    assert all(name.startswith("test_") and took > 0 for name, took in timings.files.items())
