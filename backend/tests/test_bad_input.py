"""Malformed requests answer with a 4xx, never a server error.

Each of these reached a 500 from a request anyone can send, signed in or not:
a value the 422 handler could not echo back (NaN, a value nested thousands
deep), text that is not valid Unicode, and a NUL in a path.
"""
import json

import pytest

from backend.unicode_guard import has_lone_surrogate, strip_nul

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


class TestStripNul:
    def test_drops_one_anywhere(self):
        body = b'{"a\\u0000": ["x\\u0000y", {"b": "\\u0000"}], "n": 1.5, "t": true, "z": null}'
        assert json.loads(strip_nul(body)) == {
            "a": ["xy", {"b": ""}], "n": 1.5, "t": True, "z": None,
        }

    def test_leaves_other_bodies_as_they_were(self):
        for body in (
            b'{"a": "plain"}',
            b'{"a": "\\u0000"',  # not JSON
        ):
            assert strip_nul(body) is body
        # An escaped backslash: the text is the six characters \u0000.
        escaped = json.dumps({"a": "\\u0000"}).encode()
        assert json.loads(strip_nul(escaped)) == {"a": "\\u0000"}


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
    asyncio.run(unicode_guard.JsonTextMiddleware(app)(scope, receive, send))
    return read, sent


def test_a_body_in_parts_is_checked_whole():
    read, sent = _run(
        [
            {"type": "http.request", "body": b'{"a": "\\ud8', "more_body": True},
            {"type": "http.request", "body": b'00"}', "more_body": False},
        ]
    )
    assert read == [] and sent[0]["status"] == 422


def test_a_body_in_parts_has_its_nuls_dropped():
    read, sent = _run(
        [
            {"type": "http.request", "body": b'{"a": "x\\u00', "more_body": True},
            {"type": "http.request", "body": b'00y"}', "more_body": False},
        ]
    )
    assert sent == []
    assert [json.loads(m["body"]) for m in read] == [{"a": "xy"}]


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


# --- Values a handler could not use -----------------------------------------


@pytest.fixture
def library_dir():
    """A fresh folder under books/, removed afterwards."""
    import os
    import shutil
    import uuid

    from backend.config import LIBRARY_PATH

    rel = f"books/BadInput-{uuid.uuid4().hex[:8]}/core"
    os.makedirs(os.path.join(LIBRARY_PATH, rel))
    yield rel
    shutil.rmtree(os.path.join(LIBRARY_PATH, rel.split("/core")[0]), ignore_errors=True)


def test_a_sheet_with_an_impossible_date_is_a_400(client, admin_headers):
    resp = client.post(
        "/api/characters/schemas", json={"text": "when: 2026-13-45"}, headers=admin_headers
    )
    assert resp.status_code == 400, resp.text


def test_an_empty_system_id_links_no_system(client, gm_headers):
    campaign = client.post("/api/campaigns", json={"name": "x", "system_id": ""}, headers=gm_headers)
    assert campaign.status_code == 201, campaign.text
    assert campaign.json()["system_id"] is None
    league = client.post("/api/leagues", json={"name": "x", "game_system_id": ""}, headers=gm_headers)
    assert league.status_code == 201, league.text
    assert league.json()["game_system_id"] is None
    resp = client.patch(
        f"/api/leagues/{league.json()['id']}", json={"game_system_id": ""}, headers=gm_headers
    )
    assert resp.status_code == 200, resp.text
    army = client.post(
        "/api/armies", json={"name": "x", "game_system_id": "", "faction_id": "", "units": []},
        headers=gm_headers,
    )
    assert army.status_code == 201, army.text


@pytest.mark.parametrize("url", ["/api/campaigns", "/api/leagues", "/api/armies"])
def test_a_blank_name_is_refused(client, gm_headers, url):
    resp = client.post(url, json={"name": "   ", "units": []}, headers=gm_headers)
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize("url", ["/api/campaigns", "/api/leagues", "/api/armies"])
def test_a_name_of_nothing_but_a_nul_is_refused(client, gm_headers, url):
    # PostgreSQL cannot store a NUL and dropped it after the blank check had passed.
    resp = client.post(url, json={"name": "\x00", "units": []}, headers=gm_headers)
    assert resp.status_code == 422, resp.text


