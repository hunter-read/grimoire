"""XML escaping for the OPDS feeds.

``xml.sax.saxutils`` escapes markup but leaves characters XML 1.0 does not
allow at all (most C0 controls, lone surrogates, U+FFFE and U+FFFF) in place,
and one of those anywhere makes the whole feed unreadable to an e-reader.
Titles, descriptions and names come from editors and from files' embedded
metadata, so these drop such characters before escaping.
"""

import re
from xml.sax import saxutils

# Everything outside the XML 1.0 ``Char`` production
# (#x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]),
# listed directly: the C0 controls but tab, newline and carriage return, the
# surrogates, and U+FFFE and U+FFFF. Every character past U+FFFF is allowed.
_NOT_XML_CHAR = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")


def xml_safe(text: str) -> str:
    """``text`` without the characters XML 1.0 does not allow."""
    return _NOT_XML_CHAR.sub("", text)


def escape(text: str) -> str:
    """Escape ``text`` for element content, dropping characters XML cannot hold."""
    return saxutils.escape(xml_safe(text))


def quoteattr(text: str) -> str:
    """Quote ``text`` as an attribute value, dropping characters XML cannot hold."""
    return saxutils.quoteattr(xml_safe(text))
