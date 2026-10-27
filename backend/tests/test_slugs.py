"""The shared ``slugify`` and every caller's rule (issue #711).

Each caller used to carry its own copy, and several of their slugs are stored, so
moving them onto ``backend.text.slugs`` must not change a single output. The
copies they replaced are frozen below, verbatim, and every caller is checked
against its own over a corpus of awkward names and a seeded batch of random ones.
"""
import random
import re
import unicodedata

import pytest

from backend.addons import transforms
from backend.codex import compare
from backend.indexer import categories
from backend.routers.campaigns import wikilinks
from backend.routers.characters import core as characters
from backend.services import themes
from backend.services.characters import rulesets
from backend.text.slugs import slugify


# --- The implementations each caller had before issue #711, frozen ------------

def _old_wiki(title):
    s = re.sub(r"[^\w\s-]", "", (title or "").lower()).strip()
    s = re.sub(r"[\s_-]+", "-", s)
    return s or "untitled"


def _old_indexer(name):
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


def _old_transforms(value):
    folded = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    folded = folded.lower().replace("&", "").replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9]+", "-", folded).strip("-")


def _old_codex(value):
    text = unicodedata.normalize("NFKD", value)
    text = "".join(c for c in text if not unicodedata.combining(c)).lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")[:100]


def _old_theme(name):
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return (slug or "custom")[:themes.MAX_ID_LENGTH].strip("-") or "custom"


def _old_sheet(value):
    cleaned = "".join(char if char.isalnum() else "-" for char in value.lower())
    parts = [part for part in cleaned.split("-") if part]
    return "-".join(parts)[:100] or "sheet"


def _old_entry(value):
    text = str(value).lower().replace("'", "").replace("’", "")
    cleaned = "".join(char if char.isalnum() else "-" for char in text)
    parts = [part for part in cleaned.split("-") if part]
    return "-".join(parts)[:200] or "entry"


CALLERS = [
    ("wiki", wikilinks.slugify, _old_wiki),
    ("indexer", categories.slugify, _old_indexer),
    ("addon transform", transforms.slugify, _old_transforms),
    ("codex", compare._slug, _old_codex),
    ("theme", themes.slugify_id, _old_theme),
    ("sheet", characters._slugify, _old_sheet),
    ("ruleset entry", rulesets.slugify, _old_entry),
]

CORPUS = [
    "",
    " ",
    "-",
    "---",
    "_",
    "&",
    "'",
    "Dungeons & Dragons",
    "Dungeons&Dragons",
    "Hunter's Bolt",
    "Hunter’s Bolt",
    "  Leading and trailing  ",
    "-leading hyphen",
    "trailing hyphen -",
    "_underscored_name_",
    "snake_case and kebab-case",
    "a.b,c;d:e!f?g",
    "Café Crème",
    "Straße",
    "naïve résumé",
    "Ærøskøbing",
    "ﬁligree ligature",
    "Ⅻ roman twelve",
    "²³ superscripts",
    "İstanbul",
    "KELVIN K sign",
    "日本語のタイトル",
    "Ελληνικά",
    "Мир Тьмы",
    "emoji 🐉 dragon",
    "tab\tand\nnewline",
    "nbsp space",
    "zero​width",
    "combining é",
    "Call of Cthulhu (7th Ed.)",
    "D&D 5e: Player's Handbook",
    "x" * 250,
    ("word " * 60).strip(),
    "a" * 99 + " b",
    "a" * 199 + " b",
]

_ALPHABET = (
    "abcXYZ019 _-&'’.,!()/\\\t\n" "éÉüßøÆﬁİıK²Ⅻ日本Ωω🐉́ ​"
)


def _random_names(count, seed=711):
    rng = random.Random(seed)
    return ["".join(rng.choice(_ALPHABET) for _ in range(rng.randint(0, 40))) for _ in range(count)]


@pytest.mark.parametrize("label, current, frozen", CALLERS, ids=[c[0] for c in CALLERS])
def test_every_caller_is_unchanged(label, current, frozen):
    for name in CORPUS + _random_names(2000):
        assert current(name) == frozen(name), f"{label}: {name!r}"


def test_the_wiki_rule_still_treats_none_as_empty():
    assert wikilinks.slugify(None) == "untitled"
    assert themes.slugify_id(None) == "custom"


def test_ruleset_entries_slug_whatever_they_are_given():
    assert rulesets.slugify(0) == "0"


class TestOptions:
    """What each option does, independently of any one caller."""

    def test_the_ampersand_is_where_the_families_differ(self):
        assert slugify("Dungeons & Dragons") == "dungeons-dragons"
        assert slugify("Dungeons & Dragons", amp=" and ") == "dungeons-and-dragons"
        assert slugify("D&D", amp="") == "dd"

    def test_chars(self):
        assert slugify("Café.Noir") == "caf-noir"
        assert slugify("Café.Noir", chars="unicode") == "café-noir"
        assert slugify("Café.Noir", chars="words") == "cafénoir"

    def test_fold(self):
        assert slugify("Straße Café", fold="accents") == "stra-e-cafe"
        assert slugify("Straße Café", fold="ascii") == "strae-cafe"

    def test_apostrophes(self):
        assert slugify("Hunter's Bolt") == "hunter-s-bolt"
        assert slugify("Hunter’s Bolt", drop_apostrophes=True) == "hunters-bolt"

    def test_trim(self):
        assert slugify("-edge-", chars="words") == "edge"
        assert slugify("-edge-", chars="words", trim=False) == "-edge-"

    def test_max_len_may_leave_a_trailing_hyphen(self):
        assert slugify("abc def", max_len=4) == "abc-"

    def test_fallback(self):
        assert slugify("!!!") == ""
        assert slugify("!!!", fallback="untitled") == "untitled"
        assert slugify(None, fallback="untitled") == "untitled"
