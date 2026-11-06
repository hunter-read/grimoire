"""Full-text search on PostgreSQL: the counterpart of the SQLite FTS5 queries.

Page text lives in ``book_pages`` on both databases. On SQLite the
``book_search`` FTS5 index covers it; on PostgreSQL ``book_pages.search`` is a
generated ``tsvector`` under the ``grimoire`` text search configuration
(``models/postgres.py``) - English stemming, accents folded, no stopwords - so the
same words find the same pages.

User text reaches both through ``search_query.to_fts_query``, which only ever
emits a small, safe FTS5 grammar: barewords (optionally ``word*``), ``"quoted
phrases"`` and the uppercase operators AND, OR and NOT. :func:`tsquery` reads that
grammar back and builds the equivalent ``tsquery`` in SQL from bound parameters,
so no user text is spliced into SQL and no input can be a tsquery syntax error.
FTS5's precedence is kept: NOT binds tightest, then AND (also implied by
adjacency), then OR.
"""
import re
from typing import Optional

from ..models.postgres import SEARCH_CONFIG

# A token of the FTS5 grammar to_fts_query writes: a "quoted phrase" (embedded
# quotes doubled) or a bare run of non-space characters.
_FTS_TOKEN = re.compile(r'"(?:[^"]|"")*"|\S+')
_BAREWORD = re.compile(r"^[A-Za-z0-9_]+$")

# Selectors ts_headline wraps a match in; the same private-use sentinels the
# FTS5 snippet() uses, swapped for <mark> by search._helpers.escape_snippet.
SNIPPET_OPEN = ""
SNIPPET_CLOSE = ""
SNIPPET_ELLIPSIS = "..."
# Stands in for "<" while ts_headline runs (see headline_sql).
_LESS_THAN = "\ue002"
_HEADLINE_OPTIONS = (
    f"StartSel={SNIPPET_OPEN}, StopSel={SNIPPET_CLOSE}, "
    "MaxWords=40, MinWords=20, ShortWord=0, MaxFragments=1, FragmentDelimiter=..."
)


def _term_sql(token: str, params: dict, prefix: str) -> str:
    """SQL for one FTS5 term: a ``word*`` prefix, or a word/phrase matched as a phrase."""
    name = f"{prefix}{len(params)}"
    if token.endswith("*") and _BAREWORD.fullmatch(token[:-1]):
        # Only [A-Za-z0-9_] inside the quotes, so this cannot be malformed.
        params[name] = f"'{token[:-1]}':*"
        return f"to_tsquery('{SEARCH_CONFIG}', :{name})"
    if token.startswith('"') and token.endswith('"') and len(token) >= 2:
        token = token[1:-1].replace('""', '"')
    params[name] = token
    return f"phraseto_tsquery('{SEARCH_CONFIG}', :{name})"


def tsquery(fts_query: str, params: dict, prefix: str = "tsq") -> Optional[str]:
    """A SQL ``tsquery`` expression for an FTS5 query from ``to_fts_query``.

    Bound values are added to ``params`` (names start with ``prefix``). Returns
    None when the query holds no term at all.
    """
    tokens = _FTS_TOKEN.findall(fts_query or "")
    # OR groups of AND chains, each item a term or a "NOT" marker.
    groups: list[list[str]] = [[]]
    for token in tokens:
        if token == "OR":
            groups.append([])
        elif token == "AND":
            continue  # adjacency already means AND
        else:
            groups[-1].append(token)

    ors = []
    for group in groups:
        ands: list[str] = []
        negate_next = False
        for token in group:
            if token == "NOT":
                negate_next = bool(ands)  # FTS5 NOT is binary: "a NOT b"
                continue
            term = _term_sql(token, params, prefix)
            if negate_next:
                ands[-1] = f"({ands[-1]} && !!{term})"
                negate_next = False
            else:
                ands.append(term)
        if ands:
            ors.append("(" + " && ".join(ands) + ")")
    if not ors:
        return None
    return "(" + " || ".join(ors) + ")"


def prefix_tsquery(terms: list[str], params: dict, prefix: str = "ptq") -> Optional[str]:
    """Every term as a prefix, all required: the character catalogue's search.

    The FTS5 version matches ``"term"*`` for each word. Terms come from
    ``[\\w']+``, so only an apostrophe needs escaping inside the quoted lexeme.
    """
    parts = []
    for term in terms:
        if not re.search(r"\w", term):
            continue
        name = f"{prefix}{len(params)}"
        params[name] = "'" + term.replace("'", "''") + "':*"
        parts.append(f"to_tsquery('{SEARCH_CONFIG}', :{name})")
    if not parts:
        return None
    return "(" + " && ".join(parts) + ")"


def headline_sql(content: str, query: str) -> str:
    """``ts_headline`` for ``content`` against ``query``, with FTS5-style ellipses.

    FTS5's snippet() marks a cut with "..." at either end; ts_headline does not,
    so one is added wherever the fragment does not reach the start or end of
    the page. A fragment stops at a word, dropping the punctuation after it, so
    the ends are compared without edge punctuation or whitespace, and a fragment
    that reaches the end of the page gets the page's own closing punctuation
    back ("...turns to stone." rather than "...turns to stone...").

    ts_headline also drops anything its parser takes for an HTML tag, which
    snippet() keeps (as escaped text): "<" is swapped for a placeholder on the
    way in and back on the way out, so the page's own text survives.
    """
    source = f"replace({content}, '<', '{_LESS_THAN}')"
    plain = f"replace(replace(h.t, '{SNIPPET_OPEN}', ''), '{SNIPPET_CLOSE}', '')"
    edge_start, edge_end = r"'^[\s[:punct:]]+'", r"'[\s[:punct:]]+$'"
    return (
        "(SELECT replace("
        f"CASE WHEN starts_with(x.p_head, x.f_head) THEN '' ELSE '{SNIPPET_ELLIPSIS}' END"
        f" || regexp_replace(x.t, {edge_end}, '')"
        " || CASE WHEN right(x.p_tail, length(x.f_tail)) = x.f_tail"
        f" THEN substr(x.p, length(x.p_tail) + 1) ELSE '{SNIPPET_ELLIPSIS}' END,"
        f" '{_LESS_THAN}', '<')"
        " FROM (SELECT y.t, y.p,"
        f" regexp_replace(y.p, {edge_start}, '') AS p_head,"
        f" regexp_replace(y.f, {edge_start}, '') AS f_head,"
        f" regexp_replace(y.p, {edge_end}, '') AS p_tail,"
        f" regexp_replace(y.f, {edge_end}, '') AS f_tail"
        f" FROM (SELECT h.t, {_trimmed(source)} AS p, {_trimmed(plain)} AS f"
        f" FROM (SELECT ts_headline('{SEARCH_CONFIG}', {source}, {query},"
        f" '{_HEADLINE_OPTIONS}') AS t) h) y) x)"
    )


def _trimmed(expr: str) -> str:
    """SQL for ``expr`` without leading or trailing whitespace (spaces, newlines, tabs)."""
    return rf"regexp_replace({expr}, '^\s+|\s+$', '', 'g')"
