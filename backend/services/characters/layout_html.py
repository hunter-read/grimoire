"""Validation for ``layout_html`` — HTML sheet layouts that cannot run code.

A schema may ship an HTML *template* describing how its sheet looks. A real
published character sheet is a dense, particular thing, and the JSON ``layout``
tree cannot express one; HTML can. The cost is that layout markup now arrives
from strangers, so this module exists to make that safe.

Three rules, enforced here at install time and mirrored by the client parser:

1. **The template is never inserted as HTML.** It is parsed to an AST here, and
   the client renders that AST as React elements. Nothing a schema contains
   reaches ``innerHTML``/``dangerouslySetInnerHTML``, so there is no markup
   injection surface to defend — the markup is never markup by the time it
   renders.
2. **A closed allowlist of tags and attributes.** Structural tags plus the
   ``g-*`` directives. Every ``on*`` handler, ``script``, ``style``, ``iframe``,
   ``object``, ``embed``, ``form``, ``svg`` and unknown attribute is rejected,
   loudly, at install time.
3. **No URL a schema supplies is trusted.** ``src``/``href`` must be relative or
   https, which rules out ``javascript:`` and ``data:`` outright.

Interactive widgets are *always* real components: ``<g-field name="strength"/>``
is a placeholder the renderer swaps for a FieldRenderer, never an ``<input>``
the schema wrote. A schema therefore cannot forge a form control.

The worst a hostile schema achieves is an ugly sheet.
"""
from html.parser import HTMLParser
from typing import Any, Optional

__all__ = [
    "LayoutHtmlError",
    "ALLOWED_TAGS",
    "DIRECTIVE_TAGS",
    "parse_layout_html",
    "validate_layout_html",
]


class LayoutHtmlError(ValueError):
    """A layout template used something outside the allowlist."""


#: Structural tags a sheet may draw with. No interactive elements: a schema
#: cannot write an <input>, <button>, <a> or <form>, because every interactive
#: part of a sheet is a directive that renders a real component instead.
ALLOWED_TAGS: frozenset = frozenset(
    {
        "div", "span", "section", "article", "header", "footer", "aside", "main",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "p", "br", "hr", "small", "strong", "em", "b", "i", "u", "s",
        "ul", "ol", "li", "dl", "dt", "dd",
        "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption",
        "figure", "figcaption", "img",
        "fieldset", "legend", "label",
        # Collapsible sections. Interactive, but the interaction is the
        # browser's own — there is no scripting surface and nothing a schema
        # can hook, which is what keeps them in reach for a sheet's secondary
        # details.
        "details", "summary",
    }
)

#: The directives. Each renders a real component; none of them is markup by the
#: time it reaches the DOM.
DIRECTIVE_TAGS: frozenset = frozenset(
    {
        "g-field",      # an editable field  → FieldRenderer
        "g-computed",   # a derived value    → read-only FieldRenderer
        "g-label",      # a field's label text
        "g-value",      # a field's raw value, no control
        "g-repeat",     # iterate a list field
        "g-if",         # conditional subtree
        "g-section",    # a titled group, for styling hooks
    }
)

#: Attributes allowed on every tag. `class` is the styling hook; `style` is
#: absent on purpose — inline CSS is exactly the escape hatch the scoped
#: stylesheet exists to avoid, and the app's CSP forbids it anyway.
_GLOBAL_ATTRS: frozenset = frozenset({"class", "id", "title", "role", "aria-label"})

#: Per-tag extras, kept as tight as each tag needs.
_TAG_ATTRS: dict[str, frozenset] = {
    "img": frozenset({"src", "alt", "width", "height", "loading"}),
    "td": frozenset({"colspan", "rowspan"}),
    "th": frozenset({"colspan", "rowspan", "scope"}),
    "label": frozenset({"for"}),
    "details": frozenset({"open"}),
    # `visible_if` is the same expression `g-if` takes, as an attribute: it
    # hides one element without wrapping it, which reads better for a single
    # field than a <g-if> around it.
    "g-field": frozenset(
        {"name", "label", "placeholder", "readonly", "variant", "visible_if"}
    ),
    "g-computed": frozenset({"name", "label", "format", "variant", "visible_if"}),
    "g-label": frozenset({"name", "text"}),
    "g-value": frozenset({"name", "format"}),
    "g-repeat": frozenset({"over", "as"}),
    "g-if": frozenset({"test"}),
    "g-section": frozenset({"title", "name", "visible_if"}),
}

#: Tags dropped with their contents rather than unwrapped. Keeping a <script>'s
#: text as a text node would render the code as visible gibberish; dropping the
#: subtree is both safer and what the author would want if it were an accident.
_DANGEROUS_TAGS: frozenset = frozenset(
    {"script", "style", "iframe", "object", "embed", "svg", "math", "template",
     "noscript", "link", "meta", "base", "form", "input", "textarea", "select",
     "button", "option", "video", "audio", "source", "canvas", "portal"}
)

#: Void elements, which never carry children.
_VOID_TAGS: frozenset = frozenset({"br", "hr", "img"})

#: Bounds. A sheet is a page, not a document tree — these are far above any
#: real layout and exist so a hostile template cannot exhaust the parser.
MAX_HTML_BYTES = 256 * 1024
MAX_NODES = 4000
MAX_DEPTH = 64


