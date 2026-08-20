"""Tests for sidecar serialization (issue #300)."""
import json
from xml.etree import ElementTree

import pytest
import yaml

from backend.indexer.metadata import parse_opf_metadata
from backend.metadata.formats import (
    ALL_FORMATS,
    is_grimoire_generated,
    render,
    render_json,
    render_nfo,
    render_opf,
    render_yaml,
    sidecar_path,
)

FIELDS = {
    "title": "Player's Handbook",
    "description": "The core rules.",
    "authors": ["Jeremy Crawford", "Mike Mearls"],
    "artists": ["Tyler Jacobson"],
    "publisher": "Wizards of the Coast",
    "genres": ["Fantasy"],
    "isbn": "9780786965606",
    "version": "5e",
    "language": "en",
    "license": "",
    "year": 2014,
    "month": 8,
    "day": 19,
    "category": "core",
    "urls": [{"label": "Official", "url": "https://dnd.wizards.com"}],
    "tags": ["core", "rules"],
    "cover_filename": "phb.jpg",
}


class TestSidecarPath:
    @pytest.mark.parametrize(
        "fmt,expected",
        [
            ("opf", "/lib/books/phb.opf"),
            ("nfo", "/lib/books/phb.nfo"),
            ("json", "/lib/books/phb.grimoire.json"),
            ("yaml", "/lib/books/phb.grimoire.yaml"),
        ],
    )
    def test_path_sits_next_to_the_content(self, fmt, expected):
        assert sidecar_path("/lib/books/phb.pdf", fmt) == expected

    def test_a_dotted_filename_keeps_all_but_the_last_suffix(self):
        assert sidecar_path("/lib/Vol.2 - Guide.pdf", "opf") == "/lib/Vol.2 - Guide.opf"

    def test_unknown_format_is_rejected(self):
        with pytest.raises(ValueError, match="unknown sidecar format"):
            sidecar_path("/lib/x.pdf", "epub")


class TestGeneratorMarker:
    @pytest.mark.parametrize("fmt", ALL_FORMATS)
    def test_every_format_marks_its_output(self, fmt):
        """Ownership is what makes 'never clobber a foreign file' enforceable."""
        assert is_grimoire_generated(render(FIELDS, fmt))

    def test_a_foreign_file_is_not_claimed(self):
        assert not is_grimoire_generated("<package><metadata/></package>")

    def test_render_rejects_an_unknown_format(self):
        with pytest.raises(ValueError, match="unknown sidecar format"):
            render(FIELDS, "cbz")


class TestOpf:
    def test_round_trips_through_the_importer(self, tmp_path):
        """The acceptance criterion: export then re-import reproduces the data.

        Guards against the drift the issue warns about — the exporter and the
        existing OPF parser must agree field for field, or a rescan after an
        export silently rewrites what it just wrote.
        """
        path = tmp_path / "phb.opf"
        path.write_text(render_opf(FIELDS), encoding="utf-8")

        parsed = parse_opf_metadata(str(path))

        assert parsed["title"] == FIELDS["title"]
        assert parsed["authors"] == FIELDS["authors"]
        assert parsed["description"] == FIELDS["description"]
        assert parsed["publisher"] == FIELDS["publisher"]
        assert parsed["year"] == 2014
        assert parsed["tags"] == ["core", "rules"]
        assert parsed["cover_image_filename"] == "phb.jpg"

    def test_creator_role_keeps_its_opf_prefix(self):
        """Calibre reads ``opf:role``; a bare ``role`` does not identify authors."""
        assert 'opf:role="aut"' in render_opf(FIELDS)

    def test_empty_fields_are_omitted_entirely(self):
        out = render_opf({"title": "Only A Title"})
        assert "dc:creator" not in out
        assert "dc:publisher" not in out
        assert "guide" not in out

    def test_no_cover_means_no_guide_section(self):
        assert "guide" not in render_opf({**FIELDS, "cover_filename": ""})


class TestNfo:
    def test_uses_the_elements_jellyfin_reads(self):
        out = render_nfo(FIELDS)
        assert "<plot>The core rules.</plot>" in out
        assert "<year>2014</year>" in out
        assert "<premiered>2014-08-19</premiered>" in out

    def test_multi_valued_fields_repeat_their_element(self):
        root = ElementTree.fromstring(render_nfo(FIELDS))
        assert [e.text for e in root.findall("author")] == FIELDS["authors"]
        assert [e.text for e in root.findall("tag")] == FIELDS["tags"]

    def test_control_characters_are_stripped(self):
        """XML 1.0 has no escape for these, so a consumer would reject the file."""
        out = render_nfo({"title": "T", "description": "bad\x00\x08text"})
        assert "\x00" not in out and "\x08" not in out
        assert ElementTree.fromstring(out).find("plot").text == "badtext"

    def test_newlines_in_a_description_survive(self):
        out = render_nfo({"title": "T", "description": "line one\nline two"})
        assert ElementTree.fromstring(out).find("plot").text == "line one\nline two"


class TestJson:
    def test_is_lossless(self):
        """OPF and NFO drop fields; this one is why nothing is lost."""
        payload = json.loads(render_json(FIELDS))
        for key, value in FIELDS.items():
            assert payload[key] == value

    def test_is_byte_stable_across_renders(self):
        """Keeps re-exports out of a user's git diffs and backup deltas."""
        assert render_json(FIELDS) == render_json(dict(reversed(list(FIELDS.items()))))

    def test_non_ascii_is_written_literally(self):
        assert "Æthelred" in render_json({"title": "Æthelred"})


class TestYaml:
    def test_is_lossless(self):
        payload = yaml.safe_load(render_yaml(FIELDS))
        for key, value in FIELDS.items():
            assert payload[key] == value

    def test_carries_exactly_what_json_carries(self):
        """The two lossless formats must not drift into describing a book differently."""
        assert yaml.safe_load(render_yaml(FIELDS)) == json.loads(render_json(FIELDS))

    def test_is_byte_stable_across_renders(self):
        assert render_yaml(FIELDS) == render_yaml(dict(reversed(list(FIELDS.items()))))

    def test_non_ascii_is_written_literally(self):
        """allow_unicode, so an accented title stays readable instead of escaping."""
        assert "Æthelred" in render_yaml({"title": "Æthelred"})

    def test_a_description_with_yaml_punctuation_round_trips(self):
        """Colons and newlines are what would break a naive hand-rolled emitter."""
        text = "Chapter 1: Intro\nCosts: $50 - a lot"
        assert yaml.safe_load(render_yaml({"title": "T", "description": text}))[
            "description"
        ] == text

    def test_lists_stay_block_style(self):
        """One item per line is the whole point of choosing YAML over JSON."""
        assert "- Jeremy Crawford\n" in render_yaml(FIELDS)

    def test_leads_with_a_human_readable_marker_comment(self):
        assert render_yaml(FIELDS).startswith("# Grimoire metadata sidecar v1\n")


class TestDatePrecision:
    """A bare year must not be inflated into a full date it does not support."""

    @pytest.mark.parametrize(
        "fields,expected",
        [
            ({"year": 2014, "month": 8, "day": 19}, "2014-08-19"),
            ({"year": 2014, "month": 8}, "2014-08"),
            ({"year": 2014}, "2014"),
        ],
    )
    def test_partial_dates_stay_partial(self, fields, expected):
        root = ElementTree.fromstring(render_nfo({"title": "T", **fields}))
        assert root.find("premiered").text == expected

    def test_no_year_means_no_date_element(self):
        root = ElementTree.fromstring(render_nfo({"title": "T", "month": 8}))
        assert root.find("premiered") is None
        assert root.find("year") is None
