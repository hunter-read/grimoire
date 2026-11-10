"""The GM screen's panel kinds: cleaning config and state, resets, and placement.

Every value on a board arrives from a client or a downloaded preset, so these
pin that each kind keeps only the keys it declares, bounds every number, and
falls back to a default rather than failing - a GM mid-session must never lose
a board over one bad value.
"""
import pytest

from backend.services.gm_screen import boards
from backend.services.gm_screen import panels as p


class TestConfig:
    def test_an_unknown_kind_is_refused(self):
        with pytest.raises(p.PanelError, match="Unknown panel kind"):
            p.clean_config("spreadsheet", {})

    def test_keys_a_kind_does_not_declare_are_dropped(self):
        assert p.clean_config("scratch", {"script": "alert(1)"}) == {}
        assert "colour" not in p.clean_config("counter", {"colour": "red"})

    def test_a_counter_keeps_its_start_inside_its_range(self):
        config = p.clean_config("counter", {"min": 0, "max": 12, "start": 40, "resets": "scene"})
        assert config == {"min": 0, "max": 12, "start": 12, "style": "number", "resets": "scene"}

    def test_a_counter_without_a_top_cannot_be_drawn_as_boxes(self):
        assert p.clean_config("counter", {"style": "pips"})["style"] == "number"
        assert p.clean_config("counter", {"max": 100, "style": "pips"})["style"] == "number"
        assert p.clean_config("counter", {"max": 12, "style": "pips"})["style"] == "pips"

    def test_an_unreadable_number_is_the_default(self):
        config = p.clean_config("counter", {"min": "lots", "max": True, "start": None})
        assert (config["min"], config["max"], config["start"]) == (0, None, 0)

    def test_an_unknown_reset_never_resets(self):
        assert p.clean_config("pools", {"resets": "weekly"}) == {"resets": ""}

    def test_party_stats_need_a_field_name(self):
        config = p.clean_config(
            "party",
            {
                "stats": [
                    {"label": "HP", "value": "hp_marked", "max": "hp_max", "style": "pips"},
                    {"label": "Bad", "value": "not a name"},
                    {"value": "evasion", "max": 99},
                    "nonsense",
                ]
            },
        )
        assert config["stats"] == [
            {"label": "HP", "value": "hp_marked", "max": "hp_max", "style": "pips"},
            # A number above the box cap is held to it.
            {"label": "evasion", "value": "evasion", "max": p.MAX_BOXES, "style": "number"},
        ]
        assert config["include_inactive"] is False

    def test_an_initiative_tracker_with_one_side_gets_the_default_two(self):
        config = p.clean_config("initiative", {"mode": "sides", "sides": [{"key": "pcs", "label": "PCs"}]})
        assert config["mode"] == "sides"
        assert [side["key"] for side in config["sides"]] == ["heroes", "foes"]

    def test_initiative_sides_keep_their_order_and_drop_repeats(self):
        sides = p.clean_config(
            "initiative",
            {
                "sides": [
                    {"key": "heroes", "label": "Heroes"},
                    {"key": "director", "label": "Director"},
                    {"key": "heroes", "label": "Again"},
                    {"key": "Bad Key"},
                ]
            },
        )["sides"]
        assert sides == [{"key": "heroes", "label": "Heroes"}, {"key": "director", "label": "Director"}]

    def test_a_note_keeps_only_a_plain_page_id(self):
        assert p.clean_config("note", {"page_id": "../etc/passwd", "page_slug": "lore"}) == {
            "page_id": None,
            "page_slug": "lore",
        }


class TestState:
    def test_a_counter_value_is_held_to_its_range(self):
        config = p.clean_config("counter", {"min": 0, "max": 12})
        assert p.clean_state("counter", {"value": 99}, config) == {"value": 12}
        assert p.clean_state("counter", {"value": -3}, config) == {"value": 0}
        assert p.clean_state("counter", None, config) == {"value": 0}

    def test_a_countdown_cannot_tick_past_its_size(self):
        state = p.clean_state(
            "clocks", {"items": [{"id": "a", "name": "Ritual", "size": 6, "ticks": 10}]}, {}
        )
        assert state["items"][0]["ticks"] == 6
        assert state["items"][0]["loops"] is False

    def test_rows_get_ids_and_repeated_ids_are_replaced(self):
        state = p.clean_state(
            "pools",
            {"items": [{"id": "x", "name": "A"}, {"id": "x", "name": "B"}, {"name": "C"}]},
            {},
        )
        ids = [item["id"] for item in state["items"]]
        assert ids[0] == "x" and len(set(ids)) == 3

    def test_lists_are_capped(self):
        state = p.clean_state("clocks", {"items": [{"name": str(n)} for n in range(200)]}, {})
        assert len(state["items"]) == p.MAX_ITEMS

    def test_a_combatant_on_an_unknown_side_joins_the_first(self):
        config = p.clean_config("initiative", {"mode": "sides"})
        state = p.clean_state(
            "initiative", {"entries": [{"name": "Goblin", "side": "nobody", "acted": "yes"}]}, config
        )
        entry = state["entries"][0]
        assert (entry["side"], entry["acted"], entry["score"]) == ("heroes", False, None)
        assert state["round"] == 1

    def test_the_turn_stays_on_the_list(self):
        config = p.clean_config("initiative", {})
        state = p.clean_state("initiative", {"turn": 9, "entries": [{"name": "A"}, {"name": "B"}]}, config)
        assert state["turn"] == 1

    def test_scratch_text_keeps_its_line_breaks(self):
        assert p.clean_state("scratch", {"text": "  one\n  two\n"}, {}) == {"text": "  one\n  two\n"}
        assert p.clean_state("scratch", {"text": ["x"]}, {}) == {"text": ""}


