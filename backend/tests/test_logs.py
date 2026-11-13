"""Tests for the /api/logs endpoint."""
import datetime
import logging
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from backend import config

# The repo root, where `backend` imports from whatever directory pytest started in.
_REPO = str(Path(__file__).resolve().parents[2])


class TestLogsAccess:
    def test_admin_can_access_logs(self, client, admin_headers):
        resp = client.get("/api/logs", headers=admin_headers)
        assert resp.status_code == 200

    def test_gm_cannot_access_logs(self, client, gm_headers):
        resp = client.get("/api/logs", headers=gm_headers)
        assert resp.status_code == 403

    def test_player_cannot_access_logs(self, client, player_headers):
        resp = client.get("/api/logs", headers=player_headers)
        assert resp.status_code == 403

    def test_unauthenticated_cannot_access_logs(self, client):
        resp = client.get("/api/logs")
        assert resp.status_code == 401


class TestLogsResponseShape:
    def test_response_has_required_fields(self, client, admin_headers):
        resp = client.get("/api/logs", headers=admin_headers)
        body = resp.json()
        assert "entries" in body
        assert "total" in body
        assert "max_seq" in body
        assert "level" in body
        assert "limit" in body
        assert "offset" in body

    def test_max_seq_is_non_negative_int(self, client, admin_headers):
        resp = client.get("/api/logs", headers=admin_headers)
        body = resp.json()
        assert isinstance(body["max_seq"], int)
        assert body["max_seq"] >= 0

    def test_after_seq_returns_only_newer_entries(self, client, admin_headers):
        # Get current max_seq
        resp1 = client.get("/api/logs?level=info&limit=500", headers=admin_headers)
        seq = resp1.json()["max_seq"]
        # Emit a known new entry
        logging.getLogger("grimoire").info("after_seq test marker")
        # Poll with after_seq
        resp2 = client.get(f"/api/logs?level=info&after_seq={seq}", headers=admin_headers)
        body = resp2.json()
        assert resp2.status_code == 200
        assert len(body["entries"]) >= 1
        assert any("after_seq test marker" in e["message"] for e in body["entries"])
        # All returned entries must have seq > the cursor
        for e in body["entries"]:
            assert e["seq"] > seq

    def test_after_seq_only_returns_entries_after_cursor(self, client, admin_headers):
        # Any entries returned must have seq strictly greater than the cursor
        resp1 = client.get("/api/logs?level=info&limit=500", headers=admin_headers)
        seq = resp1.json()["max_seq"]
        resp2 = client.get(f"/api/logs?level=info&after_seq={seq}", headers=admin_headers)
        assert resp2.status_code == 200
        for entry in resp2.json()["entries"]:
            assert entry["seq"] > seq

    def test_entries_is_list(self, client, admin_headers):
        resp = client.get("/api/logs", headers=admin_headers)
        assert isinstance(resp.json()["entries"], list)

    def test_total_is_non_negative_int(self, client, admin_headers):
        resp = client.get("/api/logs", headers=admin_headers)
        body = resp.json()
        assert isinstance(body["total"], int)
        assert body["total"] >= 0

    def test_entry_fields(self, client, admin_headers):
        # Emit a known log entry so at least one exists
        logging.getLogger("grimoire").info("test_entry_fields probe")
        resp = client.get("/api/logs?level=info&limit=500", headers=admin_headers)
        entries = resp.json()["entries"]
        assert len(entries) > 0
        entry = entries[-1]
        assert "seq" in entry
        assert "timestamp" in entry
        assert "level" in entry
        assert "logger" in entry
        assert "message" in entry
        assert isinstance(entry["seq"], int)
        assert entry["seq"] > 0

    def test_timestamp_format(self, client, admin_headers, monkeypatch):
        # LOG_TIMEZONE is resolved from TZ at import, so pin the default here:
        # otherwise this only passes on a machine whose TZ is unset or UTC.
        monkeypatch.setattr(config, "LOG_TIMEZONE", datetime.timezone.utc)
        logging.getLogger("grimoire").info("timestamp format probe")
        resp = client.get("/api/logs?level=info&limit=500", headers=admin_headers)
        entries = resp.json()["entries"]
        assert len(entries) > 0
        ts = entries[-1]["timestamp"]
        # Default (UTC) timestamps end with Z; non-UTC zones append the offset.
        assert ts.endswith("Z")
        assert "T" in ts


# Fixed epoch: 2024-07-22T16:00:00.123Z, chosen because it is DST for both
# northern-hemisphere zones exercised below.
_FIXED_EPOCH = 1721664000.123


def _make_record() -> logging.LogRecord:
    rec = logging.LogRecord("grimoire", logging.INFO, "f.py", 1, "probe", None, None)
    rec.created = _FIXED_EPOCH
    return rec


