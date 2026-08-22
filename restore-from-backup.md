# Restoring Grimoire from a backup

Grimoire can **create** backups, but it deliberately cannot restore them. Restoring
means replacing the live database underneath a running application - the kind of
operation that is safe when a human does it deliberately with the server stopped, and
genuinely dangerous when a web request can trigger it. So the restore is manual, and
this document is the procedure.

It takes about five minutes.

## What is in a backup

Each backup is a single `.zip` named for the moment it was taken, e.g.
`grimoire-backup-20260821T140355Z.zip`:

```
grimoire-backup-20260821T140355Z.zip
├── details.json        manifest: app version, timestamp, what is inside
├── grimoire.db         the SQLite database
├── campaign_uploads/   banners, character art, sheets, campaign files
├── system_covers/      custom game-system cover images
└── audio_covers/       custom audio cover art
```

That is everything Grimoire cannot rebuild by itself.

### What is *not* in a backup

**Your library is not backed up.** None of your PDFs, maps, tokens, or audio files are
in the archive. Grimoire treats the library as read-only content that belongs to you and
is usually far too large to copy on a schedule. **You must back your library up
separately.**

Also excluded, because Grimoire regenerates both on demand:

- `thumbnails/` - rebuilt as items are viewed, or all at once by triggering a rescan
- `page_cache/` - rendered PDF pages, re-rendered on next view

The practical consequence: after a restore, the first visit to a book or map may be a
little slower while thumbnails and pages are re-rendered. Nothing is lost.

## Before you start

- **Stop Grimoire.** Restoring into a running server will corrupt the database. This is
  the one step you cannot skip.
- **Keep the backup you are restoring from.** Copy it somewhere outside `DATA_PATH`
  first, so a mistake halfway through does not leave you with neither copy.
- **Check the version.** `details.json` records the Grimoire version that wrote the
  archive. Restoring into the *same* version is always safe. Restoring into a *newer*
  Grimoire is normally fine - migrations run automatically on startup and bring the
  schema forward. Restoring into an *older* Grimoire is not supported: the database may
  carry a schema that version does not understand.

Read the manifest without unpacking the whole archive:

```bash
unzip -p grimoire-backup-20260821T140355Z.zip details.json
```

## Restoring

The examples assume `DATA_PATH` is `./data`. Substitute your own path.

### 1. Stop the server

```bash
docker compose down
```

Not using Docker: stop the `uvicorn` process however you normally do.

### 2. Move the current data aside

Do not delete it. If the restore goes wrong, this is what you fall back to.

```bash
mv data data.broken
mkdir data
```

### 3. Unpack the backup

```bash
unzip grimoire-backup-20260821T140355Z.zip -d data/
```

You should now have `data/grimoire.db`, plus `campaign_uploads/`, `system_covers/`, and
`audio_covers/` if the backup carried any.

`details.json` can be left in place - Grimoire ignores it - or deleted.

### 4. Check the database is intact

Worth ten seconds before you start the server:

```bash
sqlite3 data/grimoire.db "PRAGMA integrity_check;"
```

Expect exactly `ok`. Anything else means the archive is damaged; restore an older
backup instead.

### 5. Fix ownership (Docker only)

The container runs as its configured `PUID`/`PGID`. Files unpacked as your user may not
be writable by it:

```bash
sudo chown -R 1000:1000 data
```

Use whatever `PUID`/`PGID` your `docker-compose.yml` sets.

### 6. Start Grimoire

```bash
docker compose up -d
```

Watch the first startup:

```bash
docker compose logs -f
```

Any schema migrations run here. Log in and confirm your books, campaigns, and users are
as you expect.

### 7. Rebuild what was intentionally left out

Trigger a rescan from **Settings → Maintenance → Rescan Library**. This re-indexes the
library against the restored database and regenerates thumbnails. Rendered pages come
back on their own as you read.

### 8. Clean up

Once you are confident the restore worked, remove the old data:

```bash
rm -rf data.broken
```

Give it a few days first if you have the disk space.

## If something goes wrong

Nothing is lost as long as you kept `data.broken`. Stop the server, move it back, and
start again:

```bash
docker compose down
rm -rf data && mv data.broken data
docker compose up -d
```

Then try an older backup.

## Please do not rely on these backups alone

Grimoire's backups are written to the same machine Grimoire runs on. A disk failure, a
ransomware event, or an accidental `rm -rf` takes the backups along with the original.
They protect you against *application-level* mistakes - a bad rescan, a cleanup that
removed more than you meant - and that is genuinely worth having. They are not disaster
recovery.

The usual guidance is **3-2-1**:

- **3** copies of your data (the live one plus two backups)
- **2** different kinds of storage (internal disk and an external drive, or a NAS)
- **1** copy off-site (another building, or a cloud sync target)

In practice, for Grimoire: point `BACKUP_DIR` at a mounted volume on a different disk,
and sync that directory somewhere off-site on a schedule (`rclone`, `restic`,
`Syncthing`, or your NAS's own backup job all work). Do the same for your library
directory, which Grimoire never touches.

## Configuration reference

| Setting | Environment variable | Default |
| --- | --- | --- |
| Backup directory | `BACKUP_DIR` | `DATA_PATH/backups` |
| Schedule | `BACKUP_SCHEDULE` | `off` (`hourly`, `daily`, `weekly`) |
| Keep at most N backups | `BACKUP_RETENTION_COUNT` | `0` (unlimited) |
| Keep at most N GB | `BACKUP_RETENTION_GB` | `0` (unlimited) |

All four are configurable in the UI under **Settings → Maintenance → Backups**. Setting
one as an environment variable pins it: the value wins, and the field becomes read-only
in the UI.

Retention limits apply independently - a backup is removed once *either* is exceeded -
and at least one backup is always kept, even if it is larger than the size limit on its
own. Pruning happens *after* a new backup is written, so the limit can be briefly
exceeded while a backup runs. Leave headroom for one extra archive.

## Taking a backup without the UI

The API is admin-only and needs a bearer token:

```bash
# List backups, newest first
curl -s http://localhost:9481/api/backups \
  -H "Authorization: Bearer $TOKEN"

# Take one now
curl -s -X POST http://localhost:9481/api/backups \
  -H "Authorization: Bearer $TOKEN"
```

`GET` returns each backup's `created_at`, `size_bytes`, and `version`, which is enough to
check how stale the newest one is and take a fresh one before doing something
destructive:

```bash
NEWEST=$(curl -s http://localhost:9481/api/backups \
  -H "Authorization: Bearer $TOKEN" | jq -r '.backups[0].created_at // empty')

if [ -z "$NEWEST" ] || [ "$(date -d "$NEWEST" +%s)" -lt "$(date -d '24 hours ago' +%s)" ]; then
  curl -s -X POST http://localhost:9481/api/backups -H "Authorization: Bearer $TOKEN"
fi
```

Creating a backup pauses database writes for as long as the snapshot takes.

### Why not just copy the database file?

Because it can produce a broken copy. Grimoire runs SQLite in WAL mode, where recent
commits may still live in a separate `-wal` file. A plain `cp` of `grimoire.db` can catch
a torn state - a database missing its most recent writes, or inconsistent between them.

Grimoire's backups use SQLite's online backup API, which reads under a lock and folds the
WAL in, producing a single self-consistent file. If you take snapshots by hand, use the
same mechanism:

```bash
sqlite3 data/grimoire.db ".backup '/path/to/grimoire-$(date +%F).db'"
```

That is safe on a running server. `cp` is not.
