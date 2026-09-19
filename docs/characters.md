# Character sheets

Grimoire's character builder is **schema-driven**: a sheet is a JSON document
describing its fields, the values derived from them, and how it is drawn. There
is no game-specific code in Grimoire, so the same engine renders D&D, Draw
Steel, Pathfinder, Cairn or a system you invent this evening.

**Characters** live under Campaigns in the sidebar, beside **Homebrew**.

## Sheets that ship today

The community repository carries five, each under the licence its game is
published with:

| System | Layout |
| --- | --- |
| Dungeons & Dragons 5e (2024) | Custom |
| Draw Steel | Custom |
| Pathfinder 2e | Custom |
| Cairn | Default |
| Basic Fantasy RPG | Default |

A *custom* sheet is laid out to resemble its published original. A *default*
sheet is drawn in plain sections from the same field definitions — perfectly
usable, and all a rules-light game needs.

Each derives the arithmetic its system actually uses: D&D scales proficiency
into saves and passive Perception, Pathfinder adds your level to a check only
once you are trained, Draw Steel works out winded and recovery values from your
stamina, and Basic Fantasy derives the ability bonus table.

## Installing a sheet

**Characters → Import a sheet**, then paste a schema. Sheets are **per user**,
like [themes](themes.md) - installing one changes nothing for anyone else, so
no admin approval is involved. Uninstalling a sheet keeps the characters built
on it: they open showing their stored values until you install it again.

## Building a character

Pick a system, give the character a name, and fill in the sheet. Edits save as
you type, so there is no Save button to forget.

- **Derived values** recalculate live. A modifier updates the instant its score
  changes.
- **Warnings** appear at the top when the sheet notices something - more spells
  prepared than your maximum allows, say. They never block saving: a sheet
  mid-edit is routinely invalid, and losing your work over a state you are on
  your way out of would be worse than the warning.
- **Portraits** upload from the sheet's header.

## The content catalog

A system can ship a **content pack** - spells, classes, feats, kits. Fields that
draw from it open a browser you can search and filter.

A character **references** an entry rather than copying it, so an erratum or an
edit reaches every character that chose it. Anything a pack does not have you
can still type in by hand: every catalog field that allows it has an **Add
custom** button, so the catalog is there when you want it and ignorable when you
do not.

## Homebrew

**Homebrew** is content you write yourself, in exactly the same shape as pack
content - so it appears in the same browser, works with the same formulas, and
can be shared as a pack of its own.

- **Fork** an existing entry to start from it. Pack content is read-only, so
  editing a spell means taking a copy that is yours.
- **Visibility** is private (the default), shared with one of your campaigns, or
  public to everyone on the server. Sharing lets people *read* your entry;
  only you can change it.
- **Export** bundles your homebrew for one system into a file, and **Import**
  reads one back. An import skips anything you already have rather than
  overwriting your work.

Deleting an entry never damages a character. The sheet shows it as missing,
and the character is intact if the entry comes back.

## Campaigns

Setting a character's campaign puts it on that table, and everyone in the
campaign can read the sheet - which is the point, since a GM should be able to
see what the party is playing. Editing stays with the player who wrote it.

## Sharing a character

**Export character** from the sheet's header writes a self-contained file:
every referenced entry is embedded, and the sheet definition travels with it.
That means it opens on a server that has neither the pack nor the homebrew it
was built from.

Importing prefers what the receiving server already has and falls back to what
is in the file, so a shared character picks up local corrections rather than
freezing what the sender happened to have.

## Installing content packs (admin)

Packs are server-wide: put a directory in `character-content/` inside your data
directory, then **Settings → Add-ons → Character content packs → Reload from
disk**. Each pack lists its licence and the credit it must be shown under,
rendered exactly as the licence requires.