class TestLogTimezone:
    """The TZ env var controls how log timestamps are rendered."""

    def test_resolve_defaults_to_utc(self, monkeypatch):
        monkeypatch.delenv("TZ", raising=False)
        assert config._resolve_log_timezone() is datetime.timezone.utc

    def test_resolve_utc_name_is_utc(self, monkeypatch):
        monkeypatch.setenv("TZ", "UTC")
        assert config._resolve_log_timezone() is datetime.timezone.utc

    def test_resolve_named_zone(self, monkeypatch):
        monkeypatch.setenv("TZ", "America/Toronto")
        assert config._resolve_log_timezone() == ZoneInfo("America/Toronto")

    def test_resolve_berlin_zone(self, monkeypatch):
        monkeypatch.setenv("TZ", "Europe/Berlin")
        assert config._resolve_log_timezone() == ZoneInfo("Europe/Berlin")

    def test_unknown_zone_falls_back_to_utc(self, monkeypatch):
        monkeypatch.setenv("TZ", "Not/AZone")
        # The warning waits for startup() rather than printing at import.
        monkeypatch.setattr(config, "_deferred_warnings", [])
        assert config._resolve_log_timezone() is datetime.timezone.utc
        assert [args for _, args in config._deferred_warnings] == [("Not/AZone",)]

    @pytest.mark.parametrize(
        "tz, expected_hhmmss, expected_suffix",
        [
            (datetime.timezone.utc, "16:00:00.123", "Z"),
            (ZoneInfo("America/Toronto"), "12:00:00.123", "-04:00"),
            (ZoneInfo("Europe/Berlin"), "18:00:00.123", "+02:00"),
        ],
    )
    def test_memory_buffer_timestamp_uses_configured_zone(
        self, monkeypatch, tz, expected_hhmmss, expected_suffix
    ):
        monkeypatch.setattr(config, "LOG_TIMEZONE", tz)
        handler = config._MemoryLogHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        handler.emit(_make_record())
        ts = handler.get_entries(limit=1)[0][0]["timestamp"]
        # The log viewer slices chars [11:23] for the HH:MM:SS.mmm display.
        assert ts[11:23] == expected_hhmmss
        assert ts.endswith(expected_suffix)

    @pytest.mark.parametrize(
        "tz, expected",
        [
            (datetime.timezone.utc, "2024-07-22 16:00:00.123+00:00"),
            (ZoneInfo("America/Toronto"), "2024-07-22 12:00:00.123-04:00"),
        ],
    )
    def test_console_formatter_uses_configured_zone(self, monkeypatch, tz, expected):
        monkeypatch.setattr(config, "LOG_TIMEZONE", tz)
        fmt = config._TZFormatter("%(asctime)s %(message)s")
        assert fmt.formatTime(_make_record()) == expected


