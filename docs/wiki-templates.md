# Wiki note templates

A **note template** is a starting point for a campaign wiki page — a 5e NPC
statblock, a Draw Steel negotiation, a session recap — so a GM builds on a
structure instead of staring at a blank note.

Templates are **per campaign**. They are small markdown files, so every campaign
keeps its own copies and a GM can edit one freely without affecting anyone
else's game. Nothing here is global, and nothing is installed by an admin.

## Using them

In a campaign wiki, the owner gets a **Templates** button beside Import. The
modal has three tabs:

| Tab | What it does |
| --- | --- |
| **My templates** | The campaign's own templates, grouped by category. Click one to start a page from it; the row also offers edit, export, and delete |
| **Browse** | The community catalogue as a collapsible folder tree — download a copy into this campaign |
| **Create** | Write a template by hand |

Below the list, **Upload a template** adds one from disk — either a `.md` file
or a `.zip` in the same layout **Export** produces, so a template can be
exported from one campaign and uploaded into another (or shared with another
GM) with its name, category, and description intact.

Picking a template **does not create the page**. It opens the normal page
editor pre-filled with the template's content, so you can edit before
committing — and cancel without leaving a stray page to delete. The page exists
only once you save it, with a de-duplicated slug like any other new page. Use
the same template five times and you get five pages.

## Writing your own

The **Create** tab collects:

| Field | What it is |
| --- | --- |
| **Name** | What the template is called in your list |
| **Category** | Groups it in the list — pick an existing one or add your own |
| **Description** | One line, shown under the name |
| **Page defaults** | The starting name, icon, and visibility a page gets |
| **Page content** | The markdown the page starts with |

There is no game system field: a template you wrote isn't *for* a system, so
Grimoire files it as your own rather than asking.

**Page defaults** are stored as a YAML frontmatter block on the template body —
the same format the community repo uses — but you never have to write or read
that YAML. Grimoire splits the block out into the form fields when you open a
template and rebuilds it when you save, including for templates you downloaded
or uploaded. Editing and re-saving repeatedly will not stack duplicate blocks,
and a body that merely starts with `---` (a horizontal rule, say) is left alone
as page content rather than being mistaken for frontmatter.

## Browsing the community catalogue

The **Browse** tab reads a catalogue published by the
[`grimoire-codex/community-add-ons`](https://github.com/grimoire-codex/community-add-ons)
repo (`templates/index.json`) and renders the repo's folder structure:

```
> Generic          (always first)
> Draw Steel
> Dungeons & Dragons 5e
```

Folders start collapsed and expand on click. The folder matching the campaign's
game system opens automatically, so a 5e GM lands on 5e templates without
hunting. **Generic** is always sorted first; every other folder is alphabetical
by display name.

Downloaded templates are marked, and downloading one you already have is
allowed — you may well want a tweaked variant alongside the original.

Each download is verified against the `body_sha256` the catalogue declares and
refused on mismatch, the same integrity check add-on installs use.

### Pointing at a different catalogue

The default catalogue suits almost everyone, so the URL field is hidden behind
the link button on the Browse tab. Open it to point Grimoire at a fork or a
private mirror, or **Reset** to restore the default. (The add-ons settings page
hides its index URL the same way.)

The catalogue is cached for an hour; the refresh button re-fetches immediately.

## Turning downloading off

Templates are **enabled by default**. To stop Grimoire fetching them from the
internet:

```bash
DISABLE_EXTERNAL_ADD_ON_INSTALL=true
```

With that set, the Browse tab disappears and both catalogue endpoints refuse —
no outbound request is made. **Authoring and uploading still work**, which is
the point: on a locked-down or air-gapped server a GM can still copy a `.md`
file out of the community repo by hand and upload it.

The switch is shared: it also stops [add-on](addons.md) and [theme](themes.md)
installs, so one setting covers everything that reaches a community repository.
It replaces the older `WIKI_TEMPLATES_DOWNLOAD_DISABLED`, which is no longer
read.

## Contributing one back

Any template can be exported as a `.zip` holding the folder layout the community
repo expects:

```
5e-spell/
├── 5e-spell.yml   # the manifest, generated from the template's fields
└── 5e-spell.md    # the page body
```

Drop that into a fork of the community repo and open a PR, or keep it as your
own catalogue. A template that was downloaded exports under the id it came from,
so a round trip keeps its identity; one you wrote gets a slug of its name.

The same `.zip` can be uploaded straight back into any campaign — export and
upload are inverses, so this doubles as a way to copy a template between
campaigns or hand one to another GM.

See [`docs/note-templates.md`](https://github.com/grimoire-codex/community-add-ons/blob/main/docs/note-templates.md)
in the community repo for the authoring reference.

## How it works

| Piece | Role |
| --- | --- |
| `models/campaigns.py` → `WikiTemplate` | One row per template, keyed to a campaign. `source_id`/`source_url`/`source_version` record where a downloaded one came from; null for authored ones |
| `services/wiki_template_catalogue.py` | Fetches the remote catalogue, builds the folder tree, verifies a downloaded body |
| `routers/campaigns/_frontmatter.py` | Splits a body's frontmatter into fields and rebuilds it on save — written to be idempotent (no stacked blocks) and conservative (ordinary markdown starting with `---` is left alone) |
| `routers/campaigns/wiki_templates.py` | The endpoints: CRUD, use, upload, export, browse, download |

The catalogue service reuses the add-on subsystem's HTTP limits and on-disk
response cache, so template fetches carry the same timeout, redirect, and size
bounds. A body URL is resolved against the catalogue URL and then required to
stay on the same host — a community catalogue must not be able to redirect a
fetch somewhere else.

Nothing is executed. A template is markdown, and the only thing Grimoire does
with it is parse frontmatter and create a wiki page.

## Settings reference

| Key | Default | Meaning |
| --- | --- | --- |
| `DISABLE_EXTERNAL_ADD_ON_INSTALL` (env) | `false` | Turns off catalogue browsing and downloading |
| `wiki_templates.index_url` (app setting) | the community repo's `templates/index.json` | Where **Browse** fetches from |
