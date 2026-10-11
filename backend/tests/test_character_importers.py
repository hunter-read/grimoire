"""URL import source matching and converter helpers."""

from pathlib import Path
from unittest.mock import patch

import pytest

from backend.services.characters import importers
from backend.services.characters.importers import dicecloud_v1, dndbeyond
from backend.services.characters import schema as schema_svc

FIXTURE = Path(__file__).parent / "fixtures" / "dicecloud_v1_sample.json"
DDB_FIXTURE = Path(__file__).parent / "fixtures" / "dndbeyond_sample.json"


def test_match_pattern_glob_and_prefix():
    url = "https://v1.dicecloud.com/character/AbCdEfGh"
    assert importers.match_pattern(url, "https://v1.dicecloud.com/character/*")
    assert importers.match_pattern(url, "https://v1.dicecloud.com/character/")
    assert not importers.match_pattern(url, "https://dicecloud.com/character/*")


def test_sources_from_schema_marks_registered_converters():
    sources = importers.sources_from_schema(
        {
            "import_sources": [
                {
                    "id": "dicecloud-v1",
                    "name": "DiceCloud v1",
                    "url_patterns": ["https://v1.dicecloud.com/character/*"],
                    "example_url": "https://v1.dicecloud.com/character/AbCdEfGh",
                },
                {
                    "id": "unknown-host",
                    "name": "Unknown",
                    "url_patterns": ["https://example.com/*"],
                },
            ]
        }
    )
    assert sources[0]["available"] is True
    assert sources[0]["example_url"].endswith("AbCdEfGh")
    assert sources[1]["available"] is False


def test_find_source_for_url():
    sources = [
        {
            "id": "dicecloud-v1",
            "url_patterns": ["https://v1.dicecloud.com/character/*"],
            "schema_id": "dnd-5e-2024",
            "available": True,
        }
    ]
    hit = importers.find_source_for_url(
        "https://v1.dicecloud.com/character/AbCdEfGh", sources
    )
    assert hit["id"] == "dicecloud-v1"
    assert importers.find_source_for_url("https://other.example/x", sources) is None


def test_validate_schema_accepts_import_sources():
    document = schema_svc.validate_schema(
        {
            "id": "demo-sheet",
            "name": "Demo",
            "version": "1.0.0",
            "fields": {"name": {"type": "text", "label": "Name"}},
            "import_sources": [
                {
                    "id": "dicecloud-v1",
                    "name": "DiceCloud v1",
                    "url_patterns": ["https://v1.dicecloud.com/character/*"],
                }
            ],
        }
    )
    assert document["import_sources"][0]["id"] == "dicecloud-v1"


def test_validate_schema_rejects_bad_import_source_id():
    with pytest.raises(schema_svc.SchemaError, match="valid 'id'"):
        schema_svc.validate_schema(
            {
                "id": "demo-sheet",
                "name": "Demo",
                "version": "1.0.0",
                "fields": {"name": {"type": "text", "label": "Name"}},
                "import_sources": [
                    {
                        "id": "DiceCloud V1",
                        "name": "DiceCloud",
                        "url_patterns": ["https://v1.dicecloud.com/character/*"],
                    }
                ],
            }
        )


def test_parse_character_id():
    assert (
        dicecloud_v1.parse_character_id("https://v1.dicecloud.com/character/AbCdEfGh")
        == "AbCdEfGh"
    )
    assert dicecloud_v1.parse_character_id("AbCdEfGh") == "AbCdEfGh"
    with pytest.raises(ValueError):
        dicecloud_v1.parse_character_id("not a url")


def test_import_from_url_public_without_api_key():
    import json

    dump = json.loads(FIXTURE.read_text())
    with patch(
        "backend.services.characters.importers.dicecloud_v1.fetch_via_public_ddp",
        return_value=dump,
    ) as public:
        payload = dicecloud_v1.import_from_url(
            "https://v1.dicecloud.com/character/AbCdEfGh",
            api_key="",
            schema_id="dnd-5e-2024",
        )
    public.assert_called_once_with("AbCdEfGh")
    assert payload["name"]


