"""URL import source matching and DiceCloud v1 helpers."""

from pathlib import Path
from unittest.mock import patch

import pytest

from backend.services.characters import importers
from backend.services.characters.importers import dicecloud_v1
from backend.services.characters import schema as schema_svc

FIXTURE = Path(__file__).parent / "fixtures" / "dicecloud_v1_sample.json"


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


def test_import_from_url_requires_api_key():
    with pytest.raises(ValueError, match="API key"):
        dicecloud_v1.import_from_url(
            "https://v1.dicecloud.com/character/AbCdEfGh", api_key=""
        )


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

    with patch("backend.services.characters.importers.dicecloud_v1.urllib.request.urlopen", return_value=_Resp()):
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
