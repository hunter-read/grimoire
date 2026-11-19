"""The granular /api/stats fields, and the sidebar's stats layouts.

A layout is an ordered list of /api/stats fields. The admin's is everyone's
default (the ``sidebar_stats`` app setting); a user may save their own. The
nine older ``show_stat_*`` flags still read and write, as a view over the
default layout.
"""
import json

import pytest

from backend.config import SessionLocal
from backend.models import AppSetting, User
from backend.services import sidebar_stats
from backend.tests.conftest import (
    make_audio,
    make_book,
    make_game_system,
    make_map,
    make_model3d,
    make_token,
)

MB = 1048576


# --- the service ---------------------------------------------------------------------


class TestLayoutRules:
    @pytest.mark.parametrize(
        "layout,message",
        [
            ("books", "must be a list"),
            (["books", "nonsense"], "Unknown stat: nonsense"),
            (["books", "books"], "same stat twice"),
            (list(sidebar_stats.STAT_IDS[:11]), "at most 10"),
        ],
    )
    def test_rejects_a_bad_layout(self, layout, message):
        with pytest.raises(sidebar_stats.LayoutError, match=message):
            sidebar_stats.validate(layout)

    def test_the_older_name_for_wargame_books_is_not_a_choice(self):
        with pytest.raises(sidebar_stats.LayoutError):
            sidebar_stats.validate(["armory_books"])

    def test_default_is_built_from_the_flags_in_their_old_order(self):
        raw = {flag: "false" for flag in sidebar_stats.LEGACY_FLAGS}
        raw.update(show_stat_size="true", show_stat_systems="true", show_stat_pages="true")
        assert sidebar_stats.default_layout(raw) == ["game_systems", "total_pages", "total_size_mb"]

    def test_a_saved_default_wins_over_the_flags(self):
        raw = {"show_stat_systems": "true", "sidebar_stats": json.dumps(["maps", "books"])}
        assert sidebar_stats.default_layout(raw) == ["maps", "books"]

    def test_a_corrupt_saved_default_falls_back_to_the_flags(self):
        raw = {"show_stat_maps": "true", "sidebar_stats": "not json"}
        assert sidebar_stats.default_layout(raw) == ["maps"]

    def test_a_users_layout_drops_what_this_release_does_not_know(self):
        stored = ["maps", "from_a_newer_release", "maps", *sidebar_stats.STAT_IDS]
        layout = sidebar_stats.user_layout(stored)
        assert layout is not None
        assert layout[0] == "maps"
        assert "from_a_newer_release" not in layout
        assert len(layout) == sidebar_stats.MAX_SIDEBAR_STATS
        assert sidebar_stats.user_layout(None) is None

    def test_flags_read_as_membership(self):
        flags = sidebar_stats.legacy_flags(["maps", "ttrpg_books"])
        assert flags["show_stat_maps"] is True
        assert flags["show_stat_books"] is False

    def test_a_flag_adds_its_stat_at_the_end_or_removes_it(self):
        assert sidebar_stats.with_flag(["maps"], "show_stat_books", True) == ["maps", "books"]
        assert sidebar_stats.with_flag(["maps", "books"], "show_stat_books", True) == [
            "maps",
            "books",
        ]
        assert sidebar_stats.with_flag(["maps", "books"], "show_stat_maps", False) == ["books"]


# --- /api/stats ----------------------------------------------------------------------


def _stats(client, headers):
    return client.get("/api/stats", headers=headers).json()


def test_stats_split_systems_books_pages_and_sizes_by_game_type(client, admin_headers):
    before = _stats(client, admin_headers)
    ttrpg = make_game_system()
    wargame = make_game_system(game_type="wargame")
    make_book(ttrpg.id, page_count=100, file_size=3 * MB)
    make_book(ttrpg.id, page_count=20, file_size=1 * MB)
    make_book(wargame.id, game_type="wargame", page_count=64, file_size=2 * MB)
    after = _stats(client, admin_headers)

    def delta(field):
        return round(after[field] - before[field], 1)

    assert delta("ttrpg_systems") == 1
    assert delta("wargame_systems") == 1
    assert delta("game_systems") == 2
    assert delta("ttrpg_books") == 2
    assert delta("wargame_books") == 1
    assert delta("books") == 3
    assert after["armory_books"] == after["wargame_books"]
    assert delta("ttrpg_pages") == 120
    assert delta("wargame_pages") == 64
    assert delta("total_pages") == 184
    assert delta("ttrpg_size_mb") == 4
    assert delta("wargame_size_mb") == 2
    assert delta("total_size_mb") == 6
    # Each total is its two halves, so a table of them adds up.
    for total, halves in (
        ("game_systems", ("ttrpg_systems", "wargame_systems")),
        ("books", ("ttrpg_books", "wargame_books")),
        ("total_pages", ("ttrpg_pages", "wargame_pages")),
    ):
        assert after[total] == sum(after[half] for half in halves)


