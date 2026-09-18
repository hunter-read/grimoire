"""Tests for the character sheet engine: expressions, layouts, styles, schemas.

The hostile-input tests are the point of this file. A schema arrives from a
stranger, so "a malicious schema cannot do anything worse than look ugly" is a
property that has to be asserted, not assumed.
"""
import pytest

from backend.services import characters as svc


# ---------------------------------------------------------------------------
# Expression language
# ---------------------------------------------------------------------------


class TestExpressions:
    @pytest.mark.parametrize(
        "formula,expected",
        [
            ("1 + 2", 3),
            ("10 - 4 * 2", 2),
            ("(10 - 4) * 2", 12),
            ("7 / 2", 3.5),
            ("8 / 2", 4),
            ("7 % 3", 1),
            ("-5 + 2", -3),
            ("floor(3.7)", 3),
            ("ceil(3.2)", 4),
            ("round(3.456, 1)", 3.5),
            ("abs(-4)", 4),
            ("min(3, 1, 2)", 1),
            ("max(3, 1, 2)", 3),
            ("clamp(15, 1, 10)", 10),
            ("sum(1, 2, 3)", 6),
            ("signed(3)", "+3"),
            ("signed(-2)", "-2"),
            ("signed(0)", "+0"),
        ],
    )
    def test_arithmetic_and_functions(self, formula, expected):
        assert svc.evaluate(formula, {}) == expected

    @pytest.mark.parametrize(
        "formula,expected",
        [
            ("2 > 1", True),
            ("1 >= 1", True),
            ("2 == 2", True),
            ("2 != 3", True),
            ("1 > 2 or 2 > 1", True),
            ("1 > 2 and 2 > 1", False),
            ("not (1 > 2)", True),
            ("2 > 1 ? 'yes' : 'no'", "yes"),
            ("1 > 2 ? 'yes' : 'no'", "no"),
            ("if(2 > 1, 10, 20)", 10),
        ],
    )
    def test_logic(self, formula, expected):
        assert svc.evaluate(formula, {}) == expected

    def test_reads_context_values(self):
        assert svc.evaluate("floor((strength - 10) / 2)", {"strength": 16}) == 3
        assert svc.evaluate("floor((strength - 10) / 2)", {"strength": 8}) == -1

    def test_dotted_paths_read_nested_dicts(self):
        assert svc.evaluate("a.b.c", {"a": {"b": {"c": 42}}}) == 42

    def test_string_equality_is_case_insensitive(self):
        assert svc.evaluate("race == 'Elf'", {"race": "elf"}) is True

    @pytest.mark.parametrize(
        "formula,context",
        [
            ("missing + 1", {}),
            ("strength / 0", {"strength": 10}),
            ("strength % 0", {"strength": 10}),
            ("level + 1", {"level": ""}),
            ("level + 1", {"level": "not a number"}),
        ],
    )
    def test_nonsense_reads_as_zero_rather_than_raising(self, formula, context):
        """A sheet being edited is routinely half-filled; it must still render."""
        assert svc.evaluate(formula, context) is not None

    def test_division_by_zero_is_zero(self):
        assert svc.evaluate("10 / 0", {}) == 0

    def test_unparseable_formula_returns_default(self):
        assert svc.evaluate("1 +", {}, default=-1) == -1

    # -- the sandbox

    @pytest.mark.parametrize(
        "formula",
        [
            "__import__('os').system('id')",
            "open('/etc/passwd')",
            "eval('1+1')",
            "exec('x=1')",
            "globals()",
            "1; import os",
            "lambda: 1",
        ],
    )
    def test_rejects_code_execution_attempts(self, formula):
        with pytest.raises(svc.ExpressionError):
            svc.parse(formula)

    def test_dotted_path_cannot_reach_python_attributes(self):
        """`x.__class__` parses as a *path*, and paths only ever index dicts."""
        assert svc.evaluate("strength.__class__", {"strength": 16}) == 0
        assert svc.evaluate("strength.__class__.__mro__", {"strength": 16}) == 0

    def test_referenced_names_finds_dependencies(self):
        ast = svc.parse("floor((strength + dex_bonus) / 2)")
        assert svc.referenced_names(ast) == {"strength", "dex_bonus"}


