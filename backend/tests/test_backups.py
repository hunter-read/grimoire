"""Tests for the backup service and API (issue #338)."""
import json
import os
import sqlite3
import zipfile
from datetime import datetime, timedelta, timezone

import pytest

from backend.services import backup as backup_service
from backend.services.backup._config import BackupConfig
from backend.services.backup._store import prune_backups, record_for


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _config(tmp_path, *, count: int = 0, gb: int = 0) -> BackupConfig:
    return BackupConfig(
        schedule="off",
        hour=3,
        minute=0,
        weekday=0,
        retention_count=count,
        retention_gb=gb,
        directory=str(tmp_path),
        schedule_env_locked=False,
        retention_count_env_locked=False,
        retention_gb_env_locked=False,
        dir_env_locked=False,
    )


def _write_backup(directory, stamp: str, size_bytes: int = 512, version: str = "1.5.6") -> str:
    """Create a syntactically valid backup archive of roughly `size_bytes`."""
    path = os.path.join(str(directory), f"grimoire-backup-{stamp}.zip")
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("details.json", json.dumps({"app": "grimoire", "version": version}))
        # Incompressible payload so the archive actually reaches the target size.
        zf.writestr("filler.bin", os.urandom(size_bytes))
    return path


@pytest.fixture
def backup_dir(tmp_path, monkeypatch):
    """Point the whole backup service at a throwaway directory."""
    target = tmp_path / "backups"
    target.mkdir()
    monkeypatch.setattr(backup_service._config, "BACKUP_DIR", str(target))
    monkeypatch.setattr(backup_service._config, "BACKUP_DIR_ENV", None)
    return target


# ---------------------------------------------------------------------------
# Database snapshot
# ---------------------------------------------------------------------------


