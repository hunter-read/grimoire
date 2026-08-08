"""Round-tripping a note template's YAML frontmatter.

A template body is markdown that may open with a `---` frontmatter block naming
the page defaults (`title`, `icon`, `icon_color`, `visibility`, `page_type`).
The template editor surfaces those as form fields rather than raw YAML, so this
module splits them out on read and puts them back on write.

Two failure modes this is written to avoid:

* **Doubling.** Saving must never leave two frontmatter blocks stacked up. The
  body is stored *without* frontmatter, and the block is rebuilt from the
  stored fields each time — so there is only ever one, whatever the client
  sends.
* **False positives.** A body that merely *starts* with `---` (a horizontal
  rule, or a `--- ... ---` divider) is not frontmatter. A block only counts
  when it closes and its lines actually parse as `key: value` pairs we
  recognise; anything else is left alone as page content.
"""
import re
from typing import Optional

# The page-default keys a template may carry. `parent`/`session_date` are
# meaningful for an imported page but not for a template, so they are neither
# read nor written here.
TEMPLATE_FM_KEYS = ("title", "icon", "icon_color", "visibility", "page_type")

VALID_VISIBILITY = ("gm", "group", "members")
VALID_PAGE_TYPE = ("note", "session")

# An opening `---` on its own line, a block, then a closing `---` on its own
# line. Non-greedy so the *first* closing delimiter wins.
_FM_RE = re.compile(r"^---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n(.*))?$", re.DOTALL)

# A frontmatter line: `key: value`, where key is a bare identifier.
_FM_LINE_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)[ \t]*:(.*)$")


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        inner = value[1:-1]
        if value[0] == '"':
            return inner.replace('\\"', '"').replace("\\\\", "\\")
        return inner
    return value


def split_frontmatter(text: str) -> tuple[dict, str]:
    """Split ``text`` into ``(fields, body)``.

    ``fields`` holds only the recognised template keys. When the text has no
    usable frontmatter it comes back empty and ``body`` is the input unchanged —
    so this is safe to run over arbitrary markdown.
    """
    text = text or ""
    if not text.startswith("---"):
        return {}, text

    match = _FM_RE.match(text)
    if not match:
        # An opening `---` that never closes: ordinary content.
        return {}, text

    block, rest = match.group(1), match.group(2) or ""

    parsed: dict[str, str] = {}
    for line in block.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        line_match = _FM_LINE_RE.match(line)
        if not line_match:
            # A line that isn't `key: value` means this block is not frontmatter
            # (e.g. a `---` fenced table or a thematic break followed by prose).
            return {}, text
        parsed[line_match.group(1)] = _unquote(line_match.group(2))

    if not parsed:
        # `---\n---`: a delimiter pair with nothing in it, not frontmatter.
        return {}, text

    # Keep only the keys we understand, but require that the block was *about*
    # page defaults — a block of entirely foreign keys is more likely to be
    # someone's own YAML than frontmatter we should eat.
    fields = {k: v for k, v in parsed.items() if k in TEMPLATE_FM_KEYS}
    if not fields:
        return {}, text

    # Drop the blank line conventionally left between the block and the body, so
    # a split/compose round trip doesn't push the body down a line each time.
    return fields, rest.lstrip("\n")


def _yaml_scalar(value: str) -> str:
    """Quote a scalar when a YAML parser could misread it."""
    s = value or ""
    if s == "" or re.search(r"[:#\[\]{}&*!|>'\"%@`]", s) or s.strip() != s:
        return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return s


def build_frontmatter(fields: dict) -> str:
    """Render the recognised fields as a frontmatter block, or ``""`` if none.

    Emitted in ``TEMPLATE_FM_KEYS`` order so a saved template is stable rather
    than reshuffling on every write.
    """
    lines = []
    for key in TEMPLATE_FM_KEYS:
        value = (fields.get(key) or "").strip()
        if value:
            lines.append(f"{key}: {_yaml_scalar(value)}")
    if not lines:
        return ""
    return "---\n" + "\n".join(lines) + "\n---\n"


def compose(fields: dict, body: str) -> str:
    """A stored body plus its fields, as the markdown a template ships.

    The body is expected to be frontmatter-free (that is how it is stored); any
    block still on it is stripped first, so composing twice cannot stack two
    blocks.
    """
    _, clean = split_frontmatter(body or "")
    block = build_frontmatter(fields)
    if not block:
        # No defaults: the body stands alone. Strip the blank line a previous
        # block left behind so removing every default doesn't creep the body
        # downward each save.
        return clean.lstrip("\n")
    return block + ("\n" + clean.lstrip("\n") if clean.strip() else "")


def clean_visibility(value: Optional[str]) -> str:
    """A visibility we accept, defaulting to the most private."""
    value = (value or "").strip().lower()
    return value if value in VALID_VISIBILITY else "gm"


def clean_page_type(value: Optional[str]) -> str:
    value = (value or "").strip().lower()
    return value if value in VALID_PAGE_TYPE else "note"
