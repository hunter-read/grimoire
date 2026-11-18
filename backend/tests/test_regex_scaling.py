"""Patterns that run over user or library text finish in linear time.

Each input below is a long run of the pattern's own opening characters with no
close, which used to make the search restart a scan to the end of the text
from every opener. The new patterns parse ordinary text exactly as before;
the parsing tests beside each pin the cases that did change.
"""
import time
from xml.etree import ElementTree

from backend.indexer.metadata import opf_fields
from backend.indexer.ocr_language import _LIST_SPLIT, tesseract_codes
from backend.metadata.embedded import _AUTHOR_SPLIT, _KEYWORD_SPLIT
from backend.routers.campaigns.wiki_io import _MD_LK_LINK_RE
from backend.services.campaigns.map_copies import _MAP_EMBED_RE
from backend.services.filename_rules.pattern import _AUTHOR_SPLIT as _FILENAME_AUTHOR_SPLIT
from backend.text.wikilinks import LINK_RE, parse_page_links

# The old patterns took seconds to minutes on these; the new ones milliseconds.
LIMIT = 0.1


def _elapsed(fn, *args) -> float:
    start = time.perf_counter()
    fn(*args)
    return time.perf_counter() - start


class TestWikiLinks:
    def test_unclosed_openers(self):
        assert _elapsed(LINK_RE.findall, "[[" * 50_000) < LIMIT
        assert _elapsed(LINK_RE.findall, "[[a" * 50_000) < LIMIT

    def test_unclosed_labels(self):
        assert _elapsed(LINK_RE.findall, "[[a|" * 50_000) < LIMIT

    def test_ordinary_links_unchanged(self):
        body = (
            "See [[The Castle]], [[Ruins: The Depths|the depths]], "
            "[[map:abc123|Map]], [[Page:id-1234-abcd:#Heading]] and [[image:f1|x]]."
        )
        assert LINK_RE.findall(body) == [
            ("The Castle", ""),
            ("Ruins: The Depths", "the depths"),
            ("map:abc123", "Map"),
            ("Page:id-1234-abcd:#Heading", ""),
            ("image:f1", "x"),
        ]

    def test_lone_bracket_still_allowed(self):
        assert LINK_RE.findall("[[[Title]]") == [("[Title", "")]
        assert LINK_RE.findall("[[Page|see [this]]") == [("Page", "see [this")]

    def test_second_opener_starts_a_new_link(self):
        assert LINK_RE.findall("[[a [[b]]") == [("b", "")]
        assert [t.title for t in parse_page_links("[[Draft [[Final]]")] == ["Final"]

    def test_map_embed(self):
        assert _elapsed(_MAP_EMBED_RE.findall, "[[map:a:" * 50_000) < LIMIT
        assert _elapsed(_MAP_EMBED_RE.findall, "[[map:a|" * 50_000) < LIMIT
        assert _MAP_EMBED_RE.findall("[[map:abc]] [[ Map: x-1 :2|label]]") == [("abc", ""), ("x-1", "label")]


class TestLegendKeeperLinks:
    def test_unclosed(self):
        assert _elapsed(_MD_LK_LINK_RE.findall, "[" * 100_000) < LIMIT
        assert _elapsed(_MD_LK_LINK_RE.findall, "[](" * 100_000) < LIMIT

    def test_links_unchanged(self):
        md = "[Town](abc123.html) and [The Keep](../x(2)%20y.html) [x](y.png)"
        assert _MD_LK_LINK_RE.findall(md) == [("Town", "abc123")]
        md = "[Town](abc123.html) and [The Keep](../x%20y.html)"
        assert _MD_LK_LINK_RE.findall(md) == [("Town", "abc123"), ("The Keep", "../x%20y")]


class TestSplits:
    def test_long_space_runs(self):
        text = " " * 100_000 + "x"
        for pattern in (_AUTHOR_SPLIT, _KEYWORD_SPLIT, _LIST_SPLIT, _FILENAME_AUTHOR_SPLIT):
            assert _elapsed(pattern.split, text) < LIMIT

    def test_splits_unchanged(self):
        assert _AUTHOR_SPLIT.split("A Smith , B Jones;C and D & E") == [
            "A Smith",
            "B Jones",
            "C",
            "D",
            "E",
        ]
        # Back-to-back separators still leave an empty part between them.
        assert _KEYWORD_SPLIT.split("a , , b") == ["a", "", "b"]
        assert _KEYWORD_SPLIT.split(" a;b ") == [" a", "b "]
        assert _FILENAME_AUTHOR_SPLIT.split("Ann & Bo and Cy") == ["Ann", "Bo", "Cy"]
        assert tesseract_codes("English  +  German") == ["eng", "deu"]


class TestOpfDescription:
    def _root(self, description: str) -> ElementTree.Element:
        package = ElementTree.Element("{http://www.idpf.org/2007/opf}package")
        metadata = ElementTree.SubElement(package, "{http://www.idpf.org/2007/opf}metadata")
        el = ElementTree.SubElement(metadata, "{http://purl.org/dc/elements/1.1/}description")
        el.text = description
        return package

    def test_unclosed_tags(self):
        root = self._root("<" * 100_000)
        assert _elapsed(opf_fields, root) < LIMIT

    def test_tags_stripped_as_before(self):
        root = self._root("<div><p>Heroes &amp; villains.</p></div> a < b")
        assert opf_fields(root)["description"] == "Heroes &amp; villains. a < b"