def test_stats_size_each_collection(client, admin_headers):
    before = _stats(client, admin_headers)
    make_map(file_size=5 * MB)
    make_token(file_size=1 * MB)
    make_model3d(file_size=7 * MB)
    make_audio(file_size=3 * MB)
    after = _stats(client, admin_headers)

    def delta(field):
        return round(after[field] - before[field], 1)

    assert delta("maps_size_mb") == 5
    assert delta("tokens_size_mb") == 1
    assert delta("models_size_mb") == 7
    assert delta("audio_size_mb") == 3
    assert delta("library_size_mb") == 16


def test_stats_count_variants_beside_the_items(client, admin_headers):
    before = _stats(client, admin_headers)
    system = make_game_system()
    book = make_book(system.id)
    make_book(system.id, variant_parent_id=book.id)
    parent_map = make_map()
    make_map(variant_parent_id=parent_map.id)
    make_map(variant_parent_id=parent_map.id)
    parent_token = make_token()
    make_token(variant_parent_id=parent_token.id)
    parent_model = make_model3d()
    make_model3d(variant_parent_id=parent_model.id)
    parent_audio = make_audio()
    make_audio(variant_parent_id=parent_audio.id)
    after = _stats(client, admin_headers)

    def delta(field):
        return after[field] - before[field]

    # The items count each once, as the library does; the variants beside them.
    assert (delta("books"), delta("book_variants")) == (1, 1)
    assert (delta("maps"), delta("map_variants")) == (1, 2)
    assert (delta("tokens"), delta("token_variants")) == (1, 1)
    assert (delta("models"), delta("model_variants")) == (1, 1)
    assert (delta("audio"), delta("audio_variants")) == (1, 1)


def test_stats_keep_every_older_field(client, admin_headers):
    body = _stats(client, admin_headers)
    for field in (
        "game_systems", "books", "armory_books", "maps", "tokens", "audio", "models",
        "indexed_books", "total_pages", "total_size_mb", "library_size_mb",
    ):
        assert field in body
    # Every stat a layout may name is a field of the response.
    assert set(sidebar_stats.STAT_IDS) <= set(body)


# --- the admin's default layout --------------------------------------------------------


_SETTING_KEYS = (sidebar_stats.SETTING_KEY, *sidebar_stats.LEGACY_FLAGS)


@pytest.fixture
def restore_stat_settings():
    """Put the stat settings back as they were: they are app-wide."""
    db = SessionLocal()
    try:
        saved = {
            row.key: row.value
            for row in db.query(AppSetting).filter(AppSetting.key.in_(_SETTING_KEYS)).all()
        }
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        db.query(AppSetting).filter(AppSetting.key.in_(_SETTING_KEYS)).delete(
            synchronize_session=False
        )
        db.add_all(AppSetting(key=key, value=value) for key, value in saved.items())
        db.commit()
    finally:
        db.close()


def _clear_saved_layout():
    db = SessionLocal()
    try:
        db.query(AppSetting).filter_by(key=sidebar_stats.SETTING_KEY).delete()
        db.commit()
    finally:
        db.close()


