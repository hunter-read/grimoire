# Backups

Grimoire can snapshot its own database and the files you have uploaded through it, on
demand or on a schedule - under **Settings → Maintenance → Backups**.

---

Each backup is a single timestamped `.zip`:

```
grimoire-backup-20260821T140355Z.zip
├── details.json        manifest: app version, timestamp, what is inside
├── grimoire.db         the SQLite database
├── campaign_uploads/   banners, character art, sheets, campaign files
├── system_covers/      custom game-system cover images
├── audio_covers/       custom audio cover art
└── branding/          the uploaded OIDC sign-in button icon
```

The database is copied with SQLite's online backup API rather than a file copy, so the
snapshot is consistent even while Grimoire is running. Database writes are paused for the
duration of the snapshot - brief for a typical library, but not instant.

## Your library is not backed up

**Backups do not include your PDFs, maps, tokens, or audio files.** The library is
yours, is mounted read-only, and is usually far too large to copy on a schedule - so
Grimoire never touches it. **Back your library up separately.**

Thumbnails and rendered pages are also excluded, because both regenerate on demand. After
a restore, the first view of a book or map is a little slower while they rebuild.

## Please do not rely on these alone

Backups are written to the same machine Grimoire runs on. A failed disk takes the
backups with the original. They protect against *application-level* accidents - a bad
rescan, a cleanup that removed more than you meant - which is worth having, but they are
not disaster recovery.

Follow **3-2-1**: three copies, on two kinds of storage, with one off-site. In practice:
point `BACKUP_DIR` at a volume on a different disk, and sync that directory somewhere
off-site (`rclone`, `restic`, `Syncthing`, or your NAS's own backup job). Do the same for
your library directory.

## Scheduling and retention

The schedule is `off`, `hourly`, `daily`, or `weekly` - set in the UI, in your local
timezone, or pinned with `BACKUP_SCHEDULE`.

Two independent retention limits keep the directory bounded, and a backup is removed once
*either* is passed:

- **`BACKUP_RETENTION_COUNT`** - keep at most N backups
- **`BACKUP_RETENTION_GB`** - keep at most N GB in total

`0` means unlimited (the default for both). Old backups are deleted oldest-first, and
**at least one backup is always kept**, even if it is larger than the size limit on its
own. Pruning happens *after* a new backup is written, so the limit can be briefly
exceeded while a backup runs - leave headroom for one extra archive.

Any of the four settings can be pinned with an environment variable, in which case the
value wins and the field is read-only in the UI.

## Restoring

Restoring is deliberately **not** something Grimoire does for you: it means replacing the
live database underneath a running app, which is safe when done by hand with the server
stopped and dangerous when a web request can trigger it.

The full procedure - stop the server, unpack, integrity-check, restart, rescan - is in
[Restoring from a backup](restore-from-backup.md). It takes about five minutes.

## From the API

The endpoints are admin-only. `GET /api/backups` lists every backup newest-first with its
`created_at`, `size_bytes`, and `version`; `POST /api/backups` takes one now. Together
these support a check-before-destructive-operation flow - see how stale the newest backup
is, and take a fresh one before a risky rescan or cleanup. `GET /api/backups/{id}/download`
retrieves an archive and `DELETE /api/backups/{id}` removes one. There is no restore
endpoint, by design.

---

## See also

- [Restoring from a backup](restore-from-backup.md) - the by-hand procedure
- [Configuration](configuration.md) - the `BACKUP_*` variables
