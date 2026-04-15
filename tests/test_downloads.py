"""Tests for the archive download endpoint (/api/downloads/archive) and
the _safe_arcname helper that sanitises in-archive paths for cross-platform
extraction on Windows, macOS, and Linux.

Strategy
--------
* Real files are written to a temp directory so the streaming ZIP/tar
  generators can actually read them (the endpoint checks os.path.isfile).
* DB rows use relative_path values that follow the convention the router
  expects:  "books/<category>/<filename>",  "maps/<folder>/<filename>",
  "tokens/<folder>/<filename>".
* We verify: correct Content-Disposition filename, correct Content-Type,
  and that every expected file is present inside the returned archive.
* Auth checks confirm players can download and unauthenticated requests
  are rejected.
"""
import io
import os
import tarfile
import tempfile
import uuid
import zipfile
from pathlib import Path
from unittest.mock import patch

import pytest

from tests.conftest import make_game_system, make_book, make_map, make_token
from backend.routers.downloads import _safe_arcname

# ---------------------------------------------------------------------------
# Shared temp directory for real files — written once for the module
# ---------------------------------------------------------------------------

_TMP = tempfile.mkdtemp(prefix="grimoire_dl_test_")


def _real_file(name: str, content: bytes = b"dummy") -> str:
    path = os.path.join(_TMP, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(content)
    return path


# ---------------------------------------------------------------------------
# Patch _LIBRARY_ROOT so _safe_filepath accepts files under _TMP
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def _patch_library_root():
    import backend.routers.downloads as dl_mod
    with patch.object(dl_mod, "_LIBRARY_ROOT", Path(_TMP).resolve()):
        yield


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def system():
    return make_game_system(name=f"TestSystem-{uuid.uuid4().hex[:6]}")


@pytest.fixture(scope="module")
def core_book(system):
    uid = uuid.uuid4().hex[:6]
    path = _real_file(f"core_book_{uid}.pdf", b"%PDF-1.4 core")
    return make_book(
        system_id=system.id,
        title=f"Core Book {uid}",
        filename=os.path.basename(path),
        filepath=path,
        relative_path=f"books/core/{os.path.basename(path)}",
        category="core",
    )


@pytest.fixture(scope="module")
def supplement_book(system):
    uid = uuid.uuid4().hex[:6]
    path = _real_file(f"supplement_{uid}.pdf", b"%PDF-1.4 supplement")
    return make_book(
        system_id=system.id,
        title=f"Supplement {uid}",
        filename=os.path.basename(path),
        filepath=path,
        relative_path=f"books/supplement/{os.path.basename(path)}",
        category="supplement",
    )


@pytest.fixture(scope="module")
def map_entry():
    uid = uuid.uuid4().hex[:6]
    path = _real_file(f"dungeon_{uid}.png", b"\x89PNG\r\n")
    return make_map(
        filename=os.path.basename(path),
        filepath=path,
        relative_path=f"maps/dungeons/{os.path.basename(path)}",
    )


@pytest.fixture(scope="module")
def map_subfolder_entry():
    uid = uuid.uuid4().hex[:6]
    path = _real_file(f"boss_{uid}.png", b"\x89PNG\r\n")
    return make_map(
        filename=os.path.basename(path),
        filepath=path,
        relative_path=f"maps/dungeons/boss_room/{os.path.basename(path)}",
    )


@pytest.fixture(scope="module")
def token_entry():
    uid = uuid.uuid4().hex[:6]
    path = _real_file(f"goblin_{uid}.png", b"\x89PNG\r\n")
    return make_token(
        filename=os.path.basename(path),
        filepath=path,
        relative_path=f"tokens/monsters/{os.path.basename(path)}",
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _zip_names(content: bytes) -> set[str]:
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        return set(zf.namelist())


def _tar_names(content: bytes, mode: str = "r:*") -> set[str]:
    with tarfile.open(fileobj=io.BytesIO(content), mode=mode) as tf:
        return {m.name for m in tf.getmembers()}


def _get_archive(client, headers, params: dict) -> bytes:
    resp = client.get("/api/downloads/archive", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return resp.content


# ---------------------------------------------------------------------------
# _safe_arcname unit tests
# ---------------------------------------------------------------------------


class TestSafeArcname:
    # --- Basic pass-through ---

    def test_simple_filename_unchanged(self):
        assert _safe_arcname("dungeon.png") == "dungeon.png"

    def test_simple_path_unchanged(self):
        assert _safe_arcname("core/rulebook.pdf") == "core/rulebook.pdf"

    def test_nested_path_unchanged(self):
        assert _safe_arcname("maps/dungeons/boss_room/map.png") == "maps/dungeons/boss_room/map.png"

    # --- Windows-illegal characters replaced ---

    def test_colon_replaced(self):
        assert ":" not in _safe_arcname("Book: Special Edition.pdf")

    def test_asterisk_replaced(self):
        assert "*" not in _safe_arcname("map*.png")

    def test_question_mark_replaced(self):
        assert "?" not in _safe_arcname("what?.pdf")

    def test_double_quote_replaced(self):
        assert '"' not in _safe_arcname('he said "hello".txt')

    def test_less_than_replaced(self):
        assert "<" not in _safe_arcname("a<b.pdf")

    def test_greater_than_replaced(self):
        assert ">" not in _safe_arcname("a>b.pdf")

    def test_pipe_replaced(self):
        assert "|" not in _safe_arcname("left|right.pdf")

    def test_backslash_converted_to_forward_slash(self):
        # Backslash is a path separator on Windows — normalise to '/'
        result = _safe_arcname("core\\rulebook.pdf")
        assert "\\" not in result
        assert result == "core/rulebook.pdf"

    def test_all_windows_illegal_chars_replaced(self):
        bad = 'fi:le*na?me"wi<th>il|legal.pdf'
        result = _safe_arcname(bad)
        for ch in ':*?"<>|\\':
            assert ch not in result

    # --- Leading slash stripped (zip-slip prevention) ---

    def test_leading_slash_stripped(self):
        result = _safe_arcname("/etc/passwd")
        assert not result.startswith("/")
        assert result == "etc/passwd"

    def test_double_leading_slash_stripped(self):
        result = _safe_arcname("//etc/passwd")
        assert not result.startswith("/")

    # --- Dots and spaces stripped from component edges ---

    def test_leading_dot_stripped_from_component(self):
        # "." alone would become "_" rather than an empty string
        result = _safe_arcname(".hidden/file.pdf")
        assert not result.startswith(".")

    def test_trailing_dot_stripped_from_component(self):
        result = _safe_arcname("folder./file.pdf")
        parts = result.split("/")
        assert not parts[0].endswith(".")

    def test_trailing_space_stripped_from_component(self):
        result = _safe_arcname("folder /file.pdf")
        parts = result.split("/")
        assert not parts[0].endswith(" ")

    # --- Empty / degenerate inputs ---

    def test_empty_string_returns_placeholder(self):
        result = _safe_arcname("")
        assert result == "_"

    def test_only_slashes_returns_placeholder(self):
        result = _safe_arcname("///")
        assert result == "_"

    def test_component_that_becomes_empty_after_strip_is_replaced(self):
        # A component of only dots and spaces should become "_"
        result = _safe_arcname("good/... /also_good.pdf")
        parts = result.split("/")
        assert all(p for p in parts), "No empty component should survive"

    # --- Long filenames clamped ---

    def test_component_clamped_to_255_bytes(self):
        long_name = "a" * 300 + ".pdf"
        result = _safe_arcname(long_name)
        assert len(result.encode("utf-8")) <= 255

    def test_multibyte_component_clamped_correctly(self):
        # Each Japanese char is 3 bytes in UTF-8; 90 chars = 270 bytes > 255
        long_name = "あ" * 90 + ".pdf"
        result = _safe_arcname(long_name)
        assert len(result.encode("utf-8")) <= 255

    # --- Real-world TTRPG filenames ---

    def test_dnd_core_book(self):
        result = _safe_arcname("Player's Handbook (5e).pdf")
        assert result == "Player's Handbook (5e).pdf"

    def test_book_with_colon_subtitle(self):
        result = _safe_arcname("Xanathar's Guide: Everything.pdf")
        assert ":" not in result
        assert "Xanathar" in result

    def test_map_with_nested_subfolders(self):
        result = _safe_arcname("dungeons/boss_room/final_boss.png")
        assert result == "dungeons/boss_room/final_boss.png"


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------


class TestDownloadAuth:
    def test_unauthenticated_rejected(self, client, system, core_book):
        resp = client.get(
            "/api/downloads/archive",
            params={"type": "system", "id": system.id},
        )
        assert resp.status_code == 401

    def test_player_can_download(self, client, player_headers, system, core_book):
        resp = client.get(
            "/api/downloads/archive",
            headers=player_headers,
            params={"type": "system", "id": system.id},
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Bad requests
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def adventure_system():
    return make_game_system(name=f"AdventureSystem-{uuid.uuid4().hex[:6]}")


@pytest.fixture(scope="module")
def subfolder_book_in_folder(adventure_system):
    """A book at books/{System}/adventures/Curse of Strahd/cos.pdf."""
    uid = uuid.uuid4().hex[:6]
    path = _real_file(f"cos_{uid}.pdf", b"%PDF-1.4 strahd")
    return make_book(
        system_id=adventure_system.id,
        title=f"Curse of Strahd {uid}",
        filename=os.path.basename(path),
        filepath=path,
        relative_path=f"books/AdventureSystem/adventures/Curse of Strahd/{os.path.basename(path)}",
        category="adventure",
    )


@pytest.fixture(scope="module")
def subfolder_book_other_folder(adventure_system):
    """A book in a different subfolder of the same system — should not appear in Strahd download."""
    uid = uuid.uuid4().hex[:6]
    path = _real_file(f"lmop_{uid}.pdf", b"%PDF-1.4 lmop")
    return make_book(
        system_id=adventure_system.id,
        title=f"Lost Mine {uid}",
        filename=os.path.basename(path),
        filepath=path,
        relative_path=f"books/AdventureSystem/adventures/Lost Mine/{os.path.basename(path)}",
        category="adventure",
    )


@pytest.fixture(scope="module")
def core_subfolder_book(adventure_system):
    """A book in core/monsters subfolder — tests that book_folder works across categories."""
    uid = uuid.uuid4().hex[:6]
    path = _real_file(f"bestiary_{uid}.pdf", b"%PDF-1.4 bestiary")
    return make_book(
        system_id=adventure_system.id,
        title=f"Bestiary {uid}",
        filename=os.path.basename(path),
        filepath=path,
        relative_path=f"books/AdventureSystem/core/monsters/{os.path.basename(path)}",
        category="core",
    )


class TestDownloadValidation:
    def test_unknown_type_returns_400(self, client, admin_headers):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "banana"},
        )
        assert resp.status_code == 400

    def test_system_missing_id_returns_400(self, client, admin_headers):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "system"},
        )
        assert resp.status_code == 400

    def test_system_category_missing_category_returns_400(self, client, admin_headers, system):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "system_category", "id": system.id},
        )
        assert resp.status_code == 400

    def test_map_folder_missing_folder_returns_400(self, client, admin_headers):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "map_folder"},
        )
        assert resp.status_code == 400

    def test_token_folder_missing_folder_returns_400(self, client, admin_headers):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "token_folder"},
        )
        assert resp.status_code == 400

    def test_book_folder_missing_id_returns_400(self, client, admin_headers):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "book_folder", "folder": "Curse of Strahd"},
        )
        assert resp.status_code == 400

    def test_book_folder_missing_folder_returns_400(self, client, admin_headers, system):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "book_folder", "id": system.id},
        )
        assert resp.status_code == 400

    def test_nonexistent_system_returns_404(self, client, admin_headers):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "system", "id": "no-such-system"},
        )
        assert resp.status_code == 404

    def test_unknown_fmt_returns_400(self, client, admin_headers, system):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "system", "id": system.id, "fmt": "rar"},
        )
        assert resp.status_code == 400

    def test_empty_scope_returns_404(self, client, admin_headers):
        """A system with no books at all should return 404."""
        empty_sys = make_game_system(name=f"EmptySys-{uuid.uuid4().hex[:6]}")
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "system", "id": empty_sys.id},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# ZIP — system scope
# ---------------------------------------------------------------------------


