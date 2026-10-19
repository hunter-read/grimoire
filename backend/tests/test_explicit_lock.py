"""An admin's (or the IdP's) "no explicit content" is a restriction the user can't
lift, and with explicit content off nothing explicit leaks through search, the
book route or MCP."""
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.auth import CurrentUser
from backend.config import SessionLocal
from backend.models import User
from backend.tests._mcp import index_page
from backend.tests.conftest import make_book, make_game_system

PASSWORD = "explicit-lock-passphrase"


def _new_player(client, admin_headers, **extra):
    username = f"lock-{uuid.uuid4().hex[:8]}"
    resp = client.post(
        "/api/users",
        json={"username": username, "password": PASSWORD, "role": "player", **extra},
        headers=admin_headers,
    )
    assert resp.status_code in (200, 201), resp.text
    login = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return resp.json()["id"], {"Authorization": f"Bearer {login.json()['token']}"}


def _set_pref(client, headers, allowed):
    return client.patch(
        "/api/users/me/preferences", json={"allow_explicit": allowed}, headers=headers
    )


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


class TestLock:
    def test_admin_restriction_cannot_be_lifted(self, client, admin_headers):
        uid, headers = _new_player(client, admin_headers)
        client.patch(f"/api/users/{uid}", json={"allow_explicit": False}, headers=admin_headers)
        assert _me(client, headers)["explicit_locked"] is True
        resp = _set_pref(client, headers, True)
        assert resp.status_code == 403
        assert _me(client, headers)["allow_explicit"] is False

    def test_locked_user_may_still_turn_it_off(self, client, admin_headers):
        uid, headers = _new_player(client, admin_headers, allow_explicit=False)
        assert _set_pref(client, headers, False).status_code == 200

    def test_admin_allowing_unlocks(self, client, admin_headers):
        uid, headers = _new_player(client, admin_headers, allow_explicit=False)
        client.patch(f"/api/users/{uid}", json={"allow_explicit": True}, headers=admin_headers)
        assert _me(client, headers)["explicit_locked"] is False
        assert _set_pref(client, headers, False).status_code == 200
        assert _set_pref(client, headers, True).status_code == 200

    def test_own_choice_is_not_a_lock(self, client, admin_headers):
        _, headers = _new_player(client, admin_headers)
        assert _set_pref(client, headers, False).status_code == 200
        assert _me(client, headers)["explicit_locked"] is False
        assert _set_pref(client, headers, True).status_code == 200

    def test_api_key_cannot_lift_it_either(self, client, admin_headers):
        uid, headers = _new_player(client, admin_headers, allow_explicit=False)
        db = SessionLocal()
        try:
            db.query(User).filter_by(id=uid).update({"api_keys_enabled": True})
            db.commit()
        finally:
            db.close()
        created = client.post(
            "/api/api-keys",
            json={"name": "k", "permissions": {"*": "write"}},
            headers=headers,
        )
        assert created.status_code == 201, created.text
        key = {"X-API-Key": created.json()["key"]}
        assert _set_pref(client, key, True).status_code == 403


class TestNothingExplicitLeaks:
    @pytest.fixture
    def hidden(self, client, admin_headers):
        _, headers = _new_player(client, admin_headers, allow_explicit=False)
        word = f"zx{uuid.uuid4().hex[:10]}"
        system = make_game_system()
        explicit = make_book(system.id, title=f"Explicit {word}", is_explicit=True)
        plain = make_book(system.id, title=f"Plain {word}")
        index_page(explicit.id, 1, f"the {word} passage")
        index_page(plain.id, 1, f"the {word} passage")
        return SimpleNamespace(headers=headers, word=word, explicit=explicit, plain=plain)

    def test_search_leaves_out_explicit_pages_and_titles(self, client, hidden):
        body = client.get(
            "/api/search", params={"q": hidden.word}, headers=hidden.headers
        ).json()
        page_ids = {r["id"] for r in body["results"]}
        title_ids = {b["id"] for b in body["book_matches"]}
        assert hidden.plain.id in page_ids
        assert hidden.explicit.id not in page_ids | title_ids

    def test_search_inside_the_explicit_book_finds_nothing(self, client, hidden):
        body = client.get(
            "/api/search",
            params={"q": hidden.word, "book_id": hidden.explicit.id},
            headers=hidden.headers,
        ).json()
        assert body["results"] == []

    def test_explicit_book_is_not_found(self, client, hidden):
        assert client.get(
            f"/api/books/{hidden.explicit.id}", headers=hidden.headers
        ).status_code == 404

    def test_mcp_book_tools_answer_not_found(self, hidden, client):
        from backend.mcp_server.tools.library import load_book

        me = _me(client, hidden.headers)
        db = SessionLocal()
        try:
            ctx = SimpleNamespace(
                user=CurrentUser(id=me["id"], username=me["username"], role="player"), db=db
            )
            with pytest.raises(HTTPException) as exc:
                load_book(ctx, hidden.explicit.id)
            assert exc.value.status_code == 404
            assert load_book(ctx, hidden.plain.id)["id"] == hidden.plain.id
        finally:
            db.close()

    def test_users_who_allow_it_still_see_it(self, client, admin_headers, hidden):
        _, headers = _new_player(client, admin_headers)
        body = client.get("/api/search", params={"q": hidden.word}, headers=headers).json()
        assert hidden.explicit.id in {r["id"] for r in body["results"]}
