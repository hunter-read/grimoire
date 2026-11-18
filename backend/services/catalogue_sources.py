"""What a community catalogue listing says about its sources, by who is asking.

The sources are the admin's configuration (Settings -> Add-ons). Anyone may
browse the sheet, pack and theme catalogues, and a GM the note-template and GM
screen ones, so for everyone but an admin a listing leaves out the configured
URLs and the reason a source could not be read, which can name hosts. A failed
source still counts, so the browser can say that something is missing.
"""
from typing import Any

#: The message a non-admin gets for a catalogue that could not be read at all.
UNREADABLE = "The catalogue could not be read"


def shows_sources(user: Any) -> bool:
    """Whether ``user`` may see the catalogue sources and their errors."""
    return getattr(user, "role", None) == "admin"


def source_failures(errors: list[dict[str, str]], show_sources: bool) -> list[dict[str, str]]:
    """``errors`` as they are, or one blank entry per failure without ``show_sources``."""
    if show_sources:
        return errors
    return [{"url": "", "error": ""} for _ in errors]
