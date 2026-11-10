"""Reading YAML that someone else wrote: a paste, an upload, an add-on source.

``yaml.safe_load`` never runs code, but it does build whatever the text
describes, and two YAML features let a few hundred bytes describe gigabytes or
blow the stack:

* **Aliases.** ``*name`` repeats an anchored node, and an anchor can hold
  aliases of the one before it, so each level multiplies the size of the
  result. Nothing Grimoire reads needs them, so they are refused outright.
* **Nesting.** The composer recurses once per level, so text like ``[[[[...``
  runs out of stack. Documents are capped at ``MAX_DEPTH`` levels, far beyond
  any real sheet, manifest or index (which stay under about a dozen).

Both are refused while the document is being composed, before any of it is
built. The error is a ``yaml.YAMLError``, so callers already handling a
malformed document need no new ``except``. So is a value that reads as a type
but cannot be built - ``2026-13-45`` looks like a date and is not one - which
``yaml.safe_load`` lets out as a bare ``ValueError``.
"""
from typing import IO, Any, Union

import yaml
from yaml.composer import ComposerError

__all__ = ["MAX_DEPTH", "UntrustedYAMLError", "safe_load", "too_deep"]

#: How many levels of mapping and list a document may nest.
MAX_DEPTH = 100


class UntrustedYAMLError(ComposerError):
    """The document uses an alias, or nests deeper than ``MAX_DEPTH``."""


class _BoundedLoader(yaml.SafeLoader):
    """``SafeLoader`` without aliases, and with a nesting limit."""

    def __init__(self, stream: Union[str, bytes, IO[str], IO[bytes]]) -> None:
        super().__init__(stream)
        self._depth = 0

    def compose_node(self, parent: Any, index: Any) -> Any:
        event = self.peek_event()
        if isinstance(event, yaml.AliasEvent):
            raise UntrustedYAMLError(
                None, None, "aliases (*name) are not supported", event.start_mark
            )
        self._depth += 1
        try:
            if self._depth > MAX_DEPTH:
                raise UntrustedYAMLError(
                    None, None, f"nested more than {MAX_DEPTH} levels deep", event.start_mark
                )
            return super().compose_node(parent, index)
        finally:
            self._depth -= 1


def safe_load(stream: Union[str, bytes, IO[str], IO[bytes]]) -> Any:
    """``yaml.safe_load`` that refuses aliases and runaway nesting."""
    loader = _BoundedLoader(stream)
    try:
        return loader.get_single_data()
    except (ValueError, OverflowError) as exc:
        raise yaml.constructor.ConstructorError(
            None, None, f"a value could not be read: {exc}", None
        ) from exc
    finally:
        loader.dispose()


def too_deep(value: Any, limit: int = MAX_DEPTH) -> bool:
    """Whether ``value`` nests lists and dicts more than ``limit`` levels deep.

    For data parsed some other way (JSON, say) that is about to be walked
    recursively. Iterative, so it cannot itself run out of stack.
    """
    stack: list[tuple[Any, int]] = [(value, 0)]
    while stack:
        item, depth = stack.pop()
        if isinstance(item, dict):
            children: Any = item.values()
        elif isinstance(item, list):
            children = item
        else:
            continue
        if depth >= limit:
            return True
        stack.extend((child, depth + 1) for child in children)
    return False
