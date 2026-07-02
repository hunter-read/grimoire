"""Tests for backend/seed_users.py."""
import json
import tempfile
from pathlib import Path


from backend.config import SessionLocal
from backend.models import User
from backend.auth import verify_password, hash_password
from backend.seed_users import seed_users, _is_hashed


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_users_json(tmp: str, data) -> Path:
    p = Path(tmp) / "users.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


def _get_user(username: str):
    db = SessionLocal()
    try:
        return db.query(User).filter_by(username=username).first()
    finally:
        db.close()


def _run(data, tmp=None):
    """Write data to users.json in a fresh temp dir, run seed_users, return tmp path."""
    if tmp is None:
        tmp = tempfile.mkdtemp()
    _write_users_json(tmp, data)
    db = SessionLocal()
    try:
        seed_users(db, tmp)
    finally:
        db.close()
    return tmp


def _unique(prefix: str) -> str:
    """Return a short unique username to avoid clashes across tests."""
    import uuid

    return f"{prefix}_{uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------------------
# _is_hashed — unit tests
# ---------------------------------------------------------------------------


def test_is_hashed_detects_bcrypt_sha256():
    assert _is_hashed(hash_password("any"))


def test_is_hashed_rejects_plain_text():
    assert not _is_hashed("plaintextpassword")


def test_is_hashed_rejects_raw_bcrypt():
    # A standard bcrypt hash (not passlib's bcrypt_sha256 wrapper) is not accepted
    assert not _is_hashed("$2b$12$somesaltandhashvalue")


# ---------------------------------------------------------------------------
# File handling
# ---------------------------------------------------------------------------


def test_no_file_is_noop():
    tmp = tempfile.mkdtemp()
    db = SessionLocal()
    try:
        seed_users(db, tmp)  # no users.json — must be silent
    finally:
        db.close()
    assert not (Path(tmp) / "users.json").exists()
    assert not (Path(tmp) / "users.json.imported").exists()


def test_file_renamed_to_imported_after_successful_seed():
    uname = _unique("seed_rename")
    tmp = _run([{"username": uname, "password": "pass1234", "role": "admin"}])
    assert not (Path(tmp) / "users.json").exists()
    assert (Path(tmp) / "users.json.imported").exists()


def test_invalid_json_leaves_file_untouched():
    tmp = tempfile.mkdtemp()
    p = Path(tmp) / "users.json"
    p.write_text("not valid json", encoding="utf-8")
    db = SessionLocal()
    try:
        seed_users(db, tmp)
    finally:
        db.close()
    assert p.exists(), "File should remain so the operator can fix it"


def test_empty_array_leaves_file_untouched():
    tmp = tempfile.mkdtemp()
    _write_users_json(tmp, [])
    db = SessionLocal()
    try:
        seed_users(db, tmp)
    finally:
        db.close()
    assert (Path(tmp) / "users.json").exists()


# ---------------------------------------------------------------------------
# Admin requirement
# ---------------------------------------------------------------------------


def test_no_admin_in_file_skips_all_creation():
    uname = _unique("seed_noadmin")
    tmp = _run([{"username": uname, "password": "pass1234", "role": "player"}])
    # File not renamed (error path)
    assert (Path(tmp) / "users.json").exists()
    assert _get_user(uname) is None


def test_no_admin_in_file_with_only_gm_also_rejected():
    uname = _unique("seed_gmonly")
    _run([{"username": uname, "password": "pass1234", "role": "gm"}])
    assert _get_user(uname) is None


# ---------------------------------------------------------------------------
# Role handling
# ---------------------------------------------------------------------------


def test_admin_role_is_stored():
    uname = _unique("seed_admin")
    _run([{"username": uname, "password": "pass1234", "role": "admin"}])
    assert _get_user(uname).role == "admin"


def test_gm_role_is_stored():
    admin = _unique("seed_gm_admin")
    gm = _unique("seed_gm")
    _run(
        [
            {"username": admin, "password": "pass1234", "role": "admin"},
            {"username": gm, "password": "pass1234", "role": "gm"},
        ]
    )
    assert _get_user(gm).role == "gm"


def test_player_role_is_stored():
    admin = _unique("seed_pl_admin")
    player = _unique("seed_pl")
    _run(
        [
            {"username": admin, "password": "pass1234", "role": "admin"},
            {"username": player, "password": "pass1234", "role": "player"},
        ]
    )
    assert _get_user(player).role == "player"


