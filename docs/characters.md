# Character sheets

Grimoire's character builder is **schema-driven**: a sheet is a JSON document
describing its fields, the values derived from them, and how it is drawn. There
is no game-specific code in Grimoire, so the same engine renders D&D, Draw
Steel, Pathfinder, Cairn or a system you invent this evening.

**Characters** live under Campaigns in the sidebar. Sheets and **rulesets** — the
content your tables play with — are both managed from **Manage sheets** there,
since the two only mean anything together.

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

**Characters → Manage sheets** is the one place for this. It opens on **Sheets**,
which lists what you have installed and offers two ways to add more, and has a
**Rulesets** tab beside it for the content those sheets draw from - the two are
one job, so they sit behind one button.

- **Browse sheets** lists what the community catalogue offers, with each sheet's
  licence and credit shown before you install anything.
- **Paste a sheet** takes one you wrote or were sent.

Sheets are **per user**, like [themes](themes.md) - installing one changes
nothing for anyone else, so no admin approval is involved. A downloaded sheet is
checked against the catalogue's digest and validated before it is stored; nothing
in a sheet runs. Uninstalling a sheet keeps the characters built on it: they open
showing their stored values until you install it again.

### Pasting one

Three boxes, because a custom sheet is three things:

| Box | What goes in it |
| --- | --- |
| **Sheet** | The definition: fields, computed values, content types. **JSON or YAML** |
| **Layout** | Optional. A custom layout, as real HTML |
| **Stylesheet** | Optional. Its CSS |

**YAML is usually the better choice** for a sheet you are writing by hand: no
quoting every key, no trailing-comma errors, and you can leave comments. JSON
works too - it is read first, and YAML only if that fails.

The layout and stylesheet are separate boxes rather than fields inside the
document because HTML embedded in JSON has to be escaped, which turns a readable
template into one unbroken line of `\"` and `\n`. The community repository keeps
them in sibling files for the same reason. A sheet with no layout is drawn in
plain sections, which is all a rules-light game needs.

Pasting is not a way around the safety rules: a pasted layout goes through the
same tag allowlist as a downloaded one, and a pasted stylesheet through the same
property filter.

## Building a character

Pick a system, give the character a name, and fill in the sheet. The name you
give fills the sheet's own name field, and renaming either one renames both.
Edits save as you type, so there is no Save button to forget.

- **Derived values** recalculate live. A modifier updates the instant its score
  changes.
- **Warnings** appear at the top when the sheet notices something - more spells
  prepared than your maximum allows, say. They never block saving: a sheet
  mid-edit is routinely invalid, and losing your work over a state you are on
  your way out of would be worse than the warning.
- **Portraits** upload from the sheet's header.
- **Picked entries open.** Click a feat or a spell on the sheet to read the
  whole entry.
- **Sheets can have pages.** The D&D 5e sheet follows the printed one: the
  character on its first page, spellcasting and details on its second.

### Your choices fill in the rest

A sheet can react to what you pick. On the D&D 5e sheet:

- **Picking a class** sets whether you cast spells and with which ability, your
  saving throws, hit dice and maximum hit points - then asks you to choose its
  skill proficiencies.
- **Picking a background** adds its skills and its origin feat. The feat is
  linked to the catalog entry when your content has it, and added by name when
  it does not.
- **Picking a species** sets your speed, size and species traits.

Each skill has one dropdown - not proficient, proficient, or expertise - and
shows its actual bonus beside it; expertise doubles your proficiency bonus.

Species traits, class features and feats all work the same way: each shows its
name with where it came from underneath, and opens to its full description.
Picking a species adds its traits. Anything the installed content lacks - a
homebrew feature, a trait from another book - can be added by hand and given a
description of your own.

Spell slots are worked out from your class and level, and shown as boxes you
tick when you cast. A multiclass caster can set their caster level, or any slot
total, by hand. Spells can be listed whether or not your class casts, since a
feat or a species can grant them, and each spell can note the ability it uses.

Ability scores are entered as a base score plus a background bonus, the way the
2024 rules build them. The sheet warns if the bonuses do not add up - more than
3 in total, or a bonus on an ability your background does not offer - but a
warning never stops you: a table's house rule is as good as the book's.

Change your mind and it follows: swap one background for another and the first
one's skills and feat come off again. Only what a pick added is taken back, so
a skill you gave yourself stays put. A choice it asks for can always be put off
and made by hand later.

### You can set any value

Everything a sheet works out is a suggestion. The table is the authority, not
the formula:

- A value filled in from your choices is marked **auto**. Type over it and it
  is yours; the reset button beside it hands it back.
- A calculated value - Armour Class, a save DC, a modifier - can be clicked and
  set. Everything built on it follows: raise your proficiency by hand and your
  save DC moves with it. An overridden value is underlined, with a reset beside
  it.
- **All values**, in the sheet's header, lists everything the character stores
  and calculates in one plain view, whatever the sheet's own layout shows. A
  sheet written by someone else that leaves a field out, or hides it, can never
  leave that value out of reach.

