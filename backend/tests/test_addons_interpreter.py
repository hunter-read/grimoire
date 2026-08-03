"""Tests for the declarative add-on interpreter and its transforms.

Driven by a checked-in slice of the real TTRPG Wiki catalogue
(``fixtures/ttrpg_wiki_systems.json``) and the real shipped definition, so these
exercise the engine against data and a manifest that actually exist rather than
an idealised toy. Nothing here touches the network.
"""
import json
import os

import pytest
import yaml

from backend.addons import interpreter, transforms
from backend.addons.interpreter import AddonDataError
from backend.addons.manifest import AddonManifest

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures")

# The shipped TTRPG Wiki definition, when the community-add-ons checkout is a
# sibling of this repo.  Tests that need it skip cleanly when it is absent (CI
# clones only this repo).
_COMMUNITY_MANIFEST = os.path.normpath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "..",
        "community-add-ons",
        "scrapers",
        "ttrpg-wiki",
        "ttrpg-wiki.yml",
    )
)


@pytest.fixture(scope="module")
def systems_doc():
    with open(os.path.join(FIXTURE_DIR, "ttrpg_wiki_systems.json"), encoding="utf-8") as fh:
        return json.load(fh)


def _manifest(**overrides) -> AddonManifest:
    """A TTRPG-Wiki-shaped manifest, defined inline so these tests do not
    depend on the separate community-add-ons checkout being present."""
    base = {
        "id": "ttrpg-wiki",
        "name": "TTRPG Wiki",
        "version": "1.0.0",
        "kind": "scraper",
        "target": "game-system",
        "attribution": "Data from TTRPG Wiki",
        "source": {
            "url": "https://ttrpgwiki.com/data/systems.json",
            "format": "json",
            "cache_ttl": 86400,
        },
        "records": {"root": "$", "skip_when": {"field": "hidden", "equals": True}},
        "search": {
            "fields": [
                {"field": "name", "weight": 1.0, "strategy": "fuzzy"},
                {"field": "edition", "weight": 0.3, "strategy": "fuzzy"},
            ],
            "min_score": 0.55,
            "limit": 10,
            "label": {"template": "{name} ({edition})"},
            "identity": {"template": "{name}", "transform": "slugify"},
            "url": {"template": "https://ttrpgwiki.com/systems/{identity}"},
        },
        "map": {
            "description": {"from": "tagline"},
            "publishers": {"from": "publisher", "as": "link_list"},
            "year": {"from": "year"},
            "license": {"from": "license"},
            "system_family": {"from": "family"},
            "edition": {"from": "edition"},
            "genres": {"from": "genre", "transform": "titlecase"},
            "dice_materials": {"from": "dice"},
            "tags": {"from": "tags"},
            "urls": [
                {"label": "Official site", "from": "officialUrl", "when_present": True},
                {
                    "label": "DriveThruRPG",
                    "from": "dtrpgUrl",
                    "when_present": True,
                    "transform": "strip_query",
                },
            ],
        },
    }
    base.update(overrides)
    return AddonManifest(**base)


@pytest.fixture(scope="module")
def manifest():
    return _manifest()


# ---------------------------------------------------------------------------
# Record extraction
# ---------------------------------------------------------------------------


class TestExtractRecords:
    def test_reads_bare_top_level_array(self, systems_doc, manifest):
        records = interpreter.extract_records(systems_doc, manifest)
        assert len(records) == len(systems_doc) - 1  # one fixture entry is hidden

    def test_skip_when_drops_matching_records(self, systems_doc, manifest):
        names = {r["name"] for r in interpreter.extract_records(systems_doc, manifest)}
        assert "Dungeons & Dragons 4th Edition" not in names

    def test_without_skip_when_everything_is_kept(self, systems_doc):
        man = _manifest(records={"root": "$"})
        assert len(interpreter.extract_records(systems_doc, man)) == len(systems_doc)

    def test_dotted_root_path(self):
        man = _manifest(records={"root": "data.systems"})
        doc = {"data": {"systems": [{"name": "A"}, {"name": "B"}]}}
        assert len(interpreter.extract_records(doc, man)) == 2

    def test_non_list_root_is_an_error(self, manifest):
        with pytest.raises(AddonDataError, match="expected a list"):
            interpreter.extract_records({"not": "a list"}, manifest)

    def test_missing_root_path_is_an_error(self):
        man = _manifest(records={"root": "nope.missing"})
        with pytest.raises(AddonDataError):
            interpreter.extract_records({"data": {}}, man)

    def test_non_dict_entries_are_ignored(self, manifest):
        assert interpreter.extract_records(["a", 1, None], manifest) == []