def test_dicecloud_fetch_via_api_key_http_error(monkeypatch):
    import urllib.error

    def boom(*a, **k):
        raise urllib.error.HTTPError(
            url="https://x", code=401, msg="nope", hdrs=None, fp=None
        )

    monkeypatch.setattr(
        "backend.services.characters.importers.dicecloud_v1.urllib.request.urlopen",
        boom,
    )
    with pytest.raises(ValueError, match="DiceCloud API returned 401"):
        dicecloud_v1.fetch_via_api_key("AbCdEfGh", "bad-key")


def _sockjs_a(ddp_obj: dict) -> str:
    import json

    return "a" + json.dumps([json.dumps(ddp_obj)])


def test_dicecloud_fetch_via_public_ddp_happy_path(monkeypatch):
    import json

    dump = json.loads(FIXTURE.read_text())
    char = dump["characters"][0]
    char_id = char.get("_id") or "AbCdEfGh"

    msgs = ["o", _sockjs_a({"msg": "connected"})]
    for col, rows in dump.items():
        if not isinstance(rows, list):
            continue
        for row in rows:
            rid = row.get("_id") or "x"
            fields = {k: v for k, v in row.items() if k != "_id"}
            msgs.append(
                _sockjs_a(
                    {
                        "msg": "added",
                        "collection": col,
                        "id": rid,
                        "fields": fields,
                    }
                )
            )
    msgs.append(_sockjs_a({"msg": "changed", "collection": "characters", "id": char_id, "fields": {"name": char.get("name")}}))
    msgs.append(_sockjs_a({"msg": "ready", "subs": ["char"]}))

    class _WS:
        def __init__(self):
            self._msgs = list(msgs)
            self._i = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def recv(self):
            if self._i >= len(self._msgs):
                raise TimeoutError("no more")
            msg = self._msgs[self._i]
            self._i += 1
            return msg

        async def send(self, data):
            return None

    monkeypatch.setattr("websockets.connect", lambda *a, **k: _WS())
    out = dicecloud_v1.fetch_via_public_ddp(char_id, timeout=5)
    assert out.get("characters")
    assert out["characters"][0].get("name") == char.get("name")


def test_dicecloud_fetch_via_public_ddp_errors(monkeypatch):
    class _WSNosub:
        def __init__(self):
            self._msgs = [
                "o",
                _sockjs_a({"msg": "connected"}),
                _sockjs_a(
                    {
                        "msg": "nosub",
                        "id": "char",
                        "error": {"reason": "private"},
                    }
                ),
            ]
            self._i = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def recv(self):
            msg = self._msgs[self._i]
            self._i += 1
            return msg

        async def send(self, data):
            return None

    monkeypatch.setattr("websockets.connect", lambda *a, **k: _WSNosub())
    with pytest.raises(ValueError, match="private"):
        dicecloud_v1.fetch_via_public_ddp("PrivateId", timeout=5)

    class _WSBadOpen:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def recv(self):
            return "h"

        async def send(self, data):
            return None

    monkeypatch.setattr("websockets.connect", lambda *a, **k: _WSBadOpen())
    with pytest.raises(ValueError, match="SockJS did not open"):
        dicecloud_v1.fetch_via_public_ddp("x", timeout=5)

    class _WSEmptyReady:
        def __init__(self):
            self._msgs = [
                "o",
                _sockjs_a({"msg": "connected"}),
                _sockjs_a({"msg": "ready", "subs": ["char"]}),
            ]
            self._i = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def recv(self):
            msg = self._msgs[self._i]
            self._i += 1
            return msg

        async def send(self, data):
            return None

    monkeypatch.setattr("websockets.connect", lambda *a, **k: _WSEmptyReady())
    with pytest.raises(ValueError, match="No character data"):
        dicecloud_v1.fetch_via_public_ddp("x", timeout=5)
def test_convert_sample_dump():
    import json

    payload = dicecloud_v1.convert(json.loads(FIXTURE.read_text()))
    assert payload["$schema"] == dicecloud_v1.EXPORT_SCHEMA
    assert payload["schema_id"] == "dnd-5e-2024"
    assert payload["name"]
    assert isinstance(payload["data"], dict)
    assert payload["data"].get("level")


