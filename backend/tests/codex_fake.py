"""A fake Grimoire Codex DB for the Codex tests (issue #35).

Grimoire Codex DB is faked with an ``httpx.MockTransport`` so every request Grimoire makes
is recorded and checked. The ``fake`` fixture sets ``GRIMOIRE_CODEX_DB_API_TOKEN``;
without it the integration is off and hidden.
"""
import json
from typing import Any, Callable

import httpx
import pytest

from backend import codex
from backend.codex import client as codex_client
from backend import config
from backend.config import SessionLocal
from backend.models import AppSetting

_RealClient = httpx.Client


class FakeCodex:
    """Records requests and answers them from ``routes``: (method, path) -> handler."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.routes: dict[tuple[str, str], Callable[[httpx.Request], httpx.Response]] = {}

    def on(self, method: str, path: str, status: int = 200, body: Any = None) -> None:
        self.routes[(method, path)] = lambda _req: httpx.Response(status, json=body)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        route = self.routes.get((request.method, request.url.path))
        if route is None:
            return httpx.Response(404, json={"error": "Not found"})
        return route(request)

    def last(self, path: str) -> httpx.Request:
        return [r for r in self.requests if r.url.path == path][-1]

    def body(self, path: str) -> dict:
        return json.loads(self.last(path).content)


@pytest.fixture(name="fake")
def fake_codex(monkeypatch):
    fake = FakeCodex()
    transport = httpx.MockTransport(fake.handler)
    monkeypatch.setattr(
        codex_client.httpx, "Client", lambda **kw: _RealClient(transport=transport, **kw)
    )
    monkeypatch.setattr(config, "CODEX_DB_ENV", dict.fromkeys(codex.settings.ENV_VARS))
    monkeypatch.setattr(config, "CODEX_DB_API_TOKEN", "cdx_tok")
    db = SessionLocal()
    codex.save(db, url="https://codex.test")
    db.commit()
    db.close()
    yield fake
    db = SessionLocal()
    db.query(AppSetting).filter(AppSetting.key.like("codex_%")).delete(synchronize_session=False)
    db.commit()
    db.close()


def _set(**kwargs) -> None:
    db = SessionLocal()
    codex.save(db, **kwargs)
    db.commit()
    db.close()


def _codex_id(model, row_id: str):
    db = SessionLocal()
    value = db.get(model, row_id).codex_id
    db.close()
    return value


def _link(model, row_id: str, codex_id: str) -> None:
    db = SessionLocal()
    db.get(model, row_id).codex_id = codex_id
    db.commit()
    db.close()
