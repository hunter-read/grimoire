"""Parsing for the `[[...]]` wiki-link target syntax.

A link target has three parts — a mandatory title and two optional suffixes:

    [[Page Title]]
    [[Page Title:id-<page_id>]]
    [[Page Title:#Heading]]
    [[Page Title:id-<page_id>:#Heading]]

The title is what the reader sees; the `:id-` suffix pins the link to a specific
page so it survives renames and title collisions (issue #287); the `:#` suffix
scrolls to a heading within the target page (issue #279).

Parsing is deliberately **suffix-driven and right-to-left**: we only peel off a
trailing `:id-...` / `:#...` when it matches the strict shape below, and whatever
remains is the title, colons and all. That keeps ordinary titles containing a
colon working unchanged::

    [[Ancient Ruins: The Depths]]   -> title "Ancient Ruins: The Depths"

Because the heading is *everything* after the first `:#`, a heading that itself
starts with `#` needs no escape — the markdown heading ``# # of coin`` (whose text
is ``# of coin``) is linked as ``[[Page:## of coin]]``.

The one target this syntax cannot express is a *title* that literally contains
``:#`` or ``:id-``; such a page is still addressable by its `:id-` suffix.

`LINK_RE` and the parse rules here are mirrored in
`frontend/src/components/campaigns/wikiLinkTarget.ts` — the two must stay in
lockstep or authored links resolve differently on each side (cf. issue #252).
"""

import re
from typing import Callable, Iterator, NamedTuple, Optional

from . import slugs

# Matches [[target]] or [[target|label]]; target/label captured separately.
LINK_RE = re.compile(r"\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]")

# A fenced code block: an opening run of 3+ backticks or tildes and its info
# string, then everything up to a closing run of the same character at least as
# long - or the end of the body, as CommonMark treats an unclosed fence. The
# fence may sit in a list item or a blockquote (`- ```js`, `> ~~~`), so either
# line may start with those markers and any indent; missing one would leave its
# indented closing line looking like an opener that swallows the rest of the
# page. A backtick fence's info string has no backtick, so a line that is
# ```inline code``` is not a fence.
#
# Code is literal, so nothing inside is a link or a heading; Mermaid diagrams in
# particular use `A[[Subroutine]]` as a node shape. Mirrored by FENCE_RE in
# frontend/src/components/campaigns/wikiFences.ts.
_FENCE_PREFIX = r"(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*"
FENCE_RE = re.compile(
    rf"^{_FENCE_PREFIX}(?P<fence>(?P<ch>[`~])(?P=ch){{2,}})"
    r"(?:(?<=`)[^`\n]*|(?<=~)[^\n]*)(?:\n|\Z).*?"
    rf"(?:^{_FENCE_PREFIX}(?P=fence)(?P=ch)*[ \t]*$|\Z)",
    re.MULTILINE | re.DOTALL,
)

# Reserved prefixes for Grimoire content embeds — not page-title links.
EMBED_PREFIXES = ("book:", "map:", "token:", "audio:", "model:", "file:", "image:")

# A ":id-<page_id>" suffix. Page ids are uuid4 hex-with-dashes, but we accept any
# non-empty run of id-safe characters so a hand-typed or imported id still parses
# (resolution simply fails later if it matches no page).
_ID_SUFFIX_RE = re.compile(r":id-([0-9A-Za-z_-]+)$")


class LinkTarget(NamedTuple):
    """A parsed `[[...]]` target: display title, optional page id, optional heading."""

    title: str
    page_id: str | None
    heading: str | None


def is_embed(target: str) -> bool:
    return target.strip().lower().startswith(EMBED_PREFIXES)


def parse_target(target: str) -> LinkTarget:
    """Split a raw `[[...]]` target into its title / page-id / heading parts.

    Peels the optional `:#Heading` suffix first, then the optional `:id-<id>` that
    may sit between it and the title, so both orders of removal leave the title
    intact. Unmatched suffixes stay part of the title.
    """
    raw = (target or "").strip()

    heading = None
    # Everything after the FIRST ":#" is the heading, so a heading starting with
    # "#" (":##  of coin") needs no escaping.
    hash_at = raw.find(":#")
    if hash_at != -1:
        heading = raw[hash_at + 2 :].strip() or None
        raw = raw[:hash_at]

    page_id = None
    m = _ID_SUFFIX_RE.search(raw)
    if m:
        page_id = m.group(1)
        raw = raw[: m.start()]

    return LinkTarget(raw.strip(), page_id, heading)


