"""Scoping and filtering for a schema's ``styles`` block.

A sheet that looks like a real character sheet needs its own CSS. Accepting CSS
from a stranger is safe only if two things hold, and this module enforces both:

1. **Every selector is confined to the sheet.** Each one is rewritten to sit
   under a generated scope class, so a schema cannot restyle the app around it —
   no repainting the nav, no covering the page with a fake dialog. A selector
   that starts from the sheet itself (``&``) may go down into it, never across
   to its siblings.
2. **A closed allowlist of properties and functions.** Layout, colour, and
   typography are allowed. Anything that can load a resource, escape the
   sheet's box, or fix itself to the viewport is not.

``url()`` is rejected wherever it appears, and so is every other function that
is not on the list (``image-set()`` among them). A schema has no legitimate need
to reach the network — an image belongs in an ``<img src>``, which is checked
separately.

The stylesheet is read with tinycss2, a CSS tokenizer that follows the CSS
Syntax spec, so the checks see the same rules, declarations and functions a
browser would, escapes and strings included. What comes out is re-serialised
from those tokens rather than copied from the input.

The output is a stylesheet string the client injects under its scope class. The
app's CSP forbids inline ``<style>``, so it is attached as a constructed
stylesheet rather than written into the document.
"""
from typing import Any

import tinycss2
from tinycss2.serializer import serialize_identifier

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
        # `background` shorthand as well as `background-color`: what makes a
        # background risky is `url()`, which is rejected by value regardless of
        # which property carries it, so blocking the shorthand only forced
        # authors to write the longhand for no gain.
        "background", "background-color", "box-shadow", "outline", "outline-offset",
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

#: Functions a value may call: maths, colours, gradients and grid tracks. None
#: of them takes a resource, so a value built from them cannot reach the
#: network. Anything else — ``url()``, ``image-set()``, ``attr()``,
#: ``expression()`` — is refused.
_ALLOWED_FUNCTIONS: frozenset = frozenset(
    {
        "var", "env",
        "calc", "min", "max", "clamp", "round", "mod", "rem", "abs", "sign",
        "pow", "sqrt", "hypot", "log", "exp",
        "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
        "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch",
        "color", "color-mix", "light-dark",
        "linear-gradient", "radial-gradient", "conic-gradient",
        "repeating-linear-gradient", "repeating-radial-gradient",
        "repeating-conic-gradient",
        "repeat", "minmax", "fit-content",
    }
)

#: At-rules a schema may use. Media and container queries are responsive layout,
#: which a sheet legitimately needs; keyframes/font-face are not allowed because
#: one animates and the other loads a font over the network.
_ALLOWED_AT_RULES: frozenset = frozenset({"media", "supports", "container", "layer"})

#: How deep at-rules may nest, and how deep brackets may nest inside one value
#: or selector. Real sheets use one or two levels; the caps keep a crafted
#: input from recursing without end.
_MAX_AT_RULE_DEPTH = 4
_MAX_TOKEN_DEPTH = 32

#: Combinators that move sideways, to a later sibling. Applied to the sheet
#: itself they would reach the elements next to it.
_SIBLING_COMBINATORS = frozenset({"~", "+", "|"})


def _children(token: Any) -> list:
    """The tokens nested inside a function or bracketed block, if any."""
    if token.type == "function":
        return token.arguments
    if token.type in ("() block", "[] block", "{} block"):
        return token.content
    return []


def _check_value_tokens(tokens: list, prop: str, depth: int = 0) -> None:
    """Refuse anything in a declaration value that is not plain, inert CSS."""
    if depth > _MAX_TOKEN_DEPTH:
        raise StylesError(f"Value for {prop!r} is nested too deeply")
    for token in tokens:
        if token.type in ("url", "{} block", "at-keyword", "error"):
            raise StylesError(f"Value for {prop!r} contains a forbidden construct")
        if token.type == "function" and token.lower_name not in _ALLOWED_FUNCTIONS:
            raise StylesError(f"Function {token.lower_name}() is not allowed in a sheet stylesheet")
        _check_value_tokens(_children(token), prop, depth + 1)


def _check_declaration(declaration: Any) -> str:
    """Validate one parsed declaration, returning it serialised."""
    prop = declaration.lower_name
    # Custom properties are allowed: they are inert unless something reads them,
    # and the sheet's own rules are the only thing in scope to do so. Their
    # values pass the same check, so a variable cannot smuggle in what a
    # property could not hold directly.
    if prop.startswith("--"):
        prop = serialize_identifier(declaration.name)
    elif prop not in ALLOWED_PROPERTIES:
        raise StylesError(f"Property {prop!r} is not allowed in a sheet stylesheet")

    _check_value_tokens(declaration.value, prop)

    value = tinycss2.serialize(declaration.value).strip()
    important = " !important" if declaration.important else ""
    return f"{prop}: {value}{important}"