class TestDownloadSystemZip:
    def test_content_type_is_zip(self, client, admin_headers, system, core_book):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "system", "id": system.id},
        )
        assert resp.status_code == 200
        assert "zip" in resp.headers["content-type"]

    def test_content_disposition_has_attachment(self, client, admin_headers, system, core_book):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "system", "id": system.id},
        )
        cd = resp.headers["content-disposition"]
        assert "attachment" in cd
        assert ".zip" in cd

    def test_zip_contains_core_book(self, client, admin_headers, system, core_book):
        content = _get_archive(
            client, admin_headers, {"type": "system", "id": system.id}
        )
        names = _zip_names(content)
        assert any(core_book.filename in n for n in names)

    def test_zip_contains_supplement_book(self, client, admin_headers, system, supplement_book):
        content = _get_archive(
            client, admin_headers, {"type": "system", "id": system.id}
        )
        names = _zip_names(content)
        assert any(supplement_book.filename in n for n in names)

    def test_books_grouped_by_category_folder(self, client, admin_headers, system, core_book, supplement_book):
        content = _get_archive(
            client, admin_headers, {"type": "system", "id": system.id}
        )
        names = _zip_names(content)
        assert any(n.startswith("core/") for n in names)
        assert any(n.startswith("supplement/") for n in names)