class TestResets:
    def test_ending_a_session_also_ends_its_scene(self):
        assert p.scopes_cleared_by("session") == {"scene", "session"}
        assert p.scopes_cleared_by("rest") == {"rest"}
        with pytest.raises(p.PanelError):
            p.scopes_cleared_by("week")

    def test_a_counter_returns_to_its_start(self):
        config = p.clean_config("counter", {"max": 12, "start": 2, "resets": "session"})
        assert p.reset_state("counter", config, {"value": 9}, "scene") is None
        assert p.reset_state("counter", config, {"value": 9}, "session") == {"value": 2}

    def test_pools_keep_their_rows_and_lose_their_tokens(self):
        config = p.clean_config("pools", {"resets": "scene"})
        state = {"items": [{"id": "a", "name": "Swarm", "tokens": 4, "note": ""}]}
        assert p.reset_state("pools", config, state, "scene") == {
            "items": [{"id": "a", "name": "Swarm", "tokens": 0, "note": ""}]
        }

    def test_only_the_countdowns_marked_to_reset_clear(self):
        state = {
            "items": [
                {"id": "a", "ticks": 3, "resets": "rest"},
                {"id": "b", "ticks": 2, "resets": ""},
            ]
        }
        cleared = p.reset_state("clocks", {}, state, "rest")
        assert [item["ticks"] for item in cleared["items"]] == [0, 2]
        assert p.reset_state("clocks", {}, state, "scene") is None

    def test_initiative_clears_when_the_fight_is_over(self):
        config = p.clean_config("initiative", {"resets": "scene"})
        state = p.clean_state("initiative", {"round": 4, "entries": [{"name": "A"}]}, config)
        assert p.reset_state("initiative", config, state, "scene")["entries"] == []

    def test_a_panel_with_nothing_to_reset_is_left_alone(self):
        assert p.reset_state("scratch", {}, {"text": "x"}, "session") is None
        assert p.reset_state("counter", p.clean_config("counter", {}), {"value": 3}, "session") is None


class TestGeometry:
    def test_a_panel_stays_inside_the_twelve_columns(self):
        assert p.clean_geometry(11, 0, 6, 2, "counter") == {"x": 6, "y": 0, "w": 6, "h": 2}
        assert p.clean_geometry(-5, -1, 40, 999, "counter") == {"x": 0, "y": 0, "w": 12, "h": p.MAX_HEIGHT}

    def test_missing_size_is_the_kinds_default(self):
        cell = p.clean_geometry(None, None, None, None, "party")
        assert (cell["w"], cell["h"]) == p.default_size("party")

    def test_place_fills_the_first_gap(self):
        taken = [{"x": 0, "y": 0, "w": 4, "h": 4}, {"x": 8, "y": 0, "w": 4, "h": 4}]
        assert p.place(taken, 4, 4) == {"x": 4, "y": 0, "w": 4, "h": 4}
        assert p.place(taken, 6, 2) == {"x": 0, "y": 4, "w": 6, "h": 2}
        assert p.place([], 3, 3) == {"x": 0, "y": 0, "w": 3, "h": 3}


class TestBoards:
    def test_a_board_needs_panels_of_known_kinds(self):
        with pytest.raises(p.PanelError, match="JSON object"):
            boards.parse_board([])
        with pytest.raises(p.PanelError, match="non-empty"):
            boards.parse_board({"panels": []})
        with pytest.raises(p.PanelError, match="unknown kind"):
            boards.parse_board({"panels": [{"kind": "macro"}]})
        with pytest.raises(p.PanelError, match="must be an object"):
            boards.parse_board({"panels": ["counter"]})
        with pytest.raises(p.PanelError, match="at most"):
            boards.parse_board({"panels": [{"kind": "scratch"}] * (p.MAX_PANELS + 1)})

    def test_overlapping_panels_move_out_of_the_way(self):
        board = boards.parse_board(
            {
                "panels": [
                    {"kind": "counter", "x": 0, "y": 0, "w": 4, "h": 3},
                    {"kind": "counter", "x": 0, "y": 0, "w": 4, "h": 3},
                ]
            }
        )
        cells = [(panel["x"], panel["y"]) for panel in board]
        assert cells == [(0, 0), (4, 0)]

    def test_panels_without_a_position_flow_into_place(self):
        board = boards.parse_board({"panels": [{"kind": "counter"}, {"kind": "counter"}]})
        assert [(panel["x"], panel["y"]) for panel in board] == [(0, 0), (3, 0)]

    def test_copying_leaves_the_numbers_behind(self):
        document = {
            "panels": [
                {
                    "kind": "counter",
                    "title": "Fear",
                    "config": {"max": 12},
                    "state": {"value": 7},
                }
            ]
        }
        assert boards.parse_board(document)[0]["state"] == {"value": 7}
        assert boards.parse_board(document, keep_state=False)[0]["state"] == {"value": 0}

    def test_an_export_names_pages_by_slug(self):
        exported = boards.export_board(
            "Table",
            [
                {
                    "kind": "note",
                    "title": "Lore",
                    "x": 0,
                    "y": 0,
                    "w": 4,
                    "h": 8,
                    "config": {"page_id": "abc", "page_slug": "lore"},
                    "state": {},
                }
            ],
        )
        assert exported["format"] == boards.BOARD_FORMAT
        assert exported["panels"][0]["config"] == {"page_slug": "lore"}
        # An export reads back as the board it came from.
        assert boards.parse_board(exported)[0]["config"] == {"page_id": None, "page_slug": "lore"}