# ---------------------------------------------------------------------------
# Search and ranking
# ---------------------------------------------------------------------------


class TestSearch:
    def test_exact_name_ranks_first(self, systems_doc, manifest):
        results = interpreter.search("Blades in the Dark", systems_doc, manifest)
        assert results[0]["identity"] == "blades-in-the-dark"

    def test_ampersand_name_matches_and_slugifies(self, systems_doc, manifest):
        results = interpreter.search("Dungeons & Dragons", systems_doc, manifest)
        assert results[0]["identity"] == "dungeons-dragons"

    def test_hidden_records_are_never_returned(self, systems_doc, manifest):
        results = interpreter.search("Dungeons & Dragons", systems_doc, manifest)
        assert all("4th" not in r["label"] for r in results)

    def test_label_and_url_are_built_from_templates(self, systems_doc, manifest):
        top = interpreter.search("Call of Cthulhu", systems_doc, manifest)[0]
        assert top["label"] == "Call of Cthulhu (7th Edition)"
        assert top["url"] == "https://ttrpgwiki.com/systems/call-of-cthulhu"

    def test_scores_are_ordered_and_bounded(self, systems_doc, manifest):
        results = interpreter.search("Pathfinder", systems_doc, manifest)
        scores = [r["score"] for r in results]
        assert scores == sorted(scores, reverse=True)
        assert all(0.0 <= s <= 1.0 for s in scores)

    def test_min_score_filters_weak_matches(self, systems_doc):
        loose = _manifest(
            search={
                "fields": [{"field": "name"}],
                "min_score": 0.0,
                "label": {"from": "name"},
                "identity": {"from": "name"},
            }
        )
        strict = _manifest(
            search={
                "fields": [{"field": "name"}],
                "min_score": 0.99,
                "label": {"from": "name"},
                "identity": {"from": "name"},
            }
        )
        assert len(interpreter.search("xyzzy", systems_doc, loose)) > len(
            interpreter.search("xyzzy", systems_doc, strict)
        )

    def test_limit_caps_results(self, systems_doc):
        man = _manifest(
            search={
                "fields": [{"field": "name"}],
                "min_score": 0.0,
                "limit": 2,
                "label": {"from": "name"},
                "identity": {"from": "name"},
            }
        )
        assert len(interpreter.search("a", systems_doc, man)) == 2

    def test_no_match_returns_empty_not_an_error(self, systems_doc, manifest):
        assert interpreter.search("zzzzzzzzzz nonexistent", systems_doc, manifest) == []

    def test_blank_query_returns_nothing(self, systems_doc, manifest):
        assert interpreter.search("", systems_doc, manifest) == []

    def test_exact_strategy_requires_an_exact_match(self, systems_doc):
        man = _manifest(
            search={
                "fields": [{"field": "name", "strategy": "exact"}],
                "min_score": 0.5,
                "label": {"from": "name"},
                "identity": {"from": "name"},
            }
        )
        assert len(interpreter.search("Cairn", systems_doc, man)) == 1
        assert interpreter.search("Cair", systems_doc, man) == []

    def test_contains_strategy_matches_substrings(self, systems_doc):
        man = _manifest(
            search={
                "fields": [{"field": "name", "strategy": "contains"}],
                "min_score": 0.5,
                "label": {"from": "name"},
                "identity": {"from": "name"},
            }
        )
        assert len(interpreter.search("Cthulhu", systems_doc, man)) == 1

    def test_prefix_match_beats_raw_ratio(self, systems_doc):
        """"Pathfinder" against "Pathfinder (2nd Edition…)" should score high
        despite the large length difference."""
        results = interpreter.search("Pathfinder", systems_doc, _manifest())
        assert results[0]["score"] > 0.8


class TestFindRecord:
    def test_round_trips_a_search_identity(self, systems_doc, manifest):
        identity = interpreter.search("Mothership", systems_doc, manifest)[0]["identity"]
        record = interpreter.find_record(identity, systems_doc, manifest)
        assert record is not None and record["name"] == "Mothership"

    def test_unknown_identity_returns_none(self, systems_doc, manifest):
        assert interpreter.find_record("no-such-thing", systems_doc, manifest) is None

    def test_hidden_records_are_unreachable(self, systems_doc, manifest):
        assert (
            interpreter.find_record("dungeons-dragons-4th-edition", systems_doc, manifest)
            is None
        )

    def test_falls_back_to_positional_identity(self, systems_doc):
        man = _manifest(
            search={"fields": [{"field": "name"}], "label": {"from": "name"}}
        )
        results = interpreter.search("Cairn", systems_doc, man)
        assert results[0]["identity"].startswith("#")
        assert interpreter.find_record(results[0]["identity"], systems_doc, man)


