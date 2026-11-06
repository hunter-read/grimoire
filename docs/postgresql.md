# PostgreSQL

Grimoire keeps its database in a single SQLite file under `DATA_PATH` by default. If you
already run PostgreSQL - and back it up - you can keep Grimoire's database there instead.

Nothing about using Grimoire changes. Search, campaigns, users and everything else work
the same. SQLite remains the default and the simpler choice: there is nothing extra to run,
and Grimoire's [built-in backups](backups.md) include the database. Choose PostgreSQL
because it fits how you already run things, not for speed - a SQLite library of hundreds
of thousands of pages is fine.

---

## Requirements

- **PostgreSQL 15 or newer.** CI tests every change against 15 and the newest release. See
  [Why isn't PostgreSQL 14 supported?](#why-isnt-postgresql-14-supported)
- **An empty database** for Grimoire, and a user that owns it. On first start Grimoire
  creates its tables, and enables the `unaccent` extension, which search uses to match
  `cafe` with `café`. `unaccent` ships with PostgreSQL and is a *trusted* extension, so the
  database's owner can enable it without being a superuser. Managed services provide it
  too; on Azure, add it to the server's `azure.extensions` parameter first.
- **`DATA_PATH` is still needed.** Covers, uploaded files, thumbnails, the page cache and
  the secret key stay on disk; only the database moves.
- **One Grimoire per database.** Don't point two separate installs at the same database.

## A new install

Set `DATABASE_URL` to the database:

```yaml
environment:
  - DATABASE_URL=postgresql://grimoire:PASSWORD@postgres-host:5432/grimoire
```

A ready-made compose file that runs PostgreSQL alongside Grimoire is in
[`docs/docker/docker-compose.postgres.yml`](docker/docker-compose.postgres.yml):

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
docker compose -f docs/docker/docker-compose.postgres.yml up -d
```

On first start the log says `Creating the Grimoire schema in a new PostgreSQL database`,
and you're prompted to create the admin account as usual.

- `postgres://` works as well as `postgresql://`. Grimoire picks its own driver, so leave
  any `+driver` part out (or use `postgresql+psycopg://`).
- Characters such as `@`, `:` or `/` in the password must be
  [percent-encoded](https://developer.mozilla.org/en-US/docs/Glossary/Percent-encoding) in
  the URL. A hex password (as above) needs none.
- Connection options go on the end, e.g. `?sslmode=require` for a server that requires TLS.

## Moving an existing install

Grimoire ships a command that copies an existing SQLite database into an empty PostgreSQL
database. It reads your SQLite file and never changes it, so the file stays a complete
fallback.

1. **Back up first.** Run **Settings → Backups → Back Up Now**, and download the archive.
2. **Create an empty PostgreSQL database** and a user that owns it. Don't start Grimoire
   against it yet - Grimoire would create a fresh, empty library there, and the copy only
   goes into an empty database.
3. **Stop Grimoire.** Anything written while the copy runs would not be carried over.

   ```bash
   docker compose stop grimoire
   ```

4. **Add `DATABASE_URL`** to the Grimoire service, then **run the copy** with the same
   `DATA_PATH` and `SECRET_KEY` Grimoire uses. Through compose that is:

   ```bash
   docker compose run --rm grimoire python -m backend.scripts.sqlite_to_postgres
   ```

   It upgrades a snapshot of your database to the current version, creates the schema,
   copies every table in batches, and then reads both databases back and compares every
   row. It prints each table as it goes and ends with
   `Done: N row(s) in M table(s) copied and verified.` Any difference stops it with an
   error naming the table.

   Outside Docker, run it from the Grimoire directory with the same environment the server
   uses: `python -m backend.scripts.sqlite_to_postgres --postgres postgresql://...`
   (`--sqlite` points at a database other than `DATA_PATH/grimoire.db`).

5. **Start Grimoire.** It now uses PostgreSQL.

   ```bash
   docker compose up -d grimoire
   ```

Books that were searchable stay searchable - page text is copied, not re-read from your
PDFs.

**Going back:** remove `DATABASE_URL` and restart. Grimoire opens the SQLite file again, as
it was when you migrated; anything done since lives only in PostgreSQL.

## Backups

Grimoire's [built-in backups](backups.md) keep working, but on PostgreSQL they hold the
files only - covers, uploads and the rest of `DATA_PATH` - not the database. The backups
page says so. Back the database up with PostgreSQL's own tools, for example a nightly
`pg_dump`:

```bash
docker compose exec postgres pg_dump -U grimoire -Fc grimoire > grimoire-$(date +%F).dump
```

or your managed service's snapshots. Keep the `SECRET_KEY` (or `DATA_PATH/secret_key`)
with them: stored feed and share-link tokens are encrypted with it - see
[Security](security.md#feed-and-share-tokens-at-rest).

## Search

Page search uses PostgreSQL's full-text search, set up to behave like the SQLite index:
English stemming (`goblins` finds `goblin`), accents ignored (`cafe` finds `café`), and no
words skipped as too common. The same query syntax works - `"exact phrases"`, `fire*`
prefixes, and `AND` / `OR` / `NOT` - see [Searching your library](search.md).

A few results can differ from a SQLite install of the same library:

- **Ranking.** Matches are ordered by PostgreSQL's ranking, so books with many hits may come
  back in a different order.
- **Stemming.** PostgreSQL uses the newer Snowball English stemmer, which treats a handful of
  words differently from SQLite's Porter stemmer. A prefix search (`fire*`) is stemmed too.
- **Words with punctuation.** Hyphenated words, email addresses and URLs are kept whole as
  well as split into their parts.
- **Highlighting.** In a result's snippet, a quoted phrase is highlighted word by word rather
  than as one block.
- **Names with accents.** Matching titles, filenames and tags ignores case for accented letters
  too, so `élan` finds `Élan Keep.png`. SQLite only ignores case for A-Z.
- **Very long pages.** Only the first 250,000 characters of a single page are searchable.
  The rest is still stored and shown; no real book page comes close.

## Why isn't PostgreSQL 14 supported?

PostgreSQL 14 reaches its end of life on 12 November 2026. After that the PostgreSQL project
releases no more fixes for it, security fixes included. Grimoire doesn't test against it,
and a database that can no longer be patched isn't a safe place for your accounts and
campaigns.

PostgreSQL has no long-term-support releases: every major version gets five years of fixes
from its release. Ubuntu 22.04 LTS ships 14, which is why it can look like one. If that is
what you run, install 15 or newer from the
[PostgreSQL apt repository](https://www.postgresql.org/download/linux/ubuntu/), or run it in a
container as in the compose file above.

## Troubleshooting

**`The PostgreSQL database has Grimoire tables but no migration record`** - the database
isn't empty, but wasn't made by Grimoire (or a copy was interrupted part-way). Point
`DATABASE_URL` at a new, empty database.

**`The PostgreSQL database is not empty`** (from the migration command) - most often
Grimoire was started against the database before the copy, and created an empty library
there. If you haven't used that library, drop the database, create it again empty, and
rerun the command.

**`permission denied to create extension "unaccent"`** - the user in `DATABASE_URL` doesn't
own the database. Make it the owner (`ALTER DATABASE grimoire OWNER TO grimoire;`), or have
an administrator run `CREATE EXTENSION unaccent;` in that database once.

**`DATABASE_URL must be a PostgreSQL URL`** - only PostgreSQL is supported. Leave
`DATABASE_URL` unset to use SQLite.
