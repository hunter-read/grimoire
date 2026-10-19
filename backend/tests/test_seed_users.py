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
    tmp = _run([{"username": uname, "password": "seed-test-passphrase-1", "role": "admin"}])
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
    tmp = _run([{"username": uname, "password": "seed-test-passphrase-1", "role": "player"}])
    # File not renamed (error path)
    assert (Path(tmp) / "users.json").exists()
    assert _get_user(uname) is None


def test_no_admin_in_file_with_only_gm_also_rejected():
    uname = _unique("seed_gmonly")
    _run([{"username": uname, "password": "seed-test-passphrase-1", "role": "gm"}])
    assert _get_user(uname) is None


# ---------------------------------------------------------------------------
# Role handling
# ---------------------------------------------------------------------------


def test_admin_role_is_stored():
    uname = _unique("seed_admin")
    _run([{"username": uname, "password": "seed-test-passphrase-1", "role": "admin"}])
    assert _get_user(uname).role == "admin"


def test_gm_role_is_stored():
    admin = _unique("seed_gm_admin")
    gm = _unique("seed_gm")
    _run(
        [
            {"username": admin, "password": "seed-test-passphrase-1", "role": "admin"},
            {"username": gm, "password": "seed-test-passphrase-1", "role": "gm"},
        ]
    )
    assert _get_user(gm).role == "gm"


def test_player_role_is_stored():
    admin = _unique("seed_pl_admin")
    player = _unique("seed_pl")
    _run(
        [
            {"username": admin, "password": "seed-test-passphrase-1", "role": "admin"},
            {"username": player, "password": "seed-test-passphrase-1", "role": "player"},
        ]
    )
    assert _get_user(player).role == "player"


def test_invalid_role_defaults_to_player():
    admin = _unique("seed_badrole_admin")
    uname = _unique("seed_badrole")
    _run(
        [
            {"username": admin, "password": "seed-test-passphrase-1", "role": "admin"},
            {"username": uname, "password": "seed-test-passphrase-1", "role": "wizard"},
        ]
    )
    assert _get_user(uname).role == "player"


def test_missing_role_defaults_to_player():
    admin = _unique("seed_norole_admin")
    uname = _unique("seed_norole")
    _run(
        [
            {"username": admin, "password": "seed-test-passphrase-1", "role": "admin"},
            {"username": uname, "password": "seed-test-passphrase-1"},
        ]
    )
    assert _get_user(uname).role == "player"


# ---------------------------------------------------------------------------
# Password handling
# ---------------------------------------------------------------------------


def test_plaintext_password_is_hashed_and_verifiable():
    uname = _unique("seed_plain")
    _run([{"username": uname, "password": "my-plain-seed-passphrase", "role": "admin"}])
    user = _get_user(uname)
    assert _is_hashed(user.hashed_password)
    assert verify_password("my-plain-seed-passphrase", user.hashed_password)


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
    _run([{"username": uname, "password": "seed-test-passphrase-1", "role": "admin", "denyExplicit": True}])
    assert _get_user(uname).allow_explicit is False


def test_deny_explicit_false_sets_allow_explicit_true():
    uname = _unique("seed_allow")
    _run([{"username": uname, "password": "seed-test-passphrase-1", "role": "admin", "denyExplicit": False}])
    assert _get_user(uname).allow_explicit is True


def test_deny_explicit_omitted_defaults_to_allow():
    uname = _unique("seed_defexpl")
    _run([{"username": uname, "password": "seed-test-passphrase-1", "role": "admin"}])
    assert _get_user(uname).allow_explicit is True


# ---------------------------------------------------------------------------
# Skipping invalid / duplicate entries
# ---------------------------------------------------------------------------


def test_missing_username_entry_skipped_others_created():
    valid = _unique("seed_validentry")
    _run(
        [
            {"password": "seed-test-passphrase-1", "role": "admin"},  # no username
            {"username": valid, "password": "seed-test-passphrase-1", "role": "admin"},
        ]
    )
    assert _get_user(valid) is not None