# ---------------------------------------------------------------------------
# HTML layouts
# ---------------------------------------------------------------------------


class TestLayoutHtml:
    def test_parses_structural_markup_to_an_ast(self):
        ast = svc.parse_layout_html(
            '<div class="sheet"><h2>Abilities</h2><g-field name="strength"/></div>'
        )
        assert ast[0]["tag"] == "div"
        assert ast[0]["attrs"]["class"] == "sheet"
        children = ast[0]["children"]
        assert children[0]["tag"] == "h2"
        assert children[1]["tag"] == "g-field"
        assert children[1]["attrs"]["name"] == "strength"

    def test_keeps_text_nodes(self):
        ast = svc.parse_layout_html("<p>Hit Points</p>")
        assert ast[0]["children"][0]["text"] == "Hit Points"

    def test_allows_directives(self):
        source = (
            '<g-repeat over="attacks"><g-field name="weapon"/></g-repeat>'
            '<g-if test="is_caster"><g-computed name="spell_dc"/></g-if>'
        )
        ast = svc.parse_layout_html(source)
        assert [node["tag"] for node in ast] == ["g-repeat", "g-if"]

    def test_tolerates_unclosed_tags(self):
        """A stray tag should not fail a whole sheet, as in a browser."""
        assert svc.parse_layout_html("<div><p>text</div>")

    @pytest.mark.parametrize(
        "source",
        [
            '<div onclick="alert(1)">x</div>',
            '<div onerror="alert(1)">x</div>',
            "<div ONCLICK='alert(1)'>x</div>",
            '<div onmouseover="x">y</div>',
        ],
    )
    def test_rejects_event_handlers(self, source):
        with pytest.raises(svc.LayoutHtmlError):
            svc.parse_layout_html(source)

    @pytest.mark.parametrize(
        "source",
        [
            "<script>alert(1)</script>",
            "<style>body{}</style>",
            '<iframe src="https://evil.example"></iframe>',
            "<object data='x'></object>",
            "<embed src='x'>",
            "<svg onload=alert(1)></svg>",
            "<form><input name='x'></form>",
            "<input type='text'>",
            "<button>go</button>",
            "<textarea></textarea>",
            "<link rel=stylesheet href=x>",
            "<meta http-equiv=refresh content=0>",
            "<base href='https://evil.example'>",
        ],
    )
    def test_rejects_dangerous_tags(self, source):
        with pytest.raises(svc.LayoutHtmlError):
            svc.parse_layout_html(source)

    @pytest.mark.parametrize(
        "source",
        [
            '<img src="javascript:alert(1)">',
            '<img src="data:text/html,<script>alert(1)</script>">',
            '<img src="vbscript:alert(1)">',
            '<img src="JaVaScRiPt:alert(1)">',
        ],
    )
    def test_rejects_unsafe_urls(self, source):
        with pytest.raises(svc.LayoutHtmlError):
            svc.parse_layout_html(source)

    def test_allows_relative_and_https_images(self):
        assert svc.parse_layout_html('<img src="/api/portrait/1.png" alt="">')
        assert svc.parse_layout_html('<img src="https://example.com/a.png" alt="">')

    def test_rejects_inline_style_attribute(self):
        """Inline CSS is the escape hatch the scoped stylesheet exists to close."""
        with pytest.raises(svc.LayoutHtmlError):
            svc.parse_layout_html('<div style="position:fixed">x</div>')

    def test_rejects_doctype_and_processing_instructions(self):
        with pytest.raises(svc.LayoutHtmlError):
            svc.parse_layout_html("<!DOCTYPE html><div></div>")

    def test_drops_comments(self):
        ast = svc.parse_layout_html("<div><!-- sneaky --><p>ok</p></div>")
        assert [c.get("tag") for c in ast[0]["children"]] == ["p"]

    def test_rejects_oversized_layout(self):
        with pytest.raises(svc.LayoutHtmlError):
            svc.parse_layout_html("<div>x</div>" * 60000)

    def test_rejects_unknown_attributes(self):
        with pytest.raises(svc.LayoutHtmlError):
            svc.parse_layout_html('<div srcdoc="x">y</div>')

    def test_allows_data_attributes(self):
        ast = svc.parse_layout_html('<div data-slot="header">x</div>')
        assert ast[0]["attrs"]["data-slot"] == "header"