# ---------------------------------------------------------------------------
# ZIP — system_category scope
# ---------------------------------------------------------------------------


class TestDownloadSystemCategoryZip:
    def test_only_core_books_in_archive(self, client, admin_headers, system, core_book, supplement_book):
        content = _get_archive(
            client,
            admin_headers,
            {"type": "system_category", "id": system.id, "category": "core"},
        )
        names = _zip_names(content)
        assert core_book.filename in names
        assert supplement_book.filename not in names

    def test_content_disposition_includes_category(self, client, admin_headers, system, core_book):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "system_category", "id": system.id, "category": "core"},
        )
        cd = resp.headers["content-disposition"]
        assert "core" in cd

    def test_nonexistent_category_returns_404(self, client, admin_headers, system):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "system_category", "id": system.id, "category": "no-such-cat"},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# ZIP — map_folder scope
# ---------------------------------------------------------------------------


class TestDownloadMapFolderZip:
    def test_contains_map_file(self, client, admin_headers, map_entry):
        content = _get_archive(
            client,
            admin_headers,
            {"type": "map_folder", "folder": "dungeons"},
        )
        names = _zip_names(content)
        assert any(map_entry.filename in n for n in names)

    def test_subfolder_map_included_in_parent_folder_download(
        self, client, admin_headers, map_subfolder_entry
    ):
        content = _get_archive(
            client,
            admin_headers,
            {"type": "map_folder", "folder": "dungeons"},
        )
        names = _zip_names(content)
        assert any(map_subfolder_entry.filename in n for n in names)

    def test_subfolder_download_excludes_parent_only_maps(
        self, client, admin_headers, map_entry, map_subfolder_entry
    ):
        """Downloading dungeons/boss_room should NOT include the top-level dungeon map."""
        content = _get_archive(
            client,
            admin_headers,
            {"type": "map_folder", "folder": "dungeons/boss_room"},
        )
        names = _zip_names(content)
        assert any(map_subfolder_entry.filename in n for n in names)
        assert map_entry.filename not in names

    def test_content_type_is_zip(self, client, admin_headers, map_entry):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "map_folder", "folder": "dungeons"},
        )
        assert "zip" in resp.headers["content-type"]

    def test_nonexistent_folder_returns_404(self, client, admin_headers):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "map_folder", "folder": "does_not_exist"},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# ZIP — token_folder scope
