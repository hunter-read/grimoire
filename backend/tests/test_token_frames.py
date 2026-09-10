"""Tests for the token frame endpoints (the in-app token editor's overlay art).

The security-critical property here is that a frame id — which round-trips to a
real filesystem path — can only ever name a file in a folder that has declared
itself a frame folder with a ``.frames-container`` marker. ``safe_join`` alone is
not enough for that: it only proves a path is inside the library, which every
book and map also is. The location gate is what makes the id safe to accept, and
the traversal tests below are what prove it is load-bearing.
"""
import os
import shutil

import pytest

from backend.config import SessionLocal
from backend.models import Token
from backend.routers.token_frames import _helpers

# A 1x1 transparent PNG — real bytes, so PIL/stat-based checks behave normally.
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000d49444154789c6360000002000100055f9f2f0000"
    "000049454e44ae426082"
)
_SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"/>'


def _write(path: str, data: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


@pytest.fixture
def frame_library():
    """Build a token tree exercising every inclusion and exclusion rule.

    Yields the library root. Tears the tree back down so the session-scoped
    library stays clean for other tests.
    """
    lib = os.environ["LIBRARY_PATH"]
    tokens = os.path.join(lib, "tokens")

    files = {
        # Two frame folders with ordinary, readable names — the point of a
        # marker file rather than a magically-named directory.
        os.path.join(tokens, "Fantasy Frames", ".frames-container"): b"",
        os.path.join(tokens, "Fantasy Frames", "orc-ring.svg"): _SVG,
        os.path.join(tokens, "Scifi Frames", ".frames-container"): b"",
        os.path.join(tokens, "Scifi Frames", "plain.png"): _PNG,
        # Excluded, one rule each.
        os.path.join(tokens, "Fantasy Frames", "notes.txt"): b"not an image",
        os.path.join(tokens, "Fantasy Frames", ".hidden.png"): _PNG,
        os.path.join(tokens, "Fantasy Frames", "deep", "nested.png"): _PNG,
        os.path.join(tokens, "Unmarked", "ordinary.png"): _PNG,
        os.path.join(tokens, ".secret", ".frames-container"): b"",
        os.path.join(tokens, ".secret", "evil.png"): _PNG,
    }
    for path, data in files.items():
        _write(path, data)

    _helpers.reset_frame_cache()
    try:
        yield lib
    finally:
        shutil.rmtree(tokens, ignore_errors=True)
        _helpers.reset_frame_cache()


def _listing(client, headers):
    resp = client.get("/api/token-frames", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["frames"]


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


def test_lists_only_real_frames(client, admin_headers, frame_library):
    frames = _listing(client, admin_headers)
    by_name = {f["name"]: f for f in frames}

    # Exactly the two legitimate frames, and nothing else.
    assert set(by_name) == {"plain", "orc ring"}

    # The stem is humanised and the group is the frame folder's own name.
    assert by_name["plain"]["group"] == "Scifi Frames"
    assert by_name["plain"]["format"] == "png"
    assert by_name["orc ring"]["group"] == "Fantasy Frames"
    assert by_name["orc ring"]["format"] == "svg"


@pytest.mark.parametrize(
    "excluded",
    [
        "notes",  # wrong extension
        "hidden",  # a dotfile in a frame folder
        "nested",  # a subfolder of a frame folder is not itself marked
        "ordinary",  # an unmarked folder's image is a plain token
        "evil",  # a marker under a hidden ancestor confers nothing
    ],
)
def test_excludes(client, admin_headers, frame_library, excluded):
    names = " ".join(f["name"] for f in _listing(client, admin_headers))
    assert excluded not in names


def test_missing_tokens_dir_lists_nothing(client, admin_headers):
    """An empty or absent token library is not an error."""
    shutil.rmtree(os.path.join(os.environ["LIBRARY_PATH"], "tokens"), ignore_errors=True)
    _helpers.reset_frame_cache()
    assert _listing(client, admin_headers) == []


def test_respects_max_frames(client, admin_headers, frame_library, monkeypatch):
    directory = os.path.join(os.environ["LIBRARY_PATH"], "tokens", "Fantasy Frames")
    for i in range(5):
        _write(os.path.join(directory, f"extra{i}.png"), _PNG)
    monkeypatch.setattr(_helpers, "MAX_FRAMES", 2)
    _helpers.reset_frame_cache()
    assert len(_listing(client, admin_headers)) == 2


def test_oversized_frame_is_skipped(client, admin_headers, frame_library, monkeypatch):
    monkeypatch.setattr(_helpers, "MAX_FRAME_BYTES", 10)
    _helpers.reset_frame_cache()
    # Both fixtures exceed 10 bytes, so nothing survives the ceiling.
    assert _listing(client, admin_headers) == []


def test_listing_is_cached(client, admin_headers, frame_library, monkeypatch):
    calls = []
    real = _helpers.scan_user_frames

    def counted():
        calls.append(1)
        return real()

    monkeypatch.setattr(_helpers, "scan_user_frames", counted)
    _helpers.reset_frame_cache()
    _listing(client, admin_headers)
    _listing(client, admin_headers)
    assert len(calls) == 1


# ---------------------------------------------------------------------------
# Serving
# ---------------------------------------------------------------------------


def test_serves_frame_file(client, admin_headers, frame_library):
    frames = _listing(client, admin_headers)
    png = next(f for f in frames if f["format"] == "png")

    resp = client.get(f"/api/token-frames/{png['id']}/file", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/png")
    assert resp.content == _PNG
    # An SVG frame must not be able to run script even if navigated to directly.
    assert "default-src 'none'" in resp.headers["content-security-policy"]


def test_serves_svg_with_its_own_media_type(client, admin_headers, frame_library):
    svg = next(f for f in _listing(client, admin_headers) if f["format"] == "svg")
    resp = client.get(f"/api/token-frames/{svg['id']}/file", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/svg+xml")


def test_conditional_request_returns_304(client, admin_headers, frame_library):
    frame = _listing(client, admin_headers)[0]
    url = f"/api/token-frames/{frame['id']}/file"

    first = client.get(url, headers=admin_headers)
    assert first.status_code == 200
    etag = first.headers["etag"]

    second = client.get(url, headers={**admin_headers, "If-None-Match": etag})
    assert second.status_code == 304


# ---------------------------------------------------------------------------
# Traversal and malformed ids
# ---------------------------------------------------------------------------


def test_rejects_path_escaping_the_library(client, admin_headers, frame_library):
    frame_id = _helpers.encode_frame_id("../../../etc/passwd")
    resp = client.get(f"/api/token-frames/{frame_id}/file", headers=admin_headers)
    assert resp.status_code == 404


def test_rejects_a_real_file_outside_a_frames_dir(client, admin_headers, frame_library):
    """The location gate is load-bearing, not just safe_join.

    ``tokens/Fantasy/ordinary.png`` is a real file safely inside the library, so
    ``safe_join`` admits it. Only the marker check keeps a frame id from becoming
    a way to read arbitrary library content.
    """
    frame_id = _helpers.encode_frame_id("tokens/Unmarked/ordinary.png")
    resp = client.get(f"/api/token-frames/{frame_id}/file", headers=admin_headers)
    assert resp.status_code == 404


def test_rejects_marker_under_a_hidden_ancestor(client, admin_headers, frame_library):
    frame_id = _helpers.encode_frame_id("tokens/.secret/evil.png")
    resp = client.get(f"/api/token-frames/{frame_id}/file", headers=admin_headers)
    assert resp.status_code == 404


@pytest.mark.parametrize("frame_id", ["!!!not-base64!!!", "_", "wq", "Li4v"])
def test_malformed_ids_are_404_not_500(client, admin_headers, frame_library, frame_id):
    resp = client.get(f"/api/token-frames/{frame_id}/file", headers=admin_headers)
    assert resp.status_code == 404


def test_unknown_frame_is_404(client, admin_headers, frame_library):
    frame_id = _helpers.encode_frame_id("tokens/Fantasy Frames/nope.png")
    resp = client.get(f"/api/token-frames/{frame_id}/file", headers=admin_headers)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------


def test_guests_are_blocked(client, gm_headers, admin_headers, frame_library):
    """Guests have no access to the shared library, frames included."""
    client.patch("/api/settings", json={"guest_access_enabled": True}, headers=admin_headers)
    campaign = client.post(
        "/api/campaigns",
        json={"name": "Frame Guest Campaign", "is_gm_campaign": True},
        headers=gm_headers,
    ).json()["id"]
    code = client.post(
        f"/api/campaigns/{campaign}/guests",
        json={"nickname": "Frameless"},
        headers=gm_headers,
    ).json()["guest_code"]
    token = client.post("/api/auth/guest-login", json={"code": code}).json()["token"]
    guest_headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/api/token-frames", headers=guest_headers).status_code == 403

    frame = _listing(client, admin_headers)[0]
    resp = client.get(f"/api/token-frames/{frame['id']}/file", headers=guest_headers)
    assert resp.status_code == 403


def test_players_may_read_frames(client, player_headers, frame_library):
    """Any non-guest can use the editor, so any non-guest can list frames."""
    assert client.get("/api/token-frames", headers=player_headers).status_code == 200


# ---------------------------------------------------------------------------
# Frames and the library
# ---------------------------------------------------------------------------


def test_frames_are_ordinary_library_files(frame_library):
    """A frame folder is a normal folder; the marker adds a use, it does not hide.

    Frame images are indexed as tokens like any other image, because a frame
    *is* a token image — one you would normally composite rather than place. The
    marker only tells the editor these are offered as overlay art.
    """
    from backend.indexer import scan_library

    db = SessionLocal()
    try:
        scan_library(frame_library, os.environ["DATA_PATH"], db, scope_path="tokens")
        indexed = [t.filepath for t in db.query(Token).all()]
    finally:
        db.close()

    assert any(path.endswith("orc-ring.svg") for path in indexed)
    assert any(path.endswith("ordinary.png") for path in indexed)
    # The marker file itself is a dotfile and never becomes a row.
    assert not any(path.endswith(".frames-container") for path in indexed)