def test_import_from_url_fetches_and_converts():
    import json

    dump = json.loads(FIXTURE.read_text())

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps(dump).encode("utf-8")

    with patch(
        "backend.services.characters.importers.dicecloud_v1.urllib.request.urlopen",
        return_value=_Resp(),
    ):
        payload = dicecloud_v1.import_from_url(
            "https://v1.dicecloud.com/character/AbCdEfGh",
            api_key="test-key",
            schema_id="dnd-5e-2024",
        )
    assert payload["name"] == dump["characters"][0].get("name") or payload["name"]


def test_convert_url_uses_registry(monkeypatch):
    called = {}

    def fake(url, *, api_key, schema_id):
        called["url"] = url
        called["api_key"] = api_key
        called["schema_id"] = schema_id
        return {
            "$schema": "grimoire://character/v1",
            "schema_id": schema_id,
            "name": "From URL",
            "data": {},
            "entries": {},
        }

    monkeypatch.setitem(importers._REGISTRY, "dicecloud-v1", fake)
    monkeypatch.delenv("DICECLOUD_API_KEY", raising=False)
    out = importers.convert_url(
        "https://v1.dicecloud.com/character/x",
        source_id="dicecloud-v1",
        schema_id="dnd-5e-2024",
        api_key="k",
    )
    assert out["name"] == "From URL"
    assert called["api_key"] == "k"
    assert called["schema_id"] == "dnd-5e-2024"


def test_looks_like_http_url():
    assert importers.looks_like_http_url("https://v1.dicecloud.com/character/x")
    assert not importers.looks_like_http_url("ftp://x")
    assert not importers.looks_like_http_url("not-a-url")


def test_registered_ids_includes_dicecloud():
    assert "dicecloud-v1" in importers.registered_ids()


def test_registered_ids_includes_dndbeyond():
    assert "dndbeyond" in importers.registered_ids()


def test_parse_dndbeyond_character_id():
    assert (
        dndbeyond.parse_character_id("https://www.dndbeyond.com/characters/93643159")
        == "93643159"
    )
    assert (
        dndbeyond.parse_character_id("https://dndbeyond.com/character/93643159")
        == "93643159"
    )
    assert dndbeyond.parse_character_id("93643159") == "93643159"
    with pytest.raises(ValueError):
        dndbeyond.parse_character_id("not a url")


def test_convert_dndbeyond_sample():
    import json

    payload = dndbeyond.convert(json.loads(DDB_FIXTURE.read_text()))
    assert payload["$schema"] == dndbeyond.EXPORT_SCHEMA
    assert payload["schema_id"] == "dnd-5e-2024"
    assert payload["name"] == "Turnip Allspice"
    data = payload["data"]
    assert data["level"] == 1
    assert data["strength"] == 13
    assert data["wisdom"] == 16  # 14 base + 2 racial
    assert data["charisma"] == 16  # 15 base + 1 racial
    assert data["hp_max"] == 10
    assert "Persuasion" in data["skill_profs"]
    assert "Performance" in data["skill_profs"]
    assert data["wisdom_save_prof"] is True
    assert data["charisma_save_prof"] is True
    assert payload.get("portrait_url")
    assert any(a["name"] == "Whip" for a in data.get("attacks") or [])


def test_import_dndbeyond_from_url_fetches(monkeypatch):
    import json

    dump = json.loads(DDB_FIXTURE.read_text())

    def fake_fetch(char_id):
        assert char_id == "93643159"
        return dump

    monkeypatch.setattr(dndbeyond, "fetch_character", fake_fetch)
    payload = dndbeyond.import_from_url(
        "https://www.dndbeyond.com/characters/93643159",
        schema_id="dnd-5e-2024",
    )
    assert payload["name"] == "Turnip Allspice"


def test_find_source_for_dndbeyond_url():
    sources = [
        {
            "id": "dndbeyond",
            "url_patterns": [
                "https://www.dndbeyond.com/characters/*",
                "https://dndbeyond.com/characters/*",
            ],
            "schema_id": "dnd-5e-2024",
            "available": True,
        }
    ]
    hit = importers.find_source_for_url(
        "https://www.dndbeyond.com/characters/93643159", sources
    )
    assert hit["id"] == "dndbeyond"


