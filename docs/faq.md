# Frequently Asked Questions

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
