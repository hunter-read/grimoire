"""The vocabulary of variant kinds shared by models, services, and routers.

A *variant* is a second file of the same thing: a printer-friendly cut of a
rulebook, a form-fillable character sheet, a gridless copy of a battle map, an
older version superseded by errata. It is a real file the user owns and can
open, so it keeps its own row and its own id — it is only hidden from browsing,
counts, and search so one book does not occupy five shelf slots.

Kept in its own module so ``models`` and ``services`` can both import it without
either depending on the other.
"""

# Why these and not a free-text field: the kind drives the label the UI shows in
# the version picker and the badge, and a closed set keeps those translatable.
# ``variant_label`` next to it stays free text for the specifics ("v1.0.1").
#
# Note that the paired kinds are two entries rather than one: in a spreads /
# single-page pair each file carries its own kind, and the same holds for
# gridded / gridless. A single "spreads-or-single" kind could not say which
# member you were looking at.
VARIANT_KINDS = frozenset(
    {
        "printer-friendly",
        "form-fillable",
        "spreads",
        "single-page",
        "version",
        "black-and-white",
        "gridded",
        "gridless",
        "other",
    }
)
