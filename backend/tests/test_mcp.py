"""The MCP server at /mcp: JSON-RPC protocol, transport and API-key auth.

Tools are tested in test_mcp_tools.py, resources and prompts in
test_mcp_resources_prompts.py.
"""
import dataclasses
import uuid

import pytest
from fastapi import HTTPException

from backend import api_keys
from backend.mcp_server import errors, server, tools
from backend.tests._mcp import index_page, make_key, mcp_test_client, rpc
from backend.tests.conftest import make_book, make_game_system

WORD = "zorbulax"


@pytest.fixture(scope="module")
def mcp_client():
    with mcp_test_client() as c:
        yield c


@pytest.fixture(scope="module")
def search_key(client, admin_headers):
    return make_key(client, admin_headers, {"search": "read"})


@pytest.fixture(scope="module")
def stats_key(client, admin_headers):
    """A valid key with nothing MCP can use."""
    return make_key(client, admin_headers, {"stats": "read"})


@pytest.fixture(scope="module")
def indexed_book():
    system = make_game_system(name=f"Mcp System {uuid.uuid4().hex[:4]}")
    book = make_book(system_id=system.id, title=f"The {WORD.title()} Codex", indexed=True)
    index_page(book.id, 7, f"the {WORD} breathes fire & <smoke> on intruders")
    return book


def _rpc(c, key, method, params=None, request_id=1, headers=None):
    return rpc(c, key, method, params, request_id, headers)


def _call(c, key, name, arguments):
    resp = _rpc(c, key, "tools/call", {"name": name, "arguments": arguments})
    assert resp.status_code == 200, resp.text
    return resp.json()["result"]


# ---------------------------------------------------------------------------
# Handshake
# ---------------------------------------------------------------------------


class TestHandshake:
    def test_initialize_echoes_a_supported_version(self, mcp_client, search_key):
        resp = _rpc(
            mcp_client,
            search_key,
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "t", "version": "1"},
            },
        )
        assert resp.status_code == 200
        result = resp.json()["result"]
        assert resp.json()["id"] == 1
        assert result["protocolVersion"] == "2025-06-18"
        assert set(result["capabilities"]) - {"experimental"} == {
            "tools",
            "resources",
            "prompts",
            "completions",
        }
        assert result["capabilities"]["resources"]["subscribe"] is False
        assert result["serverInfo"]["name"] == "grimoire"
        assert "TTRPG" in result["instructions"] or "tabletop" in result["instructions"]

    def test_initialize_counter_offers_latest_for_unknown_version(self, mcp_client, search_key):
        from mcp.types import LATEST_PROTOCOL_VERSION

        params = {
            "protocolVersion": "1999-01-01",
            "capabilities": {},
            "clientInfo": {"name": "t", "version": "1"},
        }
        result = _rpc(mcp_client, search_key, "initialize", params)
        assert result.json()["result"]["protocolVersion"] == LATEST_PROTOCOL_VERSION

    def test_initialize_needs_client_info(self, mcp_client, search_key):
        error = _rpc(mcp_client, search_key, "initialize", {"protocolVersion": "2025-06-18"})
        assert error.json()["error"]["code"] == errors.INVALID_PARAMS

    def test_notification_gets_202_and_no_body(self, mcp_client, search_key):
        resp = mcp_client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
            headers={"X-API-Key": search_key},
        )
        assert resp.status_code == 202
        assert resp.content == b""

    def test_client_response_is_accepted_and_ignored(self, mcp_client, search_key):
        resp = mcp_client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 9, "result": {}},
            headers={"X-API-Key": search_key},
        )
        assert resp.status_code == 202

    def test_ping(self, mcp_client, search_key):
        assert _rpc(mcp_client, search_key, "ping", request_id="p").json() == {
            "jsonrpc": "2.0",
            "id": "p",
            "result": {},
        }


# ---------------------------------------------------------------------------
# Malformed messages
# ---------------------------------------------------------------------------


