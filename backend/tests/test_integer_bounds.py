"""Whole numbers a request stores are bounded, so one past what the column
holds is a 422 rather than a database error. SQLite holds 64 bits and
PostgreSQL's INTEGER 32, so both 2**31 and 2**63 are refused.
"""
import pytest

from .conftest import make_book, make_game_system

TOO_BIG = [2**31, 2**63]


@pytest.fixture(scope="module")
def targets(client, admin_headers):
    system = make_game_system(game_type="wargame")
    book = make_book(system.id)
    army = client.post("/api/armies", json={"name": "Bounds", "units": []}, headers=admin_headers)
    league = client.post("/api/leagues", json={"name": "Bounds"}, headers=admin_headers)
    assert army.status_code == 201 and league.status_code == 201
    return {
        "system": system.id,
        "book": book.id,
        "army": army.json()["id"],
        "league": league.json()["id"],
    }


CASES = [
    ("post", lambda t: "/api/armies", lambda t, v: {"name": "a", "points_limit": v}),
    ("patch", lambda t: f"/api/armies/{t['army']}", lambda t, v: {"points_limit": v}),
    ("post", lambda t: "/api/leagues", lambda t, v: {"name": "l", "points_limit": v}),
    ("patch", lambda t: f"/api/leagues/{t['league']}", lambda t, v: {"points_limit": v}),
    ("patch", lambda t: f"/api/books/{t['book']}", lambda t, v: {"year": v}),
    ("post", lambda t: "/api/books/bulk", lambda t, v: {"items": [{"id": t["book"], "year": v}]}),
    ("patch", lambda t: f"/api/systems/{t['system']}", lambda t, v: {"year": v}),
    (
        "post",
        lambda t: "/api/systems/bulk",
        lambda t, v: {"items": [{"id": t["system"], "year": v}]},
    ),
    (
        "post",
        lambda t: "/api/bookmarks",
        lambda t, v: {"book_id": t["book"], "page_number": v},
    ),
]
IDS = [
    "army-create",
    "army-update",
    "league-create",
    "league-update",
    "book-year",
    "book-bulk-year",
    "system-year",
    "system-bulk-year",
    "bookmark-page",
]


@pytest.mark.parametrize("value", TOO_BIG)
@pytest.mark.parametrize("method,url,body", CASES, ids=IDS)
def test_a_number_past_the_column_is_a_422(
    client, admin_headers, targets, method, url, body, value
):
    resp = getattr(client, method)(url(targets), json=body(targets, value), headers=admin_headers)
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize("method,url,body", CASES, ids=IDS)
def test_an_ordinary_number_is_kept(client, admin_headers, targets, method, url, body):
    value = 2000
    resp = getattr(client, method)(url(targets), json=body(targets, value), headers=admin_headers)
    assert resp.status_code < 300, resp.text
