# Frequently Asked Questions

## Do you collect telemetry data?

No.

Grimoire is self-hosted, you own your data, and it stays on your server. Sending any of
it to an external service without a user directly doing so goes against the ethos of the
project. Grimoire can pull data from external sources, but server owners can disable that
behavior entirely if they'd prefer a fully isolated instance.

This is a deliberate tradeoff. Without telemetry I don't receive crash and error reports,
feature usage statistics, performance metrics, or version adoption data - the kinds of
signals most developers rely on to catch bugs early and decide what to work on next. That
means I depend on you: if something breaks or feels rough, please open an issue on GitHub
or drop a note in the Discord. A good bug report is worth more to me than any analytics
dashboard.

---

## Grimoire won't start and the log mentions `SECRET_KEY`

You'll see something like this on startup:

```
SECRET_KEY is set to 'change-me', a placeholder published in Grimoire's own
documentation - anyone could forge admin sessions on this instance.
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
>
> Moving files *within* a correctly-mounted library is safe: a rescan matches them by content and keeps their tags, favorites, bookmarks, and reading progress rather than treating the move as a deletion. The caveat above applies to records already removed, which have nothing left to match against.

---

## I replaced a PDF with a better copy, but Grimoire still shows the old one

Trigger a **Rescan**. Grimoire notices that the file's contents changed and rebuilds the page renders, cover, page count, and search text, keeping the book's tags, favorites, bookmarks, and reading progress.

If a single book is affected you can also use **Re-read from disk** on the book's detail page, which does the same work for just that file.

Older versions cached rendered pages under a key derived from the file's *path*, so a replacement at the same path kept serving the previous file's pages indefinitely. That is fixed - cache keys now include a hash of the file's contents - but a browser that loaded the stale pages beforehand may still hold them; a hard reload clears that.

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

---

## How do I configure OIDC with Google?

Google works with Grimoire's built-in OIDC client — no intermediary IdP needed. Setup is a Google Cloud OAuth client plus a handful of Grimoire settings.

### 1. Create the OAuth client in Google Cloud

1. In [console.cloud.google.com](https://console.cloud.google.com), create a project (any name).
2. **APIs & Services → OAuth consent screen**: User type **External**, fill in the app name and support email. The default non-sensitive scopes (`openid`, `email`, `profile`) are all Grimoire needs — no Google verification required.
3. **Publish** the consent screen. Leaving it in **Testing** status also works but caps you at 100 explicitly listed test users and shows everyone an "unverified app" warning interstitial.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type **Web application**. Add the Authorized redirect URI:

   ```
   https://<your-grimoire-host>/api/auth/openid/callback
   ```

5. Copy the **Client ID** and **Client secret**.

> Edits to redirect URIs can take 5–15 minutes to propagate on Google's side. A `redirect_uri_mismatch` error immediately after saving usually just needs patience, not more configuration.

### 2. Configure Grimoire

In **Settings → Authentication**:

1. Set **Issuer URL** to `https://accounts.google.com` and click **Autopopulate** — or enter the endpoints by hand:

   | Field | Value |
   |---|---|
   | Authorization endpoint | `https://accounts.google.com/o/oauth2/v2/auth` |
   | Token endpoint | `https://oauth2.googleapis.com/token` |
   | Userinfo endpoint | `https://openidconnect.googleapis.com/v1/userinfo` |
   | JWKS URI | `https://www.googleapis.com/oauth2/v3/certs` |

2. Enter the **Client ID** and **Client secret** from step 1.
3. Set the **signing algorithm** to `RS256` — Google signs ID tokens with RS256 only, so pinning it rejects anything unexpected.
4. Google publishes no end-session endpoint; leave that field empty (logout stays local, which is what you want).
5. Button text: `Sign in with Google`.

### 3. Decide who gets in

- **Match by: email** with **Auto-register OFF** — recommended for a personal library. The user table becomes your allowlist: create each person a user with their Google account email (password can be left empty — the account is OIDC-only). Anyone else who signs in at Google is rejected with *"no matching user and auto-register is disabled"* and gets no session.
- **Auto-register ON** means *any* Google account on Earth can create itself a user. Only do that behind some other gate.

Password login can then be disabled (Settings, or the `ALLOW_PASSWORD_AUTHENTICATION` environment variable). Tip: keep one password-capable admin documented somewhere safe — re-enabling that variable is your recovery path if the OAuth client ever breaks.

### If you pin the settings by environment variable instead

All of the above exists as `OIDC_*` environment variables (see the README table), which locks the corresponding fields in the UI. One Docker Compose trap: **compose does not pass `.env` variables that the service's `environment:` block doesn't list.** Setting `OIDC_*` only in `.env` looks correct and silently does nothing — every variable needs a line in both files.
