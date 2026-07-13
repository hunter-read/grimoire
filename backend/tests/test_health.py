"""Tests for the unauthenticated /api/health probe used by the HEALTHCHECK."""
from unittest.mock import MagicMock

import backend.main as main


def test_health_ok_no_auth(client):
    """Health is reachable without a token and reports the DB as ok."""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["checks"]["database"] == "ok"


def test_health_reports_db_error(client, monkeypatch):
    """A failing DB check returns 503 and marks the app unhealthy."""

    def boom():
        session = MagicMock()
        session.execute.side_effect = RuntimeError("db down")
        return session

    monkeypatch.setattr(main, "SessionLocal", boom)
    resp = client.get("/api/health")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "unhealthy"
    assert body["checks"]["database"] == "error"


def test_health_checks_valkey_when_configured(client, monkeypatch):
    """When Valkey is configured, a successful ping is reported."""
    fake = MagicMock()
    fake.ping.return_value = True
    monkeypatch.setattr(main, "_valkey", fake)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["checks"]["valkey"] == "ok"
    fake.ping.assert_called_once()


def test_health_reports_valkey_error(client, monkeypatch):
    """A failing Valkey ping marks the app unhealthy with a 503."""
    fake = MagicMock()
    fake.ping.side_effect = RuntimeError("valkey down")
    monkeypatch.setattr(main, "_valkey", fake)
    resp = client.get("/api/health")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "unhealthy"
    assert body["checks"]["valkey"] == "error"
