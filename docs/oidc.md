# OpenID Connect

Grimoire authenticates against any OpenID Connect-compliant identity provider - Keycloak,
Authentik, Authelia, Auth0, Okta, and others - so you can delegate sign-in to your existing
IdP and optionally auto-create accounts.

---

## Configure

Open **Settings → Sign-in** as an admin:

1. Tick **Enable OpenID Connect**. The fields below only appear once it is on; the login page shows the button once the rest is filled in.
2. Set the **Issuer URL** (e.g. `https://idp.example.com/realms/main`) and click **Autopopulate** - the server fetches the IdP's `.well-known/openid-configuration` and fills in the endpoint URLs. You can also paste the full discovery document URL directly (e.g. `https://idp.example.com/realms/main/.well-known/openid-configuration`).
3. Paste the **Client ID** and **Client Secret** issued by your IdP. The secret is stored encrypted under `SECRET_KEY` (see [Security](security.md#feed-and-share-tokens-at-rest)); setting `OIDC_CLIENT_SECRET` in the environment instead keeps it out of the database entirely and is recommended.
4. Register the displayed **Redirect URI** with your IdP. The path is fixed - set `BASE_URL` so the host portion reflects your public origin:
   ```
   https://<your.server.com>/api/auth/openid/callback
   ```
5. (Optional) Configure:
 - **Token Issuer** - the exact `iss` value your IdP puts in tokens. Leave blank to auto-detect from the discovery document. Set this explicitly if auto-detection fails or if your IdP's issuer differs from the Issuer URL (e.g. Authentik application providers). Can also be set via `OIDC_TOKEN_ISSUER`.
 - **Groups Claim** - name of the OIDC claim that contains the user's groups. When set, roles are assigned from the **Admin group**, **GM group** and **Player group** - by default groups named `admin`, `gm` and `player`. Highest level wins; users without any matching group are denied access. The role is synced from the groups on every sign-in.
 - **Admin group / GM group / Player group** - the group that grants each role, if your provider names them differently (e.g. `grimoire-admin`). A group counts only when its name matches exactly, ignoring case; Keycloak's full-path form of a top-level group (`/grimoire-admin`) also counts, but a subgroup such as `/media/grimoire-admin` does not. A group that merely ends in a role name - `jellyfin-admin`, `media-player` - grants nothing. Leave a field blank for the default. Can also be pinned with `OIDC_ADMIN_GROUP`, `OIDC_GM_GROUP` and `OIDC_PLAYER_GROUP`.
 - **Advanced Permissions Claim** - name of the OIDC claim containing a permissions object for non-admin users. Supports `{viewNSFW: bool, campaignAccess: bool, apiKeys: bool}`. A missing `viewNSFW` key gives a newly registered account `false` and leaves an existing account's setting as it is; `viewNSFW: false` locks explicit content off so the user can't turn it on from their own settings (`true` leaves the choice with them); a missing `campaignAccess` key leaves [campaign access](campaigns.md#per-user-campaign-access) enabled; a missing `apiKeys` key leaves [API key access](api.md#api-keys) as it is (off unless an admin turned it on). If the entire claim is missing, access is denied.
 - **Match Existing Users By** - link an existing local account to the OIDC subject by email or username on first login. Subsequent logins always match by stable subject claim. Only accounts that aren't linked to a provider yet are considered, and campaign guest accounts never are.
   - **Email:** the provider's `email` claim is matched against the account's email. A provider that reports `email_verified: false` is not matched. The address and its `email_verified` flag are read together from the ID token, or from userinfo when the ID token has no email - never one from each - and userinfo is ignored when its `sub` isn't the ID token's. While this mode is on, users can't change their own email in Settings; an admin sets it, so the address keeps identifying the right person.
   - **Username:** the provider's `preferred_username` claim is matched against the Grimoire username, ignoring case. Display names (`name`, `nickname`) are only used to name a newly registered account, never to match one. Admin accounts are never matched by username; link an admin by email, or let them keep signing in with their password. Only use this mode with a provider where users cannot choose or change their own username (self-registration off, usernames set by an administrator) - otherwise anyone can register the name of an existing Grimoire account and be signed in as it.
 - **Auto-launch** - automatically redirect to the IdP when visiting `/login`. Append `?autoLaunch=0` to bypass.
 - **Auto-register** - automatically create local accounts on first OIDC login. The new account is named after the first of `preferred_username`, `nickname`, `name` and the part of `email` before the `@` that makes a valid username (2 to 100 characters, no control characters), or `oidc-` and the start of the subject if none does. A name already taken gets the start of the subject added to it.

Any field can also be pinned via an environment variable (see the table above). Pinned fields are shown read-only in the admin UI.

A sign-in has to finish in the browser that started it, within 10 minutes: `/api/auth/openid/login` sets a short-lived cookie that the callback must bring back. If the provider returns someone to Grimoire in a different browser or app, they see "sign-in was started in another browser" and start again from the login page there.

## Style the sign-in button

Many providers ask apps to use their standard "Sign in with …" button, and a familiar button
is reassuring on a login page your users have never seen before. Grimoire doesn't ship any
provider's buttons or logos. Instead you style the one OIDC button yourself, so any provider can
be matched without Grimoire having to know about it.

Under **Settings → Sign-in → Button Appearance**:

- **Button text** - what the button says, e.g. "Sign in with Acme SSO". Empty uses the default.
- **Background / Text / Border Color** - CSS hex values (`#rgb`, `#rgba`, `#rrggbb` or
  `#rrggbbaa`). Leave a field empty to keep the theme's look.
- **Corner Radius** - 0 to 40 px. Empty keeps the default (8).
- **Icon** - upload the provider's logo (PNG, JPEG, WebP, GIF or SVG, up to 1 MB). It is drawn at
  20 px to the left of the button text.

A live preview shows the result as you type.

Each of these can be pinned by an environment variable, like every other OIDC field:
`OIDC_BUTTON_TEXT`, `OIDC_BUTTON_BG_COLOR`, `OIDC_BUTTON_TEXT_COLOR`, `OIDC_BUTTON_BORDER_COLOR`,
`OIDC_BUTTON_RADIUS`, and `OIDC_BUTTON_ICON` - a path to an image file inside the container (mount
it in read-only). An env value that isn't a valid color or radius is ignored with a warning in
the log. An empty `OIDC_BUTTON_ICON` pins "no icon".

### Examples

Take the logo and colors from the provider's own brand page, because those change over time and
staying within a provider's branding rules is up to you.

| Look | Background | Text | Border | Radius | Logo |
| --- | --- | --- | --- | --- | --- |
| Google, dark | `#131314` | `#E3E3E3` | `#8E918F` | `4` or `20` (pill) | the "G" from [Google's branding guidelines](https://developers.google.com/identity/branding-guidelines) |
| Google, light | `#FFFFFF` | `#1F1F1F` | `#747775` | `4` or `20` (pill) | as above |
| Discord | `#5865F2` | `#FFFFFF` | `#5865F2` | `8` | the white Clyde mark from [Discord's branding page](https://discord.com/branding) |
| GitHub | `#24292F` | `#FFFFFF` | `#24292F` | `6` | the white Invertocat from [GitHub's logos page](https://github.com/logos) |

Google's guidelines also call for Google Sans Medium at 14 px. Grimoire keeps the button in the
app's own font, so the result is a close match rather than an exact one.

GitHub and Discord sign-in is plain OAuth 2.0, not OpenID Connect, so Grimoire can't talk to
them directly. Put a broker such as Authentik or Keycloak in front of them and point Grimoire at
the broker. If the broker sends everyone straight on to one upstream provider, style the button
for that provider.

### How the icon is handled

The login page is public, so an uploaded icon is never served the way it was uploaded. Raster
images are decoded and re-encoded, and SVGs are rendered to pixels (no script runs, and external
references are ignored). Either way the result is stored as a PNG no larger than 192 px, in
`DATA_PATH/branding/`, and served from `/api/auth/openid/button-icon` with `nosniff` and a
`default-src 'none'` content security policy. That keeps an SVG from becoming a stored-XSS
payload. Colors and the radius are checked against a strict format on save, and again when the
page renders, so no setting can inject arbitrary CSS.

## Notes

- First-run setup always uses username + password. The OIDC button only appears after the IdP is fully configured.
- **Password Authentication** in **Settings → Sign-in** can only be turned off once OpenID Connect is configured, and OpenID Connect can't be turned off while password sign-in is off - so there is always a way in. `ALLOW_PASSWORD_AUTHENTICATION` pins it regardless.
- Logging out via the in-app menu suppresses the next auto-launch (so you don't bounce straight back to the IdP).
- The login button text is configurable per deployment (e.g. "Sign in with Acme SSO"), and so is its look - see [Style the sign-in button](#style-the-sign-in-button).
- **A provider answering with something other than JSON** - an HTML error page from a proxy in front of it, say - fails the sign-in with a message on the login page ("token exchange failed", or "the sign-in could not be verified" when it's the signing keys), and the server log says which response it was. Without a working discovery document and no endpoints filled in, the login page shows "authorization endpoint not configured".
- **Multiple replicas:** when `VALKEY_URL` is set, the short-lived login state and the cached IdP signing keys (JWKS) are shared through Valkey, so a callback can be handled by any worker or replica. Without it both are kept in process memory - fine for a single instance, but if you scale out without Valkey a login can land on a worker that never saw the flow start and fail with "invalid or expired login state".

---

## See also

- [FAQ: configuring OIDC with Authentik](faq.md#how-do-i-configure-oidc-with-authentik) - a worked example
- [FAQ: configuring OIDC with Google](faq.md#how-do-i-configure-oidc-with-google) - another
- [Configuration](configuration.md) - pinning any OIDC field by environment variable
- [Users and permissions](users-and-permissions.md) - what each role can do
