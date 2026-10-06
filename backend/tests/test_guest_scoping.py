"""Guest accounts see only what their campaign shares with them (issue #519).

A guest is a code-only account scoped to the one campaign they were invited to.
Library-wide surfaces (tags, archives, stats, lookups, system folders) refuse
them outright; by-id reads and campaign reads are narrowed to what is shared in.

The inventory test at the top pins every route a guest session can reach, so a
new route that forgets its guest guard fails here instead of shipping open.
"""
import os
import tempfile
import uuid

import pytest
from fastapi.routing import APIRoute

from backend import auth
from backend.config import SessionLocal
from backend.main import app
from backend.models import CampaignResource
from .conftest import make_book, make_game_system, make_map


# Every route a guest token gets past the role guards on, with its methods. Each
# of these authorises the guest inside the handler (campaign membership, the
# campaign-share check, or the caller's own rows), or serves nothing drawn from
# the library. Adding a route here is a claim that it does - check it against a
# guest before you do.
GUEST_REACHABLE = {
    "/api/about": "GET",
    "/api/addons/verify-index": "GET",
    "/api/api-keys": "GET POST",
    "/api/api-keys/permissions": "GET",
    "/api/api-keys/{key_id}": "DELETE PATCH",
    "/api/api-keys/{key_id}/regenerate": "POST",
    "/api/audio-sets": "GET POST",
    "/api/audio-sets/{set_id}": "DELETE GET PATCH",
    "/api/audio/{audio_id}": "GET",
    "/api/audio/{audio_id}/artwork": "GET",
    "/api/audio/{audio_id}/file": "GET",
    "/api/auth/me": "GET",
    "/api/auth/sessions": "GET",
    "/api/auth/sessions/others": "DELETE",
    "/api/auth/sessions/{session_id}": "DELETE",
    "/api/bookmarks": "GET POST",
    "/api/bookmarks/{bookmark_id}": "DELETE PATCH",
    "/api/books/{book_id}": "GET",
    "/api/books/{book_id}/file": "GET",
    "/api/books/{book_id}/page/{page_num}": "GET",
    "/api/books/{book_id}/page/{page_num}/text": "GET",
    "/api/books/{book_id}/page/{page_num}/words": "GET",
    "/api/books/{book_id}/thumbnail": "GET",
    "/api/books/{book_id}/toc": "GET",
    "/api/campaigns": "GET POST",
    "/api/campaigns/calendar/subscription": "DELETE GET POST",
    "/api/campaigns/invites": "GET",
    "/api/campaigns/resources/search": "GET",
    "/api/campaigns/resources/suggested/{system_id}": "GET",
    "/api/campaigns/{campaign_id}": "DELETE GET PATCH",
    "/api/campaigns/{campaign_id}/archive": "PUT",
    "/api/campaigns/{campaign_id}/availability": "GET",
    "/api/campaigns/{campaign_id}/availability/{session_date}": "PUT",
    "/api/campaigns/{campaign_id}/availability/{session_date}/cancel": "PUT",
    "/api/campaigns/{campaign_id}/banner": "DELETE GET POST",
    "/api/campaigns/{campaign_id}/banner/focus": "PUT",
    "/api/campaigns/{campaign_id}/banner/from-source": "POST",
    "/api/campaigns/{campaign_id}/calendar.ics": "GET",
    "/api/campaigns/{campaign_id}/categories": "GET POST",
    "/api/campaigns/{campaign_id}/categories/reorder": "PUT",
    "/api/campaigns/{campaign_id}/categories/{category_id}": "DELETE PATCH",
    "/api/campaigns/{campaign_id}/convert-to-group": "POST",
    "/api/campaigns/{campaign_id}/eligible-members": "GET",
    "/api/campaigns/{campaign_id}/files": "POST",
    "/api/campaigns/{campaign_id}/files/{file_id}": "GET",
    "/api/campaigns/{campaign_id}/guests": "GET POST",
    "/api/campaigns/{campaign_id}/guests/{member_id}": "DELETE",
    "/api/campaigns/{campaign_id}/guests/{member_id}/regenerate": "POST",
    "/api/campaigns/{campaign_id}/guests/{member_id}/share-template": "GET",
    "/api/campaigns/{campaign_id}/images": "POST",
    "/api/campaigns/{campaign_id}/invite": "POST",
    "/api/campaigns/{campaign_id}/members/{member_id}/art": "DELETE GET POST",
    "/api/campaigns/{campaign_id}/members/{member_id}/sheet": "DELETE GET POST",
    "/api/campaigns/{campaign_id}/members/{member_id}/sheet/duplicate": "POST",
    "/api/campaigns/{campaign_id}/members/{member_id}/token": "DELETE GET POST",
    "/api/campaigns/{campaign_id}/members/{user_id}": "DELETE PATCH",
    "/api/campaigns/{campaign_id}/resource-group-order": "PUT",
    "/api/campaigns/{campaign_id}/resources": "GET POST",
    "/api/campaigns/{campaign_id}/resources/bulk": "POST",
    "/api/campaigns/{campaign_id}/resources/reorder": "PUT",
    "/api/campaigns/{campaign_id}/resources/{resource_id}": "DELETE PATCH",
    "/api/campaigns/{campaign_id}/schedule": "DELETE GET PUT",
    "/api/campaigns/{campaign_id}/sessions": "GET POST",
    "/api/campaigns/{campaign_id}/sessions/search": "GET",
    "/api/campaigns/{campaign_id}/sessions/{session_id}": "DELETE GET PATCH",
    "/api/campaigns/{campaign_id}/sessions/{session_id}/notes/gm": "PUT",
    "/api/campaigns/{campaign_id}/sessions/{session_id}/notes/player": "PUT",
    "/api/campaigns/{campaign_id}/sheet-sources": "GET",
    "/api/campaigns/{campaign_id}/wiki": "GET POST",
    "/api/campaigns/{campaign_id}/wiki/export": "GET",
    "/api/campaigns/{campaign_id}/wiki/import": "POST",
    "/api/campaigns/{campaign_id}/wiki/reorder": "PUT",
    "/api/campaigns/{campaign_id}/wiki/search": "GET",
    "/api/campaigns/{campaign_id}/wiki/templates": "GET POST",
    "/api/campaigns/{campaign_id}/wiki/templates/browse": "GET",
    "/api/campaigns/{campaign_id}/wiki/templates/download/{template_id}": "POST",
    "/api/campaigns/{campaign_id}/wiki/templates/upload": "POST",
    "/api/campaigns/{campaign_id}/wiki/templates/{template_id}": "DELETE GET PATCH",
    "/api/campaigns/{campaign_id}/wiki/templates/{template_id}/export": "GET",
    "/api/campaigns/{campaign_id}/wiki/templates/{template_id}/use": "POST",
    "/api/campaigns/{campaign_id}/wiki/titles": "GET",
    "/api/campaigns/{campaign_id}/wiki/{page_id}": "DELETE GET PATCH",
    "/api/campaigns/{campaign_id}/wiki/{page_id}/hide": "DELETE POST",
    "/api/changelog": "GET",
    "/api/characters": "GET POST",
    "/api/characters/import": "POST",
    "/api/characters/schemas": "GET POST",
    "/api/characters/schemas/browse": "GET",
    "/api/characters/schemas/install/{sheet_id}": "POST",
    "/api/characters/schemas/{schema_id}": "DELETE GET",
    "/api/characters/{character_id}": "DELETE GET PUT",
    "/api/characters/{character_id}/export": "GET",
    "/api/characters/{character_id}/portrait": "DELETE GET POST",
    "/api/content/packs": "GET",
    "/api/content/{schema_id}/resolve": "GET",
    "/api/content/{schema_id}/types": "GET",
    "/api/content/{schema_id}/{content_type}": "GET",
    "/api/content/{schema_id}/{content_type}/{entry_id}": "GET",
    "/api/favorites": "GET POST",
    "/api/favorites/{item_type}/{item_id}": "DELETE",
    "/api/latest-release": "GET",
    "/api/maps/{map_id}": "GET",
    "/api/maps/{map_id}/export.uvtt": "GET",
    "/api/maps/{map_id}/file": "GET",
    "/api/maps/{map_id}/page/{page_num}": "GET",
    "/api/maps/{map_id}/thumbnail": "GET",
    "/api/maps/{map_id}/vtt/authoring": "GET",
    "/api/maps/{map_id}/vtt/data": "GET",
    "/api/maps/{map_id}/vtt/image": "GET",
    "/api/models/{model_id}": "GET",
    "/api/models/{model_id}/file": "GET",
    "/api/models/{model_id}/thumbnail": "GET",
    "/api/rulesets": "GET POST",
    "/api/rulesets/installable": "GET",
    "/api/rulesets/packs/browse": "GET",
    "/api/rulesets/packs/install/{pack_id}": "POST",
    "/api/rulesets/packs/{pack_id}": "DELETE",
    "/api/rulesets/{ruleset_id}": "DELETE GET PUT",
    "/api/rulesets/{ruleset_id}/entries": "GET POST",
    "/api/rulesets/{ruleset_id}/entries/{entry_row_id}": "DELETE GET PUT",
    "/api/rulesets/{ruleset_id}/export": "GET",
    "/api/rulesets/{ruleset_id}/fork": "POST",
    "/api/rulesets/{ruleset_id}/import": "POST",
    "/api/saved-filters": "GET POST",
    "/api/saved-filters/{filter_id}": "DELETE PATCH",
    "/api/settings/ui": "GET",
    "/api/themes": "GET POST",
    "/api/themes/browse": "GET",
    "/api/themes/install/{theme_id}": "POST",
    "/api/themes/selection": "PUT",
    "/api/themes/{theme_id}": "DELETE",
    "/api/tokens/{token_id}": "GET",
    "/api/tokens/{token_id}/file": "GET",
    "/api/tokens/{token_id}/thumbnail": "GET",
    "/api/users/me": "DELETE",
    "/api/users/me/opds": "DELETE GET",
    "/api/users/me/opds/generate": "POST",
    "/api/users/me/password": "PATCH",
    "/api/users/me/preferences": "PATCH",
}

