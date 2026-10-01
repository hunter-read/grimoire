"""Tests for the optional CORS allowlist (issue #502)."""
import logging

import pytest
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

from backend.config import _read_cors_allowed_origins
from backend.main import app
from backend.security import cors_middleware_options, limiter

ORIGIN = "https://foundry.example.com"


@pytest.fixture
def cors_enabled(client):
    """Install the CORS middleware on the running app, as main.py does when
    CORS_ALLOWED_ORIGINS is set, and restore the original stack afterwards."""
    saved_user_middleware = list(app.user_middleware)
    saved_stack = app.middleware_stack
    app.user_middleware.insert(
        0, Middleware(CORSMiddleware, **cors_middleware_options([ORIGIN]))
    )
    app.middleware_stack = app.build_middleware_stack()
    try:
        yield
    finally:
        app.user_middleware[:] = saved_user_middleware
        app.middleware_stack = saved_stack


class TestReadCorsAllowedOrigins:
    def test_unset_is_off(self, monkeypatch):
        monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
        assert _read_cors_allowed_origins() == []

    def test_blank_is_off(self, monkeypatch):
        monkeypatch.setenv("CORS_ALLOWED_ORIGINS", " , ")
        assert _read_cors_allowed_origins() == []

    def test_comma_separated_list(self, monkeypatch):
        monkeypatch.setenv(
            "CORS_ALLOWED_ORIGINS",
            " https://foundry.example.com , http://localhost:30000",
        )
        assert _read_cors_allowed_origins() == [
            "https://foundry.example.com",
            "http://localhost:30000",
        ]

    def test_normalizes_trailing_slash_case_and_duplicates(self, monkeypatch):
        monkeypatch.setenv(
            "CORS_ALLOWED_ORIGINS",
            "HTTPS://Foundry.Example.com/,https://foundry.example.com",
        )
        assert _read_cors_allowed_origins() == ["https://foundry.example.com"]

    @pytest.mark.parametrize(
        "bad",
        [
            "*",
            "https://*.example.com",
            "foundry.example.com",
            "ftp://foundry.example.com",
            "https://foundry.example.com/game",
            "https://foundry.example.com?x=1",
            "https://user@foundry.example.com",
            "https://",
        ],
    )
    def test_non_origins_are_ignored_with_a_warning(self, monkeypatch, caplog, bad):
        monkeypatch.setenv("CORS_ALLOWED_ORIGINS", f"{bad},{ORIGIN}")
        with caplog.at_level(logging.WARNING, logger="grimoire"):
            assert _read_cors_allowed_origins() == [ORIGIN]
        assert "CORS_ALLOWED_ORIGINS" in caplog.text


class TestCorsOff:
    def test_no_cors_headers_by_default(self, client):
        resp = client.get("/api/auth/status", headers={"Origin": ORIGIN})
        assert "access-control-allow-origin" not in resp.headers


class TestCorsEnabled:
    def test_preflight_answered_before_auth(self, client, cors_enabled):
        resp = client.options(
            "/api/books",
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "x-api-key",
            },
        )
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == ORIGIN
        allowed = resp.headers["access-control-allow-headers"].lower()
        for header in ("authorization", "content-type", "x-api-key"):
            assert header in allowed
        assert "DELETE" in resp.headers["access-control-allow-methods"]
        assert "access-control-allow-credentials" not in resp.headers

    def test_preflight_from_other_origin_refused(self, client, cors_enabled):
        resp = client.options(
            "/api/books",
            headers={
                "Origin": "https://evil.example.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert resp.status_code == 400
        assert "access-control-allow-origin" not in resp.headers

    def test_api_key_request_gets_headers(self, client, admin_headers, cors_enabled):
        key = client.post(
            "/api/api-keys",
            json={"name": "foundry", "permissions": {"stats": "read"}},
            headers=admin_headers,
        ).json()["key"]
        resp = client.get("/api/stats", headers={"Origin": ORIGIN, "X-API-Key": key})
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == ORIGIN
        assert resp.headers["access-control-expose-headers"] == "X-Token-Expired"
        assert "access-control-allow-credentials" not in resp.headers

    def test_other_origin_gets_no_headers(self, client, cors_enabled):
        resp = client.get("/api/auth/status", headers={"Origin": "https://evil.example.com"})
        assert "access-control-allow-origin" not in resp.headers

    def test_error_responses_carry_headers(self, client, admin_headers, cors_enabled):
        # 401: no credentials.
        resp = client.get("/api/books", headers={"Origin": ORIGIN})
        assert resp.status_code == 401
        assert resp.headers["access-control-allow-origin"] == ORIGIN
        # 403: a key without the books permission.
        key = client.post(
            "/api/api-keys",
            json={"name": "stats-only", "permissions": {"stats": "read"}},
            headers=admin_headers,
        ).json()["key"]
        resp = client.get("/api/books", headers={"Origin": ORIGIN, "X-API-Key": key})
        assert resp.status_code == 403
        assert resp.headers["access-control-allow-origin"] == ORIGIN

    def test_rate_limited_response_carries_headers(self, client, cors_enabled):
        limiter.reset()
        limiter.enabled = True
        try:
            headers = {
                "Origin": ORIGIN,
                "X-Forwarded-For": "203.0.113.60",
                "X-API-Key": "wrong",
            }
            for _ in range(30):
                resp = client.get("/api/stats", headers=headers)
                if resp.status_code == 429:
                    break
            assert resp.status_code == 429
            assert resp.headers["access-control-allow-origin"] == ORIGIN
        finally:
            limiter.enabled = False
            limiter.reset()

    def test_security_headers_still_applied(self, client, cors_enabled):
        resp = client.get("/api/auth/status", headers={"Origin": ORIGIN})
        assert resp.headers["X-Content-Type-Options"] == "nosniff"
        assert resp.headers["access-control-allow-origin"] == ORIGIN
