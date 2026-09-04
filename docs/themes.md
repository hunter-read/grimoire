# Themes

A **theme** is a set of colours that overrides Grimoire's palette. Alongside the
built-in light and dark modes, a user can install themes from the community
catalogue or paste one in.

Themes are **per user**. A theme only changes what the person who chose it sees,
so anyone with an account can install one and no admin approval is involved.
That is the opposite of [add-ons](addons.md), which an admin installs for the
whole server.

## Using them

**Settings → Appearance** has two controls.

**Colour mode** is light, dark, or system. System follows the operating
system's own light/dark preference and changes with it. The choice is saved to
your account, so it follows you to another browser, and cached locally so the
app never flashes the wrong colours while it loads.

**Theme** is the built-in palette or one you have installed. Below it:

| Button | What it does |
| --- | --- |
| **Browse community themes** | The catalogue from the community repository - install a copy into your account |
| **Import a theme** | Paste a theme's JSON to install it directly |

A theme may cover one colour mode or both. One that ships a light **and** a dark
palette shows as a single entry marked *light & dark*, and **System** switches
between its two palettes as your OS setting changes. A theme covering one mode
keeps applying in the other rather than switching itself off, so nothing goes
unstyled. Anything a theme does not set falls back to the built-in palette.
Removing a theme you are using returns you to the built-in one.

### High Contrast

The community catalogue ships **High Contrast**, which pairs a pure-black and a
pure-white palette in one theme: every text-on-background pairing sits at WCAG
AAA (7:1) either way, and it follows System. It is a good starting point if the
default palette is hard to read.

It raises **luminance contrast only**. It does not address colourblindness -
distinguishing states without relying on hue needs icons and labels in the
interface itself, which no change of colour can provide.

### App modes

Grimoire has a second axis alongside light/dark: the **app mode**, which is the
side of the product you are working in. **Grimoire** is the TTRPG library;
**Codex** is a wargaming skin, built as a palette and waiting on the toggle that
will surface it.

Each app mode remembers its own colour mode and theme, so switching between them
restores the colours you picked there rather than carrying one across. **Codex**
is a built-in theme, so it can be selected from the theme list without being
installed.

A theme may declare the app mode it was designed for. That is a preference the
picker sorts by, not a restriction - the same theme can be used in either, which
is the point: one High Contrast theme serves both.

## Writing one

A theme is a JSON document:

```json
{
  "id": "midnight",
  "name": "Midnight",
  "version": "1.0.0",
  "mode": "dark",
  "app_mode": "grimoire",
  "description": "One sentence about the look.",
  "tokens": {
    "bg-deep": "#000000",
    "text": "#ffffff",
    "accent": "#ffd54a"
  }
}
```

`mode` is the built-in palette yours varies from; `app_mode` is optional and
defaults to `grimoire`. Every token is optional, so a theme can change three
colours or all of them. Paste it into **Import a theme** to try it immediately;
no repository or round-trip is needed while you iterate.

### Covering light and dark

Ship both palettes in one theme with a `variants` block, so it appears once and
works with **System**:

```json
{
  "id": "midnight",
  "name": "Midnight",
  "mode": "dark",
  "variants": {
    "dark": { "bg-deep": "#000000", "text": "#ffffff" },
    "light": { "bg-deep": "#ffffff", "text": "#000000" }
  }
}
```

`variants` replaces `tokens` when present, and `mode` then names the primary
one. A theme covering a single mode is still perfectly valid - it simply applies
in both.

### Tokens

| Group | Tokens |
| --- | --- |
| Surfaces | `bg-deep` (the page), `bg-panel`, `bg-card`, `bg-card-hover`, `bg-input` |
| Lines | `border`, `border-light` |
| Accent | `accent`, `accent-dim`, `accent-bright`, `accent-alt`, `on-accent` |
| Text | `text`, `text-dim`, `text-muted` |
| Status | `danger`, `warning`, `success`, `red`, `green`, `blue` |
| Destructive buttons | `danger-fill` (the plate), `on-danger` (its label) |
| Content types | `type-book`, `type-map`, `type-token`, `type-audio`, `type-file` |
| Over artwork | `on-media`, `on-media-border`, `scrim`, `scrim-strong` |
| Versions | `variant` — marks an item that has other versions (the version picker, the gallery badge, the duplicate compare view) |
| Other | `tag-bg`, `tag-border`, `mark-bg` (search highlight), `invite-bg`, `overlay`, `shadow` |

Three of these are easy to get wrong:

- **`on-accent`** is text drawn *on* an accent fill, not the accent itself. It is
  dark in both built-in palettes, because the accent is light in both.
- **The content-type hues** identify what a thing is, so they must stay
  distinguishable from each other, not merely on-brand.
- **`on-media` and the scrims** sit over user artwork. They stay light-on-dark in
  both modes, because your theme says nothing about what someone's cover image
  looks like underneath.

### What Grimoire accepts

A token value must be a plain colour: hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`, or
`transparent` / `currentcolor` / `inherit`.

Anything else is dropped, as is any token name not in the list above. These
values are written straight into the page's styles, so the allowlist and the
colour grammar are a security boundary, not a formatting preference - a value
like `red; background: url(https://example.com/)` is rejected rather than
sanitised. A theme that sets nothing recognisable is refused outright instead of
installing as a silent no-op.

Check your contrast: body text wants at least 4.5:1 against every surface it can
land on, and `on-accent` against `accent`.

### Contributing

Themes live in the [community-add-ons](https://github.com/grimoire-codex/community-add-ons)
repository under `themes/<id>/<id>.json`. Add the directory, run
`python3 scripts/build_index.py`, and open a PR; CI validates the theme against
the schema and checks the catalogue is current. See that repo's
[`themes/README.md`](https://github.com/grimoire-codex/community-add-ons/tree/main/themes)
for the authoring reference.

Downloads are verified against the SHA-256 in the catalogue and are pinned to the
catalogue's own host, so a theme file cannot be swapped out or served from
somewhere else.

## Turning downloads off

`DISABLE_EXTERNAL_ADD_ON_INSTALL=true` stops Grimoire fetching anything from a
community repository - themes, note templates, and add-ons alike. **Browse
community themes** disappears and the catalogue endpoints refuse.

**Import a theme** keeps working, because pasting one touches no network. On an
air-gapped server you can copy a theme's JSON across by hand and install it that
way.