def test_dndbeyond_fetch_character_success(monkeypatch):
    import json

    dump = json.loads(DDB_FIXTURE.read_text())

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps(dump).encode("utf-8")

    monkeypatch.setattr(
        "backend.services.characters.importers.dndbeyond.urllib.request.urlopen",
        lambda *a, **k: _Resp(),
    )
    out = dndbeyond.fetch_character("93643159")
    assert out["name"] == "Turnip Allspice"


def test_dndbeyond_fetch_character_errors(monkeypatch):
    import json
    import urllib.error

    def raise_http(code):
        def _open(*a, **k):
            raise urllib.error.HTTPError(
                url="https://x", code=code, msg="err", hdrs=None, fp=None
            )

        return _open

    monkeypatch.setattr(
        "backend.services.characters.importers.dndbeyond.urllib.request.urlopen",
        raise_http(403),
    )
    with pytest.raises(ValueError, match="private"):
        dndbeyond.fetch_character("1")

    monkeypatch.setattr(
        "backend.services.characters.importers.dndbeyond.urllib.request.urlopen",
        raise_http(404),
    )
    with pytest.raises(ValueError, match="not found"):
        dndbeyond.fetch_character("1")

    monkeypatch.setattr(
        "backend.services.characters.importers.dndbeyond.urllib.request.urlopen",
        raise_http(500),
    )
    with pytest.raises(ValueError, match="returned 500"):
        dndbeyond.fetch_character("1")

    monkeypatch.setattr(
        "backend.services.characters.importers.dndbeyond.urllib.request.urlopen",
        lambda *a, **k: (_ for _ in ()).throw(
            urllib.error.URLError("dns fail")
        ),
    )
    with pytest.raises(ValueError, match="Could not reach"):
        dndbeyond.fetch_character("1")

    class _BadJson:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b"<html>nope</html>"

    monkeypatch.setattr(
        "backend.services.characters.importers.dndbeyond.urllib.request.urlopen",
        lambda *a, **k: _BadJson(),
    )
    with pytest.raises(ValueError, match="non-JSON"):
        dndbeyond.fetch_character("1")

    class _Empty:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps({"name": "no id"}).encode()

    monkeypatch.setattr(
        "backend.services.characters.importers.dndbeyond.urllib.request.urlopen",
        lambda *a, **k: _Empty(),
    )
    with pytest.raises(ValueError, match="not a character payload"):
        dndbeyond.fetch_character("1")


def test_dndbeyond_convert_edge_cases():
    import json

    data = json.loads(DDB_FIXTURE.read_text())
    data["overrideHitPoints"] = 42
    data["removedHitPoints"] = 5
    data["temporaryHitPoints"] = 3
    data["overrideStats"] = [{"id": 1, "value": 18}]
    data["bonusStats"] = [{"id": 2, "value": 2}]
    data["modifiers"]["feat"] = [
        {
            "type": "expertise",
            "subType": "persuasion",
            "friendlySubtypeName": "Persuasion",
        },
        {
            "type": "half-proficiency",
            "subType": "stealth",
            "friendlySubtypeName": "Stealth",
        },
        {"type": "bonus", "subType": "hit-points", "value": 2},
        {"type": "set", "subType": "innate-speed-walking", "value": 35},
        {"type": "language", "subType": "elvish", "friendlySubtypeName": "Elvish"},
    ]
    data["customItems"] = [{"name": "Lucky Coin", "quantity": 1, "description": "<b>shiny</b>"}]
    data["inventory"].append(
        {
            "quantity": 1,
            "equipped": True,
            "isAttuned": True,
            "definition": {
                "name": "Cloak of Protection",
                "filterType": "Wondrous item",
                "rarity": "Uncommon",
                "magic": True,
                "description": "<p>Bonus</p>",
            },
        }
    )
    data["classSpells"] = [
        {
            "spells": [
                {
                    "prepared": True,
                    "definition": {"name": "Bless", "level": 1},
                }
            ]
        }
    ]
    data["feats"] = [
        {"definition": {"name": "Alert", "snippet": "You can't be surprised."}}
    ]
    payload = dndbeyond.convert(data, schema_doc={"id": "dnd-5e-2024"})
    sheet = payload["data"]
    assert sheet["hp_max"] == 42
    assert sheet["hp_current"] == 37
    assert sheet["hp_temp"] == 3
    assert sheet["strength"] == 18
    assert sheet["dexterity"] == 14  # 12 base + 2 bonusStats
    assert "Persuasion" in sheet["skill_expertise"]
    assert "Stealth" in sheet["skill_half_profs"]
    assert sheet["speed"] == 35
    assert "Elvish" in sheet["languages"]
    assert any(i["name"] == "Lucky Coin" for i in sheet["equipment"])
    assert any(i["name"] == "Cloak of Protection" for i in sheet["magic_items"])
    assert any(s["name"] == "Bless" for s in sheet["spells"])
    assert any(f["name"] == "Alert" for f in sheet["feats"])
    assert payload["schema"]["id"] == "dnd-5e-2024"


