"""Tests for book-target scrapers and the interpreter primitives they need.

Driven by checked-in slices of real DriveThruRPG API responses
(``fixtures/drivethrurpg_*.json``) and the real shipped definition, so these
exercise nested-array traversal, ``select``/``pluck``, and the two-stage
search→detail flow against payloads that actually exist. Nothing hits the
network.
"""
import json
import os

import pytest
import yaml

from backend.addons import interpreter, transforms
from backend.addons.manifest import AddonManifest

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures")

_COMMUNITY_MANIFEST = os.path.normpath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "..",
        "community-add-ons",
        "scrapers",
        "drivethrurpg",
        "drivethrurpg.yml",
    )
)


def _fixture(name):
    with open(os.path.join(FIXTURE_DIR, name), encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture(scope="module")
def search_doc():
    return _fixture("drivethrurpg_search.json")


@pytest.fixture(scope="module")
def detail_doc():
    return _fixture("drivethrurpg_detail.json")


def _manifest(**overrides) -> AddonManifest:
    """A DriveThruRPG-shaped manifest, defined inline so these tests do not
    depend on the separate community-add-ons checkout being present."""
    base = {
        "id": "drivethrurpg",
        "name": "DriveThruRPG",
        "version": "1.0.0",
        "kind": "scraper",
        "target": "book",
        "attribution": "Data from DriveThruRPG",
        "source": {
            "url": "https://api.drivethrurpg.com/api/vBeta/products?keyword={query}",
            "format": "json",
            "cache_ttl": 3600,
        },
        "detail": {"url": "https://api.drivethrurpg.com/api/vBeta/products/{identity}"},
        "records": {"root": "$", "skip_when": {"field": "isGiftCert", "equals": True}},
        "search": {
            "fields": [
                {"field": "description.name", "weight": 1.0},
                {"field": "publisher.name", "weight": 0.2},
            ],
            "min_score": 0.4,
            "limit": 15,
            "label": {"template": "{description.name} — {publisher.name}"},
            "identity": {"from": "productId"},
            "url": {"template": "https://www.drivethrurpg.com/en/product/{identity}"},
        },
        "map": {
            "title": {"from": "description.name"},
            "description": {
                "from": "description.description",
                "transform": "strip_html",
            },
            "authors": {"from": "authors"},
            "artists": {"from": "artists"},
            "publisher": {"from": "publisher.name"},
            "publisher_url": {"from": "publisher.descriptions.url", "first": True},
            "isbn": {"from": "isbn"},
            "genres": {
                "from": "filters",
                "select": {"field": "parentId", "in": [10, 100]},
                "pluck": {
                    "from": "descriptions.name",
                    "select": {"field": "languageCode", "equals": "en"},
                    "first": True,
                },
            },
            "year": {"from": "dateAvailable"},
        },
    }
    base.update(overrides)
    return AddonManifest(**base)


@pytest.fixture(scope="module")
def manifest():
    return _manifest()


# ---------------------------------------------------------------------------
# Nested traversal
# ---------------------------------------------------------------------------


class TestNestedDig:
    def test_reads_a_nested_scalar(self, detail_doc):
        assert interpreter._dig(detail_doc, "description.name") == "Blades in the Dark"

    def test_maps_over_a_list_and_flattens(self, detail_doc):
        """`filters.descriptions.name` collects every name from every filter."""
        names = interpreter._dig(detail_doc, "filters.descriptions.name")
        assert isinstance(names, list)
        assert "Fantasy" in names

    def test_missing_path_is_none(self, detail_doc):
        assert interpreter._dig(detail_doc, "nope.not.here") is None

    def test_scalar_mid_path_is_none(self, detail_doc):
        assert interpreter._dig(detail_doc, "isbn.deeper") is None

    def test_empty_list_result_is_none(self):
        assert interpreter._dig({"items": []}, "items.name") is None


class TestSelectAndPluck:
    def test_select_narrows_by_equals(self, detail_doc):
        kept = interpreter._select(
            detail_doc["filters"],
            _manifest().map["genres"].pluck.select,  # languageCode == en
        )
        # `filters` entries are not language rows, so nothing matches.
        assert kept is None

    def test_select_narrows_by_in(self, detail_doc):
        spec = _manifest().map["genres"].select
        kept = interpreter._select(detail_doc["filters"], spec)
        assert kept is not None
        assert all(f["parentId"] in (10, 100) for f in kept)

    def test_select_returns_none_when_nothing_matches(self, detail_doc):
        from backend.addons.manifest import SelectSpec

        spec = SelectSpec(field="parentId", equals=999999999)
        assert interpreter._select(detail_doc["filters"], spec) is None

    def test_select_needs_a_test(self):
        from pydantic import ValidationError

        from backend.addons.manifest import SelectSpec

        with pytest.raises(ValidationError, match="equals.*in|'equals' or 'in'"):
            SelectSpec(field="x")

    def test_pluck_reads_the_english_name_from_each_kept_entry(
        self, detail_doc, manifest
    ):
        """The real reason both primitives exist: the genre taxonomy nests a
        per-language name list inside each filter."""
        fields = interpreter.map_record(detail_doc, manifest)
        assert fields["genres"] == ["Fantasy", "Dark Fantasy", "Steampunk"]

    def test_storefront_noise_is_excluded_from_genres(self, detail_doc, manifest):
        """Without the parentId filter, "PDF" and "English" would be genres."""
        genres = interpreter.map_record(detail_doc, manifest)["genres"]
        for noise in ("PDF", "English", "Staff Picks", "Physical Products"):
            assert noise not in genres


class TestFirst:
    def test_first_collapses_a_list_to_one_value(self, detail_doc, manifest):
        fields = interpreter.map_record(detail_doc, manifest)
        assert fields["publisher_url"] == "http://www.onesevendesign.com"
        assert isinstance(fields["publisher_url"], str)

    def test_without_first_a_repeated_path_stays_a_list(self, detail_doc):
        man = _manifest(map={"authors": {"from": "filters.descriptions.name"}})
        assert isinstance(interpreter.map_record(detail_doc, man)["authors"], list)

    def test_values_are_de_duplicated(self):
        """A flattened nested path can reach the same value by several routes."""
        man = _manifest(map={"authors": {"from": "rows.name"}})
        doc = {"rows": [{"name": "A"}, {"name": "a"}, {"name": "B"}]}
        assert interpreter.map_record(doc, man)["authors"] == ["A", "B"]


# ---------------------------------------------------------------------------
# strip_html
# ---------------------------------------------------------------------------


class TestStripHtml:
    def test_removes_tags(self):
        assert transforms.strip_html("<p>Hello <b>world</b></p>") == "Hello world"

    def test_keeps_paragraph_breaks(self):
        assert transforms.strip_html("<p>One</p><p>Two</p>") == "One\n\nTwo"

    def test_br_becomes_a_newline(self):
        assert transforms.strip_html("One<br>Two") == "One\nTwo"

    def test_unescapes_entities(self):
        assert transforms.strip_html("<p>Tom &amp; Jerry &mdash; ok</p>") == "Tom & Jerry — ok"

    def test_plain_text_is_only_trimmed(self):
        assert transforms.strip_html("  already plain  ") == "already plain"

    def test_collapses_runaway_blank_lines(self):
        assert "\n\n\n" not in transforms.strip_html("<p>a</p><p></p><p></p><p>b</p>")

    def test_real_store_copy_has_no_markup_left(self, detail_doc, manifest):
        text = interpreter.map_record(detail_doc, manifest)["description"]
        assert "<" not in text and "&nbsp;" not in text
        assert text.startswith("Winner:")


# ---------------------------------------------------------------------------
# Search against the summary payload
# ---------------------------------------------------------------------------


class TestBookSearch:
    def test_finds_the_book(self, search_doc, manifest):
        results = interpreter.search("Blades in the Dark", search_doc, manifest)
        assert results
        assert results[0]["label"].startswith("Blades in the Dark")

    def test_identity_is_the_product_id(self, search_doc, manifest):
        results = interpreter.search("Blades in the Dark", search_doc, manifest)
        assert all(r["identity"].isdigit() for r in results)

    def test_label_includes_the_publisher(self, search_doc, manifest):
        """The catalogue is full of near-misses, so the publisher disambiguates."""
        results = interpreter.search("Blades in the Dark", search_doc, manifest)
        assert any("One Seven" in r["label"] for r in results)

    def test_url_is_built_from_the_identity(self, search_doc, manifest):
        top = interpreter.search("Blades in the Dark", search_doc, manifest)[0]
        assert top["url"] == f"https://www.drivethrurpg.com/en/product/{top['identity']}"

    def test_exact_title_outranks_a_supplement(self, search_doc, manifest):
        results = interpreter.search("Blades in the Dark", search_doc, manifest)
        labels = [r["label"] for r in results]
        heist_deck = next(i for i, s in enumerate(labels) if "Heist Deck" in s)
        exact = next(i for i, s in enumerate(labels) if s.startswith("Blades in the Dark —"))
        assert exact < heist_deck

    def test_gift_certificates_are_skipped(self, manifest):
        doc = [
            {"productId": 1, "description": {"name": "Gift"}, "isGiftCert": True},
            {"productId": 2, "description": {"name": "Gift"}, "isGiftCert": False},
        ]
        results = interpreter.search("Gift", doc, manifest)
        assert [r["identity"] for r in results] == ["2"]


# ---------------------------------------------------------------------------
# Mapping the detail payload
# ---------------------------------------------------------------------------


class TestBookMapping:
    def test_maps_the_core_fields(self, detail_doc, manifest):
        fields = interpreter.map_record(detail_doc, manifest)
        assert fields["title"] == "Blades in the Dark"
        assert fields["authors"] == ["John Harper"]
        assert fields["artists"] == ["John Harper"]
        assert fields["publisher"] == "One Seven"

    def test_year_comes_from_an_iso_timestamp(self, detail_doc, manifest):
        assert interpreter.map_record(detail_doc, manifest)["year"] == 2016

    def test_empty_isbn_is_omitted(self, detail_doc, manifest):
        """Digital products usually have no ISBN; that must not propose a blank."""
        assert "isbn" not in interpreter.map_record(detail_doc, manifest)

    def test_publisher_is_a_scalar_not_a_link_list(self, detail_doc, manifest):
        """`publisher` (book) is a plain string, unlike `publishers` (system)."""
        assert isinstance(interpreter.map_record(detail_doc, manifest)["publisher"], str)

    def test_month_and_day_coerce_to_integers(self):
        man = _manifest(map={"month": {"from": "m"}, "day": {"from": "d"}})
        fields = interpreter.map_record({"m": "3", "d": 14}, man)
        assert fields["month"] == 3 and fields["day"] == 14

    def test_a_non_numeric_date_part_is_dropped(self):
        man = _manifest(map={"month": {"from": "m"}})
        assert interpreter.map_record({"m": "March"}, man) == {}


# ---------------------------------------------------------------------------
# The shipped community definition
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not os.path.isfile(_COMMUNITY_MANIFEST),
    reason="community-add-ons checkout not present",
)
class TestShippedDefinition:
    """Guards the real DriveThruRPG definition against drift in this engine."""

    @pytest.fixture(scope="class")
    @classmethod
    def shipped(cls):
        with open(_COMMUNITY_MANIFEST, encoding="utf-8") as fh:
            return AddonManifest(**yaml.safe_load(fh))

    def test_it_loads_and_validates(self, shipped):
        assert shipped.id == "drivethrurpg"
        assert shipped.target == "book"
        assert shipped.detail is not None

    def test_it_is_a_query_source(self, shipped):
        from backend.addons import service

        assert service.is_query_source(shipped)

    def test_it_searches_the_real_fixture(self, search_doc, shipped):
        results = interpreter.search("Blades in the Dark", search_doc, shipped)
        assert any(r["identity"] == "170689" for r in results)

    def test_it_maps_the_real_fixture(self, detail_doc, shipped):
        fields = interpreter.map_record(detail_doc, shipped)
        assert fields["title"] == "Blades in the Dark"
        assert fields["authors"] == ["John Harper"]
        assert fields["year"] == 2016
        assert fields["genres"] == ["Fantasy", "Dark Fantasy", "Steampunk"]
        assert fields["publisher_url"] == "http://www.onesevendesign.com"

    def test_it_links_back_to_the_product_page(self, detail_doc, shipped):
        """The user should be able to revisit the source the data came from."""
        urls = interpreter.map_record(detail_doc, shipped, "170689")["urls"]
        assert urls == [
            {
                "label": "DriveThruRPG",
                "url": "https://www.drivethrurpg.com/en/product/170689",
            }
        ]

    def test_its_product_links_carry_no_affiliate_code(self, detail_doc, shipped):
        """Importing someone else's referral tag into a user's own library is
        not something a metadata fetch should do."""
        urls = interpreter.map_record(detail_doc, shipped, "170689")["urls"]
        assert urls
        assert all("affiliate" not in u["url"] and "?" not in u["url"] for u in urls)
