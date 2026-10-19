# Users and permissions

Roles, pre-seeded accounts, and how to keep a book, system, or whole category out of your
players' hands.

---

## User roles

| Role | What they can do |
|---|---|
| `admin` | Everything - user management, app settings, metadata editing, rescan |
| `gm` | Read everything except admin-only content, edit metadata, create GM campaigns |
| `player` | Read-only access, personal campaigns, session notes |
| `guest` | Code-only account scoped to a single campaign. No access to the library, maps, tokens, audio, or search. See [Guest invites](campaigns.md#guest-invites). |

Create additional accounts in **Settings → Users** after logging in as admin.

---

## Restricting books

By default every user can see every book. If you would rather keep the adventure
module your players are currently inside out of their hands, books, systems, and
whole categories can be restricted to a minimum role.

There are two restriction levels:

| Level | Who can see it |
|---|---|
| **Everyone** | No restriction. The default. |
| **GMs and admins only** | Hidden from players and guests. |
| **Admins only** | Hidden from GMs as well. |

Restricted content is **hidden**, not locked - it disappears from the library,
search, system pages, downloads, favourites, and the OPDS feed. A title and cover
are themselves the spoiler, so a padlock nobody can open would defeat the point.

### Where restrictions can be set

Restrictions resolve most-specific-first, so a narrower setting always wins:

```
book  →  system  →  category default  →  everyone
```

- **A single book** - in the book editor, or for many at once through bulk edit.
  A book set to *Inherit* takes its system's or category's setting; a book set
  explicitly to *Everyone* stays visible even inside a restricted system, which is
  how a free player's guide can sit in an otherwise admin-only adventure line.
- **A whole system** - in the system editor. Restricting a system hides the system
  itself along with every book in it that has no setting of its own.
- **A whole category** - in **Settings → Application → Category Restrictions**.
  This is the library-wide default for that category. Core rulebooks and character
  sheets cannot be restricted: everyone at the table needs those by definition.

Only admins can change any of these, including in bulk edit.

### Granting one GM access

A locked-down library still needs the GM running the campaign to reach their own
material. In **Settings → Users**, expand a GM's row and use **Library access
grants** to give that person access to a specific system or book without lowering
the restriction for anyone else.

Grants are only available for GMs. Admins already see everything, and players and
guests are exactly who the restrictions exist to exclude, so they cannot be
granted past one. A grant is removed automatically if the user stops being a GM.

### Restricted books in campaigns

A restricted book can still be linked into a campaign - the GM needs it - but it is
always forced to **GM-only** visibility there, and cannot be made public or private
to the players. If you restrict a book that was already shared, its existing shares
are demoted to GM-only for you.

---

## Pre-seeding users

Drop a `users.json` file into your data directory before first start and Grimoire will create those accounts automatically. Afterwards the file is replaced by `users.json.imported`, a record of what was imported with every password replaced by its hash (so no plaintext password is left on disk), and is never processed again.

### Format

```json
[
  {
    "username": "admin",
    "password": "a-long-passphrase-you-chose",
    "role": "admin"
  },
  {
    "username": "gm",
    "password": "$bcrypt-sha256$v=2,t=2b,r=12$...",
    "role": "gm"
  },
  {
    "username": "alice",
    "password": "another-long-passphrase",
    "role": "player",
    "denyExplicit": true
  }
]
```

| Field | Required | Description |
|---|---|---|
| `username` | Yes | Login username |
| `password` | Yes | Plaintext password **or** a pre-hashed `$bcrypt-sha256$` string |
| `role` | No | `admin`, `gm`, or `player` - defaults to `player` if missing |
| `denyExplicit` | No | `true` to turn explicit content off for this user, locked so they can't turn it back on themselves - defaults to `false` |

**Rules:**
- At least one entry must have `"role": "admin"` - the file is rejected otherwise.
- Plaintext passwords follow the same [password rules](security.md) as any new password: at least `PASSWORD_MIN_LENGTH` characters (12 by default) and not a commonly used one. An entry that fails is skipped with a line in the log. If no admin entry passes, nothing is imported and the file is left in place to fix. Pre-hashed passwords are taken as they are.
- Entries whose username already exists in the database are silently skipped.
- On parse or validation errors the file is left untouched so you can fix and restart.

### Generating a pre-hashed password

Pre-hashing lets you avoid storing plaintext passwords in the JSON file. Grimoire uses the `bcrypt_sha256` scheme (the same format passlib writes, so a hash from passlib works too). To make one with a running Grimoire container:

```bash
docker exec <container_name> python3 -c "from backend.password_hash import hash_password; print(hash_password('yourpassword'))"
```

Copy the output (starts with `$bcrypt-sha256$`) into the `password` field.

### Docker example

```bash
# Place users.json in your data volume before starting
cp users.json.example /path/to/data/users.json
# Replace every "changeme" with a real password (the example's are refused
# on purpose, so an unedited copy imports nothing), then:
docker compose up -d
```

---

## See also

- [OpenID Connect](oidc.md) - delegating sign-in, and mapping roles from IdP groups
- [Security hardening](security.md) - sessions, revocation, and rate limiting
- [Campaigns](campaigns.md) - guest invites and per-user campaign access
