"""Tests for the layout directives that give a sheet pages and per-option boxes."""
import os
import re

import pytest

from backend.services.characters.layout_html import (
    ALLOWED_TAGS,
    DIRECTIVE_TAGS,
    LayoutHtmlError,
    parse_layout_html,
)


class TestPagesAndOptions:
    """Tabs for a multi-page sheet, and a checkbox per multiselect option."""

    def test_tabs_parse_with_their_titles(self):
        ast = parse_layout_html(
            '<g-tabs><g-tab title="Character"><p>one</p></g-tab>'
            '<g-tab title="Spells"><p>two</p></g-tab></g-tabs>'
        )
        tabs = ast[0]
        assert tabs["tag"] == "g-tabs"
        assert [child["attrs"]["title"] for child in tabs["children"]] == ["Character", "Spells"]

    def test_a_tab_may_carry_a_condition(self):
        ast = parse_layout_html('<g-tabs><g-tab title="Spells" visible_if="is_caster"></g-tab></g-tabs>')
        assert ast[0]["children"][0]["attrs"]["visible_if"] == "is_caster"

    def test_an_option_parses(self):
        ast = parse_layout_html('<g-option field="skill_profs" value="Athletics" label="Athletics" />')
        assert ast[0]["attrs"] == {
            "field": "skill_profs",
            "value": "Athletics",
            "label": "Athletics",
        }

    @pytest.mark.parametrize(
        "html",
        [
            '<g-tabs onclick="x()"></g-tabs>',
            '<g-tab title="A" onmouseover="x()"></g-tab>',
            '<g-option field="a" value="b" onchange="x()" />',
            '<g-option field="a" value="b" style="color:red" />',
        ],
    )
    def test_they_take_no_handlers_or_styles(self, html):
        with pytest.raises(LayoutHtmlError):
            parse_layout_html(html)


class TestBrowserAllowlistMatches:
    """The browser's tag lists must mirror the server's, both ways.

    They drifted once: `details` and `summary` were allowed here but not in the
    renderer, so every collapsible section was silently unwrapped - drawn open,
    with no box and no way to fold it. The server check passed, so nothing
    failed until someone looked at a sheet.
    """

    RENDERER = os.path.join(
        os.path.dirname(__file__), "..", "..", "frontend", "src",
        "components", "characters", "LayoutRenderer.jsx",
    )

    def _js_set(self, name: str) -> set[str]:
        with open(self.RENDERER, encoding="utf-8") as handle:
            source = handle.read()
        match = re.search(rf"const {name} = new Set\(\[(.*?)\]\)", source, re.S)
        assert match, f"{name} not found in LayoutRenderer.jsx"
        # Strip comments before collecting the quoted tag names.
        body = re.sub(r"//[^\n]*", "", match.group(1))
        return set(re.findall(r"'([a-z0-9-]+)'", body))

    def test_structural_tags_match(self):
        assert self._js_set("ALLOWED_TAGS") == set(ALLOWED_TAGS)

    def test_directives_match(self):
        assert self._js_set("DIRECTIVES") == set(DIRECTIVE_TAGS)


class TestTiersAndPips:
    def test_a_tier_parses_with_its_ladder_and_labels(self):
        ast = parse_layout_html(
            '<g-tier value="Stealth" fields="skill_profs skill_expertise" '
            'labels="—|Prof|Exp" titles="None|Proficient|Expertise" label="Stealth" />'
        )
        assert ast[0]["attrs"]["fields"] == "skill_profs skill_expertise"

    def test_pips_parse(self):
        ast = parse_layout_html('<g-pips count="slots_1_total" value="slots_1_used" label="Slot" />')
        assert ast[0]["tag"] == "g-pips"

    @pytest.mark.parametrize(
        "html",
        ['<g-tier value="a" onchange="x()" />', '<g-pips count="3" onclick="x()" />'],
    )
    def test_they_take_no_handlers(self, html):
        with pytest.raises(LayoutHtmlError):
            parse_layout_html(html)