# ---------------------------------------------------------------------------
# Stylesheets
# ---------------------------------------------------------------------------


class TestStyles:
    def test_scopes_selectors(self):
        assert svc.scope_styles(".ability { color: red }", "gc-x") == (
            ".gc-x .ability { color: red }"
        )

    def test_rewrites_root_and_body_to_the_scope(self):
        assert svc.scope_styles(":root { --ink: red }", "gc-x") == ".gc-x { --ink: red }"
        assert svc.scope_styles("body { color: red }", "gc-x") == ".gc-x { color: red }"

    def test_scopes_every_selector_in_a_list(self):
        out = svc.scope_styles(".a, .b { color: red }", "gc-x")
        assert out == ".gc-x .a, .gc-x .b { color: red }"

    def test_scopes_inside_media_queries(self):
        out = svc.scope_styles("@media (max-width: 600px) { .a { color: red } }", "gc-x")
        assert "@media (max-width: 600px)" in out
        assert ".gc-x .a { color: red }" in out

    @pytest.mark.parametrize(
        "css",
        [
            ".a { position: fixed }",
            ".a { position: absolute }",
            ".a { background: url(https://evil.example/t.png) }",
            ".a { behavior: url(x.htc) }",
            ".a { -moz-binding: url(x) }",
            ".a { width: expression(alert(1)) }",
            "@font-face { font-family: x }",
            "@keyframes spin { from { opacity: 0 } }",
        ],
    )
    def test_rejects_dangerous_css(self, css):
        with pytest.raises(svc.StylesError):
            svc.scope_styles(css, "gc-x")

    def test_rejects_url_in_an_allowed_property(self):
        with pytest.raises(svc.StylesError):
            svc.scope_styles(".a { background-color: url(https://evil.example) }", "gc-x")

    def test_allows_custom_properties(self):
        assert "--ink: #333" in svc.scope_styles(".a { --ink: #333 }", "gc-x")

    def test_strips_comments(self):
        assert svc.scope_styles("/* note */ .a { color: red }", "gc-x") == (
            ".gc-x .a { color: red }"
        )

    def test_rejects_oversized_styles(self):
        with pytest.raises(svc.StylesError):
            svc.scope_styles(".a { color: red }" * 20000, "gc-x")


# ---------------------------------------------------------------------------
# Schema validation and evaluation
# ---------------------------------------------------------------------------


def _schema(**overrides):
    document = {
        "id": "test-system",
        "name": "Test System",
        "fields": {
            "strength": {"type": "number", "label": "Strength", "min": 1, "max": 20,
                         "default": 10},
            "name": {"type": "text", "label": "Name"},
        },
        "computed": {
            "str_mod": {"formula": "floor((strength - 10) / 2)"},
        },
    }
    document.update(overrides)
    return document


