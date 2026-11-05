"""List routes take an offset and limit within what the database can bind.

A value past the 64-bit integer SQLite binds would fail inside the query, so
each route bounds it and answers 422 instead.
"""
import pytest

from backend.routers._browse import MAX_MEDIA_LIMIT, MAX_OFFSET
from backend.routers._page_num import MAX_PAGE_NUM

from .conftest import make_book, make_game_system

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


PAGE_ROUTES = [
    "/api/books/b/page/{n}",
    "/api/books/b/page/{n}/tile?width=1024&col=0&row=0",
    "/api/books/b/page/{n}/text",
    "/api/books/b/page/{n}/words",
    "/api/books/b/page/{n}/size",
    "/api/books/b/page/{n}/shapes",
    "/api/maps/m/page/{n}",
    "/api/maps/m/page/{n}/size",
    "/api/maps/m/page/{n}/shapes",
]


@pytest.mark.parametrize("n", [0, -1, MAX_PAGE_NUM + 1, 2**63])
@pytest.mark.parametrize("route", PAGE_ROUTES)
def test_a_page_number_out_of_range_is_refused(client, player_headers, route, n):
    resp = client.get(route.format(n=n), headers=player_headers)
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize("route", PAGE_ROUTES)
def test_the_largest_page_number_reaches_the_route(client, player_headers, route):
    # Past validation, an unknown book or map is the route's own 404.
    resp = client.get(route.format(n=MAX_PAGE_NUM), headers=player_headers)
    assert resp.status_code == 404, resp.text


def test_a_huge_page_number_on_a_real_books_text_is_refused(client, player_headers):
    # The text route used to bind the number straight into its FTS lookup.
    book = make_book(make_game_system().id, mime_type="application/pdf")
    resp = client.get(f"/api/books/{book.id}/page/{2**63}/text", headers=player_headers)
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize("params", [
    {"offset": 2**63}, {"offset": MAX_OFFSET + 1}, {"offset": -1},
    {"limit": 0}, {"limit": -1}, {"limit": 201},
])
def test_duplicate_groups_refuse_out_of_range_paging(client, admin_headers, params):
    resp = client.get("/api/duplicates/groups", params=params, headers=admin_headers)
    assert resp.status_code == 422, resp.text


def test_the_largest_duplicate_groups_offset_is_an_empty_page(client, admin_headers):
    resp = client.get("/api/duplicates/groups", params={"offset": MAX_OFFSET}, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["groups"] == []
# SQLite reads a negative LIMIT as "no limit", so a negative value would lift
# the cap, and one past 64 bits would fail to bind.
LIMITED = [(path, {}) for path in LISTS] + [("/api/search", {"q": "dragon"})]


@pytest.mark.parametrize("limit", [0, -1, -(10**22)])
@pytest.mark.parametrize("path, params", LIMITED)
def test_a_limit_below_one_is_refused(client, player_headers, path, params, limit):
    resp = client.get(path, params={**params, "limit": limit}, headers=player_headers)
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize("path, params", LIMITED)
def test_a_limit_of_one_is_accepted(client, player_headers, path, params):
    resp = client.get(path, params={**params, "limit": 1}, headers=player_headers)
    assert resp.status_code == 200, resp.text