class TestSnapshotDatabase:
    def test_produces_a_readable_copy(self, tmp_path):
        dest = tmp_path / "snap.db"
        backup_service.snapshot_database(str(dest))

        assert dest.exists()
        conn = sqlite3.connect(str(dest))
        try:
            tables = {
                r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
        finally:
            conn.close()
        # The snapshot is a real database, not an empty file.
        assert "users" in tables

    def test_snapshot_is_self_contained(self, tmp_path):
        """No -wal/-shm sidecar is needed to read the copy back.

        This is the property a plain `cp` cannot guarantee under WAL.
        """
        dest = tmp_path / "solo.db"
        backup_service.snapshot_database(str(dest))

        assert not (tmp_path / "solo.db-wal").exists()
        conn = sqlite3.connect(str(dest))
        try:
            assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Archive creation
# ---------------------------------------------------------------------------


class TestCreateBackup:
    def test_creates_archive_with_db_and_manifest(self, backup_dir):
        from backend.config import SessionLocal

        db = SessionLocal()
        try:
            record = backup_service.create_backup(db, trigger="manual")
        finally:
            db.close()

        assert os.path.isfile(record.path)
        assert record.filename.startswith("grimoire-backup-")
        assert record.filename.endswith(".zip")

        with zipfile.ZipFile(record.path) as zf:
            names = zf.namelist()
            assert "grimoire.db" in names
            assert "details.json" in names
            manifest = json.loads(zf.read("details.json"))

        assert manifest["app"] == "grimoire"
        assert manifest["trigger"] == "manual"
        assert manifest["version"]
        # The manifest states what is deliberately absent.
        assert any("library" in x for x in manifest["excludes"])

    def test_includes_user_authored_assets(self, backup_dir, monkeypatch, tmp_path):
        """Campaign uploads and covers ride along; caches do not."""
        from backend.config import SessionLocal

        uploads = tmp_path / "campaign_uploads"
        (uploads / "banners").mkdir(parents=True)
        (uploads / "banners" / "banner.png").write_bytes(b"art")

        monkeypatch.setattr(
            backup_service._archive,
            "ASSET_DIRS",
            ((str(uploads), "campaign_uploads"),),
        )

        db = SessionLocal()
        try:
            record = backup_service.create_backup(db)
        finally:
            db.close()

        with zipfile.ZipFile(record.path) as zf:
            assert "campaign_uploads/banners/banner.png" in zf.namelist()
            assert not any(n.startswith("page_cache") for n in zf.namelist())

    def test_does_not_back_up_previous_backups(self, backup_dir):
        """A backup never nests earlier backups inside itself."""
        from backend.config import SessionLocal

        _write_backup(backup_dir, "20200101T000000Z", size_bytes=4096)

        db = SessionLocal()
        try:
            record = backup_service.create_backup(db)
        finally:
            db.close()

        with zipfile.ZipFile(record.path) as zf:
            assert not any("grimoire-backup-" in n for n in zf.namelist())

    def test_leaves_no_partial_file_when_snapshot_fails(self, backup_dir, monkeypatch):
        """A failed run must not leave a half-written archive in the listing."""
        from backend.config import SessionLocal

        def boom(_dest):
            raise OSError("disk full")

        monkeypatch.setattr(backup_service._archive, "snapshot_database", boom)

        db = SessionLocal()
        try:
            with pytest.raises(OSError):
                backup_service.create_backup(db)
        finally:
            db.close()

        assert os.listdir(backup_dir) == []

    def test_rejects_a_concurrent_run(self, backup_dir, monkeypatch):
        from backend.config import SessionLocal

        # Hold the module lock as an in-flight backup would.
        backup_service._archive._lock.acquire()
        db = SessionLocal()
        try:
            with pytest.raises(RuntimeError, match="already running"):
                backup_service.create_backup(db)
        finally:
            backup_service._archive._lock.release()
            db.close()


# ---------------------------------------------------------------------------
# Listing and lookup
# ---------------------------------------------------------------------------


class TestListBackups:
    def test_lists_newest_first(self, backup_dir):
        _write_backup(backup_dir, "20260101T000000Z")
        _write_backup(backup_dir, "20260301T000000Z")
        _write_backup(backup_dir, "20260201T000000Z")

        records = backup_service.list_backups(_config(backup_dir))

        assert [r.id for r in records] == [
            "20260301T000000Z",
            "20260201T000000Z",
            "20260101T000000Z",
        ]

    def test_ignores_unrelated_files(self, backup_dir):
        _write_backup(backup_dir, "20260101T000000Z")
        (backup_dir / "notes.txt").write_text("hello")
        (backup_dir / "random.zip").write_bytes(b"PK")

        records = backup_service.list_backups(_config(backup_dir))
        assert len(records) == 1

    def test_missing_directory_lists_empty(self, tmp_path):
        assert backup_service.list_backups(_config(tmp_path / "nope")) == []

    def test_created_at_parsed_from_filename(self, backup_dir):
        _write_backup(backup_dir, "20260821T140355Z")
        record = backup_service.list_backups(_config(backup_dir))[0]

        assert record.created_at == datetime(2026, 8, 21, 14, 3, 55, tzinfo=timezone.utc)
        assert record.version == "1.5.6"

    def test_version_unknown_when_manifest_missing(self, backup_dir):
        path = os.path.join(str(backup_dir), "grimoire-backup-20260101T000000Z.zip")
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("grimoire.db", b"x")

        assert record_for(path).version == "unknown"

    def test_corrupt_archive_still_lists(self, backup_dir):
        """A truncated archive is reported, not hidden — the operator needs to
        see it exists so they know not to rely on it."""
        path = os.path.join(str(backup_dir), "grimoire-backup-20260101T000000Z.zip")
        with open(path, "wb") as fh:
            fh.write(b"not a zip at all")

        record = record_for(path)
        assert record is not None
        assert record.version == "unknown"


class TestFindBackup:
    def test_finds_by_id(self, backup_dir):
        _write_backup(backup_dir, "20260101T000000Z")
        assert backup_service.find_backup(_config(backup_dir), "20260101T000000Z") is not None

    def test_missing_id_returns_none(self, backup_dir):
        assert backup_service.find_backup(_config(backup_dir), "20990101T000000Z") is None

    @pytest.mark.parametrize(
        "evil",
        [
            "../../../etc/passwd",
            "..%2F..%2Fsecret",
            "20260101T000000Z/../../escape",
            "",
            "not-a-timestamp",
        ],
    )
    def test_rejects_path_traversal(self, backup_dir, evil):
        """The id is pattern-matched before it reaches the filesystem."""
        assert backup_service.find_backup(_config(backup_dir), evil) is None


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------


class TestPruneBackups:
    def test_no_limits_prunes_nothing(self, backup_dir):
        for stamp in ("20260101T000000Z", "20260102T000000Z", "20260103T000000Z"):
            _write_backup(backup_dir, stamp)

        assert prune_backups(_config(backup_dir)) == []
        assert len(backup_service.list_backups(_config(backup_dir))) == 3

    def test_count_limit_removes_oldest_first(self, backup_dir):
        for stamp in (
            "20260101T000000Z",
            "20260102T000000Z",
            "20260103T000000Z",
            "20260104T000000Z",
        ):
            _write_backup(backup_dir, stamp)

        removed = prune_backups(_config(backup_dir, count=2))

        assert {r.id for r in removed} == {"20260101T000000Z", "20260102T000000Z"}
        assert [r.id for r in backup_service.list_backups(_config(backup_dir))] == [
            "20260104T000000Z",
            "20260103T000000Z",
        ]

    def test_size_limit_removes_oldest_first(self, backup_dir):
        # Three ~0.4GB backups against a 1GB budget: the oldest has to go.
        big = 400 * 1024 * 1024
        for stamp in ("20260101T000000Z", "20260102T000000Z", "20260103T000000Z"):
            path = os.path.join(str(backup_dir), f"grimoire-backup-{stamp}.zip")
            with zipfile.ZipFile(path, "w") as zf:
                zf.writestr("details.json", json.dumps({"version": "1.5.6"}))
            # Pad on disk rather than compressing 400MB of entropy in memory.
            with open(path, "ab") as fh:
                fh.truncate(big)

        removed = prune_backups(_config(backup_dir, gb=1))

        assert [r.id for r in removed] == ["20260101T000000Z"]

    def test_always_keeps_at_least_one_backup(self, backup_dir):
        """A single archive over the size budget is kept, not deleted to nothing."""
        path = os.path.join(str(backup_dir), "grimoire-backup-20260101T000000Z.zip")
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("details.json", json.dumps({"version": "1.5.6"}))
        with open(path, "ab") as fh:
            fh.truncate(3 * 1024**3)  # 3GB against a 1GB budget

        assert prune_backups(_config(backup_dir, gb=1)) == []
        assert len(backup_service.list_backups(_config(backup_dir))) == 1

    def test_count_limit_of_one_keeps_newest(self, backup_dir):
        _write_backup(backup_dir, "20260101T000000Z")
        _write_backup(backup_dir, "20260102T000000Z")

        prune_backups(_config(backup_dir, count=1))
        remaining = backup_service.list_backups(_config(backup_dir))

        assert [r.id for r in remaining] == ["20260102T000000Z"]

    def test_create_backup_applies_retention(self, backup_dir, monkeypatch):
        from backend.config import SessionLocal

        for stamp in ("20200101T000000Z", "20200102T000000Z"):
            _write_backup(backup_dir, stamp)

        base = backup_service.backup_settings

        def limited(db):
            config = base(db)
            config.retention_count = 1
            return config

        monkeypatch.setattr(backup_service._archive, "backup_settings", limited)

        db = SessionLocal()
        try:
            record = backup_service.create_backup(db)
        finally:
            db.close()

        remaining = backup_service.list_backups(_config(backup_dir, count=1))
        assert [r.id for r in remaining] == [record.id]


class TestDeleteBackup:
    def test_deletes(self, backup_dir):
        _write_backup(backup_dir, "20260101T000000Z")

        assert backup_service.delete_backup(_config(backup_dir), "20260101T000000Z") is True
        assert backup_service.list_backups(_config(backup_dir)) == []

    def test_missing_returns_false(self, backup_dir):
        assert backup_service.delete_backup(_config(backup_dir), "20990101T000000Z") is False


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


class TestBackupAPI:
    def test_list_requires_admin(self, client, player_headers):
        assert client.get("/api/backups", headers=player_headers).status_code == 403

    def test_list_requires_auth(self, client):
        assert client.get("/api/backups").status_code == 401

    def test_create_requires_admin(self, client, player_headers):
        assert client.post("/api/backups", headers=player_headers).status_code == 403

    def test_delete_requires_admin(self, client, player_headers):
        resp = client.delete("/api/backups/20260101T000000Z", headers=player_headers)
        assert resp.status_code == 403

    def test_create_then_list_and_download(self, client, admin_headers, backup_dir):
        created = client.post("/api/backups", headers=admin_headers)
        assert created.status_code == 200, created.text
        item = created.json()
        assert item["size_bytes"] > 0
        assert item["version"]

        listed = client.get("/api/backups", headers=admin_headers)
        assert listed.status_code == 200
        body = listed.json()
        assert [b["id"] for b in body["backups"]] == [item["id"]]
        assert body["total_bytes"] == item["size_bytes"]
        assert body["directory"] == str(backup_dir)

        # created_at is what makes the "how stale is the newest backup?" check work.
        created_at = datetime.fromisoformat(body["backups"][0]["created_at"])
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        assert datetime.now(timezone.utc) - created_at < timedelta(minutes=5)

        dl = client.get(f"/api/backups/{item['id']}/download", headers=admin_headers)
        assert dl.status_code == 200
        assert dl.headers["content-type"] == "application/zip"
        assert item["filename"] in dl.headers["content-disposition"]

    def test_download_missing_returns_404(self, client, admin_headers, backup_dir):
        resp = client.get("/api/backups/20990101T000000Z/download", headers=admin_headers)
        assert resp.status_code == 404

    def test_download_rejects_traversal(self, client, admin_headers, backup_dir):
        resp = client.get("/api/backups/not-an-id/download", headers=admin_headers)
        assert resp.status_code == 404

    def test_delete_endpoint(self, client, admin_headers, backup_dir):
        _write_backup(backup_dir, "20260101T000000Z")

        resp = client.delete("/api/backups/20260101T000000Z", headers=admin_headers)
        assert resp.status_code == 204
        assert client.get("/api/backups", headers=admin_headers).json()["backups"] == []

    def test_delete_missing_returns_404(self, client, admin_headers, backup_dir):
        resp = client.delete("/api/backups/20990101T000000Z", headers=admin_headers)
        assert resp.status_code == 404

    def test_empty_list(self, client, admin_headers, backup_dir):
        body = client.get("/api/backups", headers=admin_headers).json()
        assert body["backups"] == []
        assert body["total_bytes"] == 0


class TestBackupSettingsAPI:
    def test_requires_admin(self, client, player_headers):
        assert client.get("/api/backups/settings", headers=player_headers).status_code == 403

    def test_defaults(self, client, admin_headers, backup_dir):
        body = client.get("/api/backups/settings", headers=admin_headers).json()
        assert body["backup_schedule"] == "off"
        assert body["backup_retention_count"] == 0
        assert body["backup_retention_gb"] == 0
        assert body["schedule_env_locked"] is False

    def test_update_schedule_and_retention(self, client, admin_headers, backup_dir):
        resp = client.put(
            "/api/backups/settings",
            headers=admin_headers,
            json={
                "backup_schedule": "weekly",
                "backup_schedule_hour": 4,
                "backup_schedule_minute": 30,
                "backup_schedule_weekday": 2,
                "backup_retention_count": 5,
                "backup_retention_gb": 10,
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["backup_schedule"] == "weekly"
        assert body["backup_schedule_hour"] == 4
        assert body["backup_schedule_weekday"] == 2
        assert body["backup_retention_count"] == 5
        assert body["backup_retention_gb"] == 10

        # Reset so the scheduler thread doesn't linger for later tests.
        client.put(
            "/api/backups/settings", headers=admin_headers, json={"backup_schedule": "off"}
        )

    def test_rejects_unknown_schedule(self, client, admin_headers, backup_dir):
        resp = client.put(
            "/api/backups/settings", headers=admin_headers, json={"backup_schedule": "yearly"}
        )
        assert resp.status_code == 400

    def test_clamps_out_of_range_values(self, client, admin_headers, backup_dir):
        body = client.put(
            "/api/backups/settings",
            headers=admin_headers,
            json={
                "backup_schedule_hour": 99,
                "backup_schedule_minute": -5,
                "backup_schedule_weekday": 12,
                "backup_retention_count": -3,
            },
        ).json()
        assert body["backup_schedule_hour"] == 23
        assert body["backup_schedule_minute"] == 0
        assert body["backup_schedule_weekday"] == 6
        assert body["backup_retention_count"] == 0

    def test_rejects_unwritable_directory(self, client, admin_headers, backup_dir):
        resp = client.put(
            "/api/backups/settings",
            headers=admin_headers,
            json={"backup_dir": "/nonexistent-parent-xyz/backups"},
        )
        assert resp.status_code == 400
        assert "Parent directory" in resp.json()["detail"]

    def test_rejects_file_as_directory(self, client, admin_headers, backup_dir, tmp_path):
        target = tmp_path / "afile"
        target.write_text("x")

        resp = client.put(
            "/api/backups/settings", headers=admin_headers, json={"backup_dir": str(target)}
        )
        assert resp.status_code == 400
        assert "not a directory" in resp.json()["detail"]

    def test_accepts_valid_directory(self, client, admin_headers, backup_dir, tmp_path):
        target = tmp_path / "elsewhere"
        target.mkdir()

        resp = client.put(
            "/api/backups/settings", headers=admin_headers, json={"backup_dir": str(target)}
        )
        assert resp.status_code == 200
        assert resp.json()["backup_dir"] == str(target)

        # Reset so it doesn't leak into other tests.
        client.put("/api/backups/settings", headers=admin_headers, json={"backup_dir": ""})


class TestEnvLocks:
    def test_env_pins_schedule_and_blocks_writes(
        self, client, admin_headers, backup_dir, monkeypatch
    ):
        monkeypatch.setattr(backup_service._config, "BACKUP_SCHEDULE_ENV", "daily")

        body = client.get("/api/backups/settings", headers=admin_headers).json()
        assert body["backup_schedule"] == "daily"
        assert body["schedule_env_locked"] is True

        resp = client.put(
            "/api/backups/settings", headers=admin_headers, json={"backup_schedule": "off"}
        )
        assert resp.status_code == 400
        assert "BACKUP_SCHEDULE" in resp.json()["detail"]

    def test_env_pins_retention(self, client, admin_headers, backup_dir, monkeypatch):
        monkeypatch.setattr(backup_service._config, "BACKUP_RETENTION_COUNT_ENV", 7)

        body = client.get("/api/backups/settings", headers=admin_headers).json()
        assert body["backup_retention_count"] == 7
        assert body["retention_count_env_locked"] is True

        resp = client.put(
            "/api/backups/settings", headers=admin_headers, json={"backup_retention_count": 3}
        )
        assert resp.status_code == 400

    def test_env_pins_directory(self, client, admin_headers, tmp_path, monkeypatch):
        pinned = tmp_path / "pinned"
        pinned.mkdir()
        monkeypatch.setattr(backup_service._config, "BACKUP_DIR_ENV", str(pinned))

        body = client.get("/api/backups/settings", headers=admin_headers).json()
        assert body["backup_dir"] == str(pinned)
        assert body["dir_env_locked"] is True

        resp = client.put(
            "/api/backups/settings", headers=admin_headers, json={"backup_dir": str(tmp_path)}
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------


class TestBackupScheduler:
    """Exercises the scheduler thread directly, without waiting on real clocks."""

    def teardown_method(self):
        from backend import backup_scheduler

        backup_scheduler.stop()

    def test_apply_starts_thread_when_scheduled(self, monkeypatch):
        from backend import backup_scheduler
        from backend.config import SessionLocal

        started = {}

        def fake_start(schedule, hour, minute, weekday):
            started.update(
                schedule=schedule, hour=hour, minute=minute, weekday=weekday
            )

        monkeypatch.setattr(backup_scheduler, "start", fake_start)

        base = backup_service.backup_settings

        def scheduled(db):
            config = base(db)
            config.schedule = "weekly"
            config.hour = 4
            config.weekday = 3
            return config

        monkeypatch.setattr(backup_scheduler.backup_service_module, "backup_settings", scheduled)

        db = SessionLocal()
        try:
            backup_scheduler.apply(db)
        finally:
            db.close()

        assert started == {"schedule": "weekly", "hour": 4, "minute": 0, "weekday": 3}

    def test_apply_stops_thread_when_off(self, monkeypatch):
        from backend import backup_scheduler
        from backend.config import SessionLocal

        stopped = []
        monkeypatch.setattr(backup_scheduler, "stop", lambda: stopped.append(True))

        db = SessionLocal()
        try:
            backup_scheduler.apply(db)  # default schedule is "off"
        finally:
            db.close()

        assert stopped == [True]

    def test_start_and_stop_lifecycle(self):
        from backend import backup_scheduler

        backup_scheduler.start("daily", 3, 0, 0)
        assert backup_scheduler._thread is not None
        assert backup_scheduler._thread.is_alive()

        backup_scheduler.stop()
        assert backup_scheduler._thread is None

    @pytest.mark.parametrize(
        "schedule,weekday", [("hourly", 0), ("daily", 0), ("weekly", 3)]
    )
    def test_start_logs_each_schedule_shape(self, schedule, weekday):
        from backend import backup_scheduler

        backup_scheduler.start(schedule, 3, 30, weekday)
        assert backup_scheduler._thread.is_alive()
        backup_scheduler.stop()

    def test_loop_runs_a_backup_when_the_timer_fires(self, monkeypatch, backup_dir):
        """The thread body takes a backup, then exits on the next stop signal."""
        from backend import backup_scheduler

        calls = []
        monkeypatch.setattr(
            backup_scheduler.backup_service_module,
            "create_backup",
            lambda db, trigger: calls.append(trigger)
            or backup_service.BackupRecord(
                id="20260101T000000Z",
                filename="grimoire-backup-20260101T000000Z.zip",
                path="/tmp/x.zip",
                size_bytes=1,
                created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                version="1.6.0",
            ),
        )

        # First wait returns False (timer fired), second returns True (stop).
        waits = iter([False, True])
        monkeypatch.setattr(
            backup_scheduler._stop_event, "wait", lambda _secs: next(waits)
        )

        backup_scheduler._run("hourly", 3, 0, None)

        assert calls == ["scheduled"]

    def test_loop_survives_a_failed_backup(self, monkeypatch, backup_dir):
        """A failing run must not kill the thread — the next one still gets a turn."""
        from backend import backup_scheduler

        attempts = []

        def boom(db, trigger):
            attempts.append(trigger)
            raise OSError("disk full")

        monkeypatch.setattr(
            backup_scheduler.backup_service_module, "create_backup", boom
        )

        waits = iter([False, False, True])
        monkeypatch.setattr(
            backup_scheduler._stop_event, "wait", lambda _secs: next(waits)
        )

        backup_scheduler._run("hourly", 3, 0, None)

        assert attempts == ["scheduled", "scheduled"]
