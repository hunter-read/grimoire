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

## Notes

- First-run setup always uses username + password. The OIDC button only appears after the IdP is fully configured.
- Logging out via the in-app menu suppresses the next auto-launch (so you don't bounce straight back to the IdP).
- The login button text is configurable per deployment (e.g. "Sign in with Acme SSO").
- **Multiple replicas:** when `VALKEY_URL` is set, the short-lived login state and the cached IdP signing keys (JWKS) are shared through Valkey, so a callback can be handled by any worker or replica. Without it both are kept in process memory - fine for a single instance, but if you scale out without Valkey a login can land on a worker that never saw the flow start and fail with "invalid or expired login state".

---

## See also

- [FAQ: configuring OIDC with Authentik](faq.md#how-do-i-configure-oidc-with-authentik) - a worked example
- [FAQ: configuring OIDC with Google](faq.md#how-do-i-configure-oidc-with-google) - another
- [Configuration](configuration.md) - pinning any OIDC field by environment variable
- [Users and permissions](users-and-permissions.md) - what each role can do