# ---------------------------------------------------------------------------
# Field mapping
# ---------------------------------------------------------------------------


class TestMapRecord:
    def _mapped(self, systems_doc, manifest, identity):
        record = interpreter.find_record(identity, systems_doc, manifest)
        assert record is not None
        return interpreter.map_record(record, manifest)

    def test_maps_the_expected_fields(self, systems_doc, manifest):
        fields = self._mapped(systems_doc, manifest, "blades-in-the-dark")
        assert fields["description"]
        assert fields["year"] == 2017
        assert fields["system_family"] == "FitD"
        assert fields["edition"] == "1st Edition"
        assert fields["license"] == "CC BY 3.0"

    def test_publishers_become_link_list_objects(self, systems_doc, manifest):
        fields = self._mapped(systems_doc, manifest, "blades-in-the-dark")
        assert fields["publishers"] == [
            {"name": "Evil Hat Productions", "url": ""}
        ]

    def test_genres_are_title_cased_into_a_list(self, systems_doc, manifest):
        fields = self._mapped(systems_doc, manifest, "dungeons-dragons")
        assert fields["genres"] == ["Fantasy"]

    def test_scalar_becomes_a_single_element_list_field(self, systems_doc, manifest):
        fields = self._mapped(systems_doc, manifest, "dungeons-dragons")
        assert fields["dice_materials"] == ["d20"]

    def test_tags_pass_through_as_a_list(self, systems_doc, manifest):
        fields = self._mapped(systems_doc, manifest, "dungeons-dragons")
        assert "Tactical" in fields["tags"]

    def test_year_is_an_integer(self, systems_doc, manifest):
        fields = self._mapped(systems_doc, manifest, "dungeons-dragons")
        assert isinstance(fields["year"], int)

    def test_urls_carry_their_labels(self, systems_doc, manifest):
        fields = self._mapped(systems_doc, manifest, "dungeons-dragons")
        labels = {u["label"] for u in fields["urls"]}
        assert "Official site" in labels

    def test_affiliate_parameters_are_stripped_from_store_links(
        self, systems_doc, manifest
    ):
        """The source appends its own affiliate_id; importing that into a
        user's library would monetise their data on someone else's behalf."""
        fields = self._mapped(systems_doc, manifest, "blades-in-the-dark")
        dtrpg = [u for u in fields["urls"] if u["label"] == "DriveThruRPG"]
        assert dtrpg, "fixture should include a DriveThruRPG link"
        assert "affiliate_id" not in dtrpg[0]["url"]
        assert "?" not in dtrpg[0]["url"]

    def test_when_present_omits_missing_entries(self, systems_doc, manifest):
        """Blades has no officialUrl in the source, so no such entry appears."""
        fields = self._mapped(systems_doc, manifest, "blades-in-the-dark")
        assert all(u["label"] != "Official site" for u in fields.get("urls", []))

    def test_absent_source_fields_are_omitted_entirely(self, systems_doc):
        """A field with no data must not be proposed as an empty value — that
        would offer to blank out something the user already filled in."""
        man = _manifest(map={"license": {"from": "noSuchField"}})
        record = interpreter.find_record("cairn", systems_doc, _manifest())
        assert interpreter.map_record(record, man) == {}


    def test_identity_is_available_to_map_templates(self, systems_doc, manifest):
        """A link back to the source page needs the identity, which for this
        source is derived from the name rather than being a field."""
        man = _manifest(
            map={"urls": {"label": "Src", "template": "https://x/s/{identity}"}}
        )
        record = interpreter.find_record("cairn", systems_doc, manifest)
        fields = interpreter.map_record(record, man, "cairn")
        assert fields["urls"] == [{"label": "Src", "url": "https://x/s/cairn"}]

    def test_an_identity_template_without_an_identity_is_dropped(self, systems_doc):
        """Rather than emitting a link with a hole in it."""
        man = _manifest(map={"urls": {"label": "Src", "template": "https://x/s/{identity}"}})
        record = interpreter.find_record("cairn", systems_doc, _manifest())
        fields = interpreter.map_record(record, man)
        assert fields.get("urls") in (None, [])

    def test_split_produces_a_list(self):
        man = _manifest(map={"genres": {"from": "g", "split": "/"}})
        assert interpreter.map_record({"g": "a / b/c"}, man)["genres"] == ["a", "b", "c"]

    def test_template_mapping(self):
        man = _manifest(map={"edition": {"template": "{a} {b}"}})
        assert interpreter.map_record({"a": "2nd", "b": "Ed"}, man)["edition"] == "2nd Ed"

    def test_list_target_joins_when_mapped_to_a_scalar_field(self):
        man = _manifest(map={"license": {"from": "l"}})
        assert interpreter.map_record({"l": ["MIT", "OGL"]}, man)["license"] == "MIT, OGL"

    def test_booleans_are_not_mapped(self):
        man = _manifest(map={"license": {"from": "l"}})
        assert interpreter.map_record({"l": True}, man) == {}

    def test_empty_values_are_dropped(self):
        man = _manifest(map={"license": {"from": "l"}, "edition": {"from": "e"}})
        assert interpreter.map_record({"l": "", "e": "   "}, man) == {}