def _attr_allowed(tag: str, attr: str) -> bool:
    if attr.startswith("on"):
        # Every event handler, including ones invented after this was written.
        return False
    if attr.startswith("data-"):
        return True
    return attr in _GLOBAL_ATTRS or attr in _TAG_ATTRS.get(tag, frozenset())


def _check_url(tag: str, attr: str, value: str) -> None:
    """Reject any URL that is not plainly inert.

    Relative paths and https only. That excludes `javascript:` and `data:`
    without needing to enumerate the schemes that are dangerous — an allowlist
    of two, rather than a blocklist that a new scheme walks around.
    """
    if attr not in ("src", "href"):
        return
    candidate = value.strip()
    if not candidate:
        return
    lowered = candidate.lower()
    if lowered.startswith(("https://", "/")) or not _has_scheme(lowered):
        return
    raise LayoutHtmlError(f"<{tag} {attr}> must be a relative path or https URL")


def _has_scheme(value: str) -> bool:
    head, sep, _ = value.partition(":")
    if not sep:
        return False
    # A colon inside a path segment ("a/b:c") is not a scheme.
    return "/" not in head and "?" not in head and "#" not in head


class _LayoutParser(HTMLParser):
    """Builds an AST, refusing anything outside the allowlist.

    Uses the stdlib parser rather than a dependency: the grammar accepted here
    is tiny and closed, so the work is in the allowlist, not in the parsing.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root: dict[str, Any] = {"tag": "#root", "attrs": {}, "children": []}
        self.stack: list[dict[str, Any]] = [self.root]
        self.node_count = 0
        # Depth of dangerous subtree currently being skipped. Non-zero means
        # every token is discarded until its close tag balances out.
        self.skipping = 0

    # -- helpers
    def _current(self) -> dict[str, Any]:
        return self.stack[-1]

    def _open(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> dict[str, Any]:
        self.node_count += 1
        if self.node_count > MAX_NODES:
            raise LayoutHtmlError(f"Layout exceeds {MAX_NODES} elements")
        if len(self.stack) > MAX_DEPTH:
            raise LayoutHtmlError(f"Layout nests deeper than {MAX_DEPTH}")

        clean: dict[str, str] = {}
        for name, value in attrs:
            attr = name.lower()
            if not _attr_allowed(tag, attr):
                raise LayoutHtmlError(f"Attribute {name!r} is not allowed on <{tag}>")
            text = value or ""
            _check_url(tag, attr, text)
            clean[attr] = text

        return {"tag": tag, "attrs": clean, "children": []}

    # -- HTMLParser interface
    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        tag = tag.lower()
        if self.skipping:
            if tag not in _VOID_TAGS:
                self.skipping += 1
            return
        if tag in _DANGEROUS_TAGS:
            raise LayoutHtmlError(f"<{tag}> is not allowed in a layout")
        if tag not in ALLOWED_TAGS and tag not in DIRECTIVE_TAGS:
            raise LayoutHtmlError(f"<{tag}> is not a known layout element")

        node = self._open(tag, attrs)
        self._current()["children"].append(node)
        if tag not in _VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        tag = tag.lower()
        if self.skipping:
            return
        if tag in _DANGEROUS_TAGS:
            raise LayoutHtmlError(f"<{tag}> is not allowed in a layout")
        if tag not in ALLOWED_TAGS and tag not in DIRECTIVE_TAGS:
            raise LayoutHtmlError(f"<{tag}> is not a known layout element")
        self._current()["children"].append(self._open(tag, attrs))

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self.skipping:
            self.skipping -= 1
            return
        if tag in _VOID_TAGS:
            return
        # Find the matching open tag, tolerating unclosed children the way a
        # browser would rather than failing a layout over a stray </div>.
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                return

    def handle_data(self, data: str) -> None:
        if self.skipping or not data.strip():
            return
        self.node_count += 1
        if self.node_count > MAX_NODES:
            raise LayoutHtmlError(f"Layout exceeds {MAX_NODES} elements")
        self._current()["children"].append({"text": data})

    def handle_comment(self, data: str) -> None:
        # Dropped: a comment carries nothing the renderer needs, and conditional
        # comments are a well-worn way to smuggle markup past a naive filter.
        return

    def handle_decl(self, decl: str) -> None:
        raise LayoutHtmlError("A layout is a fragment; it cannot declare a doctype")

    def handle_pi(self, data: str) -> None:
        raise LayoutHtmlError("Processing instructions are not allowed in a layout")

    def unknown_decl(self, data: str) -> None:
        raise LayoutHtmlError("CDATA sections are not allowed in a layout")


def parse_layout_html(source: str) -> list[dict[str, Any]]:
    """Parse a layout template to an AST, raising LayoutHtmlError if unsafe.

    The returned AST is plain JSON — dicts of tag/attrs/children and text nodes
    — so it can be handed to the client as data.
    """
    if not isinstance(source, str):
        raise LayoutHtmlError("layout_html must be a string")
    if len(source.encode("utf-8")) > MAX_HTML_BYTES:
        raise LayoutHtmlError(f"layout_html exceeds {MAX_HTML_BYTES} bytes")

    parser = _LayoutParser()
    try:
        parser.feed(source)
        parser.close()
    except LayoutHtmlError:
        raise
    except Exception as exc:  # malformed markup the stdlib parser chokes on
        raise LayoutHtmlError(f"Could not parse layout_html: {exc}") from exc

    return parser.root["children"]


def validate_layout_html(source: str) -> list[dict[str, Any]]:
    """Alias kept for symmetry with the other validators in this package."""
    return parse_layout_html(source)