def test_invalid_role_defaults_to_player():
    admin = _unique("seed_badrole_admin")
    uname = _unique("seed_badrole")
    _run(
        [
            {"username": admin, "password": "pass1234", "role": "admin"},
            {"username": uname, "password": "pass1234", "role": "wizard"},
        ]
    )
    assert _get_user(uname).role == "player"


def test_missing_role_defaults_to_player():
    admin = _unique("seed_norole_admin")
    uname = _unique("seed_norole")
    _run(
        [
            {"username": admin, "password": "pass1234", "role": "admin"},
            {"username": uname, "password": "pass1234"},
        ]
    )
    assert _get_user(uname).role == "player"


# ---------------------------------------------------------------------------
# Password handling
# ---------------------------------------------------------------------------


def test_plaintext_password_is_hashed_and_verifiable():
    uname = _unique("seed_plain")
    _run([{"username": uname, "password": "myplainpass", "role": "admin"}])
    user = _get_user(uname)
    assert _is_hashed(user.hashed_password)
    assert verify_password("myplainpass", user.hashed_password)


def test_prehashed_password_stored_as_is_and_verifiable():
    uname = _unique("seed_prehash")
    hashed = hash_password("prehashed_pw")
    _run([{"username": uname, "password": hashed, "role": "admin"}])
    user = _get_user(uname)
    assert user.hashed_password == hashed
    assert verify_password("prehashed_pw", user.hashed_password)


def test_prehashed_password_is_not_double_hashed():
    """If a hash is passed in, verify_password on the original plaintext still works."""
    uname = _unique("seed_nodouble")
    hashed = hash_password("original")
    _run([{"username": uname, "password": hashed, "role": "admin"}])
    user = _get_user(uname)
    # If double-hashed, verify would fail
    assert verify_password("original", user.hashed_password)


# ---------------------------------------------------------------------------
# denyExplicit
# ---------------------------------------------------------------------------


def test_deny_explicit_true_sets_allow_explicit_false():
    uname = _unique("seed_deny")
    _run([{"username": uname, "password": "pass1234", "role": "admin", "denyExplicit": True}])
    assert _get_user(uname).allow_explicit is False


def test_deny_explicit_false_sets_allow_explicit_true():
    uname = _unique("seed_allow")
    _run([{"username": uname, "password": "pass1234", "role": "admin", "denyExplicit": False}])
    assert _get_user(uname).allow_explicit is True


def test_deny_explicit_omitted_defaults_to_allow():
    uname = _unique("seed_defexpl")
    _run([{"username": uname, "password": "pass1234", "role": "admin"}])
    assert _get_user(uname).allow_explicit is True


# ---------------------------------------------------------------------------
# Skipping invalid / duplicate entries
# ---------------------------------------------------------------------------


def test_missing_username_entry_skipped_others_created():
    valid = _unique("seed_validentry")
    _run(
        [
            {"password": "pass1234", "role": "admin"},  # no username
            {"username": valid, "password": "pass1234", "role": "admin"},
        ]
    )
    assert _get_user(valid) is not None


def test_missing_password_entry_skipped_others_created():
    admin = _unique("seed_nopw_admin")
    uname = _unique("seed_nopw")
    _run(
        [
            {"username": admin, "password": "adminpass1", "role": "admin"},
            {"username": uname, "role": "player"},  # no password
        ]
    )
    assert _get_user(admin) is not None
    assert _get_user(uname) is None


def test_existing_user_skipped_without_overwriting():
    uname = _unique("seed_exists")
    # First seed
    _run([{"username": uname, "password": "firstpass", "role": "admin"}])
    first_hash = _get_user(uname).hashed_password

    # Second seed with a different password
    _run([{"username": uname, "password": "differentpass", "role": "admin"}])
    assert _get_user(uname).hashed_password == first_hash


def test_multiple_users_all_created():
    admin = _unique("seed_multi_admin")
    gm = _unique("seed_multi_gm")
    player = _unique("seed_multi_player")
    _run(
        [
            {"username": admin, "password": "p1", "role": "admin"},
            {"username": gm, "password": "p2", "role": "gm"},
            {"username": player, "password": "p3", "role": "player"},
        ]
    )
    assert _get_user(admin).role == "admin"
    assert _get_user(gm).role == "gm"
    assert _get_user(player).role == "player"