def test_a_nul_is_dropped_before_validation(client, gm_headers):
    resp = client.post("/api/leagues", json={"name": "Spring\x00 Cup\x00"}, headers=gm_headers)
    assert resp.status_code == 201, resp.text
    assert resp.json()["name"] == "Spring Cup"


def test_tags_differing_by_a_nul_are_one_tag(client, gm_headers):
    from backend.tests.conftest import make_book, make_game_system

    book = make_book(system_id=make_game_system().id, title="Nul Tags")
    resp = client.patch(
        f"/api/books/{book.id}", json={"tags": ["abc", "ab\x00c"]}, headers=gm_headers
    )
    assert resp.status_code == 200, resp.text
    tags = client.get(f"/api/books/{book.id}", headers=gm_headers).json()["tags"]
    assert [t["name"] if isinstance(t, dict) else t for t in tags] == ["abc"]


def test_a_name_is_trimmed(client, gm_headers):
    resp = client.post("/api/leagues", json={"name": "  Spring Cup  "}, headers=gm_headers)
    assert resp.json()["name"] == "Spring Cup"
    resp = client.patch(f"/api/leagues/{resp.json()['id']}", json={"name": "  "}, headers=gm_headers)
    assert resp.status_code == 422


def test_a_list_field_sent_as_a_number_is_a_422(client, admin_headers):
    from .conftest import make_book, make_game_system

    system = make_game_system()
    book = make_book(system.id)
    cases = [
        ("patch", f"/api/books/{book.id}", {"genres": 1}),
        ("patch", f"/api/books/{book.id}", {"tags": "one"}),
        ("patch", f"/api/systems/{system.id}", {"tags": 1}),
        ("patch", f"/api/systems/{system.id}", {"genres": 1}),
        ("patch", f"/api/systems/{system.id}", {"dice_materials": 1}),
        ("post", "/api/systems/bulk", {"items": [{"id": system.id, "genres": 1}]}),
        ("post", "/api/books/bulk/tags", {"ids": [book.id], "tags": 1}),
    ]
    for method, url, body in cases:
        resp = getattr(client, method)(url, json=body, headers=admin_headers)
        assert resp.status_code == 422, (url, body, resp.text)


@pytest.mark.parametrize(
    "url", ["/api/genres", "/api/system-families", "/api/parent-systems", "/api/licenses", "/api/dice-materials"]
)
def test_a_lookup_name_past_the_column_is_a_422(client, admin_headers, url):
    resp = client.post(url, json={"name": "g" * 70000}, headers=admin_headers)
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize("level", [{"a": 1}, ["gm"], 5])
def test_a_category_level_that_is_not_a_level_is_a_400(client, admin_headers, level):
    resp = client.patch(
        "/api/settings", json={"restricted_categories": {"adventure": level}}, headers=admin_headers
    )
    assert resp.status_code == 400, resp.text


def test_an_upload_name_past_the_limit_is_a_400(client, admin_headers, library_dir):
    resp = client.post(
        "/api/files/upload",
        headers=admin_headers,
        data={"destination": library_dir},
        files={"file": ("x" * 600 + ".pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert resp.status_code == 400, resp.text


def test_an_upload_name_at_the_limit_is_kept(client, admin_headers, library_dir):
    name = "x" * 251 + ".pdf"  # 255 bytes: no room for the temporary ".part" name
    resp = client.post(
        "/api/files/upload",
        headers=admin_headers,
        data={"destination": library_dir},
        files={"file": (name, b"%PDF-1.4", "application/pdf")},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == name


def test_a_malformed_uvtt_reads_as_unreadable(tmp_path):
    import base64
    import struct
    import zlib

    from backend.services.media import maps

    deep = tmp_path / "deep.uvtt"
    deep.write_text("[" * 50000 + "]" * 50000)
    with pytest.raises(ValueError):
        maps.load_vtt(str(deep))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    # A PNG header claiming 60000 x 60000 pixels, with no real image behind it.
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 60000, 60000, 8, 2, 0, 0, 0))
        + chunk(b"IEND", b"")
    )
    bomb = tmp_path / "bomb.uvtt"
    bomb.write_text(json.dumps({"format": 0.3, "image": base64.b64encode(png).decode()}))
    assert maps.vtt_image_size(str(bomb)) == (None, None)