class TestLogsLevelFilter:
    def test_default_level_is_info(self, client, admin_headers):
        resp = client.get("/api/logs", headers=admin_headers)
        assert resp.json()["level"] == "info"

    def test_debug_level_accepted(self, client, admin_headers):
        resp = client.get("/api/logs?level=debug", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["level"] == "debug"

    def test_warning_level_accepted(self, client, admin_headers):
        resp = client.get("/api/logs?level=warning", headers=admin_headers)
        assert resp.status_code == 200

    def test_error_level_accepted(self, client, admin_headers):
        resp = client.get("/api/logs?level=error", headers=admin_headers)
        assert resp.status_code == 200

    def test_critical_level_accepted(self, client, admin_headers):
        resp = client.get("/api/logs?level=critical", headers=admin_headers)
        assert resp.status_code == 200

    def test_invalid_level_rejected(self, client, admin_headers):
        resp = client.get("/api/logs?level=verbose", headers=admin_headers)
        assert resp.status_code == 422

    def test_debug_returns_more_than_info(self, client, admin_headers):
        """DEBUG level should return >= entries compared to INFO level."""
        logging.getLogger("grimoire").debug("debug-only probe for filter test")
        logging.getLogger("grimoire").info("info probe for filter test")

        debug_resp = client.get("/api/logs?level=debug&limit=2000", headers=admin_headers)
        info_resp  = client.get("/api/logs?level=info&limit=2000",  headers=admin_headers)

        debug_total = debug_resp.json()["total"]
        info_total  = info_resp.json()["total"]
        assert debug_total >= info_total

    def test_info_entries_contain_no_debug(self, client, admin_headers):
        """Entries returned at INFO level must not include DEBUG-level entries."""
        resp = client.get("/api/logs?level=info&limit=2000", headers=admin_headers)
        for entry in resp.json()["entries"]:
            assert entry["level"] != "DEBUG"

    def test_error_entries_only_contain_error_or_above(self, client, admin_headers):
        resp = client.get("/api/logs?level=error&limit=2000", headers=admin_headers)
        allowed = {"ERROR", "CRITICAL"}
        for entry in resp.json()["entries"]:
            assert entry["level"] in allowed


class TestLogsPagination:
    def test_limit_param(self, client, admin_headers):
        # Ensure enough log entries exist
        log = logging.getLogger("grimoire")
        for i in range(10):
            log.info(f"pagination test probe {i}")

        resp = client.get("/api/logs?level=debug&limit=5", headers=admin_headers)
        body = resp.json()
        assert body["limit"] == 5
        assert len(body["entries"]) <= 5

    def test_offset_param(self, client, admin_headers):
        resp_no_offset = client.get("/api/logs?level=debug&limit=10&offset=0", headers=admin_headers)
        resp_offset    = client.get("/api/logs?level=debug&limit=10&offset=5", headers=admin_headers)

        entries_no = resp_no_offset.json()["entries"]
        entries_of = resp_offset.json()["entries"]
        # They should differ (assuming enough entries exist)
        if entries_no and entries_of:
            assert entries_no != entries_of

    def test_limit_too_large_rejected(self, client, admin_headers):
        resp = client.get("/api/logs?limit=99999", headers=admin_headers)
        assert resp.status_code == 422

    def test_limit_zero_rejected(self, client, admin_headers):
        resp = client.get("/api/logs?limit=0", headers=admin_headers)
        assert resp.status_code == 422

    def test_negative_offset_rejected(self, client, admin_headers):
        resp = client.get("/api/logs?offset=-1", headers=admin_headers)
        assert resp.status_code == 422


class TestMemoryHandler:
    # The buffer is a bounded deque, so once the full suite has logged more
    # than _LOG_BUFFER_MAX records the total stops growing. Look for the probe
    # message among the newest entries instead of comparing counts.
    def test_buffer_captures_info(self):
        from backend.config import _memory_handler
        logging.getLogger("grimoire").info("memory handler capture test")
        entries, _ = _memory_handler.get_entries(min_level=logging.INFO, limit=50)
        assert "memory handler capture test" in [e["message"] for e in entries]

    def test_buffer_captures_debug(self):
        from backend.config import _memory_handler
        logging.getLogger("grimoire").debug("memory handler debug capture test")
        entries, _ = _memory_handler.get_entries(min_level=logging.DEBUG, limit=50)
        assert "memory handler debug capture test" in [e["message"] for e in entries]

    def test_get_entries_respects_min_level(self):
        from backend.config import _memory_handler
        logging.getLogger("grimoire").debug("level-filter debug entry")
        logging.getLogger("grimoire").info("level-filter info entry")

        debug_entries, _ = _memory_handler.get_entries(min_level=logging.DEBUG, limit=2000)
        info_entries,  _ = _memory_handler.get_entries(min_level=logging.INFO,  limit=2000)

        assert len(debug_entries) >= len(info_entries)

    def test_entries_have_correct_structure(self):
        from backend.config import _memory_handler
        logging.getLogger("grimoire").info("structure check probe")
        entries, max_seq = _memory_handler.get_entries(min_level=logging.INFO, limit=10)
        assert len(entries) > 0
        e = entries[-1]
        assert set(e.keys()) == {"seq", "timestamp", "level", "logger", "message", "user"}
        assert isinstance(e["seq"], int)
        assert e["seq"] > 0
        assert isinstance(max_seq, int)
        assert max_seq > 0


class TestConfigReload:
    """Reloading backend.config (test_opds.py does, to re-read the environment)
    must leave logging as it found it, not stack a second buffer or reformat one."""

    def test_reload_keeps_one_bare_message_buffer(self):
        import importlib
        from backend.routers.logs import core as logs_core

        foreign = logging.NullHandler()
        foreign.setFormatter(logging.Formatter("foreign %(message)s"))
        logging.root.addHandler(foreign)
        before = config._memory_handler
        logging.getLogger("grimoire").info("before the reload")
        _, seq_before = before.get_entries(limit=1)
        try:
            importlib.reload(config)
        finally:
            logging.root.removeHandler(foreign)

        buffers = [h for h in logging.root.handlers if config._is_ours(h, "memory")]
        assert buffers == [before]
        assert config._memory_handler is before is logs_core._memory_handler
        assert before.formatter._fmt == "%(message)s"
        assert foreign.formatter._fmt == "foreign %(message)s"

        logging.getLogger("grimoire").info("after the reload")
        entries, seq_after = before.get_entries(limit=1)
        assert entries[-1]["message"] == "after the reload"
        assert seq_after > seq_before

    def test_reload_in_a_fresh_interpreter_keeps_root_as_it_was(self):
        """Outside pytest (whose own handlers sit on root), config adds the
        console handler itself - a reload must add neither it nor the buffer
        again, nor give the buffer the console's format."""
        import subprocess
        import sys

        probe = (
            "import importlib, logging\n"
            "import backend.config as c\n"
            "fmts = lambda: [h.formatter._fmt for h in logging.root.handlers]\n"
            "before = fmts()\n"
            "importlib.reload(c)\n"
            "print(before == fmts(), fmts())\n"
        )
        out = subprocess.run(
            [sys.executable, "-c", probe], cwd=_REPO, capture_output=True, text=True, check=True
        ).stdout
        assert out.strip() == (
            "True ['%(asctime)s [%(name)s] %(levelname)s: %(message)s', '%(message)s']"
        )


def _epub_with_a_missing_font(path: Path) -> None:
    """An EPUB whose stylesheet names a font the archive doesn't hold - the
    page renders, and MuPDF reports the missing font every time it lays out."""
    import zipfile

    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?><container version="1.0" '
            'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
            '<rootfile full-path="OEBPS/content.opf" '
            'media-type="application/oebps-package+xml"/></rootfiles></container>',
        )
        z.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" '
            'version="2.0" unique-identifier="id"><metadata '
            'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title>'
            '<dc:identifier id="id">x</dc:identifier></metadata><manifest>'
            '<item id="c" href="ch.xhtml" media-type="application/xhtml+xml"/>'
            '<item id="s" href="css/s.css" media-type="text/css"/></manifest>'
            '<spine><itemref idref="c"/></spine></package>',
        )
        z.writestr(
            "OEBPS/css/s.css",
            '@font-face { font-family: "Gone"; src: url(../font/Gone-Regular.otf); }'
            ' body { font-family: "Gone"; }',
        )
        z.writestr(
            "OEBPS/ch.xhtml",
            '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head>'
            '<link rel="stylesheet" href="css/s.css"/></head><body><p>Hi</p></body></html>',
        )


