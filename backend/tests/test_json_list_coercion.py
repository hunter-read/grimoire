"""Tests for the response-model coercion of free-form JSON list columns (issue #356).

The response models declare real element types (`list[str]`, `list[LinkEntry]`,
`list[PublisherRef]`) so generated clients get a usable shape instead of an
untyped node. Those columns are plain JSON though, so these tests pin the two
halves of that contract: the declared shape survives untouched, and a row
holding something else is normalized rather than raising — a response model that
rejects a stored row turns a plain GET into a 500.
"""
from backend.routers._json_list_coercion import (
    coerce_link_list,
    coerce_publisher_list,
    coerce_str_list,
)
from backend.routers.books._schemas import BookDetail
from backend.routers.favorites._schemas import FavoriteSystemItem
from backend.routers.systems._schemas import BookOut, SystemSummary
from backend.routers.tags._schemas import TaggedSystemItem


class TestCoerceStrList:
    def test_passes_through_a_plain_string_list(self):
        assert coerce_str_list(["Gygax", "Arneson"]) == ["Gygax", "Arneson"]

    def test_none_becomes_empty_list(self):
        assert coerce_str_list(None) == []

    def test_stringifies_scalars_and_trims(self):
        assert coerce_str_list([5, "  x  ", True]) == ["5", "x", "True"]

    def test_drops_nulls_blanks_and_containers(self):
        # A stringified dict/list would be worse than dropping it.
        assert coerce_str_list([None, "", "  ", {"a": 1}, ["b"]]) == []

    def test_wraps_a_bare_scalar(self):
        assert coerce_str_list("Solo") == ["Solo"]


class TestCoerceLinkList:
    def test_passes_through_link_dicts(self):
        entries = [{"label": "Publisher", "url": "https://example.com"}]
        assert coerce_link_list(entries) == entries

    def test_bare_string_becomes_a_labelless_url(self):
        assert coerce_link_list(["https://example.com"]) == [
            {"url": "https://example.com"}
        ]

    def test_none_becomes_empty_list(self):
        assert coerce_link_list(None) == []

    def test_drops_blanks_and_nulls(self):
        assert coerce_link_list([None, "", "   "]) == []


class TestCoercePublisherList:
    def test_passes_through_publisher_dicts(self):
        entries = [{"name": "TSR", "url": "https://tsr.example"}]
        assert coerce_publisher_list(entries) == entries

    def test_bare_string_becomes_a_named_publisher(self):
        assert coerce_publisher_list(["TSR"]) == [{"name": "TSR"}]

    def test_none_becomes_empty_list(self):
        assert coerce_publisher_list(None) == []

    def test_scanner_shape_without_url_is_preserved(self):
        # `indexer/scan.py` writes exactly this when it infers a publisher.
        assert coerce_publisher_list([{"name": "TSR"}]) == [{"name": "TSR"}]


def _book_payload(**overrides):
    payload = {
        "id": "b1",
        "title": "Player's Handbook",
        "filename": "phb.pdf",
        "relative_path": "D&D/Core/phb.pdf",
        "authors": [],
        "artists": [],
        "genres": [],
        "urls": [],
        "isbn": "",
        "version": "",
        "language": "",
        "license": "",
        "ocr_indexed": False,
        "ocr_pending": False,
        "tags": [],
        "is_explicit": False,
        "is_missing": False,
    }
    payload.update(overrides)
    return payload


class TestBookResponseModels:
    def test_book_out_keeps_well_formed_values(self):
        book = BookOut.model_validate(
            _book_payload(
                authors=["Gygax"],
                genres=["Fantasy"],
                urls=[{"label": "Publisher", "url": "https://example.com"}],
            )
        )
        assert book.authors == ["Gygax"]
        assert book.genres == ["Fantasy"]
        assert book.urls[0].label == "Publisher"

    def test_book_out_normalizes_legacy_shapes(self):
        book = BookOut.model_validate(
            _book_payload(authors=[5, None], urls=["https://example.com"])
        )
        assert book.authors == ["5"]
        assert book.urls[0].url == "https://example.com"
        # A bare URL has no label to recover, so it comes back blank.
        assert book.urls[0].label == ""

    def test_book_detail_normalizes_legacy_shapes(self):
        book = BookDetail.model_validate(
            _book_payload(artists=["  Elmore  "], urls=["https://example.com"])
        )
        assert book.artists == ["Elmore"]
        assert book.urls[0].url == "https://example.com"