# ---------------------------------------------------------------------------


class TestDownloadTokenFolderZip:
    def test_contains_token_file(self, client, admin_headers, token_entry):
        content = _get_archive(
            client,
            admin_headers,
            {"type": "token_folder", "folder": "monsters"},
        )
        names = _zip_names(content)
        assert any(token_entry.filename in n for n in names)

    def test_content_type_is_zip(self, client, admin_headers, token_entry):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "token_folder", "folder": "monsters"},
        )
        assert "zip" in resp.headers["content-type"]

    def test_nonexistent_folder_returns_404(self, client, admin_headers):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "token_folder", "folder": "no_such_folder"},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# ZIP — book_folder scope
# ---------------------------------------------------------------------------


class TestDownloadBookFolderZip:
    def test_contains_book_in_subfolder(
        self, client, admin_headers, adventure_system, subfolder_book_in_folder
    ):
        content = _get_archive(
            client,
            admin_headers,
            {"type": "book_folder", "id": adventure_system.id, "folder": "Curse of Strahd"},
        )
        names = _zip_names(content)
        assert any(subfolder_book_in_folder.filename in n for n in names)

    def test_excludes_book_from_different_subfolder(
        self, client, admin_headers, adventure_system,
        subfolder_book_in_folder, subfolder_book_other_folder
    ):
        content = _get_archive(
            client,
            admin_headers,
            {"type": "book_folder", "id": adventure_system.id, "folder": "Curse of Strahd"},
        )
        names = _zip_names(content)
        assert subfolder_book_other_folder.filename not in names

    def test_works_for_non_adventure_category(
        self, client, admin_headers, adventure_system, core_subfolder_book
    ):
        """book_folder works for any category, not just adventures."""
        content = _get_archive(
            client,
            admin_headers,
            {"type": "book_folder", "id": adventure_system.id, "folder": "monsters"},
        )
        names = _zip_names(content)
        assert any(core_subfolder_book.filename in n for n in names)

    def test_content_type_is_zip(
        self, client, admin_headers, adventure_system, subfolder_book_in_folder
    ):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "book_folder", "id": adventure_system.id, "folder": "Curse of Strahd"},
        )
        assert resp.status_code == 200
        assert "zip" in resp.headers["content-type"]

    def test_content_disposition_includes_folder_name(
        self, client, admin_headers, adventure_system, subfolder_book_in_folder
    ):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "book_folder", "id": adventure_system.id, "folder": "Curse of Strahd"},
        )
        cd = resp.headers["content-disposition"]
        assert "Curse_of_Strahd" in cd

    def test_nonexistent_folder_returns_404(
        self, client, admin_headers, adventure_system
    ):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "book_folder", "id": adventure_system.id, "folder": "no-such-folder"},
        )
        assert resp.status_code == 404

    def test_nonexistent_system_returns_404(self, client, admin_headers):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "book_folder", "id": "no-such-system", "folder": "anything"},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Format variants — tar, tar.gz, tar.bz2
