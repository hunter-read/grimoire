"""Parse ``CHANGELOG.md`` into the structure the About dialog renders.

The file is Keep a Changelog markdown maintained by hand. Rather than ship a
markdown renderer to the browser to display four kinds of node, this reads the
handful of constructs the format actually uses — a version heading, an optional
prose summary, and ``###`` sections of bullets — and hands the client plain
data. The dialog then styles it like the rest of the app instead of inheriting
whatever a markdown renderer decides.

Parsing is deliberately forgiving. A changelog entry is documentation, not
input: a heading that does not match, a stray paragraph, a section with no
bullets under it costs that fragment and nothing else. The alternative — an
About dialog that fails to open because someone wrote a date wrong — is far
worse than one that quietly omits a line.

Read once and cached: the file ships in the image and cannot change under a
running process, so re-reading it per request would be pure waste.
"""

import os
import re
import threading
from typing import Optional, TypedDict

from ..config import logger

# ``## [1.6.2] - 2026-09-10``, ``## [Unreleased]``, or the same without
# brackets. The brackets are Keep a Changelog's link-reference syntax and carry
# no meaning here beyond naming the version, so they are optional: a changelog
# that has not adopted the link definitions still parses.
# The trailing remainder is captured loosely and the date picked out of it
# separately, so a heading whose date is mistyped still yields its release with
# `date: None` — losing the date, rather than losing every entry beneath it.
_VERSION_RE = re.compile(r"^##\s+\[?(?P<version>[^\]\s]+)\]?\s*(?P<rest>.*)$")
_DATE_RE = re.compile(r"(?P<date>\d{4}-\d{2}-\d{2})")
# ``### Added``, ``### ⚠ Breaking``, ``### Security`` — the category name is
# whatever the author wrote, including a leading emoji, and is passed through
# rather than mapped to a closed set. A changelog that invents "Documentation"
# should render it, not drop it.
_SECTION_RE = re.compile(r"^###\s+(?P<title>.+?)\s*$")
_BULLET_RE = re.compile(r"^[-*]\s+(?P<text>.+?)\s*$")
# Link definitions at the foot of the file (``[1.6.2]: https://…``). They are
# reference plumbing for the markdown, never content.
_LINK_DEF_RE = re.compile(r"^\[[^\]]+\]:\s*\S+\s*$")


class Section(TypedDict):
    """One ``###`` category and its bullets."""

    title: str
    entries: list[str]


class Release(TypedDict):
    """One version heading and everything under it."""

    version: str
    date: Optional[str]
    summary: Optional[str]
    sections: list[Section]


# The repo root, three levels up from this file (backend/services/changelog.py).
_DEFAULT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "CHANGELOG.md",
)

_cache_lock = threading.Lock()
_cache: Optional[list[Release]] = None


def _flush(summary_lines: list[str]) -> Optional[str]:
    """Join a release's free prose into one paragraph, or ``None`` if there was none."""
    text = " ".join(line.strip() for line in summary_lines if line.strip()).strip()
    return text or None


def parse_changelog(text: str) -> list[Release]:
    """Turn Keep a Changelog markdown into a list of releases, newest first.

    Order follows the file rather than being sorted: the changelog is already
    newest-first, and sorting would mean parsing version strings — which invites
    the question of what to do with ``Unreleased``, a value no version
    comparison orders correctly.
    """
    releases: list[Release] = []
    release: Optional[Release] = None
    section: Optional[Section] = None
    summary_lines: list[str] = []

    for raw in text.splitlines():
        line = raw.rstrip()

        version_match = _VERSION_RE.match(line)
        if version_match:
            if release is not None:
                release["summary"] = _flush(summary_lines)
                releases.append(release)
            summary_lines = []
            section = None
            date_match = _DATE_RE.search(version_match.group("rest"))
            release = {
                "version": version_match.group("version"),
                "date": date_match.group("date") if date_match else None,
                "summary": None,
                "sections": [],
            }
            continue

        # Anything before the first version heading is the file's preamble.
        if release is None:
            continue

        section_match = _SECTION_RE.match(line)
        if section_match:
            section = {"title": section_match.group("title"), "entries": []}
            release["sections"].append(section)
            continue

        bullet_match = _BULLET_RE.match(line)
        if bullet_match:
            if section is None:
                # A bullet with no category above it. Keep the text under an
                # unnamed section rather than dropping it; the renderer shows
                # such a section without a header.
                section = {"title": "", "entries": []}
                release["sections"].append(section)
            section["entries"].append(bullet_match.group("text"))
            continue

        # Free prose, but only the lead paragraph before any ``###`` counts as
        # the release summary — a stray line further down belongs to no section
        # and is dropped rather than silently appended to the summary.
        if section is None and line and not _LINK_DEF_RE.match(line):
            summary_lines.append(line)

    if release is not None:
        release["summary"] = _flush(summary_lines)
        releases.append(release)

    # Drop releases that parsed to nothing at all (a heading with no body).
    return [r for r in releases if r["sections"] or r["summary"]]


def load_changelog(path: Optional[str] = None) -> list[Release]:
    """The parsed changelog, read from disk once and cached.

    Returns an empty list when the file is absent — which is a supported state,
    not an error: ``.dockerignore`` excludes markdown by default, and a source
    checkout run from an unusual working directory may not find it either. The
    dialog simply shows no changelog section in that case.
    """
    global _cache
    if path is None:
        with _cache_lock:
            if _cache is not None:
                return _cache

    target = path or _DEFAULT_PATH
    try:
        with open(target, encoding="utf-8") as fh:
            releases = parse_changelog(fh.read())
    except FileNotFoundError:
        logger.info("No CHANGELOG.md at %s - the About dialog will omit it.", target)
        releases = []
    except OSError as e:
        logger.warning("Could not read CHANGELOG.md at %s: %s", target, e)
        releases = []

    if path is None:
        with _cache_lock:
            _cache = releases
    return releases


def reset_cache() -> None:
    """Drop the cached parse. For tests."""
    global _cache
    with _cache_lock:
        _cache = None