class TestProtocolErrors:
    """Malformed calls are refused by the SDK. These pin that they are refused,
    not the SDK's exact wording or codes, which it owns."""

    def test_unknown_method(self, mcp_client, search_key):
        body = _rpc(mcp_client, search_key, "sampling/createMessage").json()
        assert "result" not in body and body["error"]["code"] < 0

    def test_body_that_is_not_json(self, mcp_client, search_key):
        resp = mcp_client.post(
            "/mcp",
            content=b"{nope",
            headers={"X-API-Key": search_key, "Content-Type": "application/json"},
        )
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == errors.PARSE_ERROR

    @pytest.mark.parametrize(
        "body",
        [
            [{"jsonrpc": "2.0", "id": 1, "method": "ping"}],  # batches are not supported
            {"jsonrpc": "1.0", "id": 1, "method": "ping"},
            {"jsonrpc": "2.0", "id": 3, "method": 5},
        ],
    )
    def test_invalid_message_is_a_400(self, mcp_client, search_key, body):
        resp = mcp_client.post("/mcp", json=body, headers={"X-API-Key": search_key})
        assert resp.status_code == 400
        assert "result" not in resp.json() and resp.json()["error"]["code"] < 0

    @pytest.mark.parametrize("request_id", [True, None])
    def test_a_message_without_a_usable_id_gets_no_answer(
        self, mcp_client, search_key, request_id
    ):
        """Without an id there is nothing to answer to: it is taken as a notification."""
        resp = mcp_client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": request_id, "method": "ping"},
            headers={"X-API-Key": search_key},
        )
        assert resp.status_code == 202

    def test_params_must_be_an_object(self, mcp_client, search_key):
        error = _rpc(mcp_client, search_key, "tools/list", params=[1]).json()["error"]
        assert error["code"] == errors.INVALID_PARAMS

    def test_tools_call_needs_a_name(self, mcp_client, search_key):
        error = _rpc(mcp_client, search_key, "tools/call", {"arguments": {}}).json()["error"]
        assert error["code"] == errors.INVALID_PARAMS

    def test_unknown_tool_is_a_protocol_error(self, mcp_client, search_key):
        error = _rpc(mcp_client, search_key, "tools/call", {"name": "nope"}).json()["error"]
        assert error["code"] == errors.INVALID_PARAMS
        assert "nope" in error["message"]

    def test_unsupported_protocol_version_header(self, mcp_client, search_key):
        resp = _rpc(
            mcp_client, search_key, "ping", headers={"MCP-Protocol-Version": "2020-01-01"}
        )
        assert resp.status_code == 400

    def test_supported_protocol_version_header(self, mcp_client, search_key):
        resp = _rpc(
            mcp_client, search_key, "ping", headers={"MCP-Protocol-Version": "2025-11-25"}
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Transport and auth
# ---------------------------------------------------------------------------


class TestTransport:
    @pytest.mark.parametrize("method", ["GET", "DELETE"])
    def test_stream_and_session_methods_are_405(self, mcp_client, method):
        resp = mcp_client.request(method, "/mcp")
        assert resp.status_code == 405
        assert resp.headers["allow"] == "POST"

    def test_no_key_is_401(self, mcp_client):
        resp = mcp_client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
        assert resp.status_code == 401

    def test_unknown_key_is_401(self, mcp_client):
        assert _rpc(mcp_client, "grim_not-a-real-key", "ping").status_code == 401

    def test_keys_off_refuses_every_key(self, mcp_client, search_key, monkeypatch):
        from backend import config

        monkeypatch.setattr(config, "API_KEYS_ENABLED", False)
        assert _rpc(mcp_client, search_key, "ping").status_code == 403

    def test_cross_origin_browser_request_is_refused(self, mcp_client, search_key):
        resp = _rpc(mcp_client, search_key, "ping", headers={"Origin": "https://evil.example"})
        assert resp.status_code == 403

    def test_same_origin_request_is_allowed(self, mcp_client, search_key):
        resp = _rpc(mcp_client, search_key, "ping", headers={"Origin": "http://testserver"})
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


class TestToolsList:
    def test_lists_search_with_its_schema(self, mcp_client, search_key):
        listed = _rpc(mcp_client, search_key, "tools/list").json()["result"]["tools"]
        search = next(t for t in listed if t["name"] == "search_library")
        assert search["inputSchema"]["type"] == "object"
        assert search["inputSchema"]["required"] == ["query"]
        assert "book_id" in search["inputSchema"]["properties"]
        assert search["annotations"]["readOnlyHint"] is True

    def test_hides_tools_the_key_cannot_call(self, mcp_client, stats_key):
        assert _rpc(mcp_client, stats_key, "tools/list").json()["result"]["tools"] == []

    def test_all_permissions_floor_counts(self, client, admin_headers, mcp_client):
        key = make_key(client, admin_headers, {"*": "read"})
        names = [t["name"] for t in _rpc(mcp_client, key, "tools/list").json()["result"]["tools"]]
        assert "search_library" in names


class TestSearchLibrary:
    def test_finds_page_and_title_matches(self, mcp_client, search_key, indexed_book):
        result = _call(mcp_client, search_key, "search_library", {"query": WORD})
        assert result["isError"] is False
        body = result["content"][0]["text"]
        assert result["content"][0]["type"] == "text"
        assert f"[book_id: {indexed_book.id}]" in body
        assert "page 7" in body
        # Snippet HTML becomes plain text: highlights in bold, entities unescaped.
        assert f"**{WORD}**" in body
        assert "<smoke>" in body and "<mark>" not in body
        assert "Books whose title or metadata match" in body

    def test_scoped_to_one_book(self, mcp_client, search_key, indexed_book):
        body = _call(
            mcp_client, search_key, "search_library", {"query": WORD, "book_id": indexed_book.id}
        )["content"][0]["text"]
        assert "page 7" in body
        assert "Books whose title" not in body

    def test_no_results_suggests_what_to_try(self, mcp_client, search_key):
        result = _call(mcp_client, search_key, "search_library", {"query": "qqxyzzynothing"})
        assert result["isError"] is False
        assert "No books or pages matched" in result["content"][0]["text"]

    def test_bad_arguments_are_a_tool_error_the_model_can_fix(self, mcp_client, search_key):
        result = _call(mcp_client, search_key, "search_library", {"query": "x", "limit": 500})
        assert result["isError"] is True
        text_ = result["content"][0]["text"]
        assert "query" in text_ and "limit" in text_

    def test_key_without_permission_gets_a_tool_error(self, mcp_client, stats_key):
        result = _call(mcp_client, stats_key, "search_library", {"query": WORD})
        assert result["isError"] is True
        assert "'search'" in result["content"][0]["text"]


class TestToolFailures:
    @pytest.fixture
    def failing(self, monkeypatch):
        def install(exc):
            def run(args, ctx):
                raise exc

            broken = dataclasses.replace(tools.TOOLS["search_library"], run=run)
            monkeypatch.setitem(tools.TOOLS, "search_library", broken)

        return install

    def test_http_errors_become_their_message(self, mcp_client, search_key, failing):
        failing(HTTPException(404, "Book not found"))
        result = _call(mcp_client, search_key, "search_library", {"query": WORD})
        assert result == {
            "content": [{"type": "text", "text": "Book not found"}],
            "isError": True,
        }

    def test_unexpected_errors_are_hidden(self, mcp_client, search_key, failing):
        failing(RuntimeError("secret internals"))
        result = _call(mcp_client, search_key, "search_library", {"query": WORD})
        assert result["isError"] is True
        assert "secret" not in result["content"][0]["text"]


class TestInternalErrors:
    def test_unexpected_failure_outside_a_tool(self, mcp_client, search_key, monkeypatch):
        def boom(ctx):
            raise RuntimeError("secret internals")

        monkeypatch.setattr(server, "list_tools", boom)
        error = _rpc(mcp_client, search_key, "tools/list").json()["error"]
        assert error["code"] == errors.INTERNAL_ERROR
        assert error["message"] == "Internal error"
        assert "secret" not in str(error)


class TestHasLevel:
    def test_levels(self):
        assert api_keys.has_level({"search": "write"}, "search", "read")
        assert not api_keys.has_level({"search": "read"}, "search", "write")
        assert api_keys.has_level({"*": "read"}, "books", "read")
        assert not api_keys.has_level(None, "books", "read")


class TestUISettingsFlag:
    def test_off_by_default_and_exposed_to_the_ui(self, client, player_headers):
        assert client.get("/api/settings/ui", headers=player_headers).json()["mcp_enabled"] is False

    def test_follows_the_env_switch(self, client, player_headers, monkeypatch):
        from backend import config

        monkeypatch.setattr(config, "MCP_ENABLED", True)
        assert client.get("/api/settings/ui", headers=player_headers).json()["mcp_enabled"] is True


# ---------------------------------------------------------------------------
# The SDK underneath
# ---------------------------------------------------------------------------


class TestAcceptHeader:
    """The SDK requires Accept: application/json; Grimoire's endpoint never did."""

    @pytest.mark.parametrize("accept", ["*/*", "application/json, text/event-stream", None])
    def test_json_or_wildcard_is_answered(self, mcp_client, search_key, accept):
        headers = {"Accept": accept} if accept else {}
        resp = _rpc(mcp_client, search_key, "ping", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["result"] == {}

    def test_a_client_that_refuses_json_is_406(self, mcp_client, search_key):
        resp = _rpc(mcp_client, search_key, "ping", headers={"Accept": "text/html"})
        assert resp.status_code == 406


def test_sdk_is_not_loaded_unless_mcp_is_enabled(tmp_path):
    """MCP off (the default) must not cost every server the SDK's memory."""
    import os
    import subprocess
    import sys

    env = {
        **os.environ,
        "DATA_PATH": str(tmp_path),
        "LIBRARY_PATH": str(tmp_path),
        "DISABLE_VERSION_CHECKING": "true",
    }
    env.pop("MCP_ENABLED", None)
    probe = "import sys, backend.main; print('mcp' in sys.modules)"
    out = subprocess.run(
        [sys.executable, "-c", probe], env=env, capture_output=True, text=True, check=True
    )
    assert out.stdout.strip().splitlines()[-1] == "False"


def test_the_sdk_client_connects_over_http(search_key, indexed_book):
    """End to end with the SDK's own client over a real socket, as Claude Code connects."""
    import asyncio
    import socket
    import threading
    import time

    import httpx
    import uvicorn
    from fastapi import FastAPI
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    from backend.routers import mcp as mcp_router

    app = FastAPI()
    app.include_router(mcp_router.router)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    uv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=uv.run, daemon=True)
    thread.start()
    for _ in range(100):
        if uv.started:
            break
        time.sleep(0.05)

    async def session_flow():
        async with httpx.AsyncClient(headers={"X-API-Key": search_key}) as http:
            async with streamable_http_client(f"http://127.0.0.1:{port}/mcp", http_client=http) as (
                read,
                write,
                _,
            ):
                async with ClientSession(read, write) as session:
                    init = await session.initialize()
                    listed = await session.list_tools()
                    found = await session.call_tool("search_library", {"query": WORD})
                    return init, listed, found

    try:
        init, listed, found = asyncio.run(session_flow())
    finally:
        uv.should_exit = True
        thread.join(timeout=10)
    assert init.serverInfo.name == "grimoire"
    assert "search_library" in {t.name for t in listed.tools}
    assert found.isError is False
    assert WORD in found.content[0].text


class TestHostAllowList:
    """A DNS-rebinding page controls the Host its requests carry, so Host itself
    is checked, not only that Origin agrees with it."""

    def test_rebound_host_is_refused(self, mcp_client, search_key):
        resp = _rpc(
            mcp_client, search_key, "ping",
            headers={"Host": "evil.example", "Origin": "http://evil.example"},
        )
        assert resp.status_code == 403
        assert "MCP_ALLOWED_HOSTS" in resp.json()["detail"]

    def test_patterns(self, monkeypatch):
        from backend import config
        from backend.routers.mcp.core import allowed_hosts, host_allowed

        monkeypatch.setattr(config, "BASE_URL", "https://grimoire.example.com")
        monkeypatch.setattr(config, "MCP_ALLOWED_HOSTS", ["nas.lan:9481", "10.0.0.5"])
        patterns = allowed_hosts()
        for ok in ("localhost:9481", "127.0.0.1:1", "[::1]:9481", "grimoire.example.com",
                   "nas.lan:9481", "10.0.0.5", "10.0.0.5:9481"):
            assert host_allowed(ok, patterns), ok
        for bad in ("evil.example", "nas.lan:80", "grimoire.example.com.evil.example",
                    "localhost.evil.example", "", None):
            assert not host_allowed(bad, patterns), bad

    def test_the_sdk_check_is_on_with_the_same_list(self):
        from backend.mcp_server.server import build_session_manager
        from backend.routers.mcp.core import allowed_hosts

        settings = build_session_manager().security_settings
        assert settings.enable_dns_rebinding_protection is True
        assert settings.allowed_hosts == allowed_hosts()
