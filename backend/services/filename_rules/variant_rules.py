"""A library's own filename markers for variant kinds and labels (issue #569).

Duplicate review pre-fills each copy's kind from its filename, but the built-in
markers only know the conventions most packs share: ``grid``/``nogrid``,
"printer friendly", a version token. Creators name things their own way -
``GL_Tavern.png`` for gridless, ``_NG``, ``[Night]``, ``-pf`` - and in those packs
every pair had to be described by hand. These rules teach the guess a library's
own vocabulary.

A rule matches a whole token, a prefix, or a suffix - never a raw substring, so
a rule for ``grid`` cannot make ``Gridiron Tavern`` read as gridded - and maps
the match to a kind, a label, or both. Rules are checked before the built-in
markers, so a library's convention wins, and in order, so the first rule that
tells two copies apart is the one used.

Stored as one JSON list in ``app_settings`` rather than a table: the list is
short, its order is its meaning, and it is only ever read and written whole.
"""
import json
import logging
from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

from ...models import AppSetting
from ...models.collections import COLLECTIONS
from ...models.variants import VARIANT_KINDS, kinds_for
from ..duplicates.grid import name_tokens

logger = logging.getLogger("grimoire.filename_rules")

SETTING_KEY = "variant_filename_rules"

MATCH_TYPES = ("token", "prefix", "suffix")

# Enough for any library's conventions; a ceiling so a runaway client cannot make
# every duplicate scan test thousands of rules per pair.
MAX_RULES = 200


class RuleError(ValueError):
    """A rule list that cannot be saved, with a message an admin can act on."""


def _stem(filename: str) -> str:
    dot = (filename or "").rfind(".")
    return filename[:dot] if dot > 0 else (filename or "")


def matches(rule: dict, filename: str) -> bool:
    """Whether ``rule`` matches ``filename``'s stem, ignoring case."""
    stem = _stem(filename).lower()
    value = rule["value"].lower()
    if rule["match"] == "prefix":
        return stem.startswith(value)
    if rule["match"] == "suffix":
        return stem.endswith(value)
    # A token rule may itself span tokens ("no grid"), so it matches a run of
    # consecutive tokens rather than any one.
    wanted = name_tokens(value)
    have = name_tokens(stem)
    if not wanted:
        return False
    span = len(wanted)
    return any(have[i : i + span] == wanted for i in range(len(have) - span + 1))


def _clean_rule(raw: Any, index: int) -> dict:
    where = f"Rule {index + 1}"
    if not isinstance(raw, dict):
        raise RuleError(f"{where} is not an object.")
    match = raw.get("match")
    if match not in MATCH_TYPES:
        raise RuleError(f"{where}: match must be one of {', '.join(MATCH_TYPES)}.")
    value = str(raw.get("value") or "").strip()
    if not value:
        raise RuleError(f"{where} has nothing to match.")
    if len(value) > 100:
        raise RuleError(f"{where}: the text to match is too long.")
    if match == "token" and not name_tokens(value):
        raise RuleError(f"{where}: '{value}' has no letters or digits to match as a token.")
    kind = str(raw.get("kind") or "").strip() or None
    label = str(raw.get("label") or "").strip()[:100]
    collection = str(raw.get("collection") or "").strip() or None
    if collection is not None and collection not in COLLECTIONS:
        raise RuleError(f"{where}: unknown collection '{collection}'.")
    if kind is not None:
        allowed = kinds_for(collection) if collection else VARIANT_KINDS
        if kind not in allowed:
            scope = f"{collection} variants" if collection else "any collection"
            raise RuleError(f"{where}: '{kind}' is not a kind {scope} can have.")
    if kind is None and not label:
        raise RuleError(f"{where} needs a kind, a label, or both.")
    return {"match": match, "value": value, "kind": kind, "label": label, "collection": collection}


def validate_rules(raw: Any) -> list[dict]:
    """Check an incoming rule list, raising :class:`RuleError` on the first problem."""
    if not isinstance(raw, list):
        raise RuleError("Rules must be a list.")
    if len(raw) > MAX_RULES:
        raise RuleError(f"At most {MAX_RULES} rules.")
    return [_clean_rule(r, i) for i, r in enumerate(raw)]


def load_rules(db: Session) -> list[dict]:
    """The saved rules. A corrupt setting reads as none rather than breaking scans."""
    row = db.query(AppSetting).filter_by(key=SETTING_KEY).first()
    if not row or not row.value:
        return []
    try:
        return validate_rules(json.loads(row.value))
    except (ValueError, TypeError) as e:
        logger.warning("Ignoring the saved variant filename rules: %s", e)
        return []


def save_rules(db: Session, raw: Any) -> list[dict]:
    """Validate and store ``raw``, returning what was saved. Commits."""
    rules = validate_rules(raw)
    row = db.query(AppSetting).filter_by(key=SETTING_KEY).first()
    if row is None:
        row = AppSetting(key=SETTING_KEY)
        db.add(row)
    row.value = json.dumps(rules)
    db.commit()
    return rules


def suggest(
    rules: Iterable[dict], filename: str, other_filename: str, resource_type: str
) -> tuple[Optional[str], str]:
    """``(kind, label)`` the rules give ``filename`` paired against ``other_filename``.

    Relational, like the built-in markers: a rule only speaks for a copy when it
    matches that copy and not the other, because a marker both files carry
    (``GL_`` on every map in a gridless pack) distinguishes nothing. The kind
    and the label are taken independently - the first distinguishing rule with
    a kind supplies the kind, the first with a label the label - so a ``night``
    label rule and a ``GL_`` kind rule combine on ``GL_Tavern_Night.png``.
    Either half may come back empty, for the built-in markers to fill.
    """
    allowed = kinds_for(resource_type)
    kind: Optional[str] = None
    label = ""
    for rule in rules:
        if rule.get("collection") and rule["collection"] != resource_type:
            continue
        if rule.get("kind") and rule["kind"] not in allowed:
            continue
        if not matches(rule, filename) or matches(rule, other_filename):
            continue
        if kind is None and rule.get("kind"):
            kind = rule["kind"]
        if not label and rule.get("label"):
            label = rule["label"]
        if kind and label:
            break
    return kind, label