# ---------------------------------------------------------------------------


class TestDownloadFormats:
    @pytest.mark.parametrize("fmt,mime", [
        ("zip",     "zip"),
        ("tar",     "tar"),
        ("tar.gz",  "gzip"),
        ("tar.bz2", "bzip2"),
    ])
    def test_content_type_per_format(self, client, admin_headers, system, core_book, fmt, mime):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "system", "id": system.id, "fmt": fmt},
        )
        assert resp.status_code == 200
        assert mime in resp.headers["content-type"]

    @pytest.mark.parametrize("fmt,ext", [
        ("zip",     ".zip"),
        ("tar",     ".tar"),
        ("tar.gz",  ".tar.gz"),
        ("tar.bz2", ".tar.bz2"),
    ])
    def test_content_disposition_extension_per_format(
        self, client, admin_headers, system, core_book, fmt, ext
    ):
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "system", "id": system.id, "fmt": fmt},
        )
        assert ext in resp.headers["content-disposition"]

    def test_tar_contains_expected_file(self, client, admin_headers, system, core_book):
        content = _get_archive(
            client,
            admin_headers,
            {"type": "system", "id": system.id, "fmt": "tar"},
        )
        names = _tar_names(content, mode="r:")
        assert any(core_book.filename in n for n in names)

    def test_tar_gz_contains_expected_file(self, client, admin_headers, system, core_book):
        content = _get_archive(
            client,
            admin_headers,
            {"type": "system", "id": system.id, "fmt": "tar.gz"},
        )
        names = _tar_names(content, mode="r:gz")
        assert any(core_book.filename in n for n in names)

    def test_tar_bz2_contains_expected_file(self, client, admin_headers, system, core_book):
        content = _get_archive(
            client,
            admin_headers,
            {"type": "system", "id": system.id, "fmt": "tar.bz2"},
        )
        names = _tar_names(content, mode="r:bz2")
        assert any(core_book.filename in n for n in names)

    def test_zip_default_when_fmt_omitted(self, client, admin_headers, system, core_book):
        """Omitting fmt should default to ZIP."""
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "system", "id": system.id},
        )
        assert resp.status_code == 200
        assert "zip" in resp.headers["content-type"]
        # Verify it's actually a valid ZIP
        _zip_names(resp.content)  # would raise if not a zip


