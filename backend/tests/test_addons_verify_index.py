"""Tests for index URL strict verification logic and API endpoint."""
from backend.addons.constants import DEFAULT_INDEX_URL, is_trusted_index_url, normalize_index_url


def test_normalize_index_url():
    assert normalize_index_url(" https://example.com/index.json/ ") == "https://example.com/index.json"
    assert normalize_index_url("") == ""
    assert normalize_index_url(None) == ""


def test_is_trusted_index_url_strict_matching():
    # Exact trusted matches
    assert is_trusted_index_url(DEFAULT_INDEX_URL) is True
    assert is_trusted_index_url("https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.yaml") is True

    # Normalized variations (trailing slashes or whitespace)
    assert is_trusted_index_url(f" {DEFAULT_INDEX_URL}/ ") is True

    # Partial substring / spoofed URLs must fail
    assert is_trusted_index_url("https://evil.com/grimoire-codex/community-add-ons/main/index.json") is False
    assert is_trusted_index_url("https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.json.malicious") is False
    assert is_trusted_index_url("https://raw.githubusercontent.com/grimoire-codex/community-add-ons/fake/index.json") is False
    assert is_trusted_index_url("") is False


def test_is_trusted_index_url_custom_trusted_list():
    custom_trusted = ["https://custom.repo/index.json"]
    assert is_trusted_index_url("https://custom.repo/index.json", trusted_urls=custom_trusted) is True
    assert is_trusted_index_url(DEFAULT_INDEX_URL, trusted_urls=custom_trusted) is False


def test_verify_index_endpoint(client, admin_headers, player_headers):
    # Verified default URL with admin_headers
    resp = client.get("/api/addons/verify-index", params={"url": DEFAULT_INDEX_URL}, headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["verified"] is True
    assert data["url"] == DEFAULT_INDEX_URL
    assert DEFAULT_INDEX_URL in data["trusted_index_urls"]

    # Verified default URL with non-admin player_headers
    resp_player = client.get("/api/addons/verify-index", params={"url": DEFAULT_INDEX_URL}, headers=player_headers)
    assert resp_player.status_code == 200
    assert resp_player.json()["verified"] is True

    # Unverified custom URL
    resp_custom = client.get("/api/addons/verify-index", params={"url": "https://custom.repo/index.json"}, headers=admin_headers)
    assert resp_custom.status_code == 200
    data_custom = resp_custom.json()
    assert data_custom["verified"] is False
    assert data_custom["url"] == "https://custom.repo/index.json"
