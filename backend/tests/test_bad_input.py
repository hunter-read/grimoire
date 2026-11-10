"""Malformed requests answer with a 4xx, never a server error.

Each of these reached a 500 from a request anyone can send, signed in or not:
a value the 422 handler could not echo back (NaN, a value nested thousands
deep), text that is not valid Unicode, and a NUL in a path.
"""
import json

import pytest

from backend.unicode_guard import has_lone_surrogate

JSON = {"Content-Type": "application/json"}
DEEP = '{"a":' * 5000 + "1" + "}" * 5000


@pytest.mark.parametrize(
    "url,body",
    [
        ("/api/auth/login", '{"username": NaN, "password": "x"}'),
        ("/api/auth/login", '{"username": "x", "password": Infinity}'),
        ("/api/auth/login", '{"username": "\\ud800", "password": "x"}'),
        ("/api/auth/login", '{"username": "x", "password": "a\\udfffb"}'),
        ("/api/auth/login", '{"username": "x", "password": "x", "\\ud800": 1}'),
    ],
    ids=["nan", "infinity", "surrogate-username", "surrogate-password", "surrogate-key"],
)
def test_a_malformed_body_is_a_422(client, url, body):
    resp = client.post(url, content=body, headers=JSON)
    assert resp.status_code == 422, resp.text
    assert all("loc" in error and "msg" in error for error in resp.json()["detail"])


@pytest.mark.parametrize(
    "url,body",
    [
        ("/api/auth/login", '{"username": ' + DEEP + ', "password": "x"}'),
        ("/api/share/no-such-token/unlock", '{"password": ' + DEEP + "}"),
    ],
    ids=["login", "share-unlock"],
)
def test_a_deeply_nested_body_is_a_client_error(client, url, body):
    # Refused by the JSON parser (400) or by validation (422), by Python version.
    resp = client.post(url, content=body, headers=JSON)
    assert resp.status_code in (400, 422)


def test_a_deeply_nested_value_is_not_echoed():
    # The 422 handler's own fallback, for a parser that reads the nesting.
    import asyncio

    from fastapi.exceptions import RequestValidationError

    from backend.validation_errors import request_validation_handler

    deep: dict = {}
    node = deep
    for _ in range(5000):
        node["a"] = {}
        node = node["a"]
    error = {"type": "string_type", "loc": ["body", "username"], "msg": "bad", "input": deep}
    nan = {"type": "string_type", "loc": ["body", "password"], "msg": "bad", "input": float("nan")}
    resp = asyncio.run(request_validation_handler(None, RequestValidationError([error, nan])))  # type: ignore[arg-type]
    assert resp.status_code == 422
    detail = json.loads(bytes(resp.body))["detail"]
    assert [e["loc"] for e in detail] == [["body", "username"], ["body", "password"]]
    assert all("input" not in e for e in detail)


def test_a_value_that_can_be_written_is_still_echoed(client):
    resp = client.post("/api/auth/login", content='{"username": 5, "password": "x"}', headers=JSON)
    assert resp.status_code == 422
    assert resp.json()["detail"][0]["input"] == 5


def test_a_surrogate_pair_is_ordinary_text(client):
    # An emoji written as an escaped pair is valid Unicode: the sign-in just fails.
    body = '{"username": "\\ud83d\\ude00", "password": "not-the-password"}'
    resp = client.post("/api/auth/login", content=body, headers=JSON)
    assert resp.status_code == 401, resp.text


@pytest.mark.parametrize("path", ["/a%00b", "/api/opds/a%00b/"])
def test_a_nul_in_a_path_is_not_found(client, path):
    resp = client.get(path)
    assert 400 <= resp.status_code < 500, resp.text


class TestHasLoneSurrogate:
    def test_finds_one_anywhere(self):
        assert has_lone_surrogate(b'{"a": ["x", {"b": "\\ud800"}]}')
        assert has_lone_surrogate(b'{"\\udc00": 1}')

    def test_passes_valid_text_and_non_json(self):
        assert not has_lone_surrogate(b'{"a": "plain"}')
        assert not has_lone_surrogate(b'{"a": "\\ud83d\\ude00"}')
        # An escaped backslash: the text is the six characters \ud800.
        assert not has_lone_surrogate(json.dumps({"a": "\\ud800"}).encode())
        assert not has_lone_surrogate(b'{"a": "\\ud800"')


def test_form_data_is_passed_on_unread(client):
    # Form data is never JSON-parsed, so it is not refused here.
    resp = client.post("/api/auth/login", data={"username": "x", "password": "x"})
    assert resp.status_code == 422
    assert resp.json()["detail"][0]["type"] != "unicode_error"


def _run(messages, monkeypatch=None, limit=None):
    """Drive the middleware over ``messages``: (what the app read, what was sent)."""
    import asyncio

    from backend import unicode_guard

    if limit is not None:
        monkeypatch.setattr(unicode_guard, "MAX_CHECKED_BYTES", limit)
    queue = list(messages)
    read: list = []
    sent: list = []

    async def app(scope, receive, send):
        while True:
            message = await receive()
            read.append(message)
            if message["type"] != "http.request" or not message.get("more_body"):
                break

    async def receive():
        return queue.pop(0)

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "POST", "headers": [(b"content-type", b"application/json")]}
    asyncio.run(unicode_guard.LoneSurrogateMiddleware(app)(scope, receive, send))
    return read, sent


def test_a_body_in_parts_is_checked_whole():
    read, sent = _run(
        [
            {"type": "http.request", "body": b'{"a": "\\ud8', "more_body": True},
            {"type": "http.request", "body": b'00"}', "more_body": False},
        ]
    )
    assert read == [] and sent[0]["status"] == 422


def test_a_body_too_large_to_check_is_passed_on_whole(monkeypatch):
    parts = [
        {"type": "http.request", "body": b'{"a": "\\ud800",', "more_body": True},
        {"type": "http.request", "body": b' "b": 1', "more_body": True},
        {"type": "http.request", "body": b"}", "more_body": False},
    ]
    read, sent = _run(parts, monkeypatch, limit=8)
    assert read == parts and sent == []


def test_a_client_that_goes_away_is_passed_on():
    parts = [
        {"type": "http.request", "body": b'{"a": "\\ud800"', "more_body": True},
        {"type": "http.disconnect"},
    ]
    read, sent = _run(parts)
    assert read == parts and sent == []
