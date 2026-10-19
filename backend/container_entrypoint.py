"""Container entrypoint: start Grimoire as an unprivileged user (issue #579).

The image used to run everything as root. This runs first, as root, and hands
the command (uvicorn by default) to an unprivileged user once the volumes are
ready for it. Every existing install has to keep working with no change on the
user's side, so it only drops privileges when it can show that nothing the old
root process could do stops working:

* ``--user`` / Kubernetes ``runAsUser``: already unprivileged, so it just runs
  the command.
* ``PUID``/``PGID`` (the Unraid and LinuxServer convention): run as exactly
  that. ``PUID=0`` keeps the old root behaviour.
* Rootless Podman or Docker (container root already maps to an unprivileged
  host user): stays root. Dropping again would leave the bind mounts owned by a
  sub-uid the host user can't easily edit, and would lose write access to a
  library owned by that host user.
* Otherwise it runs as whoever owns the mounted library (so in-app file
  management keeps writing as the library's owner), falling back to the owner
  of the data volume, then to the image's ``grimoire`` user (1000:1000).

``DATA_PATH`` (and a ``BACKUP_DIR`` given in the environment) are chowned to
that user first: an upgraded install has root-owned files there. That is a walk
of ``lstat`` calls that only changes what doesn't already match, so after the
first start it costs little, and it also repairs files a ``docker exec`` as root
left behind. The library is never chowned: those are the user's own files. A
backup directory chosen in the app (stored in the database) is not chowned
either - only checked, with a hint in the log if the user can't write to it -
so start-up ownership changes follow only the container's own configuration.

When the user was picked automatically and still can't read the library,
write to a library root could write to, or write to the data volume (a network
share that refuses ``chown``, say), it stays root and logs why and how to fix
it, rather than failing to start. An explicit ``PUID`` is honoured regardless.
Library entries that user owns itself, symlinks, and ``lost+found`` are not part
of that check: the first it can fix itself, and the others say nothing about
access to the library's files.

Run as ``python -I backend/container_entrypoint.py``: standard library only,
and it must not import the ``backend`` package, whose config creates
directories under ``DATA_PATH`` at import time - as root, from here.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from collections.abc import Iterable, Mapping
from typing import NoReturn

DEFAULT_UID = 1000
DEFAULT_GID = 1000
HOME_DIR = "/home/grimoire"
# A uid_map line meaning "no user namespace": container uid 0 is host uid 0.
_INITIAL_UID_MAP = ["0", "0", "4294967295"]
# Bounds the probe list on a share that refuses every chown.
_MAX_FAILED_CHOWNS = 200
# How many entries at the top of the library are checked for readability.
_MAX_LIBRARY_ENTRIES = 200

Check = tuple[str, int]


def volume_paths(env: Mapping[str, str]) -> tuple[str, str]:
    """(LIBRARY_PATH, DATA_PATH), resolved exactly as ``backend.config`` will.

    The compose examples set both to ``/library`` and ``/data``, but the app's
    own defaults are relative to its working directory, and a ``docker run``
    without them has been writing to ``/app/data`` all along.
    """
    return (
        os.path.abspath(env.get("LIBRARY_PATH", "./library")),
        os.path.abspath(env.get("DATA_PATH", "./data")),
    )


def log(message: str) -> None:
    print(f"grimoire-entrypoint: {message}", file=sys.stderr, flush=True)


def parse_id(env: Mapping[str, str], name: str) -> int | None:
    """``PUID``/``PGID`` as an int, or None when unset or not a valid id."""
    raw = (env.get(name) or "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        value = -1
    if not 0 <= value < 2**32 - 1:
        log(f"{name}={raw!r} is not a valid id - ignoring it.")
        return None
    return value


def in_user_namespace(uid_map_path: str = "/proc/self/uid_map") -> bool:
    """True when container root is not host root (rootless Podman/Docker, userns-remap)."""
    try:
        with open(uid_map_path) as fh:
            lines = [line.split() for line in fh if line.strip()]
    except OSError:
        return False
    return _INITIAL_UID_MAP not in lines


def detect_identity(paths: Iterable[str]) -> tuple[int, int]:
    """The owner of the first mounted, non-root-owned path, else the image default.

    Only mount points count: an unmounted ``/library`` is the image's own empty
    directory, and its owner says nothing about the user's files.
    """
    for path in paths:
        try:
            st = os.stat(path)
        except OSError:
            continue
        if st.st_uid != 0 and os.path.ismount(path):
            return st.st_uid, st.st_gid or DEFAULT_GID
    return DEFAULT_UID, DEFAULT_GID


def configured_backup_dir(env: Mapping[str, str]) -> str | None:
    """``BACKUP_DIR`` from the environment, when set."""
    if env.get("BACKUP_DIR"):
        return os.path.abspath(env["BACKUP_DIR"])
    return None


def app_backup_dir(data_path: str) -> str | None:
    """A backup directory an admin chose in the app, which lives in the database.

    Read read-only, and only to check it is writable; any failure (no database
    yet, an older schema) just means there is no custom directory.
    """
    db_path = os.path.join(data_path, "grimoire.db")
    if not os.path.isfile(db_path):
        return None
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2)
        try:
            row = conn.execute(
                "SELECT value FROM app_settings WHERE key = 'backup_dir'"
            ).fetchone()
        finally:
            conn.close()
    except sqlite3.Error:
        return None
    if row and row[0] and str(row[0]).strip():
        return os.path.abspath(str(row[0]).strip())
    return None


def _is_within(path: str, parent: str) -> bool:
    path, parent = os.path.realpath(path), os.path.realpath(parent)
    return path == parent or path.startswith(parent.rstrip(os.sep) + os.sep)


def fix_ownership(root: str, uid: int, gid: int, skip: str | None = None) -> list[str]:
    """Chown everything under ``root`` that isn't already ``uid:gid``.

    Symlinks are changed themselves, never followed. Returns the paths whose
    chown failed (capped), so the caller can check those are still writable.
    """
    failed: list[str] = []

    def fix(path: str) -> None:
        try:
            st = os.lstat(path)
            if st.st_uid != uid or st.st_gid != gid:
                os.lchown(path, uid, gid)
        except OSError:
            if len(failed) < _MAX_FAILED_CHOWNS:
                failed.append(path)

    fix(root)
    if os.path.islink(root):
        # The link itself is changed; what it points at is left alone.
        return failed
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        if skip:
            dirnames[:] = [d for d in dirnames if not _is_within(os.path.join(dirpath, d), skip)]
        for name in dirnames + filenames:
            fix(os.path.join(dirpath, name))
    return failed


def _access_mode(path: str, write: bool) -> int:
    is_dir = os.path.isdir(path)
    mode = os.W_OK if write else os.R_OK
    return mode | os.X_OK if is_dir else mode


def probe(uid: int, gid: int, checks: list[Check]) -> list[Check]:
    """The ``checks`` (path, access mode) that would fail for ``uid:gid``.

    Asked of a forked child that has actually switched user, so the kernel
    answers: ACLs, read-only mounts and NFS root-squash are all accounted for,
    which reasoning about mode bits from here would miss.
    """
    if not checks:
        return []
    read_fd, write_fd = os.pipe()
    pid = os.fork()
    if pid == 0:  # pragma: no cover - the child's coverage isn't collected
        os.close(read_fd)
        try:
            if (os.getuid(), os.getgid()) != (uid, gid):
                os.setgroups([])
                os.setgid(gid)
                os.setuid(uid)
            # Indices, not paths: a file name may contain a newline.
            failing = [str(i) for i, (path, mode) in enumerate(checks) if not os.access(path, mode)]
            os.write(write_fd, " ".join(failing).encode())
            os._exit(0)
        except BaseException:
            os._exit(1)
    os.close(write_fd)
    with os.fdopen(read_fd, "rb") as fh:
        output = fh.read().decode()
    _, status = os.waitpid(pid, 0)
    if os.waitstatus_to_exitcode(status) != 0:
        return list(checks)
    return [checks[int(i)] for i in output.split()]


def describe(checks: list[Check]) -> str:
    shown = [f"{'write' if mode & os.W_OK else 'read'} {path}" for path, mode in checks[:5]]
    more = f" (and {len(checks) - 5} more)" if len(checks) > 5 else ""
    return ", ".join(shown) + more


def library_checks(library: str, uid: int | None = None) -> list[Check]:
    """Read access to the library and its top level, plus write when root had it.

    Write only matters when the library is writable at all: a ``:ro`` mount
    refuses root too, and then nothing Grimoire could do before is lost.

    Skipped at the top level: symlinks and ``lost+found`` (neither holds library
    files), and entries ``uid`` owns itself (it can change their permissions).
    """
    if not os.path.isdir(library):
        return []
    checks: list[Check] = [(library, _access_mode(library, write=False))]
    try:
        with os.scandir(library) as entries:
            for i, entry in enumerate(entries):
                if i >= _MAX_LIBRARY_ENTRIES:
                    break
                if entry.name == "lost+found" or entry.is_symlink():
                    continue
                try:
                    if uid is not None and entry.stat(follow_symlinks=False).st_uid == uid:
                        continue
                except OSError:
                    pass
                checks.append((entry.path, _access_mode(entry.path, write=False)))
    except OSError:
        pass
    if os.access(library, os.W_OK):
        checks.append((library, _access_mode(library, write=True)))
    return checks


def drop_privileges(uid: int, gid: int, env: dict[str, str]) -> None:
    os.setgroups([])
    os.setgid(gid)
    os.setuid(uid)
    # Docker sets HOME=/root, which the new user can't write.
    if env.get("HOME") in (None, "", "/root"):
        env["HOME"] = HOME_DIR


def _run(argv: list[str], env: dict[str, str]) -> NoReturn:
    os.execvpe(argv[0], argv, env)


def choose_user(env: Mapping[str, str], library: str, data: str) -> tuple[int, int, bool] | None:
    """(uid, gid, explicit) to run as, or None to stay root."""
    puid, pgid = parse_id(env, "PUID"), parse_id(env, "PGID")
    if puid is None and pgid is None:
        if in_user_namespace():
            log("Rootless container (root here is an unprivileged host user) - running as it. "
                "Set PUID/PGID to run as another user.")
            return None
        uid, gid = detect_identity([library, data])
        return uid, gid, False
    detected = detect_identity([library, data])
    uid = puid if puid is not None else detected[0]
    gid = pgid if pgid is not None else detected[1]
    if uid == 0:
        log("PUID=0 - running as root.")
        return None
    if gid == 0:
        # Not root, but group root: everything group-readable by root (most of
        # the image) is readable by Grimoire, and what it writes is root's group.
        log("PGID=0 - running with the root group. Set PGID to your own group "
            "unless you mean to.")
    return uid, gid, True


def prepare(
    env: Mapping[str, str], library: str, data: str, uid: int, gid: int, explicit: bool
) -> bool:
    """Ready the volumes for ``uid:gid``. False means stay root instead."""
    who = f"uid {uid}, gid {gid}"
    fix_hint = (
        f"Set PUID/PGID to the owner of those files, or give {who} access on the host. "
        "Set PUID=0 to keep running as root and silence this."
    )

    denied = probe(uid, gid, library_checks(library, uid))
    if denied:
        log(f"{who} can't {describe(denied)}.")
        if not explicit:
            log(f"Staying root so nothing stops working. {fix_hint}")
            return False

    os.makedirs(data, exist_ok=True)
    targets = [data]
    backups = configured_backup_dir(env)
    if (
        backups
        and os.path.isdir(backups)
        and not os.path.islink(backups)
        and not _is_within(backups, data)
    ):
        targets.append(backups)
    if os.path.isdir(HOME_DIR):
        targets.append(HOME_DIR)

    failed: list[str] = []
    for target in targets:
        # A library mounted inside the data volume is still the user's files.
        skip = library if _is_within(library, target) else None
        failed += fix_ownership(target, uid, gid, skip=skip)
    checks = [(t, _access_mode(t, write=True)) for t in targets if t != HOME_DIR]
    checks += [(p, _access_mode(p, write=True)) for p in failed if not os.path.islink(p)]
    denied = probe(uid, gid, checks)
    if denied:
        log(f"{who} can't {describe(denied)}.")
        if not explicit:
            log(f"Staying root so nothing stops working. {fix_hint}")
            return False

    chosen = None if backups else app_backup_dir(data)
    if chosen and os.path.isdir(chosen) and not _is_within(chosen, data):
        if probe(uid, gid, [(chosen, _access_mode(chosen, write=True))]):
            log(
                f"{who} can't write to the backup folder set in the app ({chosen}), so "
                f"backups there will fail. Give {who} write access on the host, or set "
                "BACKUP_DIR in the container's environment."
            )
    return True


def main(argv: list[str]) -> NoReturn:
    if not argv:
        log("No command given.")
        sys.exit(2)
    env = dict(os.environ)
    library, data = volume_paths(env)
    if os.getuid() != 0:
        # --user / runAsUser: nothing can change owners from here, so all that
        # helps is saying why the app is about to fail.
        if os.path.isdir(data) and not os.access(data, os.W_OK | os.X_OK):
            log(f"{data} is not writable by uid {os.getuid()}. On an install that used "
                f"to run as root, chown it on the host to {os.getuid()}:{os.getgid()}, "
                "or drop --user and let the image switch users itself.")
        _run(argv, env)

    choice = choose_user(env, library, data)
    if choice is not None:
        uid, gid, explicit = choice
        if prepare(env, library, data, uid, gid, explicit):
            drop_privileges(uid, gid, env)
            log(f"Running as uid {uid}, gid {gid}.")
    _run(argv, env)


if __name__ == "__main__":  # pragma: no cover
    main(sys.argv[1:])