def _check_selector_tokens(tokens: list, depth: int = 0) -> None:
    """Refuse constructs no selector needs, and any ``&`` below the top level."""
    if depth > _MAX_TOKEN_DEPTH:
        raise StylesError("Selector is nested too deeply")
    for token in tokens:
        if token.type in ("url", "{} block", "at-keyword", "error"):
            raise StylesError("Selector contains a forbidden construct")
        if token.type == "literal" and token.value == "&":
            raise StylesError("'&' may only start a selector")
        if token.type == "literal" and token.value in (";", "}"):
            raise StylesError("Selector contains a forbidden construct")
        _check_selector_tokens(_children(token), depth + 1)


def _strip_whitespace(tokens: list) -> list:
    start, end = 0, len(tokens)
    while start < end and tokens[start].type == "whitespace":
        start += 1
    while end > start and tokens[end - 1].type == "whitespace":
        end -= 1
    return tokens[start:end]


def _first_combinator(tokens: list) -> Any:
    """The first token after leading whitespace, or None if there is none."""
    for token in tokens:
        if token.type != "whitespace":
            return token
    return None


def _scope_selector(tokens: list, scope: str) -> str:
    """Rewrite one selector so it can only match inside the sheet."""
    tokens = _strip_whitespace(tokens)
    if not tokens:
        raise StylesError("Empty selector")

    nests = tokens[0].type == "literal" and tokens[0].value == "&"
    rest = tokens[1:] if nests else tokens
    _check_selector_tokens(rest)

    text = tinycss2.serialize(tokens)
    # `:root` and `html`/`body` are the usual ways to try to reach the whole
    # page. Rewriting rather than rejecting means a schema author who wrote
    # `:root { --ink: red }` out of habit gets sheet-wide variables, which is
    # what they meant.
    if text in (":root", "html", "body"):
        return f".{scope}"

    if nests:
        # `&.wide` or `&:hover` adds to the sheet's own compound; what follows
        # it must step down into the sheet, not across to a sibling.
        end = 0
        while end < len(rest) and not (
            rest[end].type == "whitespace"
            or (rest[end].type == "literal" and rest[end].value in (">", *_SIBLING_COMBINATORS))
        ):
            end += 1
        after = rest[end:]
    else:
        # A bare selector sits under the sheet as a descendant, unless it opens
        # with a combinator of its own.
        after = rest
    combinator = _first_combinator(after)
    if combinator is not None and combinator.type == "literal" and combinator.value in _SIBLING_COMBINATORS:
        raise StylesError(f"A selector may not use {combinator.value!r} to leave the sheet")

    if nests:
        return f".{scope}{tinycss2.serialize(rest)}"
    return f".{scope} {text}"


def _scope_selector_list(prelude: list, scope: str) -> str:
    """Split a prelude on its top-level commas and scope each selector.

    Commas inside ``:is()``/``:not()`` belong to those functions, which the
    tokenizer has already folded into a single token, so they are not split.
    """
    selectors: list[list] = [[]]
    for token in prelude:
        if token.type == "literal" and token.value == ",":
            selectors.append([])
        else:
            selectors[-1].append(token)
    return ", ".join(_scope_selector(selector, scope) for selector in selectors)


def _scope_rules(rules: list, scope: str, depth: int) -> list[str]:
    """Filter and scope a list of parsed rules."""
    out: list[str] = []
    for rule in rules:
        if rule.type == "error":
            raise StylesError(f"Malformed stylesheet: {rule.message}")

        if rule.type == "at-rule":
            at_name = rule.lower_at_keyword
            if at_name not in _ALLOWED_AT_RULES:
                raise StylesError(f"@{at_name} is not allowed in a sheet stylesheet")
            if rule.content is None:
                raise StylesError(f"@{at_name} needs a block of rules")
            if depth >= _MAX_AT_RULE_DEPTH:
                raise StylesError("At-rules are nested too deeply")
            _check_selector_tokens(rule.prelude)
            head = " ".join(filter(None, (f"@{at_name}", tinycss2.serialize(rule.prelude).strip())))
            # A conditional group wraps ordinary rules; scope those recursively.
            inner = _scope_rules(
                tinycss2.parse_rule_list(rule.content, skip_whitespace=True),
                scope,
                depth + 1,
            )
            out.append(f"{head} {{\n" + "\n".join(inner) + "\n}")
            continue

        declarations = []
        for item in tinycss2.parse_blocks_contents(rule.content, skip_whitespace=True):
            if item.type == "error":
                raise StylesError(f"Malformed declaration: {item.message}")
            if item.type != "declaration":
                raise StylesError("Nested rules are not allowed in a sheet stylesheet")
            declarations.append(_check_declaration(item))
        if declarations:
            joined = "; ".join(declarations)
            out.append(f"{_scope_selector_list(rule.prelude, scope)} {{ {joined} }}")
    return out


def scope_styles(source: str, scope: str) -> str:
    """Filter a stylesheet and confine every rule to ``scope``.

    Returns CSS text. Raises StylesError on anything outside the allowlist, so a
    bad stylesheet fails at install time rather than rendering wrong.
    """
    if not isinstance(source, str):
        raise StylesError("styles must be a string")
    if len(source.encode("utf-8")) > MAX_STYLE_BYTES:
        raise StylesError(f"styles exceeds {MAX_STYLE_BYTES} bytes")

    rules = tinycss2.parse_stylesheet(source, skip_comments=True, skip_whitespace=True)
    return "\n".join(_scope_rules(rules, scope, 0))
