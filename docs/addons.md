# Community add-ons

Add-ons are installable extensions, authored and maintained separately from
Grimoire in the [`grimoire-codex/community-add-ons`](https://github.com/grimoire-codex/community-add-ons)
repo. Today they are **metadata scrapers**: they look a game system or a book up
on an external source and offer to fill in its details.

Keeping definitions out of this repo means a source that changes its layout can
be fixed by a community PR, not a Grimoire release.

## Using them

**Settings → Add-ons** (admin only).

1. **Refresh** fetches the index from the configured URL (defaults to the
   community repo).
2. **Install** the add-ons you want. They land in `DATA_PATH/add-ons/<id>/`.
3. Open a game system or a book → **Edit** → **Fetch metadata**.

Each add-on declares a `target` — `game-system` or `book` — and only appears in
the editor for that kind of thing.

Pick a source, confirm the match, then review a per-field diff and tick what you
want. Fields your system already has are **not** pre-selected, so a fetch never
quietly overwrites your own work. Applying is an ordinary `PATCH` of just the
fields you chose.

Links are the exception to "replace": `urls` merges rather than overwriting, so
fetching adds the source's own page to whatever links you already had instead of
clearing them.

**Already know which one?** Where a source supports it, the dialog offers
*"Know the exact one? Paste a link or ID"* — paste the item's page URL from the
source (or just its ID) and it goes straight to the review step, no searching.
That is the quickest route for a big catalogue like DriveThruRPG, where a title
search returns many near-misses.

To run a private or in-development add-on, drop its directory into
`DATA_PATH/add-ons/<id>/` and restart — no index required.

## Keeping them current

Definitions are expected to change — that is the point of keeping them outside
Grimoire. When a source alters its layout, the fix ships as a new version of the
add-on, and installed copies need to pick it up.

Installed add-ons whose index version is newer are badged with the available
version and get an **Update** button; **Update all** applies every pending one
at once (refreshing the index first). Updating is the same download-and-verify
path as installing, so the checksum is still enforced.

Two deliberate behaviours:

- **Versions compare as semver**, not as strings — `1.10.0` is newer than
  `1.9.0`, and republishing an older version is never offered as an update.
- **A changed script drops back to unapproved.** Consent was given to specific
  code; if the code changed, Grimoire asks again before running it. `Update all`
  is no exception.

An add-on you placed by hand has no index entry, so it never reports an update —
update it the way you installed it.

## Included sources

| Add-on | Target | Source | Fills in |
| --- | --- | --- | --- |
| TTRPG Wiki | game system | [ttrpgwiki.com](https://ttrpgwiki.com) | description, publisher, year, licence, system family, edition, genres, dice, tags, links |
| DriveThruRPG | book | [drivethrurpg.com](https://www.drivethrurpg.com) | title, description, authors, artists, publisher, genres, ISBN, year, links |

**A note on DriveThruRPG:** its web storefront is behind a Cloudflare bot
challenge, so the scraper does not touch it. It uses the OneBookShelf JSON API
at `api.drivethrurpg.com`, which is unauthenticated and publishes an OpenAPI
spec — more reliable than HTML scraping and lighter on their servers. The links
it writes carry no affiliate code.

## Add-ons that run code

Most add-ons are declarative YAML — Grimoire interprets them itself and no
third-party code ever executes. Some sources need more, so an add-on may ship a
Python script.

Grimoire will not run one unless **both** are true:

1. **Allow add-on scripts** is enabled (off by default).
2. That add-on was approved when you installed it, via a dialog naming the
   script and its SHA-256.

When one does run, it executes in a short-lived **subprocess** with a timeout,
no database handle, and no access to Grimoire internals — so a crash, hang, or
memory blow-up takes down only that subprocess. Approval is bound to the script's
digest, so an update that changes the script requires fresh consent.

This is process isolation, not a sandbox: a script can still reach the network
and read what the server user can read. Treat installing one as running a
program someone sent you. That is exactly why add-ons live in a public repo —
the code is there to be read before you trust it.

Downloads are checked against the SHA-256 in the index and refused on mismatch.

## Writing one

See [`docs/format.md`](https://github.com/grimoire-codex/community-add-ons/blob/main/docs/format.md)
in the add-ons repo for the authoring reference, and
[`docs/scripts.md`](https://github.com/grimoire-codex/community-add-ons/blob/main/docs/scripts.md)
for the script contract.

To test locally without publishing, serve the repo (`python3 -m http.server 8000`)
and point the index URL at `http://localhost:8000/index.json`.

## How it works

`backend/addons/` (see [`architecture.md`](architecture.md)):

| Module | Role |
| --- | --- |
| `manifest.py` | Pydantic models — the Python twin of the repo's JSON Schema |
| `registry.py` | Discovery, loading, install state, enable/approval checks |
| `install.py` | Index refresh, download + integrity verification, install/remove |
| `fetch.py` | HTTP with shared limits and an on-disk response cache |
| `interpreter.py` | The declarative engine: records → ranked search → mapped fields, plus pasted-URL identity extraction |
| `transforms.py` | Closed table of named value transforms |
| `scripts.py` | Subprocess runner for script-backed add-ons |
| `service.py` | Resolves YAML vs. script; answers search/fetch |
| `diff.py` | Compares fetched values against a system's current ones |

A manifest declares a source URL, how to find records in the response, how to
rank them against a query, and how to map source fields onto Grimoire's. The
interpreter is deliberately **not** an expression language: a definition can only
name transforms that already exist, and can only write to a per-target allowlist
of fields — a book scraper may set `isbn`, a system scraper may not. There is no
`eval` anywhere in the YAML path.

Two source shapes are supported:

- **Catalogue** — one URL serving every record, fetched once and cached for the
  manifest's `cache_ttl`. Typically one fetch a day serves every lookup, and a
  warm cache keeps things working through a source outage. (TTRPG Wiki.)
- **Search** — a URL containing `{query}`, answering per search. When results are
  trimmed summaries, an optional `detail` block names a per-item endpoint, and
  the field mapping runs against that fuller response. (DriveThruRPG.)

Install state lives in the generic `app_settings` table under `addons.*` keys.
No new tables, no migration.

## Settings reference

| Key | Default | Meaning |
| --- | --- | --- |
| `addons.index_url` | the community repo's `index.json` | Where **Refresh** fetches from |
| `addons.allow_scripts` | `false` | Global switch for executing add-on scripts |
| `addons.installed` | `{}` | Per-add-on state (version, digests, approval, enabled) |
| `addons.index_cache` | `{}` | Last fetched index |

These are read and written directly rather than through `/api/settings`, which
enumerates its fields explicitly.