@pytest.mark.usefixtures("restore_stat_settings")
class TestDefaultLayout:
    def test_saving_a_layout_reaches_both_settings_endpoints(self, client, admin_headers):
        layout = ["ttrpg_books", "wargame_books", "maps", "library_size_mb"]
        resp = client.patch("/api/settings", json={"sidebar_stats": layout}, headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["sidebar_stats"] == layout
        ui = client.get("/api/settings/ui", headers=admin_headers).json()
        assert ui["sidebar_stats"] == layout
        # The older flags read as whether their stat is in the layout.
        assert ui["show_stat_maps"] is True
        assert ui["show_stat_library_size"] is True
        assert ui["show_stat_systems"] is False

    def test_rejects_a_bad_layout(self, client, admin_headers):
        resp = client.patch(
            "/api/settings", json={"sidebar_stats": ["books", "nope"]}, headers=admin_headers
        )
        assert resp.status_code == 400
        assert "nope" in resp.json()["detail"]

    def test_only_an_admin_sets_it(self, client, player_headers):
        resp = client.patch(
            "/api/settings", json={"sidebar_stats": ["books"]}, headers=player_headers
        )
        assert resp.status_code == 403

    def test_a_flag_before_any_layout_is_saved_works_as_it_always_did(
        self, client, admin_headers
    ):
        _clear_saved_layout()
        client.patch("/api/settings", json={"show_stat_audio": True}, headers=admin_headers)
        ui = client.get("/api/settings/ui", headers=admin_headers).json()
        assert "audio" in ui["sidebar_stats"]
        assert ui["show_stat_audio"] is True

    def test_a_flag_after_a_layout_is_saved_edits_it(self, client, admin_headers):
        client.patch(
            "/api/settings", json={"sidebar_stats": ["maps", "books"]}, headers=admin_headers
        )
        client.patch(
            "/api/settings",
            json={"show_stat_maps": False, "show_stat_tokens": True},
            headers=admin_headers,
        )
        ui = client.get("/api/settings/ui", headers=admin_headers).json()
        assert ui["sidebar_stats"] == ["books", "tokens"]

    def test_a_flag_cannot_push_the_layout_past_ten(self, client, admin_headers):
        full = [stat for stat in sidebar_stats.STAT_IDS if stat != "audio"][:10]
        client.patch("/api/settings", json={"sidebar_stats": full}, headers=admin_headers)
        resp = client.patch("/api/settings", json={"show_stat_audio": True}, headers=admin_headers)
        assert resp.status_code == 400
        assert "at most 10" in resp.json()["detail"]


# --- a user's own layout ---------------------------------------------------------------


@pytest.fixture
def clear_player_layout(player_id):
    yield
    db = SessionLocal()
    try:
        db.query(User).filter_by(id=player_id).update({"sidebar_stats": None})
        db.commit()
    finally:
        db.close()


@pytest.mark.usefixtures("clear_player_layout")
class TestUserLayout:
    URL = "/api/users/me/preferences"

    def test_follows_the_default_until_set(self, client, player_headers):
        assert client.get("/api/auth/me", headers=player_headers).json()["sidebar_stats"] is None

    def test_saves_reads_back_and_clears(self, client, player_headers):
        layout = ["wargame_pages", "ttrpg_pages", "audio_size_mb"]
        resp = client.patch(self.URL, json={"sidebar_stats": layout}, headers=player_headers)
        assert resp.status_code == 200
        assert resp.json()["sidebar_stats"] == layout
        assert client.get("/api/auth/me", headers=player_headers).json()["sidebar_stats"] == layout

        # Leaving it out of a patch changes nothing...
        client.patch(self.URL, json={"display_name": "Player"}, headers=player_headers)
        assert client.get("/api/auth/me", headers=player_headers).json()["sidebar_stats"] == layout

        # ...and an explicit null goes back to the admin's default.
        resp = client.patch(self.URL, json={"sidebar_stats": None}, headers=player_headers)
        assert resp.json()["sidebar_stats"] is None
        assert client.get("/api/auth/me", headers=player_headers).json()["sidebar_stats"] is None

    def test_an_empty_layout_is_kept_rather_than_read_as_the_default(
        self, client, player_headers
    ):
        client.patch(self.URL, json={"sidebar_stats": []}, headers=player_headers)
        assert client.get("/api/auth/me", headers=player_headers).json()["sidebar_stats"] == []

    @pytest.mark.parametrize(
        "layout",
        [["books", "unknown"], ["books", "books"], list(sidebar_stats.STAT_IDS[:11])],
    )
    def test_rejects_a_bad_layout(self, client, player_headers, layout):
        resp = client.patch(self.URL, json={"sidebar_stats": layout}, headers=player_headers)
        assert resp.status_code == 400