None of this needs content installed. With no class or species loaded - a
homebrew class you are playing from your own notes, say - every one of these
is simply an ordinary field you fill in.

### What the builder does, and does not do

Grimoire keeps your character's **record** and does its **arithmetic**. It does
not run a game's **character creation procedure** - Traveller's careers,
Cyberpunk's lifepath, a priority table, rolling on random tables. Those differ
completely from game to game, and belong at the table with the book; the sheet
holds what they produced.

Four rules keep it that way, for anyone writing a sheet or asking for a feature:

1. **The record and the arithmetic, never the procedure.**
2. **Everything automatic is a suggestion** - it can be overridden and reset,
   and a warning never blocks saving.
3. **Nothing in the engine is about one game.** A new capability has to be
   general data that two or more games could use as it stands.
4. **Every sheet works with no content installed.**

## The content catalog

A system can ship a **content pack** - spells, classes, feats, kits. Fields that
draw from it open a browser you can search and filter.

A character **references** an entry rather than copying it, so an erratum or an
edit reaches every character that chose it. Anything a pack does not have you
can still type in by hand: every catalog field that allows it has an **Add
custom** button, so the catalog is there when you want it and ignorable when you
do not.

## Rulesets

A **ruleset** is a named set of content a table plays with — an SRD, a
supplement, your house rules. It holds exactly the same shape as pack content,
so it appears in the same browser and works with the same formulas. What a
ruleset adds is that you can **edit** it and that it is **scoped**.

Scoping is the useful part. Two games can run the same system and allow
different content:

- A ruleset **belonging to a campaign** is shared with everyone at that table.
  The GM who owns the campaign edits it; the players read it. It is deleted with
  the campaign.
- A ruleset **for the server** is available in every game. Only an admin can
  create one, which is what core rules usually want.

**Characters → Manage sheets → Rulesets** is where you manage them.

### Getting content into one

- **Browse content packs** to get the content itself. This is how the 5.5e SRD
  reaches a table: an admin installs the pack once from the community catalogue,
  and from then on any ruleset can import it in a click. Anyone may browse - a GM
  should be able to see what a pack offers before asking for it - but installing
  is admin-only, because a pack is shared by everyone on the server. Each file is
  checked against the digest the catalogue published before anything is written.
- **Import a content pack** into a ruleset once it is installed. The pack's
  licence and credit are copied onto the ruleset, so SRD content stays attributed
  wherever it is shown.
- **Fork an existing entry.** Pack content is read-only, so changing a spell
  means taking a copy. The copy remembers what it came from.
- **Write one by hand**, filling in the same form the catalog browser reads.
- **Import a document** someone exported, or **Export** yours to send on. The
  paste box reads **JSON or YAML**, like a sheet does. Pick which ruleset it goes
  into and what to do about anything already there: keep it (the default), add
  the incoming copy alongside, or replace it. Defaulting to *keep* means an
  import never silently overwrites your work.

Deleting an entry never damages a character. The sheet shows it as missing, and
the character is intact if the entry comes back.

## Campaigns

Setting a character's campaign puts it on that table, and everyone in the
campaign can read the sheet - which is the point, since a GM should be able to
see what the party is playing. Editing stays with the player who wrote it.

## Sharing a character

**Export character** from the sheet's header writes a self-contained file:
every referenced entry is embedded, and the sheet definition travels with it.
That means it opens on a server that has neither the pack nor the ruleset it
was built from.

Importing prefers what the receiving server already has and falls back to what
is in the file, so a shared character picks up local corrections rather than
freezing what the sender happened to have.

## Pointing at a different catalogue (admin)

The sheet catalogue follows whichever add-on index is configured under
**Settings → Add-ons**, so setting that to a branch's `index.json` points
themes, note templates and sheets at that branch together. The dialog shows
which catalogue the listing came from, so it is obvious when you are not on
`main`.

That setting takes a **comma-separated list**, so you can offer several
catalogues at once — the official one alongside a friend's fork, say. Sheets
from every source appear together, labelled with the host they came from when
more than one is configured, and installing one picks that source's copy even
if another offers a sheet by the same name. A source that cannot be reached is
called out rather than quietly leaving its sheets out of the list.

## Installing content packs (admin)

Packs are server-wide, so installing one needs an admin. The usual way is
**Characters → Manage sheets → Rulesets → Browse content packs**, which lists
what the community catalogue offers. An installed pack there can be
**reinstalled**, **updated** when the catalogue has a newer version, or
**uninstalled**. Uninstalling also sits beside each pack under **Settings →
Add-ons → Character content packs**.

A pack can also be installed by hand: put its directory in `character-content/`
inside your data directory, then **Reload from disk** on that settings page.
Deleting the directory by hand works too - a pack whose directory is gone stops
being listed as installed.

Uninstalling leaves characters intact: an entry they reference shows as not
installed until the pack comes back. A ruleset that imported the pack keeps its
own copy of the entries, so it is unaffected; to pick up a newer version of the
pack in a ruleset, import it again and choose **Replace it**.

Each pack lists its licence and the credit it must be shown under, rendered
exactly as the licence requires.
