"""Authorization regression tests for book content routes and campaign detail.

Covers three critical access-control fixes:

  1. Guests may only read a book's file/page/toc/thumbnail when that book is
     shared into a campaign they belong to (campaign scoping on the by-id
     content routes, which bypass the library-browse guard).
  2. NSFW (allow_explicit) is enforced on the file/page routes for non-guests,
     matching the metadata endpoint. A book shared into a guest's campaign is
     allowed regardless of the explicit flag (guests have no NSFW preference).
  3. GET /api/campaigns/{id} must not leak gm-only / unshared-private resource
     ids to members who can't see those resources.
"""
import os
import tempfile

import pytest

from backend.config import SessionLocal
from backend.models import User
from backend.routers.books._helpers import _invalidate_book_cache
from .conftest import make_book, make_game_system


def uid() -> str:
    import uuid

    return str(uuid.uuid4())[:8]


def _real_pdf_book(system_id, **kwargs):
    """A book whose filepath points at a real (tiny) PDF on disk."""
    f = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    f.write(b"%PDF-1.4\n%stub\n")
    f.close()
    book = make_book(
        system_id=system_id,
        filepath=f.name,
        filename=os.path.basename(f.name),
        relative_path=os.path.basename(f.name),
        mime_type="application/pdf",
        is_missing=False,
        **kwargs,
    )
    # The page/text/words routes read filepath through an LRU cache.
    _invalidate_book_cache()
    return book, f.name


