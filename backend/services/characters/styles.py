"""Scoping and filtering for a schema's ``styles`` block.

A sheet that looks like a real character sheet needs its own CSS. Accepting CSS
from a stranger is safe only if two things hold, and this module enforces both:

1. **Every selector is confined to the sheet.** Each one is rewritten to sit
   under a generated scope class, so a schema cannot restyle the app around it —
   no repainting the nav, no covering the page with a fake dialog.
2. **A closed allowlist of properties.** Layout, colour, and typography are
   allowed. Anything that can load a resource, escape the sheet's box, or fix
   itself to the viewport is not.

``url()`` is rejected wherever it appears. It is the one CSS value that reaches
the network, and a schema has no legitimate need for it — an image belongs in an
``<img src>``, which is checked separately.

The output is a stylesheet string the client injects under its scope class. The
app's CSP forbids inline ``<style>``, so it is attached as a constructed
stylesheet rather than written into the document.
"""
import re
from typing import Optional

__all__ = ["StylesError", "ALLOWED_PROPERTIES", "scope_styles", "MAX_STYLE_BYTES"]


class StylesError(ValueError):
    """A stylesheet used a property, value, or construct that is not allowed."""


MAX_STYLE_BYTES = 128 * 1024

#: Properties a sheet may set. Everything here is inert: it changes how the
#: sheet looks and cannot load a resource, leave the sheet's box, or interact.
ALLOWED_PROPERTIES: frozenset = frozenset(
    {
        # box model
        "display", "flex", "flex-direction", "flex-wrap", "flex-grow",
        "flex-shrink", "flex-basis", "gap", "row-gap", "column-gap",
        "grid", "grid-template", "grid-template-columns", "grid-template-rows",
        "grid-template-areas", "grid-area", "grid-column", "grid-row",
        "grid-auto-flow", "grid-auto-columns", "grid-auto-rows",
        "align-items", "align-content", "align-self",
        "justify-items", "justify-content", "justify-self", "place-items",
        "place-content", "place-self", "order",
        "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
        "padding", "padding-top", "padding-right", "padding-bottom",
        "padding-left",
        "width", "min-width", "max-width",
        "height", "min-height", "max-height",
        "box-sizing", "overflow", "overflow-x", "overflow-y",
        # borders and surfaces
        "border", "border-top", "border-right", "border-bottom", "border-left",
        "border-width", "border-style", "border-color", "border-radius",
        "border-top-left-radius", "border-top-right-radius",
        "border-bottom-left-radius", "border-bottom-right-radius",
        "border-collapse", "border-spacing",
        "background-color", "box-shadow", "outline", "outline-offset",
        "opacity",
        # typography
        "color", "font", "font-family", "font-size", "font-weight",
        "font-style", "font-variant", "font-stretch",
        "line-height", "letter-spacing", "word-spacing",
        "text-align", "text-decoration", "text-transform", "text-indent",
        "text-overflow", "white-space", "word-break", "overflow-wrap",
        "vertical-align", "list-style", "list-style-type", "list-style-position",
        # harmless extras
        "visibility", "cursor", "table-layout", "caption-side", "aspect-ratio",
        "object-fit", "object-position", "writing-mode", "text-shadow",
    }
)

#: Rejected values, checked against the whole declaration. `position: fixed`
#: would let a sheet pin an element over the app chrome; `url()` reaches the
#: network; `expression()` is a legacy IE code-execution vector that costs
#: nothing to keep out.
_FORBIDDEN_VALUE_RE = re.compile(
    r"""(?xi)
      url\s*\(
    | expression\s*\(
    | javascript\s*:
    | @import
    | behavior\s*:
    | -moz-binding
    """
)

#: At-rules a schema may use. Media and container queries are responsive layout,
#: which a sheet legitimately needs; keyframes/font-face are not allowed because
#: one animates and the other loads a font over the network.
_ALLOWED_AT_RULES: frozenset = frozenset({"media", "supports", "container", "layer"})

_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)


def _check_declaration(declaration: str) -> Optional[str]:
    """Validate one ``prop: value`` pair, returning it normalised or None."""
    if not declaration.strip():
        return None
    name, sep, value = declaration.partition(":")
    if not sep:
        raise StylesError(f"Malformed declaration {declaration.strip()!r}")

    prop = name.strip().lower()
    if not prop:
        raise StylesError("Declaration is missing a property name")
    # Custom properties are allowed: they are inert unless something reads them,
    # and the sheet's own rules are the only thing in scope to do so.
    if not prop.startswith("--") and prop not in ALLOWED_PROPERTIES:
        raise StylesError(f"Property {prop!r} is not allowed in a sheet stylesheet")

    if _FORBIDDEN_VALUE_RE.search(value):
        raise StylesError(f"Value for {prop!r} contains a forbidden construct")

    return f"{prop}: {value.strip()}"


def _scope_selector(selector: str, scope: str) -> str:
    """Rewrite one selector so it can only match inside the sheet."""
    selector = selector.strip()
    if not selector:
        raise StylesError("Empty selector")
    if _FORBIDDEN_VALUE_RE.search(selector):
        raise StylesError("Selector contains a forbidden construct")
    # `:root` and `html`/`body` are the usual ways to try to reach the whole
    # page. Rewriting rather than rejecting means a schema author who wrote
    # `:root { --ink: red }` out of habit gets sheet-wide variables, which is
    # what they meant.
    if selector in (":root", "html", "body"):
        return f".{scope}"
    if selector.startswith("&"):
        return f".{scope}{selector[1:]}"
    return f".{scope} {selector}"


def _scope_selector_list(selectors: str, scope: str) -> str:
    return ", ".join(
        _scope_selector(part, scope) for part in selectors.split(",") if part.strip()
    )


def scope_styles(source: str, scope: str) -> str:
    """Filter a stylesheet and confine every rule to ``scope``.

    Returns CSS text. Raises StylesError on anything outside the allowlist, so a
    bad stylesheet fails at install time rather than rendering wrong.
    """
    if not isinstance(source, str):
        raise StylesError("styles must be a string")
    if len(source.encode("utf-8")) > MAX_STYLE_BYTES:
        raise StylesError(f"styles exceeds {MAX_STYLE_BYTES} bytes")

    css = _COMMENT_RE.sub(" ", source)
    out: list[str] = []
    pos = 0
    length = len(css)

    while pos < length:
        brace = css.find("{", pos)
        if brace == -1:
            if css[pos:].strip():
                raise StylesError("Trailing text after the last rule")
            break

        prelude = css[pos:brace].strip()
        block_end = _matching_brace(css, brace)
        body = css[brace + 1 : block_end]

        if prelude.startswith("@"):
            at_name = prelude[1:].split(None, 1)[0].lower().rstrip("(")
            if at_name not in _ALLOWED_AT_RULES:
                raise StylesError(f"@{at_name} is not allowed in a sheet stylesheet")
            # A conditional group wraps ordinary rules; scope those recursively.
            inner = scope_styles(body, scope)
            out.append(f"{prelude} {{\n{inner}\n}}")
        else:
            declarations = [
                cleaned
                for part in body.split(";")
                if (cleaned := _check_declaration(part)) is not None
            ]
            if declarations:
                joined = "; ".join(declarations)
                out.append(f"{_scope_selector_list(prelude, scope)} {{ {joined} }}")

        pos = block_end + 1

    return "\n".join(out)


def _matching_brace(css: str, start: int) -> int:
    """Index of the ``}`` closing the ``{`` at ``start``."""
    depth = 0
    for index in range(start, len(css)):
        char = css[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
    raise StylesError("Unbalanced braces in styles")
