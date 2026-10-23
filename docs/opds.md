# OPDS catalog

Grimoire serves the [OPDS 1.2](https://specs.opds.io/opds-1.2) catalog format, so e-reader
apps - Panels, Chunky, KyBook, KOReader - can browse and download from your library
directly.

---

## Enabling OPDS

Set `OPDS_ENABLED=true` and `BASE_URL` to your instance's public URL in your compose file:

```yaml
environment:
  OPDS_ENABLED: "true"
  BASE_URL: "https://grimoire.example.com"
```

## Personal feed URLs

OPDS access is per-user. Each user generates their own opaque feed URL in **Settings → Account → OPDS Feed**. The URL contains a long random token - no username or password is needed by the OPDS client.

Guest accounts are campaign-scoped and do not get an OPDS feed: OPDS reports as unavailable for them, they cannot generate a token, and the feed rejects any token belonging to a guest.

- **Enable** - generates a unique feed URL
- **Copy** - copies the URL to the clipboard
- **Regenerate** - issues a new token; the old URL stops working immediately
- **Disable** - revokes the token; the feed URL stops working immediately

## Feed versions

Grimoire serves two versions of the feed. Both use the same token, so regenerating or disabling it affects both. Pick one with the **Feed version** dropdown in **Settings → Account → OPDS Feed** - the URL and the Copy button follow your choice.

| Version | What it shows |
|---------|---------------|
| **v2** (default) | **All Books**, then one entry per game system with its book count, then **Other Books** for anything with no game system. Systems you cannot see, and explicit systems when explicit content is off, are left out. |
| **v1** (original) | One **All Books** entry. Kept as it was, so apps you connected before v2 existed keep working without any change. |

To switch an app from v1 to v2, copy the v2 URL and replace the feed URL in the app.

## Feed URL structure

v2:

```
https://grimoire.example.com/opds/v2/{token}                  ← navigation root
https://grimoire.example.com/opds/v2/{token}/all              ← all books
https://grimoire.example.com/opds/v2/{token}/system/{id}      ← one game system's books
https://grimoire.example.com/opds/v2/{token}/other            ← books with no game system
https://grimoire.example.com/opds/v2/{token}/entry/{id}       ← single book
https://grimoire.example.com/opds/v2/{token}/download/{id}    ← file download
https://grimoire.example.com/opds/v2/{token}/cover/{id}       ← cover thumbnail (WebP)
```

v1:

```
https://grimoire.example.com/opds/{token}                ← navigation root
https://grimoire.example.com/opds/{token}/all            ← all books
https://grimoire.example.com/opds/{token}/entry/{id}     ← single book
https://grimoire.example.com/opds/{token}/download/{id}  ← file download
https://grimoire.example.com/opds/{token}/cover/{id}     ← cover thumbnail (WebP)
```

## Content filtering

The OPDS feed respects each user's explicit-content preference. Users with explicit content disabled will not see explicit books in their feed and cannot download them via OPDS.

---

## See also

- [Configuration](configuration.md) - `OPDS_ENABLED` and `BASE_URL`
- [Users and permissions](users-and-permissions.md) - restricted books are hidden from feeds too