_ROLE_GUARDS = (auth.require_admin, auth.require_gm_or_admin, auth.require_not_guest)


def _login_and_guard(route: APIRoute) -> tuple[bool, bool]:
    """(needs a login, has a role guard that refuses guests) for a route."""
    found = {"auth": False, "guard": False}

    def walk(dep) -> None:
        for d in dep.dependencies:
            if d.call in _ROLE_GUARDS:
                found["guard"] = True
            if d.call is auth.get_current_user:
                found["auth"] = True
            walk(d)

    walk(route.dependant)
    return found["auth"], found["guard"]


def test_guest_reachable_routes_are_reviewed():
    reachable: dict[str, set[str]] = {}
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        needs_login, guarded = _login_and_guard(route)
        if needs_login and not guarded:
            reachable.setdefault(route.path, set()).update(route.methods)
    expected = {path: set(methods.split()) for path, methods in GUEST_REACHABLE.items()}
    assert reachable == expected


def uid() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture
def campaign(client, gm_headers, admin_headers):
    client.patch("/api/settings", json={"guest_access_enabled": True}, headers=admin_headers)
    resp = client.post(
        "/api/campaigns",
        json={"name": f"Scoping {uid()}", "is_gm_campaign": True},
        headers=gm_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _make_guest(client, gm_headers, campaign_id, nickname="Guest"):
    created = client.post(
        f"/api/campaigns/{campaign_id}/guests", json={"nickname": nickname}, headers=gm_headers
    )
    assert created.status_code == 201, created.text
    return created.json()


@pytest.fixture
def guest(client, gm_headers, campaign):
    """A logged-in guest of `campaign`: (headers, guest record)."""
    created = _make_guest(client, gm_headers, campaign)
    login = client.post("/api/auth/guest-login", json={"code": created["guest_code"]})
    assert login.status_code == 200, login.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {login.json()['token']}"}, created


def _share(client, gm_headers, campaign_id, rtype, rid, visibility="public"):
    resp = client.post(
        f"/api/campaigns/{campaign_id}/resources",
        json={"resource_type": rtype, "resource_id": rid, "visibility": visibility},
        headers=gm_headers,
    )
    assert resp.status_code == 201, resp.text


# --- Library-wide surfaces --------------------------------------------------


def test_guest_refused_library_wide_reads(client, guest, player_headers):
    headers, _ = guest
    system = make_game_system()
    make_map(tags=["battlemap"])
    urls = [
        "/api/tags",
        "/api/tags/battlemap/items",
        "/api/stats",
        "/api/genres",
        "/api/system-families",
        "/api/parent-systems",
        "/api/licenses",
        "/api/dice-materials",
        f"/api/systems/{system.id}/book-folders",
        f"/api/systems/{system.id}/cover",
        "/api/downloads/archive?type=map_folder&folder=System",
        "/api/downloads/archive?type=tag&tag=battlemap",
        f"/api/downloads/archive?type=system&id={system.id}",
    ]
    for url in urls:
        r = client.get(url, headers=headers)
        assert r.status_code == 403, f"{url} -> {r.status_code}"

    # Players keep them.
    assert client.get("/api/tags", headers=player_headers).status_code == 200
    assert client.get("/api/tags/battlemap/items", headers=player_headers).status_code == 200
    assert client.get("/api/stats", headers=player_headers).status_code == 200


# --- Books by id -------------------------------------------------------------


def test_guest_book_metadata_follows_campaign_share(client, gm_headers, campaign, guest):
    headers, _ = guest
    system = make_game_system()
    unshared = make_book(system.id)
    gm_only = make_book(system.id)
    public = make_book(system.id)
    _share(client, gm_headers, campaign, "book", gm_only.id, "gm")
    _share(client, gm_headers, campaign, "book", public.id, "public")

    assert client.get(f"/api/books/{unshared.id}", headers=headers).status_code == 404
    assert client.get(f"/api/books/{gm_only.id}", headers=headers).status_code == 404
    r = client.get(f"/api/books/{public.id}", headers=headers)
    assert r.status_code == 200
    assert r.json()["title"] == public.title


def _variant_ids(client, url, headers) -> set:
    r = client.get(url, headers=headers)
    assert r.status_code == 200, r.text
    return {v["id"] for v in r.json()["variants"]}


def test_guest_book_variants_trimmed_to_shared(
    client, gm_headers, campaign, guest, player_headers
):
    headers, _ = guest
    system = make_game_system()
    parent = make_book(system.id)
    shared = make_book(system.id, variant_parent_id=parent.id, variant_kind="printer-friendly")
    hidden = make_book(system.id, variant_parent_id=parent.id, variant_kind="printer-friendly")
    _share(client, gm_headers, campaign, "book", parent.id)
    _share(client, gm_headers, campaign, "book", shared.id)

    url = f"/api/books/{parent.id}"
    assert _variant_ids(client, url, headers) == {shared.id}
    assert _variant_ids(client, url, player_headers) == {shared.id, hidden.id}


# --- Media by id -------------------------------------------------------------


def test_guest_map_variants_trimmed_to_shared(
    client, gm_headers, campaign, guest, player_headers
):
    headers, _ = guest
    f = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    f.write(b"stub")
    f.close()
    try:
        parent = make_map(filepath=f.name)
        shared = make_map(variant_parent_id=parent.id, variant_kind="gridless")
        hidden = make_map(variant_parent_id=parent.id, variant_kind="gridless")
        _share(client, gm_headers, campaign, "map", parent.id)
        _share(client, gm_headers, campaign, "map", shared.id)

        assert _variant_ids(client, f"/api/maps/{parent.id}", headers) == {shared.id}
        # Opening the shared variant itself trims the family the same way.
        assert _variant_ids(client, f"/api/maps/{shared.id}", headers) == {shared.id}
        assert _variant_ids(client, f"/api/maps/{parent.id}", player_headers) == {
            shared.id,
            hidden.id,
        }
    finally:
        os.unlink(f.name)


# --- Favorites ---------------------------------------------------------------


def test_guest_favorites_resolve_only_shared_items(client, gm_headers, campaign, guest):
    headers, _ = guest
    system = make_game_system()
    shared = make_map()
    unshared = make_map()
    _share(client, gm_headers, campaign, "map", shared.id)
    for item_type, item_id in [
        ("map", shared.id),
        ("map", unshared.id),
        ("system", system.id),
        ("tag", "battlemap"),
    ]:
        r = client.post(
            "/api/favorites", json={"item_type": item_type, "item_id": item_id}, headers=headers
        )
        assert r.status_code == 201, r.text

    items = client.get("/api/favorites", headers=headers).json()["items"]
    assert [(i["item_type"], i["item_id"]) for i in items] == [("map", shared.id)]


# --- Campaign detail ---------------------------------------------------------


def _codes(client, campaign_id, headers) -> dict:
    members = client.get(f"/api/campaigns/{campaign_id}", headers=headers).json()["members"]
    return {m.get("user_id"): m.get("guest_code") for m in members}


def test_guest_codes_visible_only_to_the_owner(client, gm_headers, campaign, guest):
    headers, me = guest
    other = _make_guest(client, gm_headers, campaign, nickname="Other")

    codes = _codes(client, campaign, headers)
    assert codes[other["user_id"]] is None
    assert codes[me["user_id"]] is None

    assert _codes(client, campaign, gm_headers)[other["user_id"]] == other["guest_code"]


# --- Character sheet sources -------------------------------------------------


def _pdf_file() -> str:
    f = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    f.write(b"%PDF-1.4 stub")
    f.close()
    return f.name


def _upload_pdf(client, gm_headers, campaign_id, name, visibility) -> str:
    r = client.post(
        f"/api/campaigns/{campaign_id}/files",
        files={"file": (name, b"%PDF-1.4 stub", "application/pdf")},
        headers=gm_headers,
    )
    assert r.status_code in (200, 201), r.text
    file_id = r.json()["resource_id"]
    db = SessionLocal()
    try:
        db.query(CampaignResource).filter_by(
            campaign_id=campaign_id, resource_type="file", resource_id=file_id
        ).one().visibility = visibility
        db.commit()
    finally:
        db.close()
    return file_id


def test_guest_sheet_sources_limited_to_shared(client, gm_headers, campaign, guest):
    headers, me = guest
    system = make_game_system()
    unshared_path, shared_path = _pdf_file(), _pdf_file()
    try:
        unshared = make_book(
            system.id, category="character-sheet", filepath=unshared_path, relative_path="u.pdf"
        )
        shared = make_book(
            system.id, category="character-sheet", filepath=shared_path, relative_path="s.pdf"
        )
        _share(client, gm_headers, campaign, "book", shared.id)
        secret = _upload_pdf(client, gm_headers, campaign, "secret.pdf", "gm")
        public = _upload_pdf(client, gm_headers, campaign, "open.pdf", "public")

        r = client.get(f"/api/campaigns/{campaign}/sheet-sources", headers=headers)
        assert r.status_code == 200
        assert [b["id"] for b in r.json()["books"]] == [shared.id]
        assert [f["id"] for f in r.json()["files"]] == [public]

        dup = f"/api/campaigns/{campaign}/members/{me['id']}/sheet/duplicate"
        for source_type, source_id in (("book", unshared.id), ("file", secret)):
            r = client.post(
                dup, json={"source_type": source_type, "source_id": source_id}, headers=headers
            )
            assert r.status_code == 404, (source_type, r.text)
        r = client.post(dup, json={"source_type": "book", "source_id": shared.id}, headers=headers)
        assert r.status_code == 200, r.text

        # The GM still sees every source.
        r = client.get(f"/api/campaigns/{campaign}/sheet-sources", headers=gm_headers).json()
        assert {unshared.id, shared.id} <= {b["id"] for b in r["books"]}
        assert {secret, public} <= {f["id"] for f in r["files"]}
    finally:
        os.unlink(unshared_path)
        os.unlink(shared_path)