class TestMuPDFMessages:
    """MuPDF's own complaints go to the "pymupdf" logger at DEBUG, not stdout."""

    _RENDER = (
        "import sys, pymupdf\n"
        "pymupdf.open(sys.argv[1])[0].get_pixmap()\n"
        "print('rendered')\n"
    )

    def _run(self, probe: str, epub: Path, **env: str):
        import os
        import subprocess
        import sys

        child_env = {k: v for k, v in os.environ.items() if k != "PYMUPDF_MESSAGE"}
        child_env.update(env)
        return subprocess.run(
            [sys.executable, "-c", probe, str(epub)],
            cwd=_REPO,
            capture_output=True,
            text=True,
            check=True,
            env=child_env,
        )

    @pytest.mark.parametrize(
        "first", ["import backend.config\n", "import pymupdf\nimport backend.config\n"]
    )
    def test_kept_off_stdout_whichever_is_imported_first(self, tmp_path, first):
        epub = tmp_path / "book.epub"
        _epub_with_a_missing_font(epub)
        proc = self._run(first + self._RENDER, epub, LOG_LEVEL="info")
        assert proc.stdout.strip() == "rendered"
        assert "MuPDF" not in proc.stderr

    def test_shown_at_debug(self, tmp_path):
        epub = tmp_path / "book.epub"
        _epub_with_a_missing_font(epub)
        proc = self._run("import backend.config\n" + self._RENDER, epub, LOG_LEVEL="debug")
        assert "MuPDF" not in proc.stdout
        assert "[pymupdf] DEBUG: MuPDF error:" in proc.stderr
        assert "Gone-Regular.otf" in proc.stderr

    def test_spawned_workers_inherit_it(self, tmp_path):
        """Render and indexing workers are spawned fresh and may import pymupdf
        before any of backend.config - the environment carries the setting."""
        epub = tmp_path / "book.epub"
        _epub_with_a_missing_font(epub)
        probe = (
            "import subprocess, sys\n"
            "import backend.config\n"
            "child = 'import sys, pymupdf; pymupdf.open(sys.argv[1])[0].get_pixmap()'\n"
            "r = subprocess.run([sys.executable, '-c', child, sys.argv[1]],\n"
            "                   capture_output=True, text=True, check=True)\n"
            "print(repr(r.stdout + r.stderr))\n"
        )
        proc = self._run(probe, epub, LOG_LEVEL="info")
        assert proc.stdout.strip() == "''"

    def test_an_operators_own_setting_wins(self, tmp_path):
        epub = tmp_path / "book.epub"
        _epub_with_a_missing_font(epub)
        out = tmp_path / "mupdf.txt"
        proc = self._run(
            "import backend.config\n" + self._RENDER,
            epub,
            LOG_LEVEL="info",
            PYMUPDF_MESSAGE=f"path:{out}",
        )
        assert proc.stdout.strip() == "rendered"
        assert "Gone-Regular.otf" in out.read_text()
