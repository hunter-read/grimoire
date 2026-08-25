"""Resolving an add-on's self-declared ``author`` into a display name and link.

Shared by all three kinds of community content — scrapers, themes, and wiki
note templates — so a byline resolves identically wherever it is shown.

The author field is free text written by whoever authored the add-on, and the
community repo is open to anyone. The value therefore never becomes a URL
directly: a manifest could otherwise supply ``javascript:`` or point the byline
at somewhere unrelated. Instead a *GitHub username* is recognised by shape and
the profile URL is derived here, so the only links produced are
``https://github.com/<username>`` for a string that is already known to be a
plain username. Anything else renders as an unlinked name.
"""
import re

GITHUB_BASE = "https://github.com/"

# GitHub's own rule for usernames: alphanumeric or single hyphens, no leading or
# trailing hyphen, 39 characters max. Deliberately strict — a string that fails
# it is shown as a plain name rather than guessed at.
_GITHUB_USERNAME = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$")


def parse_author(raw: str) -> tuple[str, str]:
    """Split a manifest ``author`` into ``(display_name, url)``.

    ``url`` is ``""`` whenever no GitHub profile can be derived safely, which
    is the signal for the UI to render the name as plain text.

    A leading ``@`` is accepted and stripped, since that is how people usually
    write a username. The display name keeps the author's own spelling.
    """
    name = (raw or "").strip()
    if not name:
        return "", ""

    candidate = name[1:].strip() if name.startswith("@") else name
    if _GITHUB_USERNAME.match(candidate):
        return candidate, f"{GITHUB_BASE}{candidate}"

    # A full GitHub profile URL is the other form people reach for. Accept only
    # an exact https://github.com/<username> with nothing after it, so a link
    # to an arbitrary repo, gist, or lookalike host is never produced.
    for prefix in (GITHUB_BASE, "http://github.com/"):
        if candidate.lower().startswith(prefix):
            tail = candidate[len(prefix) :].strip("/")
            if _GITHUB_USERNAME.match(tail):
                return tail, f"{GITHUB_BASE}{tail}"
            break

    return name, ""
