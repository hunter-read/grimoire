"""The three things that make two files look like the same thing (issue #304).

Each signal catches a class of duplicate the others cannot:

* **hash** — byte-identical files. Certain, and free: the scanner already stores
  a SHA-256 per row (issue #284) and the column is indexed, so this is one
  ``GROUP BY`` and no file reads at all.
* **metadata** — near-identical titles and authors. Catches ``book.pdf`` beside
  ``book_v2.pdf``, and the printer-friendly cut whose bytes share nothing.
* **text** — overlapping extracted text. Catches the case neither of the others
  can: the same book scanned twice, or a PDF and a CBZ of one scan, where the
  bytes differ completely and the filenames may too.

Cost is the constraint throughout. Comparing every book against every other book
is quadratic — 20k books is 200M comparisons — so metadata comparison is
*blocked* on a prefix of the normalised title, and the text signal only ever runs
on a pair some cheaper signal already flagged.
"""
import difflib
import re
from collections import Counter
from typing import Any, Iterable, Optional

from sqlalchemy import func, text as sql_text
from sqlalchemy.orm import Session

# Leading articles carry no identity: "The Player's Handbook" and "Player's
# Handbook" are the same book on two storefronts.
_ARTICLES = ("the ", "a ", "an ")

# Trailing edition/format noise that should not stop two files matching.
_NOISE = re.compile(
    r"\b("
    r"v?\d+(\.\d+)*|"
    r"copy|copy \d+|\(\d+\)|"
    r"printer[- ]?friendly|print(able)?|form[- ]?fillable|fillable|"
    r"spreads?|single[- ]?page|two[- ]?page|"
    r"b&?w|black[- ]?and[- ]?white|gr[ea]yscale|"
    r"ocr|scan(ned)?|compressed|hi[- ]?res|low[- ]?res"
    r")\b",
    re.IGNORECASE,
)
# Apostrophes are dropped rather than spaced out, so "Player's" reads as
# "players" rather than splitting into "player s" - otherwise the possessive
# form of a title scores worse against its plain spelling than it should.
_APOSTROPHE = re.compile(r"['\u2019`]")
_PUNCT = re.compile(r"[^a-z0-9 ]+")
_SPACES = re.compile(r"\s+")

# Blocking width. Two titles that disagree in their first four characters are
# not going to clear the similarity threshold, and this is what turns an O(n^2)
# sweep into something that finishes on a large library.
BLOCK_WIDTH = 4

# Similarity floors, tuned to prefer a missed pair over a false one: every hit
# costs the user a decision, and the tool is only useful if its suggestions are
# mostly right.
METADATA_THRESHOLD = 0.82
TEXT_THRESHOLD = 0.55

# How hard to look, chosen by the user per scan.
#
# "exact" is the cheap, certain end: byte-identical files only, an indexed
# lookup with no file reads and no false positives. Everything below it trades
# certainty for reach by loosening the fuzzy thresholds, which both takes longer
# and returns matches that need judging — the same bargain Stash's search
# accuracy offers, and the reason the default sits in the middle rather than at
# the widest setting.
ACCURACY_LEVELS: dict[str, dict] = {
    "exact": {"metadata": None, "text": None},
    "high": {"metadata": 0.90, "text": 0.70},
    "medium": {"metadata": METADATA_THRESHOLD, "text": TEXT_THRESHOLD},
    "low": {"metadata": 0.70, "text": 0.40},
}

DEFAULT_ACCURACY = "medium"


def thresholds_for(accuracy: str) -> dict:
    """The metadata/text cutoffs for an accuracy level.

    A ``None`` cutoff means "do not run this signal at all" rather than "accept
    everything", which is what makes ``exact`` skip the fuzzy passes outright
    instead of running them with an impossible threshold.
    """
    return ACCURACY_LEVELS.get(accuracy, ACCURACY_LEVELS[DEFAULT_ACCURACY])

# How much of a book to sample for the text signal. The front matter of two
# editions diverges most, so an early sample is the discriminating one, and a
# bounded read keeps this from turning into a full-library table scan.
TEXT_SAMPLE_PAGES = 10
TEXT_SAMPLE_TOKENS = 200

_STOPWORDS = frozenset(
    """the a an and or of to in on for with by from at as is are was were be been
    it its this that these those you your he she they them their we our i not no
    if then than but so such can may might will would shall should do does did
    have has had page chapter table contents""".split()
)


def normalize_title(value: Optional[str]) -> str:
    """Strip a title down to what actually identifies the work."""
    text_value = (value or "").lower().strip()
    if not text_value:
        return ""
    text_value = _NOISE.sub(" ", text_value)
    text_value = _APOSTROPHE.sub("", text_value)
    text_value = _PUNCT.sub(" ", text_value)
    text_value = _SPACES.sub(" ", text_value).strip()
    for article in _ARTICLES:
        if text_value.startswith(article):
            text_value = text_value[len(article):]
            break
    return text_value.strip()


def name_key(record: Any) -> str:
    """The comparison key for a record: its title, or its filename stem."""
    title = getattr(record, "title", None)
    if title:
        normalized = normalize_title(title)
        if normalized:
            return normalized
    return normalize_title(record.filename.rsplit(".", 1)[0])


def block_key(key: str) -> str:
    """The bucket a name falls into, so only plausible pairs get compared."""
    return key[:BLOCK_WIDTH]


