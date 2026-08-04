"""Tests for the isolated script runner and its worker.

The worker (``backend.addon_worker``) is tested in-process; the subprocess path
in ``backend.addons.scripts`` is tested with real spawned children for the happy
path, timeout, and crash cases, mirroring the existing isolated-worker tests.
"""
import json
import os
import textwrap

import pytest

from backend import addon_worker
from backend.addons import registry, scripts
from backend.addons.manifest import AddonManifest
from backend.addons.scripts import AddonScriptError

BASE = {
    "id": "scripted",
    "name": "Scripted",
    "version": "1.0.0",
    "kind": "scraper",
    "script": {"entry": "run.py", "timeout": 20},
}

GOOD_SCRIPT = """
import json, sys

def main():
    req = json.load(sys.stdin)
    if req["action"] == "search":
        json.dump({"results": [
            {"identity": "a-1", "label": "Alpha One", "score": 0.9,
             "url": "https://example.com/a-1"},
        ]}, sys.stdout)
    else:
        json.dump({"fields": {"license": "OGL", "year": 1999,
                              "nonsense": "ignored"},
                   "url": "https://example.com/a-1"}, sys.stdout)
"""


@pytest.fixture
def addons_dir(tmp_path, monkeypatch):
    directory = tmp_path / "add-ons"
    directory.mkdir()
    monkeypatch.setattr(registry, "ADDONS_DIR", str(directory))
    return directory


def _install(addons_dir, body, addon_id="scripted", **manifest_overrides):
    directory = addons_dir / addon_id
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "run.py").write_text(textwrap.dedent(body))
    data = {**BASE, "id": addon_id, **manifest_overrides}
    return AddonManifest(**data)


# ---------------------------------------------------------------------------
# The worker, in-process
# ---------------------------------------------------------------------------


class TestWorker:
    def _script(self, tmp_path, body):
        path = tmp_path / "s.py"
        path.write_text(textwrap.dedent(body))
        return str(path)

    def test_runs_a_script_and_returns_its_output(self, tmp_path):
        path = self._script(tmp_path, GOOD_SCRIPT)
        result = addon_worker.run(path, json.dumps({"action": "search"}))
        assert result["results"][0]["identity"] == "a-1"

    def test_reports_a_script_with_no_main(self, tmp_path):
        path = self._script(tmp_path, "x = 1\n")
        assert "no main()" in addon_worker.run(path, "{}")["error"]

    def test_reports_a_script_that_prints_nothing(self, tmp_path):
        path = self._script(tmp_path, "def main():\n    pass\n")
        assert "no output" in addon_worker.run(path, "{}")["error"]

    def test_reports_invalid_json_output(self, tmp_path):
        path = self._script(tmp_path, "def main():\n    print('not json')\n")
        assert "invalid JSON" in addon_worker.run(path, "{}")["error"]

    def test_reports_non_object_output(self, tmp_path):
        path = self._script(tmp_path, "def main():\n    print('[1,2]')\n")
        assert "did not return an object" in addon_worker.run(path, "{}")["error"]

    def test_main_writes_a_result_file_even_when_the_script_raises(self, tmp_path):
        """An exception must be reported, not left to look like a crash."""
        path = self._script(tmp_path, "def main():\n    raise RuntimeError('boom')\n")
        out = tmp_path / "result.json"
        addon_worker.main(path, "{}", str(out))
        assert "boom" in json.loads(out.read_text())["error"]

    def test_main_handles_an_unimportable_script(self, tmp_path):
        out = tmp_path / "result.json"
        addon_worker.main(str(tmp_path / "missing.py"), "{}", str(out))
        assert json.loads(out.read_text())["error"]

    def test_stdout_is_restored_after_a_run(self, tmp_path):
        import sys

        before = sys.stdout
        addon_worker.run(self._script(tmp_path, GOOD_SCRIPT), json.dumps({"action": "s"}))
        assert sys.stdout is before


# ---------------------------------------------------------------------------
# The subprocess runner
# ---------------------------------------------------------------------------


