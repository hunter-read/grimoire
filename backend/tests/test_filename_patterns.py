"""The folder naming pattern language (issues #521 and #522).

The examples are the reporters' own filenames: if these stop reading, the
feature has stopped doing the one thing it was asked for.
"""
import random
import re
import time

import pytest

from backend.services.filename_rules import pattern as pattern_module
from backend.services.filename_rules.pattern import (
    FIELDS,
    MAX_PLACEHOLDERS,
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


class TestLengthCaps:
    """``{field:N}`` caps what writing puts in a field (issue #938)."""

    def test_cuts_a_long_value_to_the_cap(self):
        name, _ = parse("{title:10}").render({"title": "Tomb of Annihilation"}, ".pdf")
        assert name == "Tomb of An.pdf"

    def test_a_short_value_is_left_alone(self):
        assert parse("{title:80}").render({"title": "Crystallica"}, ".pdf")[0] == "Crystallica.pdf"

    def test_counts_the_cleaned_value(self):
        # The colon is written as " - " before the cut, and the dash it leaves
        # at the end is dropped rather than kept dangling.
        name, _ = parse("{title:17}").render({"title": "Curse of Strahd: Reloaded"}, ".pdf")
        assert name == "Curse of Strahd.pdf"

    def test_a_cut_does_not_leave_an_open_bracket(self):
        name, _ = parse("{title:7}").render({"title": "Title (Revised)"}, ".pdf")
        assert name == "Title.pdf"

    def test_a_value_of_nothing_but_trimmable_characters_is_kept(self):
        assert parse("{title:2}").render({"title": "(((("}, "")[0] == "(("

    def test_caps_every_field_including_optional_ones(self):
        pattern = parse("{publisher:3} - {title:5}< ({authors:4})>")
        name, _ = pattern.render(
            {"publisher": "Loot Tavern", "title": "Crystallica", "authors": "Ann Smith"}, ".pdf"
        )
        assert name == "Loo - Cryst (Ann).pdf"

    def test_reading_ignores_the_cap(self):
        pattern = parse("{publisher:3} - {title:5}")
        assert pattern.read("Loot Tavern - Crystallica.pdf") == {
            "publisher": "Loot Tavern",
            "title": "Crystallica",
        }

    def test_written_gives_a_value_as_the_pattern_writes_it(self):
        pattern = parse("{title:5} ({year})")
        assert pattern.written("title", "Crystallica") == "Cryst"
        assert pattern.written("year", "2026") == "2026"
        assert pattern.written("publisher", "A: B") == "A - B"

    def test_a_capped_field_still_counts_once(self):
        with pytest.raises(PatternError, match="more than once"):
            parse("{title:5} - {title}")

    def test_padding_around_the_cap_is_allowed(self):
        assert parse("{ Title : 80 }").parts[0].limit == 80

    @pytest.mark.parametrize("source", ["{title:}", "{title:0}", "{title:256}", "{title:-5}",
                                        "{title:x}", "{title:1.5}", "{title:\u0663}"])
    def test_rejects_a_cap_that_is_not_a_usable_length(self, source):
        with pytest.raises(PatternError, match="whole number from 1 to 255"):
            parse(source)

    def test_a_wildcard_cannot_have_a_cap(self):
        with pytest.raises(PatternError, match="cannot have a length"):
            parse("{*:5} - {title}")


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


def _reference_regex(pattern):
    """The single regex reading used to be: still the definition of a match."""

    def literal(text):
        return r"\s+".join(re.escape(chunk) for chunk in re.split(r"\s+", text))

    def part_regex(part):
        if isinstance(part, pattern_module._Optional):
            return "(?:" + "".join(part_regex(p) for p in part.parts) + ")?"
        if isinstance(part, pattern_module._Field):
            if part.name == "*":
                return r".+?"
            return f"(?P<{part.name}>{pattern_module._FIELD_REGEX[part.name]})"
        return literal(part)

    return re.compile("^" + "".join(part_regex(p) for p in pattern.parts) + "$", re.IGNORECASE)


def _reference_read(pattern, filename):
    match = _reference_regex(pattern).match(pattern_module._stem(filename))
    if not match:
        return None
    return {k: v for k, v in match.groupdict().items() if v is not None}


class TestMatchingSemantics:
    """Reading settles on the same match the pattern's regex would."""

    @pytest.mark.parametrize(
        "source, name, expected",
        [
            # A lazy field takes as little as it can: the first " - " splits.
            ("{title} - {*}", "A - B - C.pdf", {"title": "A"}),
            ("{*} - {title}", "A - B - C.pdf", {"title": "B - C"}),
            # An optional part is taken when it can be.
            ("{title}< ({year})>", "Book (2020).pdf", {"title": "Book", "year": 2020}),
            ("{title}< ({year})>", "Book (20).pdf", {"title": "Book (20)"}),
            # A year is four digits, so it can't swallow the title's number.
            ("{title} {year}", "Top 10 2019.pdf", {"title": "Top 10", "year": 2019}),
            # Whitespace in a literal matches any run of it, and a field after a
            # trailing run starts at the first character that isn't whitespace.
            ("{publisher} -  {title}", "Acme -    Book.pdf", {"publisher": "Acme", "title": "Book"}),
            ("{title} by {authors}", "Tome BY  Ann and Bo.pdf", {"title": "Tome", "authors": ["Ann", "Bo"]}),
            # The longest ISBN wins, as a greedy match would have it.
            ("{title} {isbn}", "Book 1234567890123.pdf", {"title": "Book", "isbn": "1234567890123"}),
            # A trailing extension is not part of the stem; a dot inside it is.
            ("{title} v{version}", "Rules v1.2.pdf", {"title": "Rules", "version": "1.2"}),
            # A newline is not "anything", but whitespace in a literal takes it.
            ("{title} {year}", "A\nB 2020.pdf", None),
            ("{title} {year}", "AB\n2020.pdf", {"title": "AB", "year": 2020}),
        ],
    )
    def test_tricky_names(self, source, name, expected):
        assert parse(source).read(name) == expected

    def test_agrees_with_the_regex_on_a_spread_of_names(self):
        rng = random.Random(521)
        sources = [
            READ_PATTERN,
            WRITE_PATTERN,
            "{title}< - {publisher}>< ({year})>",
            "{*} {title} {date}",
            "{title}<, {version}> [{isbn}]",
            "{category} - {title}< by {authors}>",
            "<{publisher} - >{title} {*}",
        ]
        alphabet = "ab -()[],v.0123456789Xx_ \t"
        for source in sources:
            pattern = parse(source)
            for _ in range(300):
                name = "".join(rng.choice(alphabet) for _ in range(rng.randint(1, 40)))
                # Seed some names with the pattern's own literals so they match.
                if rng.random() < 0.5:
                    name = re.sub(r"\{[^}]*\}", lambda m: rng.choice(["x", "2020", "a b"]), source)
                    name = name.replace("<", "").replace(">", "") + ".pdf"
                assert pattern._matcher.match(pattern_module._stem(name)) == _reference_read(
                    pattern, name
                ), (source, name)

    def test_a_name_that_cannot_fit_is_settled_quickly(self):
        """Ten wildcards against a 255-character name used to backtrack for minutes."""
        pattern = parse("{*} " * 10 + "- {title}")
        started = time.perf_counter()
        assert pattern.read("a " * 127 + "a") is None
        assert time.perf_counter() - started < 1

    def test_the_worst_pattern_allowed_is_still_quick(self):
        pattern = parse("{*}-" * (MAX_PLACEHOLDERS - 1) + "{title}!")
        started = time.perf_counter()
        assert pattern.read("-" * 255) is None
        assert time.perf_counter() - started < 1

    def test_a_name_longer_than_any_file_is_not_read(self):
        assert parse("{title}").read("a" * 2000 + ".pdf") is None

    def test_too_many_placeholders_are_refused(self):
        with pytest.raises(PatternError, match=f"at most {MAX_PLACEHOLDERS}"):
            parse("{*} " * MAX_PLACEHOLDERS + "{title}")
        parse("{*} " * (MAX_PLACEHOLDERS - 1) + "{title}")
