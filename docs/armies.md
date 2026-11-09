# Armies and leagues

For wargames, Grimoire keeps your **army lists** and runs **leagues** - a group
playing the same game over weeks or months, what Warhammer 40,000 calls a
Crusade and Age of Sigmar a Path to Glory. Both sit in the sidebar under a
**Wargaming** heading, below Campaigns and Characters under **Role-playing**, and both work with the wargame books in your library's
`armory/` folder, laid out as `armory/<System>/<Edition>/Factions/<Faction>/`.

Grimoire ships **no points, stat lines or rules text**. An army holds only what
you import or type; the rules themselves stay in your own books, which an army
opens at the right page.

Neither is available to guests, who are scoped to the campaign they were invited
to. An admin can hide either from the sidebar under **Settings → Sidebar
Visibility** (**Hide Armies**, **Hide Leagues**); the pages stay reachable by
their address.

## Armies

**Armies → Import roster** takes a `.ros` or `.rosz` roster from
[BattleScribe](https://www.battlescribe.net/) or [New Recruit](https://www.newrecruit.eu/).
Every unit comes in with its points, upgrades, stat lines and rules, and the
army is matched to the library's wargame system and faction by name - a roster
for "Warhammer 40,000 10th Edition" from the "Xenos - Necrons" catalogue lands
on that edition's Necrons faction, when your armory has them. The file is kept
as it was uploaded, so **Download roster** hands back the same bytes to open in
BattleScribe again.

**New army** builds a list by hand, for games with no BattleScribe data: a name,
optionally a game, faction and points limit, then **Edit units** for each unit's
name, model count, points and a category. An imported list comes from its
roster and is not edited by hand; import a new roster instead.

Every army can be **exported as text** - the plain list an opponent or a
tournament organiser asks for. Points over the army's limit show in red.

An army is yours: only you (and admins) can change it. It is private until you
register it in a league, when that league's organiser and members can read it.

### Rules in your own books

A roster cites where each unit's rules are printed - "Codex: Necrons, p. 82".
A GM or admin links each cited publication to a book in the library once, under
**Source books** on any army that cites it, with a **page offset** for books
whose printed page numbers do not match the PDF's (a cover and front matter
before page 1, say). The link is shared, so every army citing that publication
then opens it at the page. Suggestions come from book titles that match, and
**Search** finds others. Nobody is shown a book they could not otherwise open.

## Leagues

GMs and admins start leagues under **Leagues → New league**, with an optional
game and points limit, and add players - anyone with a full account. The
organiser is not a player until they add themselves.

Each member picks one of their own armies to play. Members **log the games they
play in**: both players, the scores, the mission, the date and notes. Give both
scores and the result follows from them; without scores, say who won. A game can
be edited or deleted by either of its players, whoever logged it, or the
organiser.

The **standings** rank members by league points - 3 for a win, 1 for a draw and 0
for a loss unless the organiser changes them under **League settings** - then by
score difference, then by score. A game whose player has left still counts for
their opponent.

Units carry their **progress** as a league goes on: experience, honours and
notes, set by the army's owner on each unit. It is kept apart from the list
itself, so it is never confused with what the roster says.

The organiser can rename the league, change its points limit and scoring, mark it
**finished** (and reopen it), or delete it. Deleting a league removes its
members and games; the armies stay.

## Data

Armies, leagues and links live in the database. Imported roster files are kept
in `army_rosters/` under the data directory and are included in
[backups](backups.md). The [API](api.md#armies) covers both, and API keys reach
them through the **Armies and leagues** permission.
