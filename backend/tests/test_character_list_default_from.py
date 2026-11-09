"""`default_from` on a list column: a row's cell worked out from the sheet.

The case it was asked for (issue #827): a family record with `born` and `age`
columns, where each relative's age should follow `campaign_year - born`.
"""
import pytest

from backend.services import characters as svc
from backend.services.characters.schema import _build_context


def _family_schema(column_overrides=None, **field_overrides):
    age = {
        "key": "age",
        "type": "number",
        "label": "Age",
        "min": 0,
        "default_from": "born ? campaign_year - born : null",
    }
    age.update(column_overrides or {})
    document = {
        "id": "family-demo",
        "name": "Family Demo",
        "fields": {
            "campaign_year": {"type": "number", "default": 1890},
            "family_records": {
                "type": "list",
                "columns": [
                    {"key": "name", "type": "text"},
                    {"key": "born", "type": "number"},
                    age,
                ],
            },
            **field_overrides,
        },
        "computed": {
            "total_age": {"formula": "sum_where(family_records, 'age')"},
        },
    }
    return svc.validate_schema(document)


def _rows(document, data):
    return _build_context(document, data)["family_records"]


class TestValidation:
    def test_a_column_formula_is_accepted(self):
        document = _family_schema()
        column = document["fields"]["family_records"]["columns"][2]
        assert column["default_from"] == "born ? campaign_year - born : null"

    def test_an_unparseable_formula_is_refused(self):
        with pytest.raises(svc.SchemaError, match="column 'age' default_from"):
            _family_schema({"default_from": "campaign_year -"})

    def test_a_blank_formula_is_refused(self):
        with pytest.raises(svc.SchemaError, match="non-empty expression"):
            _family_schema({"default_from": "  "})

    def test_an_unknown_name_is_refused(self):
        with pytest.raises(svc.SchemaError, match="unknown name: birth_year"):
            _family_schema({"default_from": "campaign_year - birth_year"})

    def test_a_computed_value_is_refused_with_the_reason(self):
        with pytest.raises(svc.SchemaError, match="not computed values"):
            _family_schema({"default_from": "total_age - born"})

    def test_another_derived_column_is_refused(self):
        document = {
            "id": "two-derived",
            "name": "Two Derived",
            "fields": {
                "rows": {
                    "type": "list",
                    "columns": [
                        {"key": "a", "type": "number", "default_from": "1"},
                        {"key": "b", "type": "number", "default_from": "a + 1"},
                    ],
                },
            },
        }
        with pytest.raises(svc.SchemaError, match="plain columns only"):
            svc.validate_schema(document)

    def test_a_column_reading_itself_is_refused(self):
        with pytest.raises(svc.SchemaError, match="plain columns only"):
            _family_schema({"default_from": "age + 1"})

    def test_an_image_field_is_refused(self):
        with pytest.raises(svc.SchemaError, match="image"):
            _family_schema(
                {"default_from": "portrait"}, portrait={"type": "image"}
            )

    def test_a_column_shadowing_an_image_field_is_the_column(self):
        """A column named like an image field reads the row's cell."""
        document = {
            "id": "shadow-image",
            "name": "Shadow Image",
            "fields": {
                "portrait": {"type": "image"},
                "rows": {
                    "type": "list",
                    "columns": [
                        {"key": "portrait", "type": "text"},
                        {"key": "caption", "type": "text", "default_from": "portrait"},
                    ],
                },
            },
        }
        svc.validate_schema(document)

    def test_a_checkbox_column_is_refused(self):
        with pytest.raises(svc.SchemaError, match="checkbox"):
            _family_schema({"type": "checkbox", "min": None})

    def test_a_non_string_formula_is_refused(self):
        with pytest.raises(svc.SchemaError, match="non-empty expression"):
            _family_schema({"default_from": 5})