# ---------------------------------------------------------------------------
# Explicit content filtering
# ---------------------------------------------------------------------------


class TestDownloadExplicitFilter:
    @pytest.fixture(scope="class")
    def explicit_system(self):
        return make_game_system(
            name=f"ExplicitSys-{uuid.uuid4().hex[:6]}",
            is_explicit=True,
        )

    @pytest.fixture(scope="class")
    def explicit_book(self, explicit_system):
        uid = uuid.uuid4().hex[:6]
        path = _real_file(f"explicit_{uid}.pdf", b"%PDF-1.4 explicit")
        return make_book(
            system_id=explicit_system.id,
            filename=os.path.basename(path),
            filepath=path,
            relative_path=f"books/core/{os.path.basename(path)}",
            category="core",
            is_explicit=True,
        )

    def test_admin_can_download_explicit_system(
        self, client, admin_headers, explicit_system, explicit_book
    ):
        # admin has allow_explicit=True by default
        resp = client.get(
            "/api/downloads/archive",
            headers=admin_headers,
            params={"type": "system", "id": explicit_system.id},
        )
        assert resp.status_code == 200

    def test_explicit_token_excluded_for_no_explicit_user(
        self, client, admin_headers
    ):
        """Create a user with allow_explicit=False and verify explicit tokens are absent."""
        from backend.config import SessionLocal
        from backend.models import User
        from backend.auth import hash_password

        uid = uuid.uuid4().hex[:6]
        db = SessionLocal()
        try:
            u = User(
                username=f"noexplicit_{uid}",
                hashed_password=hash_password("pass1234"),
                role="player",
                allow_explicit=False,
            )
            db.add(u)
            db.commit()
        finally:
            db.close()

        login = client.post(
            "/api/auth/login",
            json={"username": f"noexplicit_{uid}", "password": "pass1234"},
        )
        assert login.status_code == 200
        token = login.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Create an explicit token
        tok_uid = uuid.uuid4().hex[:6]
        path = _real_file(f"explicit_tok_{tok_uid}.png", b"\x89PNG")
        make_token(
            filename=os.path.basename(path),
            filepath=path,
            relative_path=f"tokens/nsfw/{os.path.basename(path)}",
            is_explicit=True,
        )

        # A non-explicit user asking for this folder should get 404
        # (no visible files after filtering)
        resp = client.get(
            "/api/downloads/archive",
            headers=headers,
            params={"type": "token_folder", "folder": "nsfw"},
        )
        assert resp.status_code == 404
