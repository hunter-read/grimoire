# The compendium

A game system's **Compendium** tab collects the rules content linked to it -
spells, conditions, monsters, classes, rules - in one place you can browse and
search. It reads [content packs](characters.md#the-content-catalog), so a fresh
server with the D&D 5e SRD pack installed has a working compendium as soon as
the pack is linked to a system. Nothing needs to be imported.

- [Setting one up](#setting-one-up)
- [Reading it](#reading-it)
- [Character sheets for a system](#character-sheets-for-a-system)
- [Where the content comes from](#where-the-content-comes-from)
- [Who sees what](#who-sees-what)
- [Writing a pack for it](#writing-a-pack-for-it)

## Setting one up

A system's compendium is made of the packs and sheets **linked** to it. A GM or
an admin sets them from the system's page:

1. Open the system and choose **Edit**.
2. Under **Compendium**, tick the **content packs** that should fill it, and the
   **character sheets** its players use.

Each tick is saved at once, like a cover upload. A system can link more than one
pack - the SRD and a homebrew pack, say - and one pack can be linked to more
than one system, so the SRD can serve both a "D&D 5e" and a "D&D 5e (2024)"
shelf.

The packs are the ones installed on the server (see
[Installing content packs](characters.md#installing-content-packs-admin)). The
sheets are your own and the ones an admin installed for everyone (see
[Sheets for everyone](characters.md#sheets-for-everyone-admin)).

A link is kept by the pack's or sheet's id, not by the installed copy, so
uninstalling the SRD and installing it again - or updating it - leaves the
system linked. A link whose pack is not installed right now is shown as **not
installed** in the edit form, where it can be unticked.

Once anything is linked, the system's page has two tabs: **Books** and
**Compendium**.

## Reading it

The Compendium tab lists each kind of content the linked packs hold, with how
many entries it has. Open one to get a list you can:

- **search** - by name and the fields its pack marks as searchable,
- **filter** - by the fields its pack marks as filters, such as a spell's level
  and school or a monster's type and challenge rating. A filter that depends on
  another, such as a subclass on its class, waits until its parent is chosen,
- **page** through, 50 at a time.

Each entry opens on its own address, so you can bookmark it or paste a link to
it in a campaign note. What you searched and filtered is kept while you move
between an entry and its list.

The search box above the list looks across every kind at once.

Entries also turn up in the global **Search**, in a **Compendium** section
beside the books. The **System** filter there narrows them too, and an entry
opens in the system you picked.

The credit each pack must be shown under is printed at the foot of every
compendium page, word for word. Open game licences such as CC BY 4.0 require it
wherever the content appears.

## Character sheets for a system

The sheets linked to a system are listed on its page as shortcuts. Choosing one
opens **Characters** with a new character already set to that sheet. A sheet you
don't have - it is neither yours nor installed for everyone - is named but not a
link, so you know which one to install.

## Where the content comes from

- **Linked content packs.** Their entries, read-only.
- **Rulesets** written for the same sheets: the server's, your campaigns', and
  your own personal ones. A table's house version of a spell appears beside the
  pack's, marked with the ruleset it comes from. A ruleset that is an unchanged
  copy of a linked pack - one the SRD was imported into - is not shown twice.

How an entry reads comes from the add-ons themselves, never from Grimoire:

1. the sheet the pack is for, if you have it (your own copy, or one installed
   for everyone),
2. otherwise the content types the pack declares itself - this is how a pack
   carries reference material such as conditions or monsters that no sheet uses,
3. otherwise the entry's own values, each shown under its key.

A system with sheets linked but no pack still has a compendium if a ruleset is
written for one of those sheets.

## Who sees what

The compendium follows the system. Anyone who can open the system can read its
compendium; a system hidden from you hides its compendium too, and its entries
stay out of your search. A ruleset's entries reach only the people who can read
that ruleset - a GM's personal ruleset stays the GM's. Guest accounts have no
library access, so they have no compendium either.

Changing what a system is linked to is for GMs and admins, like the rest of its
edit form.

## Writing a pack for it

A content pack is a directory of JSON files, one per content type. The
community repository's
[content pack guide](https://github.com/grimoire-codex/community-add-ons/blob/main/content-packs/README.md)
covers the format. For the compendium, two parts matter:

- A pack's `_meta.json` may declare **content types of its own**, under
  `content_types`, in the same shape a character sheet uses. That is how the SRD
  packs carry conditions, rules and monsters. If the pack's sheet declares a type
  of the same name, the sheet's declaration is used.
- A type's `search_fields`, `filter_fields`, `filter_depends`, `sort_default` and
  `compact_display` decide how its list searches, filters, sorts and reads. A
  field of type `textarea` keeps its paragraphs.

Grimoire refuses a pack whose declared types do not validate, with a message
naming the problem, so a typo shows up when the pack loads rather than as an
empty compendium.
