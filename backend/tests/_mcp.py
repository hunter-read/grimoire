"""Shared helpers for the MCP test modules (not collected: no test_ prefix).

/mcp is only registered when MCP_ENABLED is on, so the tests mount the router
on a bare app of their own instead of reloading backend.main. Keys are minted
through the shared session client, which runs the real /api/api-keys flow.
"""
import uuid
from contextlib import contextmanager

import fitz
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from backend.config import SessionLocal
from backend.routers import mcp as mcp_router
from backend.tests.conftest import make_book


@contextmanager
def mcp_test_client():
    app = FastAPI()
    app.include_router(mcp_router.router)
    with TestClient(app) as c:
        yield c


def make_key(client, headers, permissions):
    resp = client.post(
        "/api/api-keys",
        json={"name": f"mcp-{uuid.uuid4().hex[:6]}", "permissions": permissions},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["key"]


def allow_keys(client, admin_headers, user_id, allowed=True):
    resp = client.patch(
        f"/api/users/{user_id}", json={"api_keys_enabled": allowed}, headers=admin_headers
    )
    assert resp.status_code == 200, resp.text


def rpc(c, key, method, params=None, request_id=1, headers=None):
    body = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        body["params"] = params
    return c.post("/mcp", json=body, headers={"X-API-Key": key, **(headers or {})})


def result_of(c, key, method, params=None):
    resp = rpc(c, key, method, params)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "result" in body, body
    return body["result"]


def error_of(c, key, method, params=None):
    body = rpc(c, key, method, params).json()
    assert "error" in body, body
    return body["error"]


def call(c, key, name, arguments):
    return result_of(c, key, "tools/call", {"name": name, "arguments": arguments})


def call_text(c, key, name, arguments):
    """A tool call that must succeed, as its text."""
    res = call(c, key, name, arguments)
    assert res["isError"] is False, res
    return res["content"][0]["text"]


def call_error(c, key, name, arguments):
    """A tool call that must fail, as its message."""
    res = call(c, key, name, arguments)
    assert res["isError"] is True, res
    return res["content"][0]["text"]


def index_page(book_id, page, content):
    db = SessionLocal()
    try:
        db.execute(
            text("INSERT INTO book_search (book_id, page_number, content) VALUES (:b, :p, :c)"),
            {"b": book_id, "p": page, "c": content},
        )
        db.commit()
    finally:
        db.close()


def make_pdf_book(directory, system_id, pages, toc=None, **kwargs):
    """A real PDF on disk with ``pages`` of text, registered as a book."""
    path = directory / f"book-{uuid.uuid4().hex[:6]}.pdf"
    doc = fitz.open()
    for body in pages:
        doc.new_page().insert_textbox(fitz.Rect(50, 50, 550, 800), body, fontsize=12)
    if toc:
        doc.set_toc(toc)
    doc.save(str(path))
    doc.close()
    return make_book(
        system_id=system_id,
        filepath=str(path),
        filename=path.name,
        relative_path=path.name,
        mime_type="application/pdf",
        page_count=len(pages),
        **kwargs,
    )
