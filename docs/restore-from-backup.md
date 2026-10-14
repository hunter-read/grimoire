# Restoring from a backup

Restoring is deliberately **not** something Grimoire does for you. It means replacing the
live database underneath a running application - safe when done by hand with the server
stopped, and dangerous when a web request can trigger it. So there is no restore button
and no restore endpoint.

The procedure below takes about five minutes.

> **Before you start:** a restore replaces your current database wholesale. Every account,
> tag, bookmark, campaign, and piece of metadata reverts to the state it was in when the
> backup was taken. Anything added since is lost. If the current database is merely
> *damaged* rather than gone, take a fresh backup of it first so you can change your mind.

## What is in the archive

A backup is a single timestamped `.zip`:

```
grimoire-backup-20260821T140355Z.zip
├── details.json        manifest: app version, timestamp, what is inside
├── grimoire.db         the SQLite database
├── campaign_uploads/   banners, character art, sheets, campaign files
├── system_covers/      custom game-system cover images
├── audio_covers/       custom audio cover art
└── branding/          the uploaded OIDC sign-in button icon
```

Your library - the PDFs, maps, tokens, audio, and models themselves - is **not** in here,
and does not need to be restored. Neither are thumbnails or rendered pages, which
regenerate on demand.

## 1. Stop the server

```bash
docker compose down
```

The database must not be open while you replace it. Restoring underneath a running
container risks a corrupt file, and Grimoire holds the database open for as long as it is
running.

## 2. Unpack the archive somewhere temporary

```bash
mkdir -p /tmp/grimoire-restore
unzip grimoire-backup-20260821T140355Z.zip -d /tmp/grimoire-restore
cat /tmp/grimoire-restore/details.json
```

Read `details.json` before going further. It records the app version and the timestamp, so
you can confirm this is the backup you meant - and see whether it was taken by an older
version than the one you are about to run.

## 3. Integrity-check the database

```bash
sqlite3 /tmp/grimoire-restore/grimoire.db "PRAGMA integrity_check;"
```

It should print `ok`. Anything else means the archive itself is damaged - try an older
backup rather than restoring this one.

If you do not have `sqlite3` on the host, run it through the image:

```bash
docker run --rm -v /tmp/grimoire-restore:/r alpine \
  sh -c "apk add --no-cache sqlite >/dev/null && sqlite3 /r/grimoire.db 'PRAGMA integrity_check;'"
```

## 4. Move the current data aside

Rename rather than delete, so the current state is recoverable if the restore goes wrong:

```bash
cd /path/to/your/data          # the host side of your /app/data volume
mv grimoire.db grimoire.db.before-restore
mv campaign_uploads campaign_uploads.before-restore   # if present
mv system_covers   system_covers.before-restore       # if present
mv audio_covers    audio_covers.before-restore        # if present
mv branding        branding.before-restore            # if present
```

Also remove the SQLite side files if they are there, since they belong to the database you
are replacing:

```bash
rm -f grimoire.db-wal grimoire.db-shm
```

## 5. Copy the backup into place

```bash
cp /tmp/grimoire-restore/grimoire.db .
cp -r /tmp/grimoire-restore/campaign_uploads . 2>/dev/null || true
cp -r /tmp/grimoire-restore/system_covers   . 2>/dev/null || true
cp -r /tmp/grimoire-restore/audio_covers    . 2>/dev/null || true
cp -r /tmp/grimoire-restore/branding        . 2>/dev/null || true
```

Make sure the files are owned by whoever the container runs as. If you run Grimoire as a
non-root user, `chown` them to match the rest of the data directory:

```bash
chown -R --reference=. grimoire.db campaign_uploads system_covers audio_covers branding
```

## 6. Start up and rescan

```bash
docker compose up -d
docker compose logs -f
```

Schema migrations run automatically on startup, so restoring a backup taken by an older
version is fine - Grimoire brings the database forward to the current schema itself.

Once it is up, trigger a **Rescan** from the sidebar (or **Settings → Maintenance**). The
restored database describes your library as it was when the backup was taken; a rescan
reconciles it with whatever is actually on disk now, picking up files added since and
marking any that have gone.

Thumbnails and rendered pages were not in the archive, so the first view of a book or map
will be a little slower while they rebuild. This is normal and needs no action.

## 7. Clean up

Once you are satisfied everything is there:

```bash
rm -rf /tmp/grimoire-restore
rm -rf /path/to/your/data/*.before-restore
```

Keep the `.before-restore` copies until you have actually checked your campaigns, users,
and tags. They are the only way back.

## See also

- [Backups](backups.md) - taking them, scheduling them, and retention
- [Configuration](configuration.md) - `BACKUP_DIR` and the other `BACKUP_*` variables
