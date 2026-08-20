"""Seed users from {DATA_PATH}/users.json on first startup."""

import json
import uuid
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from .models import User
from .auth import hash_password

log = logging.getLogger("grimoire.seed")

VALID_ROLES = {"admin", "gm", "player"}


def _is_hashed(password: str) -> bool:
    """Return True if password is already a passlib bcrypt_sha256 hash."""
    return password.startswith("$bcrypt-sha256$")


def seed_users(db: Session, data_path: str) -> None:
    """Seed users from users.json, then rename it so the seed never runs again."""
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

        if db.query(User).filter_by(username=username).first():
            log.info(f"User '{username}' already exists - skipping")
            skipped += 1
            continue

        hashed = password if _is_hashed(password) else hash_password(password)

        db.add(
            User(
                id=str(uuid.uuid4()),
                username=username,
                hashed_password=hashed,
                role=role,
                allow_explicit=not deny_explicit,
            )
        )
        log.info(f"Seeded user '{username}' (role={role})")
        created += 1

    db.commit()
    log.info(f"Seed complete - {created} created, {skipped} skipped")

    dest = src.parent / "users.json.imported"
    src.rename(dest)
    log.info("Renamed users.json → users.json.imported")
