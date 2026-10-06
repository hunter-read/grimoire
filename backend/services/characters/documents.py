"""Parsing a hand-written sheet or ruleset, as JSON or as YAML.

A sheet is a document people write by hand, and JSON is a poor format to write
by hand: every key quoted, no comments, and a trailing comma is a syntax error.
YAML is accepted for the same reason the add-on repository accepts it for
indexes — ``fetch.py`` already tries JSON and falls back to YAML, and this is
that rule applied to pasted content.

Nothing here executes anything. ``yaml.safe_load`` handles only YAML's data
types, so a document cannot name a Python class or call a constructor the way
``yaml.load`` would allow.
"""
from typing import Any

import yaml

__all__ = ["DocumentError", "parse_document"]

#: Bounds what one paste can hand the parser. Matches the catalogue's own cap on
#: a downloaded sheet, so pasting and installing are held to the same limit.
MAX_DOCUMENT_BYTES = 512 * 1024


class DocumentError(ValueError):
    """The pasted text is not a document we can read."""


def parse_document(text: str, *, what: str = "document") -> dict[str, Any]:
    """Parse ``text`` as JSON, then as YAML, and require a mapping.

    JSON is tried first and YAML second, which costs nothing: YAML 1.2 is a
    superset of JSON, so the fallback would parse valid JSON anyway — but its
    error messages are about YAML, and someone pasting JSON with a trailing
    comma deserves to be told about the comma.
    """
    if not text or not text.strip():
        raise DocumentError(f"There is no {what} here")
    if len(text.encode("utf-8")) > MAX_DOCUMENT_BYTES:
        raise DocumentError(f"That {what} is too large")

    import json

    try:
        parsed = json.loads(text)
    except ValueError as json_error:
        try:
            parsed = yaml.safe_load(text)
        except yaml.YAMLError as yaml_error:
            # Both parsers rejected it. The YAML message is the more useful of
            # the two, since YAML accepts JSON: text that is neither is usually
            # closer to being YAML than to being JSON.
            raise DocumentError(
                f"That {what} is not valid JSON or YAML: {_first_line(yaml_error)}"
            ) from yaml_error
        if parsed is None:
            raise DocumentError(
                f"That {what} is not valid JSON or YAML: {_first_line(json_error)}"
            ) from json_error

    if not isinstance(parsed, dict):
        raise DocumentError(f"A {what} must be a mapping of fields, not a list or a value")
    return parsed


def _first_line(error: Exception) -> str:
    """The first line of a parser error.

    A YAML error spans several lines with a snippet and a caret, which reads
    badly in a toast. The first line says what went wrong and where.
    """
    return str(error).strip().splitlines()[0] if str(error).strip() else "unparseable"
