"""Custom login message HTML sanitization.

The login message is rendered as HTML on the (pre-auth) login screen and in
the admin settings editor, so tags and attributes are strictly allowlisted. The
editor on the client only emits this set of tags; anything else is dropped.

The message is parsed with the standard library's HTML parser and rebuilt from
the parsed pieces: every text run and attribute value is escaped on the way out,
so nothing in the input can close an attribute or open a tag the allowlist did
not produce. (A regex pass used to re-emit single-quoted values inside double
quotes unescaped, which let a ``"`` in the value add attributes.)
"""
from html import escape
from html.parser import HTMLParser
import re
from typing import Optional

_ALLOWED_TAGS = frozenset(
    {"b", "strong", "i", "em", "s", "strike", "del", "u", "p", "br", "ul", "ol", "li", "a"}
)
_VOID_TAGS = frozenset({"br"})
_ALLOWED_ATTRS = {"a": frozenset({"href", "title"})}
# Dropped together with everything inside them, not just unwrapped.
_DANGEROUS_TAGS = frozenset(
    {"script", "style", "iframe", "object", "embed", "svg", "math", "template", "noscript"}
)
_SAFE_URL_RE = re.compile(r"^(https?:|mailto:|/|#)", re.IGNORECASE)


class _Sanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        # How many dangerous elements we are inside; their content is skipped.
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if tag in _DANGEROUS_TAGS:
            self.skip += 1
            return
        if self.skip or tag not in _ALLOWED_TAGS:
            return
        allowed = _ALLOWED_ATTRS.get(tag, frozenset())
        kept: list[str] = []
        for name, value in attrs:
            value = value or ""
            if name not in allowed:
                continue
            if name == "href" and not _SAFE_URL_RE.match(value):
                continue
            kept.append(f'{name}="{escape(value, quote=True)}"')
        if tag == "a":
            # Force safe link relations
            kept.append('rel="noopener noreferrer nofollow"')
            kept.append('target="_blank"')
        self.out.append(f"<{tag}{(' ' + ' '.join(kept)) if kept else ''}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if tag in _DANGEROUS_TAGS:
            return
        self.handle_starttag(tag, attrs)
        if not self.skip and tag in _ALLOWED_TAGS and tag not in _VOID_TAGS:
            self.out.append(f"</{tag}>")

    def handle_endtag(self, tag: str) -> None:
        if tag in _DANGEROUS_TAGS:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip or tag not in _ALLOWED_TAGS or tag in _VOID_TAGS:
            return
        self.out.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.out.append(escape(data, quote=False))

    # Comments, doctypes, processing instructions and CDATA are dropped by
    # HTMLParser's default no-op handlers.


def sanitize_login_message(html: str) -> str:
    """Allowlist-sanitize HTML for the custom login message."""
    if not html:
        return ""
    parser = _Sanitizer()
    parser.feed(html)
    parser.close()
    return "".join(parser.out)