class TestSchemaValidation:
    def test_accepts_a_minimal_schema(self):
        validated = svc.validate_schema(_schema())
        assert validated["id"] == "test-system"

    def test_defaults_the_layout_when_none_is_given(self):
        validated = svc.validate_schema(_schema())
        assert validated["layout"][0]["fields"] == ["strength", "name"]

    @pytest.mark.parametrize("bad_id", ["", "Has Spaces", "UPPER", "trailing-", None, 5])
    def test_rejects_a_bad_id(self, bad_id):
        with pytest.raises(svc.SchemaError):
            svc.validate_schema(_schema(id=bad_id))

    def test_rejects_a_missing_name(self):
        document = _schema()
        del document["name"]
        with pytest.raises(svc.SchemaError):
            svc.validate_schema(document)

    def test_rejects_an_unknown_field_type(self):
        with pytest.raises(svc.SchemaError, match="unknown type"):
            svc.validate_schema(_schema(fields={"x": {"type": "wormhole"}}))

    def test_rejects_a_select_without_options(self):
        with pytest.raises(svc.SchemaError, match="options"):
            svc.validate_schema(_schema(fields={"x": {"type": "select"}}))

    def test_rejects_an_invalid_formula(self):
        with pytest.raises(svc.SchemaError, match="invalid formula"):
            svc.validate_schema(_schema(computed={"x": {"formula": "1 +"}}))

    def test_rejects_a_formula_referencing_an_unknown_name(self):
        with pytest.raises(svc.SchemaError, match="unknown name"):
            svc.validate_schema(_schema(computed={"x": {"formula": "nonexistent + 1"}}))

    def test_rejects_a_name_that_is_both_field_and_computed(self):
        with pytest.raises(svc.SchemaError, match="ambiguous"):
            svc.validate_schema(
                _schema(computed={"strength": {"formula": "1"}})
            )

    def test_rejects_a_layout_naming_an_unknown_field(self):
        with pytest.raises(svc.SchemaError, match="unknown field"):
            svc.validate_schema(_schema(layout=[{"title": "x", "fields": ["nope"]}]))

    def test_rejects_min_above_max(self):
        with pytest.raises(svc.SchemaError, match="min greater than max"):
            svc.validate_schema(
                _schema(fields={"x": {"type": "number", "min": 10, "max": 1}})
            )

    def test_derives_layout_ast_and_scoped_css(self):
        validated = svc.validate_schema(
            _schema(
                layout_html='<div class="s"><g-field name="strength"/></div>',
                styles=".s { color: red }",
            ),
            scope="gc-test",
        )
        assert validated["layout_ast"][0]["tag"] == "div"
        assert validated["styles_css"] == ".gc-test .s { color: red }"

    def test_rejects_a_schema_whose_layout_html_is_hostile(self):
        with pytest.raises(svc.SchemaError, match="Invalid layout_html"):
            svc.validate_schema(_schema(layout_html="<script>alert(1)</script>"))

    def test_rejects_a_schema_whose_styles_are_hostile(self):
        with pytest.raises(svc.SchemaError, match="Invalid styles"):
            svc.validate_schema(_schema(styles=".a { position: fixed }"))


class TestComputeValues:
    def test_computes_from_data(self):
        document = svc.validate_schema(_schema())
        assert svc.compute_values(document, {"strength": 16}) == {"str_mod": 3}

    def test_uses_declared_defaults_for_missing_values(self):
        document = svc.validate_schema(_schema())
        assert svc.compute_values(document, {}) == {"str_mod": 0}

    def test_resolves_chained_dependencies_regardless_of_order(self):
        """An author should not have to declare computed values in order."""
        document = svc.validate_schema(
            _schema(
                computed={
                    "total": {"formula": "doubled + 1"},
                    "doubled": {"formula": "strength * 2"},
                }
            )
        )
        assert svc.compute_values(document, {"strength": 5}) == {
            "doubled": 10,
            "total": 11,
        }

    def test_a_cyclic_schema_terminates(self):
        document = {
            "id": "cyclic",
            "name": "Cyclic",
            "fields": {},
            "computed": {"a": {"formula": "b + 1"}, "b": {"formula": "a + 1"}},
        }
        assert svc.compute_values(document, {}) is not None


class TestCoerceValue:
    def test_clamps_numbers_into_range(self):
        definition = {"type": "number", "min": 1, "max": 20}
        assert svc.coerce_value(definition, 30) == 20
        assert svc.coerce_value(definition, -5) == 1

    def test_reads_numeric_strings(self):
        assert svc.coerce_value({"type": "number"}, "12") == 12

    def test_unparseable_number_becomes_none(self):
        assert svc.coerce_value({"type": "number"}, "abc") is None

    @pytest.mark.parametrize("value", ["true", "1", "yes", "on", True])
    def test_checkbox_truthy(self, value):
        assert svc.coerce_value({"type": "checkbox"}, value) is True

    @pytest.mark.parametrize("value", ["false", "0", "", False, None])
    def test_checkbox_falsey(self, value):
        assert svc.coerce_value({"type": "checkbox"}, value) is False

    def test_select_rejects_a_value_outside_its_options(self):
        definition = {"type": "select", "options": ["a", "b"]}
        assert svc.coerce_value(definition, "a") == "a"
        assert svc.coerce_value(definition, "z") == ""

    def test_text_stringifies(self):
        assert svc.coerce_value({"type": "text"}, 5) == "5"
        assert svc.coerce_value({"type": "text"}, None) == ""
