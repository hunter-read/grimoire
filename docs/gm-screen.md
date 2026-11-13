# GM screen

Every group campaign has a **GM screen**: a board of tools for the things a GM
tracks at the table rather than on any one character sheet - Fear or Malice,
countdowns and progress clocks, token pools, the turn order, the party's hit
points at a glance, and the notes you want open during play.

Only the campaign's GM sees it. Players never do, so a hidden countdown stays
hidden. Open it from **GM screen** beside **Open notes** on the campaign page.

The GM screen is marked **Beta** while it settles in: expect its tools and layout
to keep changing.

---

## Building a board

A new GM screen starts empty, with three ways to fill it:

- **Start with a basic board** - the party across the top, with initiative,
  countdowns and a scratch note beneath.
- **Community presets** - a ready-made board for a game, from the community
  add-on catalogue (see [Presets](#presets)).
- **Copy from another campaign** you run (see [Copying a board](#copying-a-board)).

Or add tools one at a time with **Add tool**.

The board is a twelve-column grid. Drag a panel by the grip in its header to
move it, and drag its bottom-right corner to resize it. A panel stays exactly
where you drop it; anything it lands on moves down out of the way. From the
keyboard, focus a panel's grip and use the arrow keys to move it, or Shift and
the arrow keys to resize it. On a phone the panels stack in reading order, top
to bottom and left to right, and moving them waits for a bigger screen.

Each panel's gear button opens its settings - its title and how the tool is set
up. Changes there apply when you press **Done**. The **×** removes the panel and
everything it holds.

## The tools

| Tool | What it does |
| --- | --- |
| **Party** | One card per character in the campaign, with the stats you choose: hit points, stress, hope, evasion. A stat is a number or a row of boxes "out of" another value, such as HP marked out of HP. You can change a value from here wherever the player has let the GM edit their sheet ([Letting the GM edit](characters.md#letting-the-gm-edit)); computed values, and everyone else's sheets, only read. Retired and dead characters are hidden unless the panel's settings show them. |
| **Pinned note** | A campaign note, shown as it reads in the notes, GM secrets included. Its links open the notes. |
| **Counter** | One number: Fear, Malice, a doom track. Set a lowest and highest value and a starting value, and show it as a number with − and + or as a row of boxes. |
| **Countdowns** | Countdowns and progress clocks, each a row of boxes with a name and what happens when it triggers. Countdowns show the boxes left and clocks the boxes filled. A full row is marked **Triggered**, and a row set to loop can start again from there. |
| **Token pools** | Named pools of tokens several foes share, stepped up and down as they act. |
| **Initiative** | The turn order, one of two ways. **One after another, by score**: add combatants with a score, sort them, and step through the turns; past the last one a new round starts. **Sides take turns**: combatants are grouped by side - heroes and foes, or any sides you name - and each is ticked once it has gone. Ticking someone hands the turn to the next side with anyone left to act. **Next round** clears every tick and gives the first turn back to the side that goes first. **Add the party** puts every active character in at once. |
| **Rules reference** | Rules to look up mid-session - conditions, setting a DC, cover, travel pace - in sections with a button each. Write each section in Markdown in the panel's settings: **bold**, *italic*, lists and tables. It shows as text only: no HTML, and an image appears as its description. |
| **Random table** | Roll on a table and see the result marked in it: names, rumours, what's in the drawer. Each column rolls its own die, the number of entries it has, so a d20 table is twenty lines. A table can have up to four columns rolled together - a trait and a quirk on their own lines, or a name's start, middle and end run into one word. The last roll stays until the next one or **Clear**. |
| **Scratch note** | Free text for names made up on the spot, rulings, and who owes whom. Saved as you type. |

## Ending a scene, a session, or a rest

Many trackers clear at a fixed point: a pool empties when the scene ends, Fear
goes back down at the end of a session, a long-term countdown resets on a rest.
Each counter, token pool, initiative tracker and countdown row can be set to
clear at **the end of a scene**, **the end of a session**, or **a rest**.

The **End scene**, **End session** and **Rest** buttons above the board clear
everything set to clear then, in one click:

- a counter goes back to its starting value;
- a token pool's tokens go to 0, and the pools themselves stay set up;
- a countdown's ticks clear;
- an initiative tracker's turn order empties, ready for the next fight.

Ending a session ends its scene too, so **End session** also clears what is set
to clear at the end of a scene.

## Copying a board

**Board → Copy from another campaign** lists the other campaigns you run that
have a GM screen. Copying brings the layout and each tool's setup, but not its
values: counters start at their starting value, countdowns unticked, and the
turn order empty, because the new table's game has not happened yet. A pinned
note looks for a note with the same name in the new campaign, and shows nothing
until you pick one if there isn't one.

If this campaign already has panels, choose whether the copy replaces them or
goes beneath them. Presets and imports offer the same choice.

## Presets

**Board → Community presets** lists ready-made boards from the community
add-on repository, read from `gm-screens/` beside the add-on sources your admin
configured (see [Community add-ons](addons.md)). A preset is only ever the
built-in tools above, set up for a game - a Fear counter and countdowns, or an
initiative tracker whose sides take turns. It carries no code and no markup, and
each download is checked against the digest the catalogue publishes. When the
server has community installs switched off, the list is unavailable.

### Exporting and importing

**Board → Export** downloads the board as a `.gm-screen.json` file, and
**Board → Import** puts one on a campaign - yours from another server, or a
preset you are writing. A pinned note travels by its name.

### Writing a preset

A preset is the same JSON an export produces:

```json
{
  "format": "grimoire://gm-screen/v1",
  "name": "Example board",
  "panels": [
    {
      "kind": "counter",
      "title": "Fear",
      "x": 0, "y": 0, "w": 3, "h": 3,
      "config": { "min": 0, "max": 12, "start": 0, "style": "pips", "resets": "" }
    },
    {
      "kind": "initiative",
      "title": "Turns",
      "x": 3, "y": 0, "w": 5, "h": 8,
      "config": {
        "mode": "sides",
        "sides": [{ "key": "heroes", "label": "Heroes" }, { "key": "director", "label": "Director" }],
        "resets": "scene"
      }
    }
  ]
}
```

`kind` is one of `party`, `note`, `counter`, `clocks`, `pools`, `initiative`,
`reference`, `table` and `scratch`. `x`, `y`, `w` and `h` place the panel in grid cells (twelve columns
wide); leave `x` and `y` out to flow panels into the first gap they fit.
`config` sets the tool up and `state` (optional) gives it starting contents, such
as named pools. `resets` is `"scene"`, `"session"`, `"rest"` or `""` for never.

| Kind | `config` | `state` |
| --- | --- | --- |
| `counter` | `min`, `max` (or `null` for no limit), `start`, `style` (`number` or `pips`), `resets` | `value` |
| `clocks` | `mode` (`countdown` or `clock`) | `items`: `{name, size, ticks, note, resets, loops}` |
| `pools` | `resets` | `items`: `{name, tokens, note}` |
| `initiative` | `mode` (`ordered` or `sides`), `sides` (2 to 4 `{key, label}`), `resets` | `round`, `entries` |
| `party` | `stats`: `{label, value, max, style}`, where `value` and `max` name sheet fields; `include_inactive` | - |
| `note` | `page_slug`: the note to pin, by its name in the campaign | - |
| `reference` | `sections`: up to 30 `{title, text}`, `text` in Markdown (8,000 characters a section, 60,000 a panel) | - |
| `table` | `columns`: 1 to 4 `{label, entries}`, `entries` a list of up to 100 strings; `mode` (`list`, each column on its own line, or `join`, run together into one word) | `rolls`: one entry number per column, from 1 |
| `scratch` | - | `text` |

Every value is checked and bounded on import, and anything a kind does not
declare is dropped, so a mistake costs a default value rather than the board.
Import your file from **Board → Import** to try it, then offer it to the
community add-on repository under `gm-screens/`.

## See also

- [Campaigns](campaigns.md) - the campaign page, notes wiki and scheduling
- [Character sheets](characters.md) - the sheets the party overview reads
- [Community add-ons](addons.md) - the sources presets come from