class TestScriptRunner:
    def test_search_round_trips_through_a_subprocess(self, addons_dir):
        manifest = _install(addons_dir, GOOD_SCRIPT)
        results = scripts.search("anything", manifest)
        assert results[0]["identity"] == "a-1"
        assert results[0]["label"] == "Alpha One"
        assert results[0]["score"] == 0.9

    def test_fetch_round_trips_through_a_subprocess(self, addons_dir):
        manifest = _install(addons_dir, GOOD_SCRIPT)
        fields, url = scripts.fetch("a-1", manifest)
        assert fields["license"] == "OGL"
        assert url == "https://example.com/a-1"

    def test_a_missing_script_file_is_reported(self, addons_dir):
        (addons_dir / "scripted").mkdir()
        manifest = AddonManifest(**BASE)
        with pytest.raises(AddonScriptError, match="missing"):
            scripts.search("x", manifest)

    def test_a_script_reporting_an_error_is_surfaced(self, addons_dir):
        manifest = _install(
            addons_dir,
            """
            import json, sys
            def main():
                json.dump({"error": "source returned HTTP 503"}, sys.stdout)
            """,
        )
        with pytest.raises(AddonScriptError, match="HTTP 503"):
            scripts.search("x", manifest)

    def test_a_timeout_is_enforced(self, addons_dir):
        """A wedged script must be killed, not allowed to hang the request."""
        manifest = _install(
            addons_dir,
            """
            import time
            def main():
                time.sleep(30)
            """,
            script={"entry": "run.py", "timeout": 1},
        )
        with pytest.raises(AddonScriptError, match="timed out"):
            scripts.search("x", manifest)

    def test_a_hard_crash_is_reported(self, addons_dir):
        """A child that dies natively must not take the server with it."""
        manifest = _install(
            addons_dir,
            """
            import os
            def main():
                os._exit(1)
            """,
        )
        with pytest.raises(AddonScriptError, match="exited with code"):
            scripts.search("x", manifest)

    def test_malformed_results_are_rejected(self, addons_dir):
        manifest = _install(
            addons_dir,
            """
            import json, sys
            def main():
                json.dump({"results": "not a list"}, sys.stdout)
            """,
        )
        with pytest.raises(AddonScriptError, match="'results' list"):
            scripts.search("x", manifest)

    def test_malformed_fields_are_rejected(self, addons_dir):
        manifest = _install(
            addons_dir,
            """
            import json, sys
            def main():
                json.dump({"fields": "nope"}, sys.stdout)
            """,
        )
        with pytest.raises(AddonScriptError, match="'fields' object"):
            scripts.fetch("a-1", manifest)

    def test_candidates_without_an_identity_are_dropped(self, addons_dir):
        manifest = _install(
            addons_dir,
            """
            import json, sys
            def main():
                json.dump({"results": [
                    {"label": "no identity"},
                    "not an object",
                    {"identity": "ok"},
                ]}, sys.stdout)
            """,
        )
        results = scripts.search("x", manifest)
        assert [r["identity"] for r in results] == ["ok"]

    def test_out_of_range_scores_are_clamped(self, addons_dir):
        manifest = _install(
            addons_dir,
            """
            import json, sys
            def main():
                json.dump({"results": [
                    {"identity": "a", "score": 42},
                    {"identity": "b", "score": -5},
                    {"identity": "c", "score": "nonsense"},
                ]}, sys.stdout)
            """,
        )
        assert [r["score"] for r in scripts.search("x", manifest)] == [1.0, 0.0, 0.0]

    def test_the_script_receives_its_own_directory(self, addons_dir):
        """Scripts are told where they live so they can cache alongside themselves."""
        manifest = _install(
            addons_dir,
            """
            import json, sys
            def main():
                req = json.load(sys.stdin)
                json.dump({"fields": {"license": req["addon_dir"]}}, sys.stdout)
            """,
        )
        fields, _ = scripts.fetch("a-1", manifest)
        assert fields["license"] == str(addons_dir / "scripted")

    def test_no_temp_result_files_are_left_behind(self, addons_dir):
        import tempfile

        manifest = _install(addons_dir, GOOD_SCRIPT)
        before = {n for n in os.listdir(tempfile.gettempdir()) if "grimoire_addon_" in n}
        scripts.search("x", manifest)
        after = {n for n in os.listdir(tempfile.gettempdir()) if "grimoire_addon_" in n}
        assert after == before


class TestServiceFiltersScriptOutput:
    def test_unmappable_fields_from_a_script_are_dropped(self):
        """Script output is third-party data; it gets the same allowlist the
        declarative path is held to by schema."""
        from backend.addons.service import _allowed_only

        manifest = AddonManifest(**BASE)
        filtered = _allowed_only(
            {"license": "OGL", "id": "hijack", "cover_image": "x", "year": 2000},
            manifest,
        )
        assert filtered == {"license": "OGL", "year": 2000}

    def test_the_allowlist_follows_the_target(self):
        """A book scraper may write `isbn`; a system scraper may not."""
        from backend.addons.service import _allowed_only

        payload = {"isbn": "123", "dice_materials": ["d20"]}
        system = AddonManifest(**BASE)
        book = AddonManifest(**{**BASE, "target": "book"})

        assert _allowed_only(payload, system) == {"dice_materials": ["d20"]}
        assert _allowed_only(payload, book) == {"isbn": "123"}