def _system_payload(**overrides):
    payload = {
        "id": "s1",
        "name": "D&D",
        "slug": "dnd",
        "publishers": [],
        "character_builder_urls": [],
        "urls": [],
        "tags": [],
        "genres": [],
        "dice_materials": [],
        "system_family": "",
        "parent_system": "",
        "edition": "",
        "license": "",
        "book_count": 0,
        "total_page_count": 0,
        "has_cover": False,
        "is_explicit": False,
        "is_system_agnostic": False,
        "is_one_page": False,
        "container_kind": "",
        "parent_name": "",
        "parent_is_one_page": False,
        "name_is_custom": False,
        "child_count": 0,
    }
    payload.update(overrides)
    return payload


class TestSystemSummary:
    def test_keeps_well_formed_values(self):
        system = SystemSummary.model_validate(
            _system_payload(
                publishers=[{"name": "TSR", "url": "https://tsr.example"}],
                genres=["Fantasy"],
                dice_materials=["Resin"],
                character_builder_urls=[{"label": "Builder", "url": "https://b.example"}],
            )
        )
        assert system.publishers[0].name == "TSR"
        assert system.genres == ["Fantasy"]
        assert system.dice_materials == ["Resin"]
        assert system.character_builder_urls[0].label == "Builder"

    def test_normalizes_legacy_shapes(self):
        system = SystemSummary.model_validate(
            _system_payload(
                publishers=["TSR"],
                genres=[7],
                urls=["https://example.com"],
            )
        )
        assert system.publishers[0].name == "TSR"
        assert system.publishers[0].url == ""
        assert system.genres == ["7"]
        assert system.urls[0].url == "https://example.com"

    def test_scanner_publisher_shape_validates(self):
        # `indexer/scan.py` writes `[{"name": publisher}]` with no `url` key.
        system = SystemSummary.model_validate(
            _system_payload(publishers=[{"name": "Wizards"}])
        )
        assert system.publishers[0].name == "Wizards"
        assert system.publishers[0].url == ""


class TestTaggedAndFavoriteSystemItems:
    """These two once used `list[str]`, which 500'd on every real row."""

    @staticmethod
    def _favorite_payload(publishers):
        return {
            "item_type": "system",
            "item_id": "s1",
            "name": "D&D",
            "publishers": publishers,
            "has_cover": False,
            "container_kind": "",
        }

    def test_favorite_system_item_accepts_publisher_objects(self):
        item = FavoriteSystemItem.model_validate(
            self._favorite_payload([{"name": "TSR", "url": "https://tsr.example"}])
        )
        assert item.publishers[0].name == "TSR"
        assert item.publishers[0].url == "https://tsr.example"

    def test_favorite_system_item_normalizes_a_bare_string(self):
        item = FavoriteSystemItem.model_validate(self._favorite_payload(["TSR"]))
        assert item.publishers[0].name == "TSR"

    def test_tagged_system_item_accepts_publisher_objects(self):
        item = TaggedSystemItem.model_validate(
            {
                "item_type": "system",
                "item_id": "s1",
                "name": "D&D",
                "publishers": [{"name": "TSR"}],
            }
        )
        assert item.publishers[0].name == "TSR"


def test_openapi_arrays_all_declare_an_element_type():
    """The regression the issue reports: `"items": {}` in the generated spec.

    Guards every array property in the spec, not just the ones fixed here, so a
    future `list[Any]` response field is caught at the point it is introduced.
    """
    from backend.main import app

    spec = app.openapi()
    untyped = []
    for name, schema in spec["components"]["schemas"].items():
        for prop, detail in (schema.get("properties") or {}).items():
            branches = (
                [detail]
                if detail.get("type") == "array"
                else [b for b in detail.get("anyOf", []) if b.get("type") == "array"]
            )
            for branch in branches:
                if not branch.get("items"):
                    untyped.append(f"{name}.{prop}")

    assert untyped == []
