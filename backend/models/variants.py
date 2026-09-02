"""The vocabulary of variant kinds shared by models, services, and routers.

A *variant* is a second file of the same thing: a printer-friendly cut of a
rulebook, a form-fillable character sheet, a gridless copy of a battle map, an
older version superseded by errata. It is a real file the user owns and can
open, so it keeps its own row and its own id — it is only hidden from browsing,
counts, and search so one book does not occupy five shelf slots.

Kept in its own module so ``models`` and ``services`` can both import it without
either depending on the other.
"""

# Why a closed set and not a free-text field: the kind drives the label the UI
# shows in the version picker and the badge, and a closed set keeps those
# translatable. ``variant_label`` next to it stays free text for the specifics
# ("v1.0.1").
#
# Note that the paired kinds are two entries rather than one: in a spreads /
# single-page pair each file carries its own kind, and the same holds for
# gridded / gridless. A single "spreads-or-single" kind could not say which
# member you were looking at.
#
# The vocabulary is *scoped by collection*, because most kinds only mean
# something for one of them: a gridless token or a form-fillable audio track is
# not a distinction a user can make, and offering it only invites mis-filing.
# Anything that applies everywhere lives in _UNIVERSAL; the rest is listed
# against the collections it actually describes.
_UNIVERSAL = frozenset({"version", "other"})

# What a kind means where it is not obvious from the name:
#   universal-vtt - a .dd2vtt/.uvtt export carrying walls and lights, the same
#                   map as the flat image beside it.
#   video         - an animated cut of a still map.
#   image         - the still cut of an animated one; the counterpart to
#                   ``video``, for the same reason gridded/gridless are a pair.
VARIANT_KINDS_BY_TYPE: dict[str, frozenset] = {
    "book": _UNIVERSAL
    | {
        "printer-friendly",
        "form-fillable",
        "spreads",
        "single-page",
        "black-and-white",
    },
    "map": _UNIVERSAL
    | {
        "printer-friendly",
        "black-and-white",
        "gridded",
        "gridless",
        "universal-vtt",
        "video",
        "image",
    },
    "token": _UNIVERSAL | {"black-and-white", "color-variation"},
    "audio": _UNIVERSAL | {"remix", "slowed", "sped-up"},
}

# Every kind any collection accepts. Used where a resource type is not in hand —
# the ORM column comment, and the legacy path in ``validate_kind`` that lets a
# row keep a kind its collection no longer offers.
VARIANT_KINDS = frozenset().union(*VARIANT_KINDS_BY_TYPE.values())


def kinds_for(resource_type: str) -> frozenset:
    """The kinds ``resource_type`` accepts, or the full set for an unknown one.

    Falling back to the full set rather than raising keeps callers that do not
    know their collection (older clients, ad-hoc scripts) working exactly as
    they did before the vocabulary was scoped.
    """
    return VARIANT_KINDS_BY_TYPE.get(resource_type or "", VARIANT_KINDS)