def test_missing_password_entry_skipped_others_created():
    admin = _unique("seed_nopw_admin")
    uname = _unique("seed_nopw")
    _run(
        [
            {"username": admin, "password": "admin-seed-passphrase", "role": "admin"},
            {"username": uname, "role": "player"},  # no password
        ]
    )
    assert _get_user(admin) is not None
    assert _get_user(uname) is None


def test_existing_user_skipped_without_overwriting():
    uname = _unique("seed_exists")
    # First seed
    _run([{"username": uname, "password": "first-seed-passphrase", "role": "admin"}])
    first_hash = _get_user(uname).hashed_password

    # Second seed with a different password
    _run([{"username": uname, "password": "different-seed-passphrase", "role": "admin"}])
    assert _get_user(uname).hashed_password == first_hash


def test_multiple_users_all_created():
    admin = _unique("seed_multi_admin")
    gm = _unique("seed_multi_gm")
    player = _unique("seed_multi_player")
    _run(
        [
            {"username": admin, "password": "seed-passphrase-one", "role": "admin"},
            {"username": gm, "password": "seed-passphrase-two", "role": "gm"},
            {"username": player, "password": "seed-passphrase-three", "role": "player"},
        ]
    )
    assert _get_user(admin).role == "admin"
    assert _get_user(gm).role == "gm"
    assert _get_user(player).role == "player"


# ---------------------------------------------------------------------------
# Password rules and the leftover file
# ---------------------------------------------------------------------------


def test_imported_file_holds_no_plaintext_password():
    admin, player = _unique("seed_noplain_a"), _unique("seed_noplain_p")
    tmp = _run(
        [
            {"username": admin, "password": "plaintext-admin-passphrase", "role": "admin"},
            {"username": player, "password": "plaintext-player-passphrase"},
        ]
    )
    imported = Path(tmp) / "users.json.imported"
    text = imported.read_text(encoding="utf-8")
    assert "plaintext-admin-passphrase" not in text
    assert "plaintext-player-passphrase" not in text
    rows = {row["username"]: row for row in json.loads(text)}
    # Each seeded entry keeps the hash it was stored with.
    assert rows[admin]["password"] == _get_user(admin).hashed_password
    assert _is_hashed(rows[player]["password"])
    assert (imported.stat().st_mode & 0o777) == 0o600


def test_weak_password_entry_is_skipped():
    admin, weak, common = _unique("seed_rules_a"), _unique("seed_weak"), _unique("seed_common")
    tmp = _run(
        [
            {"username": admin, "password": "an-acceptable-passphrase", "role": "admin"},
            {"username": weak, "password": "short", "role": "player"},
            {"username": common, "password": "changeme", "role": "player"},
        ]
    )
    assert _get_user(admin) is not None
    assert _get_user(weak) is None
    assert _get_user(common) is None
    # The refused plaintext is not kept either.
    text = (Path(tmp) / "users.json.imported").read_text(encoding="utf-8")
    assert '"short"' not in text and "changeme" not in text


def test_weak_admin_password_stops_the_whole_seed():
    admin, player = _unique("seed_weak_admin"), _unique("seed_weak_admin_p")
    tmp = _run(
        [
            {"username": admin, "password": "changeme", "role": "admin"},
            {"username": player, "password": "a-fine-player-passphrase", "role": "player"},
        ]
    )
    # Nobody is created, and the file stays put to be fixed.
    assert _get_user(admin) is None
    assert _get_user(player) is None
    assert (Path(tmp) / "users.json").exists()


def test_hashed_password_is_not_checked():
    uname = _unique("seed_hash_rules")
    hashed = hash_password("x")  # far too short, but already a hash
    _run([{"username": uname, "password": hashed, "role": "admin"}])
    assert _get_user(uname).hashed_password == hashed


def test_example_file_must_be_edited():
    """The shipped example's plaintext passwords are refused, so copying it as-is
    seeds nothing."""
    example = Path(__file__).resolve().parents[2] / "users.json.example"
    data = json.loads(example.read_text(encoding="utf-8"))
    tmp = tempfile.mkdtemp()
    for row in data:
        row["username"] = _unique("seed_example_" + row["username"])
    _run(data, tmp)
    assert all(_get_user(row["username"]) is None for row in data)
    assert (Path(tmp) / "users.json").exists()
