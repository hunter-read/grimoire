"""Alembic revisions don't import live app code (issue #699).

A revision has to do on every upgrade what it did the day it was written, so the
logic it needs is frozen under ``backend/migrations/_frozen/``. Where the frozen
copy must still agree with the running app (the token vault), that is checked
here, so a divergence fails a test rather than an upgrade.
"""
import ast
from pathlib import Path

import pytest

from backend import auth, token_vault
from backend.migrations._frozen import token_vault as frozen_vault

_VERSIONS = Path(__file__).resolve().parents[1] / "migrations" / "versions"
_REVISIONS = sorted(_VERSIONS.glob("*.py"))


def _live_imports(path: Path) -> list[str]:
    """Modules ``path`` imports from ``backend`` outside ``backend.migrations``."""
    found = []
    for node in ast.walk(ast.parse(path.read_text(), filename=str(path))):
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names = [node.module]
        else:
            continue
        for name in names:
            if name.split(".")[0] != "backend":
                continue
            if name == "backend.migrations" or name.startswith("backend.migrations."):
                continue
            found.append(name)
    return found


def test_revisions_are_found():
    assert len(_REVISIONS) > 50


@pytest.mark.parametrize("path", _REVISIONS, ids=lambda p: p.name)
def test_revision_imports_no_live_app_code(path):
    assert _live_imports(path) == []


def test_the_check_catches_a_live_import(tmp_path):
    rev = tmp_path / "rev.py"
    rev.write_text(
        "from backend.migrations._frozen import token_vault\n"
        "def upgrade():\n"
        "    from backend import token_vault\n"
        "    import backend.usernames\n"
    )
    assert _live_imports(rev) == ["backend", "backend.usernames"]


class TestFrozenVaultMatchesLive:
    """Tokens 0047/0048 stored must still be readable by the running app."""

    def test_lookup_hash(self):
        assert frozen_vault.lookup_hash(auth.SECRET_KEY, "tok") == token_vault.lookup_hash("tok")

    def test_sealed_token_round_trips_both_ways(self):
        assert token_vault.unseal(frozen_vault.seal(auth.SECRET_KEY, "tok")) == "tok"
        assert frozen_vault.unseal(auth.SECRET_KEY, token_vault.seal("tok")) == "tok"

    def test_sealed_secret_round_trips_both_ways(self):
        assert token_vault.unseal_secret(frozen_vault.seal_secret(auth.SECRET_KEY, "s")) == "s"
        assert frozen_vault.unseal_secret(auth.SECRET_KEY, token_vault.seal_secret("s")) == "s"

    def test_secret_key_is_the_apps(self):
        assert frozen_vault.secret_key() == auth.SECRET_KEY

    def test_unseal_rejects_another_key_and_nothing(self):
        sealed = frozen_vault.seal("other-key", "tok")
        assert frozen_vault.unseal(auth.SECRET_KEY, sealed) is None
        assert frozen_vault.unseal(auth.SECRET_KEY, None) is None
        assert frozen_vault.unseal_secret(auth.SECRET_KEY, "not-a-token") is None

