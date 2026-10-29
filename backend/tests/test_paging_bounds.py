"""List routes take an offset and limit within what the database can bind.

A value past the 64-bit integer SQLite binds would fail inside the query, so
each route bounds it and answers 422 instead.
"""
import pytest

from backend.routers._browse import MAX_MEDIA_LIMIT, MAX_OFFSET

from .conftest import make_game_system

HUGE = 10**20

LISTS = ["/api/books", "/api/maps", "/api/tokens", "/api/audio", "/api/models"]
MEDIA = ["/api/maps", "/api/tokens", "/api/audio", "/api/models"]


@pytest.fixture(scope="module")
def system_books():
    return f"/api/systems/{make_game_system().id}/books"


@pytest.mark.parametrize("path", LISTS)
def test_a_huge_offset_is_refused(client, player_headers, path):
    assert client.get(path, params={"offset": HUGE}, headers=player_headers).status_code == 422
    assert client.get(path, params={"offset": -1}, headers=player_headers).status_code == 422


@pytest.mark.parametrize("path", LISTS)
def test_the_largest_offset_is_an_empty_page(client, player_headers, path):
    resp = client.get(path, params={"offset": MAX_OFFSET}, headers=player_headers)
    assert resp.status_code == 200, resp.text


def test_a_systems_shelf_refuses_a_huge_offset(client, player_headers, system_books):
    assert client.get(
        system_books, params={"offset": HUGE}, headers=player_headers
    ).status_code == 422
    assert client.get(
        system_books, params={"offset": MAX_OFFSET}, headers=player_headers
    ).status_code == 200


@pytest.mark.parametrize("path", MEDIA)
def test_a_huge_media_limit_is_refused(client, player_headers, path):
    assert client.get(path, params={"limit": HUGE}, headers=player_headers).status_code == 422
    assert client.get(
        path, params={"limit": MAX_MEDIA_LIMIT}, headers=player_headers
    ).status_code == 200
