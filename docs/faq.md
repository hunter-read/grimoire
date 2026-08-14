# Frequently Asked Questions

## Grimoire won't start and the log mentions `SECRET_KEY`

You'll see something like this on startup:

```
SECRET_KEY is set to 'change-me', a placeholder published in Grimoire's own
documentation — anyone could forge admin sessions on this instance.
```

`SECRET_KEY` is the key Grimoire uses to sign login sessions. Because the example
compose files in this repo shipped placeholder values (`change-me`,
`replace-this-with-a-long-random-string`, and the old built-in default
`grimoire-dev-secret-change-in-production`), those exact strings are public
knowledge. Anyone who knows the key can mint a valid **admin** session for any
instance using it, so Grimoire now refuses to start on one instead of quietly
running with forgeable logins.

**This most often hits people who copied an example compose file and never edited
the `SECRET_KEY` line** - the app started fine before, so nothing prompted them to
change it.

You have two ways to fix it:

**Option 1 - let Grimoire manage the key (easiest).** Delete the `SECRET_KEY` line
from your compose file entirely and restart. Grimoire generates a random key on
first boot and saves it to `secret_key` inside your data volume, reusing it on every
later start.

**Option 2 - set your own.** Generate a private random value and use it:

```bash
openssl rand -hex 32
```

```yaml
- SECRET_KEY=<paste the generated value here>
```

Set the key explicitly if you run **more than one replica** and they don't share a
`DATA_PATH` volume - each would otherwise generate its own key and reject the
others' sessions.

Either way, everyone gets logged out once when the signing key changes, which is
expected. Log back in with your usual username and password; accounts, library, and
settings are untouched.

---

## I forgot my admin password. How do I reset it?

If you're locked out of your account, you can reset the password directly in the database by running a one-liner inside the running container:

```bash
docker exec <container_name> python3 -c "
from passlib.context import CryptContext
import sqlite3
pwd = CryptContext(schemes=['bcrypt_sha256']).hash('<your_new_password>')
db = sqlite3.connect('/app/data/grimoire.db')
db.execute(\"UPDATE users SET hashed_password = ? WHERE username = ?\", (pwd, '<your_username>'))
db.commit()
db.close()
print('Done')
"
```

Replace `<container_name>`, `<your_new_password>`, and `<your_username>` with the correct values for your setup. The container name is typically `grimoire` unless you changed it in your compose file.

Alternatively, you can create a new admin account by [pre-seeding a users file](../README.md#pre-seeding-users) and restarting the stack.

---

## The scanner finds no books after I reorganized my library.

Grimoire expects a specific folder structure inside your library volume mount. The scanner looks for a **`books/`** subfolder at the root of the mount:

```
/library/            ← volume mount target
  books/
    D&D 5e/
      Core Rules/
        Players Handbook.pdf
    Pathfinder/
      ...
  maps/              ← optional
  tokens/            ← optional
```

If your PDFs live directly under the mounted folder (e.g. `RPGs/<GameSystem>/...` without a `books/` subfolder), the scanner will find nothing.

**Fix** - mount your library folder as `/app/library/books` instead of `/app/library`:

```yaml
volumes:
 - /path/to/your/rpgs:/app/library/books:ro
 - ./grimoire/data:/app/data
```

This lets you keep your existing file structure on the host without adding an extra `books/` folder. After updating the compose file, restart the stack and trigger a rescan from the admin panel.

> **Note:** "Remove missing files" deletes database records for files that can't be found at their expected paths. If you moved files around on the host before the volume mount was correct, those records were removed. Re-mounting correctly and rescanning will re-add everything.

---

## How do I zoom in on a page?

In the reader's **Page** and **Spread** modes, the toolbar has a zoom cluster - minus, the current level, and plus - with a reset button that appears once you are zoomed in. Zoom runs from 100% to 200% in 25% steps.

There are also keyboard shortcuts:

| Key | Action |
| --- | --- |
| `+` or `=` | Zoom in |
| `-` | Zoom out |
| `0` | Reset to 100% |

While zoomed, drag with the mouse (or one finger on touch) to pan around the page. Pinch-to-zoom works on touch devices as usual. Zoom resets when you turn the page.

**PDF** mode is the browser's own PDF viewer, so use its built-in zoom there instead.

> Past 150%, Grimoire re-requests the page at a higher render resolution so text stays sharp rather than being scaled up. The 200% ceiling is where the source render stops being able to keep up.

---

## Can I make the scroll wheel zoom instead of turning pages?

Yes - **Settings → Reader → Scroll wheel** offers three choices:

- **Turn pages** - scrolling moves through the book (the default)
- **Zoom** - scrolling zooms in and out, centred on the cursor
- **Nothing** - scrolling is left alone, so a zoomed page scrolls normally

Whichever you pick, **Ctrl + scroll** (**Cmd + scroll** on macOS) always zooms, matching the browser-wide convention.

---

## How do I configure OIDC with Authentik?

Below is a complete setup for Authentik that maps groups to Grimoire roles and controls NSFW access via a separate group.

### 1. Create the groups

In Authentik, create these groups:

| Group | Purpose |
|---|---|
| `grimoire-admin` | Full admin access |
| `grimoire-gm` | GM role |
| `grimoire-player` | Player role |
| `nsfw` | Grants explicit content access to non-admin users |

Assign your users to the appropriate groups.

### 2. Create a custom scope

Go to **Customization → Property Mappings** and create two **Scope Mappings**.

**Name: `Grimoire Groups`**
**Scope: `groups`** - maps Authentik groups to Grimoire roles:

```python
groups = [group.name for group in user.ak_groups.all()]

grimoire_groups = []
if "grimoire-admin" in groups:
    grimoire_groups.append("admin")
if "grimoire-gm" in groups:
    grimoire_groups.append("gm")
if "grimoire-player" in groups:
    grimoire_groups.append("player")

return {"groups": grimoire_groups}
```

**Name: `Grimoire Permissions`**
**Scope: `permissions`** - controls explicit content access:

```python
groups = [group.name for group in user.ak_groups.all()]

if "grimoire-admin" in groups:
    return {
        "permissions": {
            "viewNSFW": True
        }
    }

explicit = "nsfw" in groups

return {
    "permissions": {
        "viewNSFW": explicit
    }
}
```

### 3. Configure the provider

In your Authentik OAuth2/OIDC provider:

1. Open (or create) your **OAuth2/OpenID Provider**.
2. Scroll to **Advanced Protocol Settings**.
3. Under **Scopes**, click **Add** and select both `Grimoire Groups` and `Grimoire Permissions` from the list.
4. Save the provider.
5. Note your **Client ID** and **Client Secret** from the provider's overview page.

### 4. Configure Grimoire

In Grimoire **Settings → Authentication**:

1. Set **Issuer URL** to your Authentik application's issuer (e.g. `https://authentik.example.com/application/o/<app-slug>/`) and click **Autopopulate**.
   > Authentik's token issuer often differs from the provider URL. If login fails with an issuer mismatch, copy the `iss` value from a decoded token and paste it into the **Token Issuer** field.
2. Paste your **Client ID** and **Client Secret**.
3. Register the displayed **Redirect URI** in your Authentik provider.
4. Set **Groups Claim** to `groups`.
5. Set **Advanced Permissions Claim** to `permissions`.
6. Enable **Auto-register** if you want accounts created automatically on first login.
7. Enable **OpenID Connect**.
