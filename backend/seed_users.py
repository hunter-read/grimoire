"""Seed users from {DATA_PATH}/users.json on first startup.

Plaintext passwords in the file are held to the same rules as any new password
(``backend/passwords.py``); an entry that fails them is skipped. Once the seed
has run, the file is rewritten as ``users.json.imported`` with every password
replaced by its hash, so no plaintext password is left on disk.
"""

import json
import os
import uuid
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from . import passwords
from .models import User
from .auth import hash_password
from .usernames import username_taken

log = logging.getLogger("grimoire.seed")

VALID_ROLES = {"admin", "gm", "player"}


def _is_hashed(password: str) -> bool:
    """Return True if password is already a passlib bcrypt_sha256 hash."""
    return password.startswith("$bcrypt-sha256$")


def seed_users(db: Session, data_path: str) -> None:
    """Seed users from users.json, then move it aside so the seed never runs again."""
    src = Path(data_path) / "users.json"
    if not src.exists():
        return

    log.info("Found users.json - starting user seed")

    try:
        raw = json.loads(src.read_text(encoding="utf-8"))
    except Exception as exc:
        log.error(f"users.json could not be parsed: {exc} - skipping seed")
        return

    if not isinstance(raw, list) or len(raw) == 0:
        log.error("users.json must be a non-empty JSON array - skipping seed")
        return

    entries = []
    for item in raw:
        role = item.get("role") if item.get("role") in VALID_ROLES else "player"
        entries.append({**item, "_role": role})

    if not any(e["_role"] == "admin" for e in entries):
        log.error(
            "users.json contains no admin entry - "
            "at least one user must have role 'admin'. Skipping seed."
        )
        return

    # Check passwords up front, so an admin whose password is refused stops the
    # whole seed - seeding only the others would leave an instance nobody can
    # administer and no setup screen to fix it from. The file stays in place to
    # be corrected.
    for entry in entries:
        entry["_problem"] = _password_problem(entry.get("password") or "")
    if not any(e["_role"] == "admin" and not e["_problem"] for e in entries):
        log.error(
            "No admin entry in users.json has an acceptable password - "
            f"passwords need at least {passwords.PASSWORD_MIN_LENGTH} characters and "
            "must not be a commonly used one. Skipping seed; fix the file and restart."
        )
        return

    created = skipped = 0
    for entry in entries:
        username = (entry.get("username") or "").strip()
        password = entry.get("password") or ""
        role = entry["_role"]
        deny_explicit = bool(entry.get("denyExplicit", False))

        if not username or not password:
            log.warning("Skipping entry with missing username or password")
            skipped += 1
            continue

        if entry["_problem"]:
            log.warning(f"Skipping user '{username}': {entry['_problem']}")
            skipped += 1
            continue

        if username_taken(db, username):
            log.info(f"User '{username}' already exists - skipping")
            skipped += 1
            continue

        hashed = password if _is_hashed(password) else hash_password(password)
        entry["_hashed"] = hashed

        db.add(
            User(
                id=str(uuid.uuid4()),
                username=username,
                hashed_password=hashed,
                role=role,
                allow_explicit=not deny_explicit,
                explicit_locked=deny_explicit,
            )
        )
        log.info(f"Seeded user '{username}' (role={role})")
        created += 1

    db.commit()
    log.info(f"Seed complete - {created} created, {skipped} skipped")

    dest = src.parent / "users.json.imported"
    _write_imported(dest, entries)
    src.unlink()
    log.info("Moved users.json to users.json.imported, with passwords replaced by hashes")


def _password_problem(password: str) -> str | None:
    """Why a seed entry's password is refused, or None. A hash is taken as is."""
    if not password or _is_hashed(password):
        return None
    return passwords.problem(password, minimum=passwords.PASSWORD_MIN_LENGTH)


def _write_imported(dest: Path, entries: list) -> None:
    """Record what was imported, with no plaintext password left in it.

    A seeded entry keeps the hash it was stored with. Any other plaintext
    password (a skipped or already-existing user) is dropped, since nothing
    needs it again.
    """
    out = []
    for entry in entries:
        item = {k: v for k, v in entry.items() if not k.startswith("_")}
        password = item.get("password") or ""
        if "_hashed" in entry:
            item["password"] = entry["_hashed"]
        elif password and not _is_hashed(password):
            item.pop("password", None)
        out.append(item)
    partial = dest.with_name(dest.name + ".tmp")
    partial.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    os.chmod(partial, 0o600)
    os.replace(partial, dest)
