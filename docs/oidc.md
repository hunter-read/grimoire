# OpenID Connect

Grimoire authenticates against any OpenID Connect-compliant identity provider - Keycloak,
Authentik, Authelia, Auth0, Okta, and others - so you can delegate sign-in to your existing
IdP and optionally auto-create accounts.

---

## Configure

Open **Settings → Authentication** as an admin:

1. Set the **Issuer URL** (e.g. `https://idp.example.com/realms/main`) and click **Autopopulate** - the server fetches the IdP's `.well-known/openid-configuration` and fills in the endpoint URLs. You can also paste the full discovery document URL directly (e.g. `https://idp.example.com/realms/main/.well-known/openid-configuration`).
2. Paste the **Client ID** and **Client Secret** issued by your IdP.
3. Register the displayed **Redirect URI** with your IdP. The path is fixed - set `BASE_URL` so the host portion reflects your public origin:
   ```
   https://<your.server.com>/api/auth/openid/callback
   ```
4. Enable **OpenID Connect**.
5. (Optional) Configure:
 - **Token Issuer** - the exact `iss` value your IdP puts in tokens. Leave blank to auto-detect from the discovery document. Set this explicitly if auto-detection fails or if your IdP's issuer differs from the Issuer URL (e.g. Authentik application providers). Can also be set via `OIDC_TOKEN_ISSUER`.
 - **Groups Claim** - name of the OIDC claim that contains the user's groups. When set, roles are assigned from groups named (case-insensitively) `admin`, `gm`, or `player`. Highest level wins; users without any matching group are denied access.
 - **Advanced Permissions Claim** - name of the OIDC claim containing a permissions object for non-admin users. Supports `{viewNSFW: bool, campaignAccess: bool, apiKeys: bool}`. A missing `viewNSFW` key defaults to `false`; a missing `campaignAccess` key leaves [campaign access](campaigns.md#per-user-campaign-access) enabled; a missing `apiKeys` key leaves [API key access](api.md#api-keys) as it is (off unless an admin turned it on). If the entire claim is missing, access is denied.
 - **Match Existing Users By** - link an existing local account to the OIDC subject by email or username on first login. Subsequent logins always match by stable subject claim.
 - **Auto-launch** - automatically redirect to the IdP when visiting `/login`. Append `?autoLaunch=0` to bypass.
 - **Auto-register** - automatically create local accounts on first OIDC login.

Any field can also be pinned via an environment variable (see the table above). Pinned fields are shown read-only in the admin UI.

## Style the sign-in button

Many providers ask apps to use their standard "Sign in with …" button, and a familiar button
is reassuring on a login page your users have never seen before. Grimoire doesn't ship any
provider's buttons or logos. Instead you style the one OIDC button yourself, so any provider can
be matched without Grimoire having to know about it.

Under **Settings → Authentication → Button Appearance**:

- **Background / Text / Border Color** - CSS hex values (`#rgb`, `#rgba`, `#rrggbb` or
  `#rrggbbaa`). Leave a field empty to keep the theme's look.
- **Corner Radius** - 0 to 40 px. Empty keeps the default (8).
- **Icon** - upload the provider's logo (PNG, JPEG, WebP, GIF or SVG, up to 1 MB). It is drawn at
  20 px to the left of the button text.

A live preview shows the result as you type. The button text is the existing **Button Text**
field.

Each of these can be pinned by an environment variable, like every other OIDC field:
`OIDC_BUTTON_BG_COLOR`, `OIDC_BUTTON_TEXT_COLOR`, `OIDC_BUTTON_BORDER_COLOR`,
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
- Logging out via the in-app menu suppresses the next auto-launch (so you don't bounce straight back to the IdP).
- The login button text is configurable per deployment (e.g. "Sign in with Acme SSO"), and so is its look - see [Style the sign-in button](#style-the-sign-in-button).
- **Multiple replicas:** when `VALKEY_URL` is set, the short-lived login state and the cached IdP signing keys (JWKS) are shared through Valkey, so a callback can be handled by any worker or replica. Without it both are kept in process memory - fine for a single instance, but if you scale out without Valkey a login can land on a worker that never saw the flow start and fail with "invalid or expired login state".

---

## See also

- [FAQ: configuring OIDC with Authentik](faq.md#how-do-i-configure-oidc-with-authentik) - a worked example
- [FAQ: configuring OIDC with Google](faq.md#how-do-i-configure-oidc-with-google) - another
- [Configuration](configuration.md) - pinning any OIDC field by environment variable
- [Users and permissions](users-and-permissions.md) - what each role can do