def build_target(title: str, page_id: str | None = None, heading: str | None = None) -> str:
    """Inverse of `parse_target` — assemble a target string from its parts."""
    out = (title or "").strip()
    if page_id:
        out += f":id-{page_id}"
    if heading:
        out += f":#{heading}"
    return out


def _outside_fences(body: str) -> Iterator[tuple[bool, str]]:
    """Split a body into ``(is_fence, text)`` runs, in order, losing nothing."""
    last = 0
    for m in FENCE_RE.finditer(body):
        if m.start() > last:
            yield False, body[last : m.start()]
        yield True, m.group(0)
        last = m.end()
    if last < len(body):
        yield False, body[last:]


def iter_links(body: str) -> Iterator[re.Match]:
    """Every `[[...]]` match in a body, skipping any inside a fenced code block."""
    for fenced, text in _outside_fences(body or ""):
        if not fenced:
            yield from LINK_RE.finditer(text)


def sub_links(repl: Callable[[re.Match], str], body: str) -> str:
    """``LINK_RE.sub(repl, body)``, leaving fenced code byte-for-byte as it was."""
    return "".join(
        text if fenced else LINK_RE.sub(repl, text)
        for fenced, text in _outside_fences(body or "")
    )


def parse_page_links(body: str) -> list[LinkTarget]:
    """Return the distinct page-link targets referenced by [[...]] in a body.

    Embeds are skipped. Distinctness is keyed on the resolved identity (page id
    when present, else the normalized title) plus nothing else — two links to the
    same page under different headings collapse to one entry, since callers use
    this to build page-to-page link rows. A `[[...]]` in fenced code is literal
    text, so it neither links nor auto-creates a page.
    """
    out: list[LinkTarget] = []
    seen = set()
    for m in iter_links(body or ""):
        target = m.group(1).strip()
        if not target or is_embed(target):
            continue
        parsed = parse_target(target)
        if not parsed.title and not parsed.page_id:
            continue
        key = ("id", parsed.page_id) if parsed.page_id else ("slug", slugify(parsed.title))
        if key not in seen:
            seen.add(key)
            out.append(parsed)
    return out


def slugify(title: Optional[str]) -> str:
    """A wiki page's slug. Persisted, and what ``[[Title]]`` links resolve by."""
    return slugs.slugify(title, chars="words", trim=False, fallback="untitled")


# What a page title may not hold. A title is written into other pages' bodies
# as `[[Title]]` when the page is renamed, so it must read there as a title and
# nothing else: `[` / `]` would end the link early, `|` would start a label (and
# `||` a GM secret marker), and a line break would split the link across lines.
_TITLE_FORBIDDEN_RE = re.compile(r"[|\[\]\r\n]+")


def title_is_linkable(title: Optional[str]) -> bool:
    """Whether ``title`` can sit inside a `[[...]]` link without changing it."""
    return not _TITLE_FORBIDDEN_RE.search(title or "")


def clean_title(title: Optional[str]) -> str:
    """``title`` with each run of characters a link can't hold turned into a space."""
    return " ".join(_TITLE_FORBIDDEN_RE.sub(" ", title or "").split())


# --- Heading extraction -------------------------------------------------------

# ATX headings only (`# Text` .. `###### Text`), which is what the editor's
# toolbar emits and what the renderer gives an anchor to. Trailing closing hashes
# ("## Text ##") are stripped, matching CommonMark.
_HEADING_RE = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$", re.MULTILINE)

def extract_headings(body: str) -> list[dict]:
    """Return the ATX headings in a body as ``{"text", "level"}`` in document order.

    Content inside fenced code blocks is blanked first so a commented-out `# foo`
    in a code sample doesn't become a link target.
    """
    src = FENCE_RE.sub(lambda m: "\n" * m.group(0).count("\n"), body or "")
    return [
        {"text": m.group(2).strip(), "level": len(m.group(1))}
        for m in _HEADING_RE.finditer(src)
    ]


def normalize_heading(text: str) -> str:
    """Case/whitespace-insensitive key for matching a `:#Heading` to a heading."""
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def find_heading(body: str, wanted: str) -> dict | None:
    """Resolve a `:#Heading` against a body.

    Ties are broken by heading level first (H1 beats H2 beats H3), then by
    document order — so the most prominent heading with that text wins, and among
    equals the first one does.
    """
    key = normalize_heading(wanted)
    if not key:
        return None
    matches = [
        (h, i) for i, h in enumerate(extract_headings(body)) if normalize_heading(h["text"]) == key
    ]
    if not matches:
        return None
    best = min(matches, key=lambda pair: (pair[0]["level"], pair[1]))
    return best[0]
