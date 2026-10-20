"""The folder naming pattern language (issues #521 and #522).

The examples are the reporters' own filenames: if these stop reading, the
feature has stopped doing the one thing it was asked for.
"""
import pytest

from backend.services.filename_rules.pattern import (
    FIELDS,
    READ_FIELDS,
    PatternError,
    clean_value,
    parse,
)

READ_PATTERN = "{system} - [{publisher}] - {*} - {title}< (v{version}, {year})>"


class TestReading:
    def test_reads_the_title_out_of_a_structured_name(self):
        read = parse(READ_PATTERN).read(
            "D&D5e - [Loot Tavern] - adventure L2,7,12 - Crystallica (v0.99, 2026).pdf"
        )
        assert read == {
            "title": "Crystallica",
            "publisher": "Loot Tavern",
            "version": "0.99",
            "year": 2026,
        }

    def test_keeps_unicode_punctuation_in_the_title(self):
        read = parse(READ_PATTERN).read(
            "Fatherfog 0e - [EveVsEvil] - adventure one-shot - "
            "Can You Take Me Higher？ (v2, 2026).pdf"
        )
        assert read["title"] == "Can You Take Me Higher？"

    def test_an_optional_part_may_be_absent(self):
        read = parse(READ_PATTERN).read("D&D5e - [Loot Tavern] - adventure - Plain.pdf")
        assert read == {"title": "Plain", "publisher": "Loot Tavern"}

    def test_a_name_that_does_not_fit_reads_as_none(self):
        assert parse(READ_PATTERN).read("random.pdf") is None

    def test_literals_ignore_case_and_whitespace_width(self):
        read = parse("{title} BY {authors}").read("Big Book   by Alice, Bob & Carol.pdf")
        assert read == {"title": "Big Book", "authors": ["Alice", "Bob", "Carol"]}

    def test_a_year_must_be_four_digits(self):
        pattern = parse("{title} {year}")
        assert pattern.read("Curse of Strahd 2016.pdf") == {"title": "Curse of Strahd", "year": 2016}
        assert pattern.read("Curse of Strahd 16.pdf") is None

    def test_folder_and_date_fields_must_match_but_are_not_kept(self):
        read = parse("{category} - {title} - {date}").read("Core - Rules - 2024-05-01.pdf")
        assert read == {"title": "Rules"}

    def test_a_name_without_an_extension_still_reads(self):
        assert parse("{title}").read("README") == {"title": "README"}

    def test_isbn_and_product_code(self):
        read = parse("{title} [{isbn}] {product_code}").read("Book [978-0-7869-6560-0] WTC123.pdf")
        assert read == {"title": "Book", "isbn": "978-0-7869-6560-0", "product_code": "WTC123"}

    def test_an_empty_title_is_no_match(self):
        # `{title}` inside an optional group can match nothing.
        assert parse("X<{title}>").read("X.pdf") is None


WRITE_PATTERN = "{system} - [{publisher}] - {title}< (v{version}, {year})>"


class TestWriting:
    def test_fills_every_field(self):
        name, missing = parse(WRITE_PATTERN).render(
            {"system": "D&D 5e", "publisher": "Loot Tavern", "title": "Crystallica",
             "version": "0.99", "year": "2026"},
            ".pdf",
        )
        assert (name, missing) == ("D&D 5e - [Loot Tavern] - Crystallica (v0.99, 2026).pdf", [])

    def test_drops_an_optional_part_with_an_empty_field(self):
        name, _ = parse(WRITE_PATTERN).render(
            {"system": "D&D 5e", "publisher": "Loot Tavern", "title": "Crystallica", "version": "1"},
            ".pdf",
        )
        assert name == "D&D 5e - [Loot Tavern] - Crystallica.pdf"

    def test_reports_missing_required_fields_instead_of_writing_a_hole(self):
        assert parse(WRITE_PATTERN).render({"system": "D&D 5e", "title": "T"}, ".pdf") == (
            None,
            ["publisher"],
        )

    def test_an_empty_result_is_reported_as_a_missing_title(self):
        assert parse("<{title}>").render({}, ".pdf") == (None, ["title"])

    def test_cleans_values_for_the_filesystem(self):
        name, _ = parse("{title}").render({"title": 'Curse of Strahd: "Re/loaded"?'}, ".pdf")
        assert name == "Curse of Strahd - Re-loaded.pdf"

    def test_a_wildcard_pattern_cannot_write(self):
        pattern = parse(READ_PATTERN)
        assert not pattern.renderable
        with pytest.raises(PatternError):
            pattern.render({"title": "x"})

    def test_strips_trailing_dots_and_spaces(self):
        assert parse("{title}").render({"title": "Book..."}, ".pdf")[0] == "Book.pdf"


class TestCleanValue:
    def test_colon_becomes_a_dash(self):
        assert clean_value("A:B") == "A - B"

    def test_none_is_empty(self):
        assert clean_value(None) == ""

    def test_control_characters_go(self):
        assert clean_value("a\x00b\tc") == "abc"


class TestParsing:
    @pytest.mark.parametrize(
        "source, message",
        [
            ("", "empty"),
            ("x" * 501, "too long"),
            ("{titel}", "Unknown field"),
            ("{system}", "needs a {title}"),
            ("{title} - {title}", "more than once"),
            ("{title}{year}", "something between them"),
            ("{title}<{year}>", "something between them"),
            ("{title} <{year}", "never closed"),
            ("{title}>", "never opened"),
            ("{title}< <{year}>>", "nested"),
            ("<x>{title}", "at least one {field}"),
            ("{title} {", "not part of a {field}"),
            ("{{title}}", "not part of a {field}"),
            ("{system}/{title}", "cannot contain"),
            ("{title}\\x", "cannot contain"),
            ("<a/{title}>", "cannot contain"),
        ],
    )
    def test_rejects_with_a_useful_message(self, source, message):
        with pytest.raises(PatternError, match=message.replace("{", r"\{").replace("}", r"\}")):
            parse(source)

    def test_field_names_ignore_case_and_padding(self):
        assert parse("{ Title } ({YEAR})").fields == ["title", "year"]

    def test_fields_lists_named_fields_in_order(self):
        assert parse(READ_PATTERN).fields == ["system", "publisher", "title", "version", "year"]

    def test_read_fields_are_a_subset_of_fields(self):
        assert set(READ_FIELDS) <= set(FIELDS)

    def test_keeps_the_trimmed_source(self):
        assert parse("  {title}  ").source == "{title}"
