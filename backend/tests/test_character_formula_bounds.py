"""Sheet formulas come from strangers and run on every render, so each of these
hostile inputs must give the formula's default - quickly - rather than a 500 or
a stalled server."""
import json
import time

import pytest

from backend.services import characters as svc
from backend.services.characters import expressions as ex


def _quick(fn, limit=1.0):
    start = time.monotonic()
    result = fn()
    assert time.monotonic() - start < limit
    return result


class TestParseBounds:
    def test_deep_parentheses(self):
        formula = "(" * 3000 + "1" + ")" * 3000
        assert _quick(lambda: svc.evaluate(formula, {}, default="d")) == "d"
        with pytest.raises(svc.ExpressionError, match="nested"):
            svc.parse(formula)

    def test_nesting_inside_the_limit_still_works(self):
        depth = ex.MAX_EXPRESSION_DEPTH - 2
        assert svc.evaluate("(" * depth + "1" + ")" * depth, {}) == 1

    @pytest.mark.parametrize("prefix", ["-", "not ", "+"])
    def test_deep_unary_chains(self, prefix):
        assert svc.evaluate(prefix * 5000 + "1", {}, default="d") == "d"

    def test_deep_call_nesting(self):
        formula = "abs(" * 2000 + "1" + ")" * 2000
        assert svc.evaluate(formula, {}, default="d") == "d"

    def test_long_number_literal(self):
        assert svc.evaluate("1" * 5000, {}, default="d") == "d"
        with pytest.raises(svc.ExpressionError, match="too long"):
            svc.parse("9" * (ex.MAX_NUMBER_LENGTH + 1))


class TestEvaluationBounds:
    @pytest.mark.parametrize(
        "formula",
        [
            "999999999999999 * 999999999999999",
            "floor(x)",
            "round(x)",
            "x / 3",
            "-x",
        ],
    )
    def test_huge_values_give_the_default(self, formula):
        context = {"x": 10**400}
        assert _quick(lambda: svc.evaluate(formula, context, default="d")) == "d"

    @pytest.mark.parametrize("value", [float("inf"), float("-inf"), float("nan")])
    def test_non_finite_field_values_read_as_zero(self, value):
        assert svc.evaluate("floor(x) + round(x)", {"x": value}) == 0

    def test_round_digits_are_clamped(self):
        assert svc.evaluate("round(3.14159, 99)", {}) == 3.14159
        assert svc.evaluate("round(1234, -99)", {}) == 0
        # Without the clamp this asked Python for 10 ** 999999999999999.
        assert _quick(lambda: svc.evaluate("round(5, -999999999999999)", {})) == 0

    def test_ordinary_formulas_unchanged(self):
        assert svc.evaluate("floor((x - 10) / 2)", {"x": 15}) == 2
        assert svc.evaluate("x * 1000000", {"x": 1000}) == 10**9


class TestSheetData:
    def test_coerce_refuses_non_finite_numbers(self):
        for raw in ("1e999", "-1e999", "nan", 10**5000):
            assert svc.coerce_value({"type": "number"}, raw) is None

    def test_field_set_to_1e999_does_not_break_floor(self):
        document = svc.validate_schema({
            "id": "bounds-sheet",
            "name": "Bounds",
            "fields": {"score": {"type": "number", "label": "Score"}},
            "computed": {"half": {"formula": "floor(score / 2)"},
                         "rounded": {"formula": "round(score)"}},
        })
        data = {"score": svc.coerce_value({"type": "number"}, "1e999")}
        values = svc.compute_values(document, data)
        assert values["half"] == 0 and values["rounded"] == 0
        json.dumps(values)

    def test_self_squaring_chain_is_fast_and_serialisable(self):
        computed = {"c0": {"formula": "base"}}
        for i in range(1, 31):
            computed[f"c{i}"] = {"formula": f"c{i - 1} * c{i - 1}"}
        document = svc.validate_schema({
            "id": "square-sheet",
            "name": "Square",
            "fields": {"base": {"type": "number", "label": "Base"}},
            "computed": computed,
        })
        values = _quick(lambda: svc.compute_values(document, {"base": 9}), limit=2.0)
        json.dumps(values)
        assert values["c1"] == 81
        assert values["c30"] == 0  # overflowed long before, so the default


class TestSchemaValidation:
    def test_deeply_nested_formula_is_a_schema_error(self):
        with pytest.raises(svc.SchemaError):
            svc.validate_schema({
                "id": "deep-sheet",
                "name": "Deep",
                "fields": {},
                "computed": {"x": {"formula": "(" * 3000 + "1" + ")" * 3000}},
            })

    def test_long_literal_in_a_condition_is_a_schema_error(self):
        with pytest.raises(svc.SchemaError):
            svc.validate_schema({
                "id": "long-sheet",
                "name": "Long",
                "fields": {"a": {"type": "number", "label": "A",
                                 "visible_if": "1" * 5000 + " > 0"}},
            })