# ---------------------------------------------------------------------------
# Transforms
# ---------------------------------------------------------------------------


class TestTransforms:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("Dungeons & Dragons", "dungeons-dragons"),
            ("Blades in the Dark", "blades-in-the-dark"),
            ("Café Noir", "cafe-noir"),
            ("Don't Rest Your Head", "dont-rest-your-head"),
            ("  Spaced  Out  ", "spaced-out"),
            ("VI·VIII·X", "viviiix"),
        ],
    )
    def test_slugify(self, raw, expected):
        assert transforms.slugify(raw) == expected

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("fantasy", "Fantasy"),
            ("post-apocalyptic", "Post-Apocalyptic"),
            ("science fiction and horror", "Science Fiction and Horror"),
            ("the lord of the rings", "The Lord of the Rings"),
        ],
    )
    def test_titlecase(self, raw, expected):
        assert transforms.titlecase(raw) == expected

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("2d6", "2D6"),
            ("d20", "D20"),
            ("d6 dice pool", "D6 dice pool"),
            ("Diceless", "Diceless"),
            ("4dF (Fudge dice)", "4DF (Fudge dice)"),
        ],
    )
    def test_upper_dice(self, raw, expected):
        assert transforms.upper_dice(raw) == expected

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("https://x.com/p/1?affiliate_id=99", "https://x.com/p/1"),
            ("https://x.com/p/1#frag", "https://x.com/p/1"),
            ("https://x.com/p/1", "https://x.com/p/1"),
            ("not a url", "not a url"),
        ],
    )
    def test_strip_query(self, raw, expected):
        assert transforms.strip_query(raw) == expected

    def test_apply_chains_in_order(self):
        assert transforms.apply("  Hello World  ", ["trim", "lower"]) == "hello world"

    def test_apply_accepts_a_single_name(self):
        assert transforms.apply("abc", "upper") == "ABC"

    def test_apply_with_no_transform_is_identity(self):
        assert transforms.apply("abc", None) == "abc"

    def test_unknown_transform_is_ignored(self):
        assert transforms.apply("abc", ["definitely-not-real"]) == "abc"


# ---------------------------------------------------------------------------
# The shipped community definition
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not os.path.isfile(_COMMUNITY_MANIFEST),
    reason="community-add-ons checkout not present",
)
class TestShippedDefinition:
    """Guards the real TTRPG Wiki definition against drift in this engine.

    Skipped when the sibling checkout is absent, so CI for this repo alone still
    passes — but locally, a change here that breaks the shipped definition fails
    loudly instead of being discovered at runtime.
    """

    @pytest.fixture(scope="class")
    @classmethod
    def shipped(cls):
        with open(_COMMUNITY_MANIFEST, encoding="utf-8") as fh:
            return AddonManifest(**yaml.safe_load(fh))

    def test_it_loads_and_validates(self, shipped):
        assert shipped.id == "ttrpg-wiki"
        assert shipped.source is not None

    def test_it_searches_the_real_fixture(self, systems_doc, shipped):
        results = interpreter.search("Blades in the Dark", systems_doc, shipped)
        assert results[0]["identity"] == "blades-in-the-dark"

    def test_it_maps_the_real_fixture(self, systems_doc, shipped):
        record = interpreter.find_record("fate-core", systems_doc, shipped)
        fields = interpreter.map_record(record, shipped, "fate-core")
        assert fields["system_family"] == "Fate"
        assert fields["year"] == 2013
        assert fields["publishers"][0]["name"] == "Evil Hat Productions"

    def test_it_links_back_to_the_wiki_page(self, systems_doc, shipped):
        """Pulling from the wiki should also record where the data came from."""
        record = interpreter.find_record("cairn", systems_doc, shipped)
        urls = interpreter.map_record(record, shipped, "cairn")["urls"]
        assert {
            "label": "TTRPG Wiki",
            "url": "https://ttrpgwiki.com/systems/cairn",
        } in urls