def jaccard(a: Iterable, b: Iterable) -> float:
    set_a, set_b = set(a), set(b)
    if not set_a or not set_b:
        return 0.0
    union = set_a | set_b
    return len(set_a & set_b) / len(union) if union else 0.0


def title_similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def author_similarity(a: Any, b: Any) -> Optional[float]:
    """Jaccard over author lists, or None when either side has no authors.

    None rather than 0.0 because "we don't know" and "different authors" should
    not weigh the same — an unknown author must not drag a strong title match
    below the threshold.
    """
    list_a = [str(x).lower().strip() for x in (a or []) if str(x).strip()]
    list_b = [str(x).lower().strip() for x in (b or []) if str(x).strip()]
    if not list_a or not list_b:
        return None
    return jaccard(list_a, list_b)


# A short document sharing a title across two game systems is almost always a
# coincidence rather than a copy: "Character Sheet.pdf" exists once per system,
# and so do "Map Key", "Errata", and every other generic handout. Below this
# page count a cross-system title match is not treated as evidence at all.
CROSS_SYSTEM_MIN_PAGES = 10

# Even above that threshold a cross-system match is weaker evidence than one
# inside a single system, so its score is discounted rather than trusted whole.
# This is also what stops such a pair reporting 100% confidence.
#
# Kept mild on purpose: the discount must not push an otherwise-identical title
# below the cutoff of the level being scanned, or the pair is not demoted but
# lost. A perfect title match scores 0.95, so the penalty floor is 0.95 * this
# value, which has to clear ``medium``'s 0.82.
CROSS_SYSTEM_PENALTY = 0.92


def _same_system(record_a: Any, record_b: Any) -> Optional[bool]:
    """Whether two records belong to the same game system.

    ``None`` when either side has no system, which is not the same as belonging
    to different ones — maps and tokens are often system-agnostic, and treating
    "unknown" as "different" would penalise them for a field they never set.
    """
    a = getattr(record_a, "game_system_id", None)
    b = getattr(record_b, "game_system_id", None)
    if not a or not b:
        return None
    return a == b


def metadata_score(record_a: Any, record_b: Any) -> float:
    """How alike two records look by name and authorship, in 0..1."""
    title = title_similarity(name_key(record_a), name_key(record_b))
    if title <= 0:
        return 0.0

    cross_system = _same_system(record_a, record_b) is False
    if cross_system:
        # Short generic handouts that merely share a name across systems are
        # dropped outright rather than scored low: at 10-odd pages there is not
        # enough document for a title match to mean anything.
        #
        # An unknown page count is not a short one. Only paged formats report
        # one at all (see ``indexer.formats.has_page_count``), so a comic, an
        # audio file, or a book that has not finished indexing has ``None`` —
        # reading that as zero would drop every cross-system pair of those
        # formats, which is the same "unknown is not different" reasoning
        # ``_same_system`` applies to the system itself.
        pages_a = getattr(record_a, "page_count", None)
        pages_b = getattr(record_b, "page_count", None)
        known = [p for p in (pages_a, pages_b) if p]
        if known and min(known) < CROSS_SYSTEM_MIN_PAGES:
            return 0.0

    authors = author_similarity(
        getattr(record_a, "authors", None), getattr(record_b, "authors", None)
    )
    if authors is None:
        # Slight discount: a title-only match is real evidence, but weaker than
        # the same title backed by the same author.
        score = title * 0.95
    else:
        score = 0.7 * title + 0.3 * authors
    return score * CROSS_SYSTEM_PENALTY if cross_system else score


def hash_groups(db: Session, model: Any) -> list[list[str]]:
    """Ids of rows sharing a content hash — byte-identical files.

    Only parents are considered: a pair the user has already resolved into a
    variant relationship is not an open duplicate any more.
    """
    rows = (
        db.query(model.content_hash, func.count(model.id))
        .filter(
            model.content_hash.isnot(None),
            model.variant_parent_id.is_(None),
        )
        .group_by(model.content_hash)
        .having(func.count(model.id) > 1)
        .all()
    )
    groups = []
    for content_hash, _count in rows:
        ids = [
            r.id
            for r in db.query(model.id)
            .filter(
                model.content_hash == content_hash,
                model.variant_parent_id.is_(None),
            )
            .all()
        ]
        if len(ids) > 1:
            groups.append(ids)
    return groups


def text_fingerprint(db: Session, book_id: str) -> frozenset:
    """The distinctive words on a book's first pages.

    Reads from the FTS index the scanner already built, so nothing is extracted
    or OCR'd here. Returns an empty set for a book with no indexed text, which
    makes every comparison against it score 0 rather than raising.
    """
    rows = db.execute(
        sql_text(
            "SELECT content FROM book_search WHERE book_id = :bid "
            "ORDER BY page_number LIMIT :limit"
        ),
        {"bid": book_id, "limit": TEXT_SAMPLE_PAGES},
    ).fetchall()
    if not rows:
        return frozenset()

    words: Counter = Counter()
    for (content,) in rows:
        for word in _PUNCT.sub(" ", (content or "").lower()).split():
            if len(word) > 2 and word not in _STOPWORDS:
                words[word] += 1
    return frozenset(w for w, _ in words.most_common(TEXT_SAMPLE_TOKENS))


def text_score(fingerprint_a: frozenset, fingerprint_b: frozenset) -> float:
    """Overlap between two text fingerprints, in 0..1."""
    if not fingerprint_a or not fingerprint_b:
        return 0.0
    return jaccard(fingerprint_a, fingerprint_b)