def test_dndbeyond_strip_html_and_helpers():
    assert dndbeyond.strip_html("<p>Hi&nbsp;<b>there</b></p>") == "Hi there"
    assert dndbeyond.strip_html(None) == ""
    assert dndbeyond.ability_mod(18) == 4
    assert dndbeyond.ability_mod(9) == -1
    assert list(dndbeyond.iter_modifiers({"modifiers": "bad"})) == []
    assert list(dndbeyond.iter_modifiers({})) == []


def test_match_pattern_rejects_empty():
    assert not importers.match_pattern("", "https://x/*")
    assert not importers.match_pattern("https://x/y", "")


def test_sources_from_schema_skips_junk():
    assert importers.sources_from_schema({"import_sources": "nope"}) == []
    assert (
        importers.sources_from_schema(
            {
                "import_sources": [
                    "skip",
                    {"id": "", "name": "x", "url_patterns": ["https://x/*"]},
                    {"id": "ok", "name": "  ", "url_patterns": ["https://x/*"]},
                    {"id": "ok2", "name": "Ok", "url_patterns": []},
                    {"id": "ok3", "name": "Ok", "url_patterns": ["  "]},
                    {"id": "ok4", "name": "Ok", "url_patterns": ["https://x/*"]},
                ]
            }
        )
        == [
            {
                "id": "ok4",
                "name": "Ok",
                "url_patterns": ["https://x/*"],
                "available": False,
            }
        ]
    )


def test_convert_url_unknown_source():
    with pytest.raises(importers.ImportSourceError, match="No converter"):
        importers.convert_url(
            "https://example.com/x",
            source_id="missing",
            schema_id="demo",
        )


def test_convert_url_wraps_value_error(monkeypatch):
    def boom(url, *, api_key, schema_id):
        raise ValueError("nope")

    monkeypatch.setitem(importers._REGISTRY, "dicecloud-v1", boom)
    with pytest.raises(importers.ImportSourceError, match="nope"):
        importers.convert_url(
            "https://v1.dicecloud.com/character/x",
            source_id="dicecloud-v1",
            schema_id="demo",
            api_key="k",
        )


def test_convert_url_uses_env_api_key(monkeypatch):
    seen = {}

    def fake(url, *, api_key, schema_id):
        seen["api_key"] = api_key
        return {"schema_id": schema_id, "data": {}}

    monkeypatch.setitem(importers._REGISTRY, "dicecloud-v1", fake)
    monkeypatch.setenv("DICECLOUD_API_KEY", "from-env")
    importers.convert_url(
        "https://v1.dicecloud.com/character/x",
        source_id="dicecloud-v1",
        schema_id="demo",
    )
    assert seen["api_key"] == "from-env"


def test_convert_url_generic_converter(monkeypatch):
    def generic(url, *, schema_id):
        return {"schema_id": schema_id, "url": url, "data": {}}

    monkeypatch.setitem(importers._REGISTRY, "other-src", generic)
    out = importers.convert_url(
        "https://example.com/c",
        source_id="other-src",
        schema_id="demo",
    )
    assert out["url"] == "https://example.com/c"