def _add_resource(client, gm_headers, campaign_id, book_id, visibility, shared_user_ids=None):
    payload = {"resource_type": "book", "resource_id": book_id, "visibility": visibility}
    if shared_user_ids is not None:
        payload["shared_user_ids"] = shared_user_ids
    resp = client.post(
        f"/api/campaigns/{campaign_id}/resources", json=payload, headers=gm_headers
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture
def guest_campaign(client, gm_headers, admin_headers):
    """A GM campaign owned by the gm fixture user, with guest access enabled."""
    client.patch(
        "/api/settings", json={"guest_access_enabled": True}, headers=admin_headers
    )
    resp = client.post(
        "/api/campaigns",
        json={"name": f"Access Test {uid()}", "is_gm_campaign": True},
        headers=gm_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


@pytest.fixture
def guest(client, gm_headers, guest_campaign):
    """A logged-in guest of `guest_campaign`. Returns (headers, user_id)."""
    created = client.post(
        f"/api/campaigns/{guest_campaign}/guests",
        json={"nickname": "AccessGuest"},
        headers=gm_headers,
    ).json()
    login = client.post("/api/auth/guest-login", json={"code": created["guest_code"]})
    assert login.status_code == 200, login.text
    assert login.json()["user"]["role"] == "guest"
    return {"Authorization": f"Bearer {login.json()['token']}"}, created["user_id"]


# ===========================================================================
# Guest campaign scoping on book content routes
# ===========================================================================


class TestGuestBookContentScoping:
    def test_guest_denied_unshared_book(self, client, guest):
        guest_headers, _ = guest
        sys = make_game_system()
        book, path = _real_pdf_book(sys.id)
        try:
            for suffix in ("/file", "/thumbnail", "/toc", "/page/1", "/page/1/text"):
                r = client.get(f"/api/books/{book.id}{suffix}", headers=guest_headers)
                assert r.status_code == 403, f"{suffix} → {r.status_code}, expected 403"
        finally:
            os.unlink(path)

    def test_guest_allowed_public_shared_book(
        self, client, gm_headers, guest_campaign, guest
    ):
        guest_headers, _ = guest
        sys = make_game_system()
        book, path = _real_pdf_book(sys.id)
        try:
            _add_resource(client, gm_headers, guest_campaign, book.id, "public")
            r = client.get(f"/api/books/{book.id}/file", headers=guest_headers)
            assert r.status_code == 200, r.text
        finally:
            os.unlink(path)

    def test_guest_denied_gm_only_shared_book(
        self, client, gm_headers, guest_campaign, guest
    ):
        guest_headers, _ = guest
        sys = make_game_system()
        book, path = _real_pdf_book(sys.id)
        try:
            # Linked to the guest's own campaign, but gm-only visibility.
            _add_resource(client, gm_headers, guest_campaign, book.id, "gm")
            r = client.get(f"/api/books/{book.id}/file", headers=guest_headers)
            assert r.status_code == 403, r.text
        finally:
            os.unlink(path)

    def test_guest_denied_private_book_not_shared_with_them(
        self, client, gm_headers, guest_campaign, guest
    ):
        guest_headers, _ = guest
        sys = make_game_system()
        book, path = _real_pdf_book(sys.id)
        try:
            # private, but with an empty share set → guest not included.
            _add_resource(
                client, gm_headers, guest_campaign, book.id, "private", shared_user_ids=[]
            )
            r = client.get(f"/api/books/{book.id}/file", headers=guest_headers)
            assert r.status_code == 403, r.text
        finally:
            os.unlink(path)

    def test_guest_allowed_private_book_shared_with_them(
        self, client, gm_headers, guest_campaign, guest
    ):
        guest_headers, guest_id = guest
        sys = make_game_system()
        book, path = _real_pdf_book(sys.id)
        try:
            _add_resource(
                client,
                gm_headers,
                guest_campaign,
                book.id,
                "private",
                shared_user_ids=[guest_id],
            )
            r = client.get(f"/api/books/{book.id}/file", headers=guest_headers)
            assert r.status_code == 200, r.text
        finally:
            os.unlink(path)

    def test_guest_denied_book_shared_into_a_different_campaign(
        self, client, gm_headers, gm_id, guest
    ):
        guest_headers, _ = guest
        sys = make_game_system()
        book, path = _real_pdf_book(sys.id)
        try:
            # Publicly linked, but into a campaign the guest is NOT a member of.
            other = client.post(
                "/api/campaigns",
                json={"name": f"Other {uid()}", "is_gm_campaign": True},
                headers=gm_headers,
            ).json()
            _add_resource(client, gm_headers, other["id"], book.id, "public")
            r = client.get(f"/api/books/{book.id}/file", headers=guest_headers)
            assert r.status_code == 403, r.text
        finally:
            os.unlink(path)

    def test_explicit_book_shared_into_guest_campaign_is_allowed(
        self, client, gm_headers, guest_campaign, guest
    ):
        # Per product intent: a guest has no NSFW preference, so an explicit book
        # deliberately shared into their campaign is readable.
        guest_headers, _ = guest
        sys = make_game_system()
        book, path = _real_pdf_book(sys.id, is_explicit=True)
        try:
            _add_resource(client, gm_headers, guest_campaign, book.id, "public")
            r = client.get(f"/api/books/{book.id}/file", headers=guest_headers)
            assert r.status_code == 200, r.text
        finally:
            os.unlink(path)


# ===========================================================================
# NSFW enforcement on content routes for non-guest users
# ===========================================================================


class TestExplicitEnforcementOnContentRoutes:
    def _deny_explicit(self, username):
        db = SessionLocal()
        u = db.query(User).filter_by(username=username).first()
        u.allow_explicit = False
        db.commit()
        db.close()

    def _allow_explicit(self, username):
        db = SessionLocal()
        u = db.query(User).filter_by(username=username).first()
        u.allow_explicit = True
        db.commit()
        db.close()

    def test_explicit_file_denied_when_disabled(self, client, player_headers):
        self._deny_explicit("playeruser")
        try:
            sys = make_game_system()
            book, path = _real_pdf_book(sys.id, is_explicit=True)
            try:
                r = client.get(f"/api/books/{book.id}/file", headers=player_headers)
                assert r.status_code == 403, r.text
                # Metadata endpoint already enforced this; the file route now matches.
                assert client.get(
                    f"/api/books/{book.id}", headers=player_headers
                ).status_code == 403
            finally:
                os.unlink(path)
        finally:
            self._allow_explicit("playeruser")

    def test_explicit_page_denied_when_disabled(self, client, player_headers):
        self._deny_explicit("playeruser")
        try:
            sys = make_game_system()
            book, path = _real_pdf_book(sys.id, is_explicit=True)
            try:
                r = client.get(f"/api/books/{book.id}/page/1", headers=player_headers)
                assert r.status_code == 403, r.text
            finally:
                os.unlink(path)
        finally:
            self._allow_explicit("playeruser")

    def test_non_explicit_file_allowed_when_disabled(self, client, player_headers):
        self._deny_explicit("playeruser")
        try:
            sys = make_game_system()
            book, path = _real_pdf_book(sys.id, is_explicit=False)
            try:
                r = client.get(f"/api/books/{book.id}/file", headers=player_headers)
                assert r.status_code == 200, r.text
            finally:
                os.unlink(path)
        finally:
            self._allow_explicit("playeruser")


# ===========================================================================
# Campaign detail must not leak hidden resource ids
# ===========================================================================


class TestCampaignDetailResourceVisibility:
    def _accept_player(self, client, gm_headers, player_headers, player_id, campaign_id):
        client.post(
            f"/api/campaigns/{campaign_id}/invite",
            json={"user_id": player_id},
            headers=gm_headers,
        )
        client.patch(
            f"/api/campaigns/{campaign_id}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )

    def test_member_sees_only_visible_resources(
        self, client, gm_headers, player_headers, player_id
    ):
        sys = make_game_system()
        public_book = make_book(system_id=sys.id)
        gm_book = make_book(system_id=sys.id)
        private_book = make_book(system_id=sys.id)

        campaign = client.post(
            "/api/campaigns",
            json={"name": f"Leak Test {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        self._accept_player(client, gm_headers, player_headers, player_id, campaign["id"])

        _add_resource(client, gm_headers, campaign["id"], public_book.id, "public")
        _add_resource(client, gm_headers, campaign["id"], gm_book.id, "gm")
        _add_resource(
            client, gm_headers, campaign["id"], private_book.id, "private", shared_user_ids=[]
        )

        # Owner sees everything.
        owner_view = client.get(f"/api/campaigns/{campaign['id']}", headers=gm_headers)
        owner_ids = {r["resource_id"] for r in owner_view.json()["resources"]}
        assert {public_book.id, gm_book.id, private_book.id} <= owner_ids

        # Player sees only the public resource — not gm-only or unshared-private.
        member_view = client.get(
            f"/api/campaigns/{campaign['id']}", headers=player_headers
        )
        member_ids = {r["resource_id"] for r in member_view.json()["resources"]}
        assert public_book.id in member_ids
        assert gm_book.id not in member_ids
        assert private_book.id not in member_ids

    def test_detail_matches_resources_list_for_member(
        self, client, gm_headers, player_headers, player_id
    ):
        sys = make_game_system()
        public_book = make_book(system_id=sys.id)
        gm_book = make_book(system_id=sys.id)

        campaign = client.post(
            "/api/campaigns",
            json={"name": f"Parity Test {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        self._accept_player(client, gm_headers, player_headers, player_id, campaign["id"])
        _add_resource(client, gm_headers, campaign["id"], public_book.id, "public")
        _add_resource(client, gm_headers, campaign["id"], gm_book.id, "gm")

        detail_ids = {
            r["resource_id"]
            for r in client.get(
                f"/api/campaigns/{campaign['id']}", headers=player_headers
            ).json()["resources"]
        }
        list_ids = {
            r["resource_id"]
            for r in client.get(
                f"/api/campaigns/{campaign['id']}/resources", headers=player_headers
            ).json()
        }
        assert detail_ids == list_ids


# ===========================================================================
# PDF content rendering (page image, TOC, text, words) for authorised users
# ===========================================================================


@pytest.fixture
def rendered_pdf_book():
    """A real 2-page PDF with a TOC and text, inserted as a Book.

    Exercises the fitz-backed render/TOC/text/words paths in pages.py.
    """
    import fitz

    doc = fitz.open()
    for n in (1, 2):
        page = doc.new_page(width=300, height=400)
        page.insert_text((72, 72), f"Hello page {n} lorem ipsum", fontsize=14)
    doc.set_toc([[1, "Chapter One", 1], [2, "Section 1.1", 1], [1, "Chapter Two", 2]])

    f = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    f.close()
    doc.save(f.name)
    doc.close()

    book = make_book(
        system_id=make_game_system().id,
        filepath=f.name,
        filename=os.path.basename(f.name),
        relative_path=os.path.basename(f.name),
        mime_type="application/pdf",
        is_missing=False,
        page_count=2,
    )
    _invalidate_book_cache()
    yield book
    os.unlink(f.name)


class TestPdfRendering:
    def test_toc_returns_tree(self, client, admin_headers, rendered_pdf_book):
        r = client.get(f"/api/books/{rendered_pdf_book.id}/toc", headers=admin_headers)
        assert r.status_code == 200, r.text
        toc = r.json()["toc"]
        titles = [node["title"] for node in toc]
        assert "Chapter One" in titles and "Chapter Two" in titles
        # Section 1.1 nests under Chapter One.
        chapter_one = next(n for n in toc if n["title"] == "Chapter One")
        assert any(c["title"] == "Section 1.1" for c in chapter_one["children"])

    def test_page_renders_webp(self, client, admin_headers, rendered_pdf_book):
        r = client.get(
            f"/api/books/{rendered_pdf_book.id}/page/1?width=200", headers=admin_headers
        )
        assert r.status_code == 200, r.text
        assert r.headers["content-type"] == "image/webp"
        assert len(r.content) > 0

    def test_page_is_cached_on_second_request(self, client, admin_headers, rendered_pdf_book):
        # First render writes the disk cache; second serves from it (FileResponse).
        url = f"/api/books/{rendered_pdf_book.id}/page/2?width=180"
        first = client.get(url, headers=admin_headers)
        second = client.get(url, headers=admin_headers)
        assert first.status_code == 200 and second.status_code == 200
        assert second.headers["content-type"] == "image/webp"

    def test_page_out_of_range_is_400(self, client, admin_headers, rendered_pdf_book):
        r = client.get(f"/api/books/{rendered_pdf_book.id}/page/99", headers=admin_headers)
        assert r.status_code == 400

    def test_page_text(self, client, admin_headers, rendered_pdf_book):
        r = client.get(
            f"/api/books/{rendered_pdf_book.id}/page/1/text", headers=admin_headers
        )
        assert r.status_code == 200, r.text
        assert "lorem ipsum" in r.json()["text"]

    def test_page_text_out_of_range_is_400(self, client, admin_headers, rendered_pdf_book):
        r = client.get(
            f"/api/books/{rendered_pdf_book.id}/page/99/text", headers=admin_headers
        )
        assert r.status_code == 400

    def test_page_words(self, client, admin_headers, rendered_pdf_book):
        r = client.get(
            f"/api/books/{rendered_pdf_book.id}/page/1/words", headers=admin_headers
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["width"] == 300 and body["height"] == 400
        assert any(w["text"] == "lorem" for w in body["words"])

    def test_content_routes_require_auth(self, client, rendered_pdf_book):
        client.cookies.clear()
        for suffix in ("/toc", "/page/1", "/page/1/text", "/page/1/words"):
            r = client.get(f"/api/books/{rendered_pdf_book.id}{suffix}")
            assert r.status_code == 401, f"{suffix} → {r.status_code}"