class TestContext:
    def test_an_empty_cell_is_derived(self):
        rows = _rows(_family_schema(), {"family_records": [{"name": "Ada", "born": 1850, "age": None}]})
        assert rows[0]["age"] == 40

    def test_an_empty_string_counts_as_unset(self):
        rows = _rows(_family_schema(), {"family_records": [{"born": 1850, "age": ""}]})
        assert rows[0]["age"] == 40

    def test_a_typed_value_wins(self):
        rows = _rows(_family_schema(), {"family_records": [{"born": 1850, "age": 12}]})
        assert rows[0]["age"] == 12

    def test_a_typed_zero_is_the_players(self):
        rows = _rows(_family_schema(), {"family_records": [{"born": 1850, "age": 0}]})
        assert rows[0]["age"] == 0

    def test_each_row_is_worked_out_on_its_own(self):
        rows = _rows(
            _family_schema(),
            {"family_records": [{"born": 1850, "age": None}, {"born": 1880, "age": None}]},
        )
        assert [row["age"] for row in rows] == [40, 10]

    def test_follows_the_campaign_year(self):
        rows = _rows(
            _family_schema(),
            {"campaign_year": 1900, "family_records": [{"born": 1850, "age": None}]},
        )
        assert rows[0]["age"] == 50

    def test_reads_a_top_level_derived_field(self):
        document = _family_schema(
            {"default_from": "born ? year_now - born : null"},
            year_now={"type": "number", "default_from": "campaign_year + 10"},
        )
        rows = _rows(document, {"family_records": [{"born": 1850, "age": None}]})
        assert rows[0]["age"] == 50

    def test_a_column_shadows_a_field_of_the_same_name(self):
        document = _family_schema(born={"type": "number", "default": 1000})
        rows = _rows(document, {"family_records": [{"born": 1850, "age": None}]})
        assert rows[0]["age"] == 40

    def test_the_result_is_clamped(self):
        """Born after the campaign year: the column's min of 0 still holds."""
        rows = _rows(_family_schema(), {"family_records": [{"born": 1900, "age": None}]})
        assert rows[0]["age"] == 0

    def test_an_empty_result_falls_back_to_the_columns_default(self):
        rows = _rows(_family_schema({"default": 18}), {"family_records": [{"age": None}]})
        assert rows[0]["age"] == 18

    def test_an_empty_result_with_no_default_stays_empty(self):
        rows = _rows(_family_schema(), {"family_records": [{"age": None}]})
        assert rows[0]["age"] is None

    def test_the_stored_rows_are_left_alone(self):
        data = {"family_records": [{"born": 1850, "age": None}]}
        _build_context(_family_schema(), data)
        assert data["family_records"][0]["age"] is None

    def test_an_aggregate_sees_derived_values(self):
        computed = svc.compute_values(
            _family_schema(),
            {"family_records": [{"born": 1850, "age": None}, {"born": 1880, "age": 5}]},
        )
        assert computed["total_age"] == 45

    def test_a_validator_sees_derived_values(self):
        document = _family_schema()
        document["validators"] = [
            {"rule": "sum_where(family_records, 'age') < 30", "message": "Too old"}
        ]
        fired = svc.run_validators(document, {"family_records": [{"born": 1850, "age": None}]})
        assert [result["message"] for result in fired] == ["Too old"]

    def test_a_row_that_is_not_an_object_is_passed_through(self):
        rows = _rows(_family_schema(), {"family_records": ["junk"]})
        assert rows == ["junk"]

    def test_a_stored_formula_that_no_longer_parses_reads_as_empty(self):
        """Validation refuses it at install; a drifted document still draws."""
        document = _family_schema({"default": 3})
        document["fields"]["family_records"]["columns"][2]["default_from"] = "born -"
        rows = _rows(document, {"family_records": [{"born": 1850, "age": None}]})
        assert rows[0]["age"] == 3


class TestCoercingRows:
    def test_a_new_row_does_not_store_the_columns_default(self):
        """The default is only the formula's fallback, never a stored value."""
        definition = _family_schema({"default": 18})["fields"]["family_records"]
        rows = svc.coerce_value(definition, [{"born": 1850}])
        assert rows[0]["age"] is None

    def test_a_plain_columns_default_is_still_stored(self):
        definition = {
            "type": "list",
            "columns": [{"key": "qty", "type": "number", "default": 1}],
        }
        assert svc.coerce_value(definition, [{}]) == [{"qty": 1}]


class TestSaving:
    """Saving a character never writes a derived cell into its data."""

    @pytest.fixture
    def character(self, client, admin_headers):
        client.post(
            "/api/characters/schemas", json={"document": _family_schema()}, headers=admin_headers
        )
        created = client.post(
            "/api/characters",
            json={
                "schema_ref": "family-demo",
                "name": "Edmund",
                "data": {"family_records": [{"name": "Ada", "born": 1850}]},
            },
            headers=admin_headers,
        ).json()
        yield created
        client.delete(f"/api/characters/{created['id']}", headers=admin_headers)
        client.delete("/api/characters/schemas/family-demo", headers=admin_headers)

    def test_creating_stores_the_cell_empty(self, character):
        assert character["data"]["family_records"][0]["age"] is None

    def test_the_response_computes_from_the_derived_cell(self, character):
        assert character["computed"]["total_age"] == 40

    def test_updating_keeps_the_cell_empty(self, client, admin_headers, character):
        body = client.put(
            f"/api/characters/{character['id']}",
            json={"data": {"campaign_year": 1900, "family_records": [
                {"name": "Ada Lovelace", "born": 1850, "age": None}
            ]}},
            headers=admin_headers,
        ).json()
        assert body["data"]["family_records"][0]["age"] is None
        assert body["computed"]["total_age"] == 50
