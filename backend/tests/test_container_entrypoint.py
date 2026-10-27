"""Tests for the container entrypoint that drops root (issue #579).

The rule under test is that no existing install may stop working: every path
that can't prove the unprivileged user has the access root had ends with the
container staying root, unless the operator asked for a specific user.
"""
import os
import sqlite3

import pytest

from backend import container_entrypoint as ep


class _Exec(Exception):
    """Raised in place of exec so a test can see what would have run."""


@pytest.fixture
def run_calls(monkeypatch):
    calls = []

    def fake_run(argv, env):
        calls.append((argv, env))
        raise _Exec

    monkeypatch.setattr(ep, "_run", fake_run)
    return calls


# --- parse_id ---------------------------------------------------------------


@pytest.mark.parametrize(
    "raw, expected",
    [(None, None), ("", None), ("  ", None), ("99", 99), (" 1000 ", 1000), ("0", 0),
     ("abc", None), ("-1", None), (str(2**32), None)],
)
def test_parse_id(raw, expected):
    env = {} if raw is None else {"PUID": raw}
    assert ep.parse_id(env, "PUID") == expected


# --- volume_paths -----------------------------------------------------------


def test_volume_paths_match_the_app_defaults(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    assert ep.volume_paths({}) == (str(tmp_path / "library"), str(tmp_path / "data"))
    env = {"LIBRARY_PATH": "/library", "DATA_PATH": "/data"}
    assert ep.volume_paths(env) == ("/library", "/data")


# --- in_user_namespace ------------------------------------------------------


def test_no_uid_map_is_not_a_user_namespace(tmp_path):
    assert ep.in_user_namespace(str(tmp_path / "missing")) is False


def test_identity_uid_map_is_rootful(tmp_path):
    uid_map = tmp_path / "uid_map"
    uid_map.write_text("         0          0 4294967295\n")
    assert ep.in_user_namespace(str(uid_map)) is False


@pytest.mark.parametrize(
    "content",
    [
        "0 1000 1\n1 100000 65536\n",  # rootless Podman
        "0 100000 65536\n",  # Docker userns-remap
    ],
)
def test_remapped_uid_map_is_a_user_namespace(tmp_path, content):
    uid_map = tmp_path / "uid_map"
    uid_map.write_text(content)
    assert ep.in_user_namespace(str(uid_map)) is True


# --- detect_identity --------------------------------------------------------


class _Stat:
    def __init__(self, uid, gid):
        self.st_uid = uid
        self.st_gid = gid


def _fake_fs(monkeypatch, owners, mounts):
    def fake_stat(path):
        if path not in owners:
            raise FileNotFoundError(path)
        return _Stat(*owners[path])

    monkeypatch.setattr(ep.os, "stat", fake_stat)
    monkeypatch.setattr(ep.os.path, "ismount", lambda p: p in mounts)


def test_detect_identity_prefers_the_library_owner(monkeypatch):
    _fake_fs(monkeypatch, {"/library": (99, 100), "/data": (1001, 1001)}, {"/library", "/data"})
    assert ep.detect_identity(["/library", "/data"]) == (99, 100)


def test_detect_identity_skips_root_owned_and_unmounted(monkeypatch):
    # An unmounted /library is the image's own directory - its 1000 says nothing.
    _fake_fs(monkeypatch, {"/library": (1000, 1000), "/data": (1026, 100)}, {"/data"})
    assert ep.detect_identity(["/library", "/data"]) == (1026, 100)
    _fake_fs(monkeypatch, {"/library": (0, 0), "/data": (1026, 100)}, {"/library", "/data"})
    assert ep.detect_identity(["/library", "/data"]) == (1026, 100)


def test_detect_identity_root_group_falls_back_to_default_gid(monkeypatch):
    _fake_fs(monkeypatch, {"/library": (1001, 0)}, {"/library"})
    assert ep.detect_identity(["/library"]) == (1001, ep.DEFAULT_GID)


def test_detect_identity_defaults_when_everything_is_root(monkeypatch):
    _fake_fs(monkeypatch, {"/library": (0, 0)}, {"/library"})
    assert ep.detect_identity(["/library", "/missing"]) == (ep.DEFAULT_UID, ep.DEFAULT_GID)


# --- configured_backup_dir --------------------------------------------------


def _settings_db(data, value=None, table=True):
    conn = sqlite3.connect(data / "grimoire.db")
    if table:
        conn.execute("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT)")
        if value is not None:
            conn.execute("INSERT INTO app_settings VALUES ('backup_dir', ?)", (value,))
    conn.commit()
    conn.close()


def test_backup_dir_from_the_environment():
    assert ep.configured_backup_dir({"BACKUP_DIR": "/backups"}) == "/backups"
    assert ep.configured_backup_dir({}) is None


def test_backup_dir_from_app_settings(tmp_path):
    _settings_db(tmp_path, " /backups ")
    assert ep.app_backup_dir(str(tmp_path)) == "/backups"


@pytest.mark.parametrize("value, table", [(None, True), ("", True), (None, False)])
def test_backup_dir_default_or_unreadable(tmp_path, value, table):
    _settings_db(tmp_path, value, table=table)
    assert ep.app_backup_dir(str(tmp_path)) is None


def test_backup_dir_without_a_database(tmp_path):
    assert ep.app_backup_dir(str(tmp_path)) is None


# --- fix_ownership ----------------------------------------------------------


def _tree(root):
    (root / "thumbs").mkdir()
    (root / "thumbs" / "a.webp").write_bytes(b"x")
    (root / "grimoire.db").write_bytes(b"x")
    (root / "link").symlink_to(root / "grimoire.db")
    return root


def test_fix_ownership_leaves_matching_files_alone(tmp_path, monkeypatch):
    _tree(tmp_path)
    calls = []
    monkeypatch.setattr(ep.os, "lchown", lambda *a: calls.append(a))
    assert ep.fix_ownership(str(tmp_path), os.getuid(), os.getgid()) == []
    assert calls == []


def test_fix_ownership_changes_everything_else_without_following_links(tmp_path, monkeypatch):
    _tree(tmp_path)
    calls = []
    monkeypatch.setattr(ep.os, "lchown", lambda path, uid, gid: calls.append(path))
    assert ep.fix_ownership(str(tmp_path), 4242, 4242) == []
    names = {os.path.relpath(p, tmp_path) for p in calls}
    assert names == {".", "thumbs", "thumbs/a.webp", "grimoire.db", "link"}


def test_fix_ownership_skips_a_nested_library(tmp_path, monkeypatch):
    _tree(tmp_path)
    (tmp_path / "library").mkdir()
    (tmp_path / "library" / "book.pdf").write_bytes(b"x")
    calls = []
    monkeypatch.setattr(ep.os, "lchown", lambda path, uid, gid: calls.append(path))
    ep.fix_ownership(str(tmp_path), 4242, 4242, skip=str(tmp_path / "library"))
    assert not any("library" in p for p in calls)


def test_fix_ownership_reports_failures_capped(tmp_path, monkeypatch):
    _tree(tmp_path)

    def refuse(*_):
        raise PermissionError

    monkeypatch.setattr(ep.os, "lchown", refuse)
    monkeypatch.setattr(ep, "_MAX_FAILED_CHOWNS", 2)
    assert ep.fix_ownership(str(tmp_path), 4242, 4242) == [str(tmp_path), str(tmp_path / "thumbs")]


# --- probe ------------------------------------------------------------------


def test_probe_with_nothing_to_check():
    assert ep.probe(4242, 4242, []) == []


def test_probe_reports_only_failing_checks(tmp_path):
    missing = str(tmp_path / "missing")
    checks = [(str(tmp_path), os.W_OK | os.X_OK), (missing, os.R_OK)]
    assert ep.probe(os.getuid(), os.getgid(), checks) == [(missing, os.R_OK)]


@pytest.mark.skipif(os.getuid() == 0, reason="root can switch to any user")
def test_probe_treats_a_failed_switch_as_no_access(tmp_path):
    # Not root, so the child can't become uid 4242 - every check must fail.
    assert ep.probe(4242, 4242, [(str(tmp_path), os.R_OK)]) == [(str(tmp_path), os.R_OK)]


def test_probe_real_writes_catch_what_access_allows(tmp_path, monkeypatch):
    # Issue #690: os.access said yes, then mkdir was refused. The child inherits
    # the patch, standing in for a NAS share that refuses the actual write.
    monkeypatch.setattr(ep, "_really_writable", lambda path: False)
    write = [(str(tmp_path), os.W_OK | os.X_OK)]
    read = [(str(tmp_path), os.R_OK | os.X_OK)]
    assert ep.probe(os.getuid(), os.getgid(), write) == []
    assert ep.probe(os.getuid(), os.getgid(), write, real_writes=True) == write
    assert ep.probe(os.getuid(), os.getgid(), read, real_writes=True) == []


def test_really_writable_folder_leaves_nothing_behind(tmp_path):
    assert ep._really_writable(str(tmp_path)) is True
    assert list(tmp_path.iterdir()) == []


def test_really_writable_file_is_opened_not_changed(tmp_path):
    db = tmp_path / "grimoire.db"
    db.write_bytes(b"keep")
    assert ep._really_writable(str(db)) is True
    assert db.read_bytes() == b"keep"


def test_really_writable_refused_write(tmp_path, monkeypatch):
    def refuse(*a, **k):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(ep.os, "open", refuse)
    assert ep._really_writable(str(tmp_path)) is False


def test_really_writable_falls_back_to_access_for_other_paths(tmp_path):
    assert ep._really_writable(str(tmp_path / "missing")) is False


def test_allowed_only_tries_writes(tmp_path, monkeypatch):
    tried = []
    monkeypatch.setattr(ep, "_really_writable", lambda path: tried.append(path) or True)
    assert ep._allowed(str(tmp_path), os.R_OK, real_writes=True) is True
    assert ep._allowed(str(tmp_path), os.W_OK, real_writes=False) is True
    assert tried == []
    assert ep._allowed(str(tmp_path), os.W_OK | os.X_OK, real_writes=True) is True
    assert tried == [str(tmp_path)]


def test_describe_says_which_access_is_missing():
    checks = [("/library", os.W_OK | os.X_OK), ("/library/a", os.R_OK)]
    assert ep.describe(checks) == "write /library, read /library/a"
    many = [(f"/d/{i}", os.W_OK) for i in range(7)]
    assert ep.describe(many).endswith("write /d/4 (and 2 more)")


# --- library_checks ---------------------------------------------------------


def test_library_checks_missing_library(tmp_path):
    assert ep.library_checks(str(tmp_path / "missing")) == []


def test_library_checks_read_top_level_and_write_when_root_could(tmp_path, monkeypatch):
    (tmp_path / "D&D 5e").mkdir()
    (tmp_path / "loose.pdf").write_bytes(b"x")
    checks = ep.library_checks(str(tmp_path))
    assert (str(tmp_path), os.R_OK | os.X_OK) in checks
    assert (str(tmp_path / "D&D 5e"), os.R_OK | os.X_OK) in checks
    assert (str(tmp_path / "loose.pdf"), os.R_OK) in checks
    assert (str(tmp_path), os.W_OK | os.X_OK) in checks
    assert (str(tmp_path / "D&D 5e"), os.W_OK | os.X_OK) in checks


def test_library_checks_write_below_the_top_level(tmp_path):
    # Renaming a book needs write access to its own folder, not just the root.
    core = tmp_path / "D&D 5e" / "Core"
    core.mkdir(parents=True)
    (core / "phb.pdf").write_bytes(b"x")
    writes = [path for path, mode in ep.library_checks(str(tmp_path)) if mode & os.W_OK]
    assert writes == [str(tmp_path), str(tmp_path / "D&D 5e"), str(core)]
    own = os.stat(core).st_uid
    writes = [path for path, mode in ep.library_checks(str(tmp_path), own) if mode & os.W_OK]
    assert writes == [str(tmp_path)]


def test_library_dirs_is_breadth_first_and_bounded(tmp_path, monkeypatch):
    for system in ("A", "B"):
        (tmp_path / system / "Core" / "Deep").mkdir(parents=True)
    (tmp_path / "lost+found").mkdir()
    (tmp_path / "link").symlink_to(tmp_path / "A")
    (tmp_path / "A" / "loose.pdf").write_bytes(b"x")
    assert ep._library_dirs(str(tmp_path)) == [
        str(tmp_path / "A"), str(tmp_path / "B"),
        str(tmp_path / "A" / "Core"), str(tmp_path / "B" / "Core"),
        str(tmp_path / "A" / "Core" / "Deep"), str(tmp_path / "B" / "Core" / "Deep"),
    ]
    monkeypatch.setattr(ep, "_MAX_LIBRARY_DIRS", 3)
    assert ep._library_dirs(str(tmp_path)) == [
        str(tmp_path / "A"), str(tmp_path / "B"), str(tmp_path / "A" / "Core"),
    ]


def test_library_dirs_skips_unlistable_folders(tmp_path, monkeypatch):
    (tmp_path / "A").mkdir()
    real_scandir = os.scandir

    def scandir(path):
        if path != str(tmp_path):
            raise PermissionError
        return real_scandir(path)

    monkeypatch.setattr(ep.os, "scandir", scandir)
    assert ep._library_dirs(str(tmp_path)) == [str(tmp_path / "A")]


def test_library_checks_skip_folders_that_vanish(tmp_path, monkeypatch):
    monkeypatch.setattr(ep, "_library_dirs", lambda library: [str(tmp_path / "Missing")])
    writes = [path for path, mode in ep.library_checks(str(tmp_path)) if mode & os.W_OK]
    assert writes == [str(tmp_path)]


def test_library_checks_read_only_library_needs_no_write(tmp_path, monkeypatch):
    for i in range(3):
        (tmp_path / f"{i}.pdf").write_bytes(b"x")
    monkeypatch.setattr(ep, "_MAX_LIBRARY_ENTRIES", 1)
    real_access = os.access
    monkeypatch.setattr(
        ep.os, "access", lambda p, m: False if m == os.W_OK else real_access(p, m)
    )
    checks = ep.library_checks(str(tmp_path))
    assert len(checks) == 2
    assert all(mode & os.W_OK == 0 for _, mode in checks)


def test_library_checks_skip_links_lost_found_and_own_entries(tmp_path):
    (tmp_path / "lost+found").mkdir()
    (tmp_path / "dangling").symlink_to(tmp_path / "nowhere")
    (tmp_path / "Books").mkdir()
    checked = [path for path, _ in ep.library_checks(str(tmp_path))]
    assert str(tmp_path / "Books") in checked
    assert str(tmp_path / "lost+found") not in checked
    assert str(tmp_path / "dangling") not in checked
    own = os.stat(tmp_path / "Books").st_uid
    checked = [path for path, _ in ep.library_checks(str(tmp_path), own)]
    assert str(tmp_path / "Books") not in checked


def test_fix_ownership_does_not_walk_through_a_symlinked_root(tmp_path, monkeypatch):
    real = tmp_path / "real"
    real.mkdir()
    (real / "file").write_bytes(b"x")
    link = tmp_path / "link"
    link.symlink_to(real)
    changed = []
    monkeypatch.setattr(ep.os, "lchown", lambda path, uid, gid: changed.append(path))
    ep.fix_ownership(str(link), 4242, 4242)
    assert changed == [str(link)]


def test_library_checks_survives_an_unlistable_library(tmp_path, monkeypatch):
    def refuse(_):
        raise PermissionError

    monkeypatch.setattr(ep.os, "scandir", refuse)
    assert ep.library_checks(str(tmp_path))[0] == (str(tmp_path), os.R_OK | os.X_OK)


# --- drop_privileges --------------------------------------------------------


@pytest.mark.parametrize("home, expected", [("/root", ep.HOME_DIR), (None, ep.HOME_DIR),
                                            ("/custom", "/custom")])
def test_drop_privileges(monkeypatch, home, expected):
    calls = []
    monkeypatch.setattr(ep.os, "setgroups", lambda g: calls.append(("groups", g)))
    monkeypatch.setattr(ep.os, "setgid", lambda g: calls.append(("gid", g)))
    monkeypatch.setattr(ep.os, "setuid", lambda u: calls.append(("uid", u)))
    env = {} if home is None else {"HOME": home}
    ep.drop_privileges(99, 100, env)
    # Groups, then gid, then uid: once uid changes nothing else is allowed.
    assert calls == [("groups", []), ("gid", 100), ("uid", 99)]
    assert env["HOME"] == expected


# --- choose_user ------------------------------------------------------------


@pytest.fixture
def detected(monkeypatch):
    monkeypatch.setattr(ep, "detect_identity", lambda paths: (1026, 100))
    monkeypatch.setattr(ep, "in_user_namespace", lambda: False)


def test_choose_user_auto(detected):
    assert ep.choose_user({}, "/library", "/data") == (1026, 100, False)


def test_choose_user_stays_root_when_rootless(detected, monkeypatch):
    monkeypatch.setattr(ep, "in_user_namespace", lambda: True)
    assert ep.choose_user({}, "/library", "/data") is None


def test_choose_user_explicit_beats_rootless(detected, monkeypatch):
    monkeypatch.setattr(ep, "in_user_namespace", lambda: True)
    assert ep.choose_user({"PUID": "99", "PGID": "100"}, "/l", "/d") == (99, 100, True)


def test_choose_user_fills_in_the_missing_half(detected):
    assert ep.choose_user({"PGID": "5"}, "/l", "/d") == (1026, 5, True)
    assert ep.choose_user({"PUID": "7"}, "/l", "/d") == (7, 100, True)


def test_choose_user_puid_zero_keeps_root(detected):
    assert ep.choose_user({"PUID": "0"}, "/l", "/d") is None


def test_choose_user_pgid_zero_is_warned_about(detected, capsys):
    assert ep.choose_user({"PUID": "99", "PGID": "0"}, "/l", "/d") == (99, 0, True)
    assert "PGID=0" in capsys.readouterr().err


def test_choose_user_ordinary_group_is_not_warned_about(detected, capsys):
    ep.choose_user({"PUID": "99", "PGID": "100"}, "/l", "/d")
    assert "PGID=0" not in capsys.readouterr().err


# --- prepare ----------------------------------------------------------------


@pytest.fixture
def volumes(tmp_path, monkeypatch):
    library, data = tmp_path / "library", tmp_path / "data"
    library.mkdir()
    monkeypatch.setattr(ep, "HOME_DIR", str(tmp_path / "home"))
    chowned = []
    monkeypatch.setattr(
        ep, "fix_ownership", lambda root, uid, gid, skip=None: chowned.append((root, skip)) or []
    )
    return library, data, chowned


def _probe_failing(monkeypatch, failing):
    seen = []

    def fake_probe(uid, gid, checks, real_writes=False):
        seen.append(checks)
        return [c for c in checks if c[0] in failing]

    monkeypatch.setattr(ep, "probe", fake_probe)
    return seen


def test_prepare_chowns_data_and_backups(volumes, tmp_path, monkeypatch):
    library, data, chowned = volumes
    backups, home = tmp_path / "backups", tmp_path / "home"
    backups.mkdir()
    home.mkdir()
    _probe_failing(monkeypatch, set())
    env = {"BACKUP_DIR": str(backups)}
    assert ep.prepare(env, str(library), str(data), 1000, 1000, False) is True
    assert data.is_dir()
    assert [root for root, _ in chowned] == [str(data), str(backups), str(home)]


def test_prepare_only_checks_a_backup_folder_set_in_the_app(volumes, tmp_path, monkeypatch, capsys):
    library, data, chowned = volumes
    backups = tmp_path / "app-backups"
    backups.mkdir()
    data.mkdir()
    _settings_db(data, str(backups))
    _probe_failing(monkeypatch, {str(backups)})
    assert ep.prepare({}, str(library), str(data), 1000, 1000, False) is True
    assert str(backups) not in [root for root, _ in chowned]
    assert "backup folder set in the app" in capsys.readouterr().err


def test_prepare_leaves_a_symlinked_backup_dir_alone(volumes, tmp_path, monkeypatch):
    library, data, chowned = volumes
    real = tmp_path / "real-backups"
    real.mkdir()
    link = tmp_path / "linked-backups"
    link.symlink_to(real)
    _probe_failing(monkeypatch, set())
    assert ep.prepare({"BACKUP_DIR": str(link)}, str(library), str(data), 1000, 1000, False)
    assert [root for root, _ in chowned] == [str(data)]


def test_prepare_never_chowns_a_library_inside_data(volumes, tmp_path, monkeypatch):
    _, data, chowned = volumes
    library = data / "library"
    library.mkdir(parents=True)
    _probe_failing(monkeypatch, set())
    assert ep.prepare({}, str(library), str(data), 1000, 1000, False) is True
    assert chowned == [(str(data), str(library))]


def test_prepare_stays_root_when_the_library_is_out_of_reach(volumes, monkeypatch):
    library, data, chowned = volumes
    _probe_failing(monkeypatch, {str(library)})
    assert ep.prepare({}, str(library), str(data), 1000, 1000, False) is False
    assert chowned == []


def test_prepare_stays_root_when_data_stays_unwritable(volumes, monkeypatch):
    library, data, chowned = volumes
    db = str(data / "grimoire.db")
    monkeypatch.setattr(ep, "fix_ownership", lambda *a, **k: [db])
    seen = _probe_failing(monkeypatch, {db})
    assert ep.prepare({}, str(library), str(data), 1000, 1000, False) is False
    assert (db, os.W_OK) in seen[-1]


def test_prepare_tests_data_with_a_real_write(volumes, monkeypatch):
    library, data, _ = volumes
    calls = []
    monkeypatch.setattr(
        ep, "probe", lambda uid, gid, checks, real_writes=False: calls.append(real_writes) or []
    )
    assert ep.prepare({}, str(library), str(data), 1000, 1000, False) is True
    # The library is only ever asked about, never written to.
    assert calls == [False, True]


def test_prepare_honours_explicit_puid_regardless(volumes, monkeypatch):
    library, data, _ = volumes
    _probe_failing(monkeypatch, {str(library), str(data)})
    assert ep.prepare({}, str(library), str(data), 99, 100, True) is True


# --- main -------------------------------------------------------------------


def test_main_needs_a_command():
    with pytest.raises(SystemExit) as exc:
        ep.main([])
    assert exc.value.code == 2


def test_main_runs_directly_when_already_unprivileged(monkeypatch, run_calls):
    monkeypatch.setattr(ep.os, "getuid", lambda: 1000)
    monkeypatch.setattr(ep, "choose_user", lambda *a: pytest.fail("should not remap"))
    with pytest.raises(_Exec):
        ep.main(["id", "-u"])
    assert run_calls[0][0] == ["id", "-u"]


def test_main_explains_an_unwritable_data_path_under_user(monkeypatch, run_calls, tmp_path, capsys):
    monkeypatch.setattr(ep.os, "getuid", lambda: 1000)
    monkeypatch.setenv("DATA_PATH", str(tmp_path))
    monkeypatch.setattr(ep.os, "access", lambda p, m: False)
    with pytest.raises(_Exec):
        ep.main(["uvicorn"])
    assert "is not writable by uid 1000" in capsys.readouterr().err


@pytest.fixture
def as_root(monkeypatch):
    monkeypatch.setattr(ep.os, "getuid", lambda: 0)
    dropped = []
    monkeypatch.setattr(ep, "drop_privileges", lambda uid, gid, env: dropped.append((uid, gid)))
    return dropped


def test_main_drops_when_prepared(as_root, monkeypatch, run_calls):
    monkeypatch.setattr(ep, "choose_user", lambda *a: (1000, 1000, False))
    monkeypatch.setattr(ep, "prepare", lambda *a: True)
    with pytest.raises(_Exec):
        ep.main(["uvicorn"])
    assert as_root == [(1000, 1000)]
    assert run_calls[0][0] == ["uvicorn"]


@pytest.mark.parametrize("choice, prepared", [(None, True), ((1000, 1000, False), False)])
def test_main_stays_root(as_root, monkeypatch, run_calls, choice, prepared):
    monkeypatch.setattr(ep, "choose_user", lambda *a: choice)
    monkeypatch.setattr(ep, "prepare", lambda *a: prepared)
    with pytest.raises(_Exec):
        ep.main(["uvicorn"])
    assert as_root == []
    assert len(run_calls) == 1
