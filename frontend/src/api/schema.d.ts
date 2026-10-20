/**
 * GENERATED FILE - do not edit by hand.
 *
 * The backend's OpenAPI schema as TypeScript types, produced by
 * scripts/generate-api-types.mjs. Regenerate with `npm run api:types` after
 * changing a backend route or schema; CI fails while this file is stale.
 */

export interface paths {
    "/api/about": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Build information
         * @description Returns the app version, commit hash, and Python version for the About dialog. Login required - deliberately not exposed on the API-key-gated /stats endpoint so build details aren't leaked to external integrations.
         */
        get: operations["get_about_api_about_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/addons": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List add-ons
         * @description Returns installed add-ons and everything offered by the cached community index, plus add-on settings. Admin only.
         */
        get: operations["list_addons_api_addons_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/addons/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Refresh the add-on index
         * @description Re-fetches the community index from the configured URL. Admin only.
         */
        post: operations["refresh_index_api_addons_refresh_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/addons/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update add-on settings
         * @description Sets the index URL and the global 'allow add-on scripts' switch. Admin only.
         */
        patch: operations["update_addon_settings_api_addons_settings_patch"];
        trace?: never;
    };
    "/api/addons/update-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Update all add-ons
         * @description Refreshes the index, then updates every installed add-on with a newer version. Returns what was updated and what failed. A script-backed add-on whose script changed drops back to unapproved. Admin only.
         */
        post: operations["update_all_addons_api_addons_update_all_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/addons/verify-index": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Verify an add-on index URL
         * @description Strictly checks if a given add-on index URL is in the set of trusted index URLs.
         */
        get: operations["verify_index_api_addons_verify_index_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/addons/{addon_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Uninstall an add-on
         * @description Removes an installed add-on and forgets its state. Admin only.
         */
        delete: operations["uninstall_addon_api_addons__addon_id__delete"];
        options?: never;
        head?: never;
        /**
         * Enable, disable, or approve an add-on
         * @description Toggles an add-on's enabled state or its script approval. Admin only.
         */
        patch: operations["update_addon_api_addons__addon_id__patch"];
        trace?: never;
    };
    "/api/addons/{addon_id}/install": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Install or update an add-on
         * @description Downloads an add-on from the cached index, verifies its checksum, and installs it. Script-backed add-ons additionally require `approve_script`. Admin only.
         */
        post: operations["install_addon_api_addons__addon_id__install_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/api-keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List your API keys (never their secrets) */
        get: operations["list_api_keys_api_api_keys_get"];
        put?: never;
        /**
         * Create an API key that acts as you
         * @description Returns the full key once, in `key`. Only its hash is stored.
         */
        post: operations["create_api_key_api_api_keys_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/api-keys/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the permissions your keys can be granted */
        get: operations["list_permissions_api_api_keys_permissions_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/api-keys/{key_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke (delete) an API key
         * @description Revoke a key. Admins may revoke anyone's, including a key whose owner has
         *     since lost access to keys.
         */
        delete: operations["delete_api_key_api_api_keys__key_id__delete"];
        options?: never;
        head?: never;
        /** Rename a key or change its permissions or expiry */
        patch: operations["update_api_key_api_api_keys__key_id__patch"];
        trace?: never;
    };
    "/api/api-keys/{key_id}/regenerate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Issue a new secret for a key
         * @description Keeps the name and permissions. The old secret stops working at once.
         */
        post: operations["regenerate_api_key_api_api_keys__key_id__regenerate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audio": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List audio
         * @description Returns a paginated list of audio tracks.
         */
        get: operations["list_audio_api_audio_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audio-folders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List audio folders
         * @description Returns all known audio folder paths and their associated tags.
         */
        get: operations["list_audio_folders_api_audio_folders_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Set tags on an audio folder
         * @description Creates or replaces the tag list for a folder path. GM or admin role required.
         */
        patch: operations["update_audio_folder_api_audio_folders_patch"];
        trace?: never;
    };
    "/api/audio-folders/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk set audio folder tags
         * @description Sets tags on many audio folders in one transaction. Body: {folders: [{path, tags}]}. GM or admin role required.
         */
        post: operations["bulk_update_audio_folders_api_audio_folders_bulk_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audio-sets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the user's saved playlists and soundboards
         * @description List the current user's saved sets, optionally limited to one kind.
         */
        get: operations["list_audio_sets_api_audio_sets_get"];
        put?: never;
        /**
         * Save a playlist or soundboard
         * @description Save a set. Re-saving an existing (kind, name) overwrites its contents.
         *
         *     Overwriting rather than duplicating is what "save" means here: a GM
         *     re-saving "Tavern" after adding a pad expects one Tavern, not two.
         */
        post: operations["create_audio_set_api_audio_sets_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audio-sets/{set_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Load one saved set, resolved against the library
         * @description Load one set, resolved against the current library.
         */
        get: operations["get_audio_set_api_audio_sets__set_id__get"];
        put?: never;
        post?: never;
        /**
         * Delete a saved set
         * @description Delete one of the current user's saved sets.
         */
        delete: operations["delete_audio_set_api_audio_sets__set_id__delete"];
        options?: never;
        head?: never;
        /**
         * Rename a saved set or replace its contents
         * @description Rename a set and/or replace its contents.
         */
        patch: operations["update_audio_set_api_audio_sets__set_id__patch"];
        trace?: never;
    };
    "/api/audio/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk update audio tracks
         * @description Applies per-track edits for many tracks in one transaction. Body: {items: [{id, description?, tags?}]}. Unknown ids are reported in `errors` and skipped. GM or admin role required.
         */
        post: operations["bulk_update_audio_api_audio_bulk_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audio/bulk/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk add tags to audio tracks
         * @description Additively applies tags to many tracks in one transaction. Body: {ids: [...], tags: [...]}. GM or admin role required.
         */
        post: operations["bulk_add_audio_tags_api_audio_bulk_tags_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audio/groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Folders holding matching audio tracks
         * @description Every folder that holds audio tracks matching the filters, with how many. Takes the same filters as the list; the gallery renders folders from this and opens each with the list's `folder` parameter (issue #221).
         */
        get: operations["list_audio_groups_api_audio_groups_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audio/{audio_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an audio track
         * @description Returns full track metadata including duration, embedded tags, and folder tags.
         */
        get: operations["get_audio_api_audio__audio_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update audio metadata
         * @description Updates editable fields on a track (description, tags). GM or admin role required.
         */
        patch: operations["update_audio_api_audio__audio_id__patch"];
        trace?: never;
    };
    "/api/audio/{audio_id}/artwork": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Audio artwork
         * @description Returns a track's artwork, resolving a cover set through the UI first, then folder cover art, then embedded album art. 404 if none.
         */
        get: operations["serve_audio_artwork_api_audio__audio_id__artwork_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audio/{audio_id}/chapters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Audio chapter markers
         * @description Returns the chapter markers embedded in the track (`.m4b`/`.m4a` Nero or QuickTime chapters, MP3 ID3 `CHAP` frames) as `{chapters: [{start, title}]}`, ordered by start in seconds. Empty when the file has none.
         */
        get: operations["get_audio_chapters_api_audio__audio_id__chapters_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audio/{audio_id}/cover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Audio cover image
         * @description Serves only a cover set through the UI, for the editor preview. 404 when the track has none (even if it has folder or embedded art). GM or admin role required.
         */
        get: operations["serve_audio_cover_api_audio__audio_id__cover_get"];
        put?: never;
        /**
         * Upload an audio cover
         * @description Stores a cover image for the track. PNG/JPEG/WebP/GIF, max 10 MB. It takes precedence over folder and embedded art. GM or admin role required.
         */
        post: operations["upload_audio_cover_api_audio__audio_id__cover_post"];
        /**
         * Remove an audio cover
         * @description Deletes the set cover; folder and embedded art are untouched and take over again. GM or admin role required.
         */
        delete: operations["delete_audio_cover_api_audio__audio_id__cover_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audio/{audio_id}/cover/from-source": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set an audio cover from an existing image
         * @description Copies an image Grimoire already holds — a library map or token, book cover, or another track's artwork — into this track's cover. Body: {source_type, source_id}. GM or admin role required.
         */
        post: operations["set_audio_cover_from_source_api_audio__audio_id__cover_from_source_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audio/{audio_id}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Stream/download audio file
         * @description Streams the original audio file (supports HTTP range requests).
         */
        get: operations["serve_audio_file_api_audio__audio_id__file_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Public auth configuration
         * @description Returns auth-related settings needed by the unauthenticated login screen: which auth methods are enabled and the optional custom login message.
         */
        get: operations["auth_config_api_auth_config_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/guest-login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Log in as a guest
         * @description Exchanges a campaign guest invite code for a JWT scoped to a guest account. Available only when guest access is enabled.
         */
        post: operations["guest_login_api_auth_guest_login_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Log in
         * @description Authenticates with username and password. Returns a short-lived access token and sets the session and refresh cookies.
         */
        post: operations["auth_login_api_auth_login_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Log out
         * @description Revokes the current session and clears the session and refresh cookies. The refresh token stops working immediately; the current access token stays valid until it expires (at most ACCESS_TOKEN_EXPIRE_MINUTES). Requires no auth so a client with an expired access token can still log out.
         */
        post: operations["auth_logout_api_auth_logout_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get current user
         * @description Returns the authenticated user's id, username, role, and preferences.
         */
        get: operations["auth_me_api_auth_me_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/openid/button-icon": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * OIDC login-button icon
         * @description Public (the login page is pre-auth). Serves the admin-configured icon for the OIDC sign-in button as a server-normalized PNG. 404 when no icon is set. Use the URL from `/api/auth/config` → `oidc_button_icon_url`; its `v` parameter makes the response cacheable forever.
         */
        get: operations["serve_oidc_button_icon_api_auth_openid_button_icon_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/openid/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * OIDC callback
         * @description Receives the authorization code from the IdP, exchanges it for tokens, validates the ID token, resolves or creates the local user, and redirects to the frontend with a one-time grimoire token.
         */
        get: operations["oidc_callback_api_auth_openid_callback_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/openid/discover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Fetch OIDC discovery document
         * @description Admin-only. Fetches `.well-known/openid-configuration` from the issuer URL and returns the relevant endpoint URLs so the admin UI can autofill the form. The server makes the request so the browser does not hit a CORS wall.
         */
        post: operations["discover_api_auth_openid_discover_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/openid/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Start an OIDC login
         * @description Redirects the user-agent to the IdP authorization endpoint.
         */
        get: operations["oidc_login_api_auth_openid_login_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Refresh the access token
         * @description Exchanges the `grimoire_refresh` cookie for a new access token and rotates the refresh token. Returns `{token, user}` and re-sets both cookies. Returns 401 when the refresh token is missing, expired, or revoked. Reusing an already-rotated refresh token revokes the whole session.
         */
        post: operations["auth_refresh_api_auth_refresh_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List your active sessions
         * @description The caller's own live login sessions, newest first, each with its origin (password/guest/oidc), user agent, IP, and timestamps. The session backing the current request is flagged with `current: true`.
         */
        get: operations["list_sessions_api_auth_sessions_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/sessions/others": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Log out everywhere else
         * @description Revokes all of the caller's sessions except the current one. Returns `{ok, revoked, kept_current}`.
         */
        delete: operations["revoke_other_sessions_api_auth_sessions_others_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/sessions/{session_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke one of your sessions
         * @description Revokes a single session belonging to the caller. Returns 404 for an unknown session or one owned by another user.
         */
        delete: operations["revoke_one_session_api_auth_sessions__session_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/setup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * First-run admin setup
         * @description Creates the initial admin account. Returns a JWT. Fails if any users already exist.
         */
        post: operations["auth_setup_api_auth_setup_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Check initialization status
         * @description Returns whether the server has any users. Used by the frontend to decide whether to show the first-run setup screen.
         */
        get: operations["auth_status_api_auth_status_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/backups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List backups, newest first
         * @description Every backup on disk, newest first.
         *
         *     This is what makes a check-before-destructive-operation flow possible: the
         *     caller can read the newest `created_at` and decide whether it is stale.
         */
        get: operations["list_backups_api_backups_get"];
        put?: never;
        /**
         * Create a backup now
         * @description Take a backup now.
         *
         *     The database is snapshotted under a read lock, so writes are held off for
         *     the duration — brief for a typical library, but not instant.
         */
        post: operations["create_backup_api_backups_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/backups/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read backup schedule and retention settings
         * @description Effective backup configuration, with env-var locks flagged.
         */
        get: operations["get_backup_settings_api_backups_settings_get"];
        /**
         * Configure backup schedule and retention
         * @description Update backup settings and re-arm the scheduler.
         */
        put: operations["update_backup_settings_api_backups_settings_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/backups/{backup_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a backup archive
         * @description Delete one backup archive. This cannot be undone.
         */
        delete: operations["delete_backup_api_backups__backup_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/backups/{backup_id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download a backup archive
         * @description Download one backup archive.
         */
        get: operations["download_backup_api_backups__backup_id__download_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/bookmarks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List bookmarks for a book */
        get: operations["list_bookmarks_api_bookmarks_get"];
        put?: never;
        /** Create a bookmark */
        post: operations["create_bookmark_api_bookmarks_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/bookmarks/{bookmark_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a bookmark */
        delete: operations["delete_bookmark_api_bookmarks__bookmark_id__delete"];
        options?: never;
        head?: never;
        /** Update bookmark label */
        patch: operations["update_bookmark_api_bookmarks__bookmark_id__patch"];
        trace?: never;
    };
    "/api/books": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List books
         * @description Pages through the books the caller can see. `sort=added_at` lists newest first (pass `order=asc` for oldest first) and `added_since` (ISO-8601, UTC if no offset) keeps only books added at or after that moment - poll with both to find new additions. Books added before dates were tracked have a null `added_at`, sort last, and never match `added_since`.
         */
        get: operations["list_books_api_books_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk update books
         * @description Applies per-book edits for many books in one transaction. Body: {items: [{id, ...BookUpdate fields}]}. Unknown ids are reported in `errors` and skipped. GM or admin role required.
         */
        post: operations["bulk_update_books_api_books_bulk_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/bulk/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk add tags to books
         * @description Additively applies tags to many books in one transaction. Body: {ids: [...], tags: [...]}. GM or admin role required.
         */
        post: operations["bulk_add_book_tags_api_books_bulk_tags_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a book */
        get: operations["get_book_api_books__book_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update book metadata */
        patch: operations["update_book_api_books__book_id__patch"];
        trace?: never;
    };
    "/api/books/{book_id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Export pages or cut-outs
         * @description `kind: pages` exports a page list (`pages`, e.g. `"12-15, 20"`) as one PDF or as one image per page (`format` png/jpeg/webp at `dpi` 36-600; `join_spreads` joins facing pages, paired by `spread_offset`). `kind: regions` cuts out each of `regions` - `pages` (one page, or two consecutive pages for an area across a spread), `shape` rect/ellipse and `x`/`y`/`w`/`h` as fractions of those pages laid side by side - as its own file; ellipses are transparent outside the circle, so not PDF. One file is returned as itself, several as a zip. Never writes to the library.
         */
        post: operations["export_book_api_books__book_id__export_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}/export/save": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Save an export into the library
         * @description Runs the same export as `POST /books/{id}/export` and writes each file (never a zip) into the library folder `destination`, renaming rather than overwriting. Refused on a read-only library and for file types the destination does not index. Admin role required.
         */
        post: operations["save_book_export_api_books__book_id__export_save_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download book file */
        get: operations["serve_book_file_api_books__book_id__file_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}/metadata-fetch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Fetch metadata for review
         * @description Fetches one candidate's fields and diffs them against the book's current values. Writes nothing. GM or admin role required.
         */
        post: operations["fetch_metadata_api_books__book_id__metadata_fetch_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}/metadata-search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Search a metadata source
         * @description Returns ranked candidate matches for this book from one add-on. An empty query defaults to the book's title. GM or admin role required.
         */
        post: operations["search_metadata_api_books__book_id__metadata_search_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}/metadata-sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List metadata sources
         * @description Returns installed, enabled add-ons that can supply book metadata. GM or admin role required.
         */
        get: operations["list_metadata_sources_api_books__book_id__metadata_sources_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}/page/{page_num}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Render a PDF page as WebP */
        get: operations["serve_book_page_api_books__book_id__page__page_num__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}/page/{page_num}/shapes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Suggest cut-outs on a page
         * @description Finds the separate pictures on a page - embedded images and circular vector frames, as token and card sheets are built - and returns each as a `rect` or `ellipse` with `x`/`y`/`w`/`h` as fractions of the page. A page that is one flat picture (a flattened token sheet, a scan) is read by its pixels instead, against its plain background colour.
         */
        get: operations["detect_book_page_shapes_api_books__book_id__page__page_num__shapes_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}/page/{page_num}/size": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a page's size
         * @description The page's width and height in PDF points (1/72 inch).
         */
        get: operations["get_book_page_size_api_books__book_id__page__page_num__size_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}/page/{page_num}/text": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get page text */
        get: operations["get_page_text_api_books__book_id__page__page_num__text_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}/page/{page_num}/tile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Render one zoom tile of a page as WebP
         * @description One square (at most 1024px) of a page rendered as if the whole page were `width` pixels wide, for sharp zoom past what a whole-page render allows. `col`/`row` count tiles from the top left; `width` is a multiple of 256 up to 16384. Rendered documents only (PDF, EPUB, DjVu).
         */
        get: operations["serve_book_page_tile_api_books__book_id__page__page_num__tile_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}/page/{page_num}/words": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get page word bounding boxes */
        get: operations["get_page_words_api_books__book_id__page__page_num__words_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}/reindex": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Re-run OCR on a book (optional DPI override)
         * @description Re-run OCR on a single scanned book, optionally at a higher DPI.
         *
         *     Clears the book's existing search index and re-queues it for OCR from page 1.
         *     A higher ``ocr_dpi`` re-reads a specific book more sharply than the library
         *     default, without re-OCRing the whole library. Only applies to OCR-sourced
         *     (image-only) PDFs; books with a real text layer have nothing to re-OCR.
         *
         *     The OCR itself runs in the background; poll ``GET /api/scan-status`` (phase
         *     ``ocr``) for progress.
         */
        post: operations["reindex_book_api_books__book_id__reindex_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}/rescan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Re-read a book from disk and rebuild its search index
         * @description Re-read a single book from disk and rebuild its search index.
         *
         *     The general per-book re-index: unlike the OCR-only ``/reindex`` path, this
         *     works for any indexable book a user has edited externally — PDF, EPUB, DjVu,
         *     or a text document. A text-layer PDF is re-extracted and its FTS rows
         *     rebuilt; an image-only PDF is re-queued for OCR. The page count and cover
         *     thumbnail are refreshed if the file changed.
         *
         *     The work runs in the background; poll ``GET /api/scan-status`` for progress.
         *     No-ops (leaving the request for the running scan) if a library scan is
         *     already in progress.
         */
        post: operations["rescan_book_api_books__book_id__rescan_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}/thumbnail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Book cover thumbnail */
        get: operations["serve_book_thumbnail_api_books__book_id__thumbnail_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/books/{book_id}/toc": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** PDF table of contents */
        get: operations["get_book_toc_api_books__book_id__toc_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List campaigns for the current user
         * @description Campaigns the user owns or belongs to.
         *
         *     Archived campaigns are left out unless ``include_archived`` is set, so the
         *     default list stays the active games. The flag returns archived campaigns
         *     *alongside* the active ones (rather than only archived), letting the UI
         *     toggle between "active" and "everything" with one request either way.
         */
        get: operations["list_campaigns_api_campaigns_get"];
        put?: never;
        /** Create a campaign */
        post: operations["create_campaign_api_campaigns_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/admin/by-user/{user_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Admin: list campaigns owned by a user (read-only, minimal fields)
         * @description Return a minimal read-only view of all campaigns owned by a specific user.
         *
         *     Admins can inspect (but not manage or delete) campaigns through the user page.
         *     Only the title, game system, and description are exposed.
         */
        get: operations["admin_list_user_campaigns_api_campaigns_admin_by_user__user_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/calendar/subscription": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the caller's calendar subscription URLs
         * @description Return the caller's subscription URLs, if they have minted a token.
         */
        get: operations["get_calendar_subscription_api_campaigns_calendar_subscription_get"];
        put?: never;
        /**
         * Mint or rotate the caller's calendar feed token
         * @description Mint or rotate the caller's calendar token, revoking the previous one.
         */
        post: operations["generate_calendar_token_api_campaigns_calendar_subscription_post"];
        /**
         * Revoke the caller's calendar feed token
         * @description Revoke the caller's calendar token; every subscribed URL stops working.
         */
        delete: operations["revoke_calendar_token_api_campaigns_calendar_subscription_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/calendar/{token}/all.ics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * ICS feed of every campaign the token's user belongs to
         * @description Publish every campaign the token's user belongs to as one merged feed.
         */
        get: operations["all_campaigns_calendar_feed_api_campaigns_calendar__token__all_ics_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/calendar/{token}/{campaign_id}.ics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * ICS feed for a single campaign
         * @description Publish one campaign's upcoming sessions as an ICS feed.
         */
        get: operations["campaign_calendar_feed_api_campaigns_calendar__token___campaign_id__ics_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/invites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the current user's pending campaign invitations
         * @description Pending campaign invitations for the current user.
         *
         *     Returns the minimal fields the app-level invite banner needs: one entry per
         *     GM campaign the user has been invited to but not yet accepted or declined.
         */
        get: operations["list_invites_api_campaigns_invites_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/resources/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search books, maps, and tokens by name
         * @description Search across books, maps, tokens, and audio for the resource picker.
         *
         *     Books match on title and can be narrowed by game system. Maps, tokens, and
         *     audio match on their folder path *first*, then filename, so a folder name like
         *     "Abyssal Fall (30x49)" surfaces every item inside it. Folder-path matches are
         *     ranked above filename-only matches.
         *
         *     Matching happens in SQL so the query runs against the whole library. It used
         *     to filter in Python over a ``.limit()``-ed slice, which meant only the
         *     alphabetically-first 500 books / 1000 media rows were ever considered and
         *     anything past that was invisible even to an exact-name search.
         *
         *     ``limit`` is applied per resource type, so asking for several types does not
         *     make each one's share smaller.
         */
        get: operations["search_resources_global_api_campaigns_resources_search_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/resources/suggested/{system_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Suggested resources (system books) for the create wizard
         * @description Books belonging to a game system, for the create wizard's resource step.
         *
         *     Core-category books are flagged `suggested` so the wizard can pre-select them;
         *     nothing else is suggested. Ordered with suggested (core) books first.
         */
        get: operations["suggested_resources_api_campaigns_resources_suggested__system_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a campaign */
        get: operations["get_campaign_api_campaigns__campaign_id__get"];
        put?: never;
        post?: never;
        /** Delete a campaign */
        delete: operations["delete_campaign_api_campaigns__campaign_id__delete"];
        options?: never;
        head?: never;
        /** Update a campaign */
        patch: operations["update_campaign_api_campaigns__campaign_id__patch"];
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Archive or unarchive a campaign
         * @description Archive or unarchive a campaign (owner only).
         *
         *     Archiving hides the campaign from everyone's list unless they ask for
         *     archived ones, and freezes it read-only. Deliberately does not go through
         *     ``assert_can_manage``: that refuses writes to archived campaigns, which would
         *     make unarchiving impossible. The same owner and access checks are applied
         *     here instead.
         */
        put: operations["set_campaign_archived_api_campaigns__campaign_id__archive_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/availability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get availability chart for upcoming sessions */
        get: operations["get_availability_api_campaigns__campaign_id__availability_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/availability/{session_date}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Set availability for a session date */
        put: operations["set_availability_api_campaigns__campaign_id__availability__session_date__put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/availability/{session_date}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** GM: cancel or uncancel a session date */
        put: operations["cancel_session_date_api_campaigns__campaign_id__availability__session_date__cancel_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/banner": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get campaign banner image
         * @description Serve the campaign banner. Defaults to a <=1000px-wide WebP; `size=full`
         *     serves the original upload. The small copy is generated on first access for
         *     banners uploaded before downscaling existed.
         */
        get: operations["get_banner_api_campaigns__campaign_id__banner_get"];
        put?: never;
        /** Upload campaign banner */
        post: operations["upload_banner_api_campaigns__campaign_id__banner_post"];
        /** Remove campaign banner */
        delete: operations["delete_banner_api_campaigns__campaign_id__banner_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/banner/focus": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set the banner focal point
         * @description Sets where the banner sits vertically inside the 2:1 hero, as a 0-100 percentage (50 = centred). Body: {focus_y}. Campaign owner or GM required.
         */
        put: operations["set_banner_focus_api_campaigns__campaign_id__banner_focus_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/banner/from-source": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set the banner from an existing image
         * @description Copies an image Grimoire already holds — a campaign file, library map or token, book cover, or audio artwork — into the campaign banner. Body: {source_type, source_id}. The caller must be able to read the source in its own right. Campaign owner or GM required.
         */
        post: operations["set_banner_from_source_api_campaigns__campaign_id__banner_from_source_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/calendar.ics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download a campaign's schedule as an .ics file
         * @description Download a campaign's schedule as a static .ics file.
         *
         *     Unlike the feed this needs no token — the caller is already authenticated —
         *     and so it keeps working on a server with no BASE_URL configured.
         */
        get: operations["download_campaign_calendar_api_campaigns__campaign_id__calendar_ics_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List categories (optionally filtered by kind) */
        get: operations["list_categories_api_campaigns__campaign_id__categories_get"];
        put?: never;
        /** Create a category */
        post: operations["create_category_api_campaigns__campaign_id__categories_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/categories/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Reorder categories
         * @description Apply a new sort order from an ordered list of category ids (a single kind).
         */
        put: operations["reorder_categories_api_campaigns__campaign_id__categories_reorder_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/categories/{category_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a category (mode: uncategorize | delete_items)
         * @description Delete a category. mode: 'uncategorize' (default) or 'delete_items'.
         *
         *     delete_items removes the contained items: wiki pages are deleted (with their
         *     link rows), resources are unlinked from the campaign (library content is
         *     untouched).
         */
        delete: operations["delete_category_api_campaigns__campaign_id__categories__category_id__delete"];
        options?: never;
        head?: never;
        /** Rename a category */
        patch: operations["update_category_api_campaigns__campaign_id__categories__category_id__patch"];
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/convert-to-group": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Convert a personal campaign into a GM-run group campaign
         * @description Promote a personal campaign to a GM-run (group) campaign.
         *
         *     Only the owner can convert, and only if they could have created a GM campaign
         *     in the first place — otherwise this would be a way around that role check.
         *     Nothing is migrated: members, guests, and the schedule are all features a
         *     personal campaign simply never had, so they start empty. Everything already
         *     in the campaign (resources, wiki, sessions) carries over untouched.
         *
         *     One-way: there is no group -> personal route, because demoting would strand
         *     those rows with nowhere to live.
         */
        post: operations["convert_campaign_to_group_api_campaigns__campaign_id__convert_to_group_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/eligible-members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List users that can be invited */
        get: operations["eligible_members_api_campaigns__campaign_id__eligible_members_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload a campaign file (GM); links it as a resource
         * @description Uploads a file and links it as a `file` resource. Optional form fields `category_id` / `new_category_name` file it under a resource category in the same call. GM or admin role required.
         */
        post: operations["upload_campaign_file_api_campaigns__campaign_id__files_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/files/{file_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download a campaign file (honours resource visibility) */
        get: operations["get_campaign_file_api_campaigns__campaign_id__files__file_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/guests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List a campaign's guests and their invite codes */
        get: operations["list_guests_api_campaigns__campaign_id__guests_get"];
        put?: never;
        /** Create a guest invite code for a GM campaign */
        post: operations["create_guest_api_campaigns__campaign_id__guests_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/guests/{member_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a guest (deletes the guest account) */
        delete: operations["remove_guest_api_campaigns__campaign_id__guests__member_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/guests/{member_id}/regenerate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Regenerate a guest's invite code */
        post: operations["regenerate_guest_code_api_campaigns__campaign_id__guests__member_id__regenerate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/guests/{member_id}/share-template": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get share text and links for a guest invite code */
        get: operations["guest_share_template_api_campaigns__campaign_id__guests__member_id__share_template_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/images": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload an image (GM); links it as an image resource for note embedding
         * @description Upload an image to embed in a wiki note.
         *
         *     The image becomes a campaign file resource (resource_type='file', is_image=True)
         *     so it also appears under linked resources. The GM may file it under an existing
         *     resource category (`category_id`) or create a new one (`new_category_name`).
         */
        post: operations["upload_campaign_image_api_campaigns__campaign_id__images_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/invite": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Invite a player to a GM campaign */
        post: operations["invite_member_api_campaigns__campaign_id__invite_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/members/{member_id}/art": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a member's character art */
        get: operations["get_member_art_api_campaigns__campaign_id__members__member_id__art_get"];
        put?: never;
        /** Upload a member's character art */
        post: operations["upload_member_art_api_campaigns__campaign_id__members__member_id__art_post"];
        /** Remove a member's character art */
        delete: operations["delete_member_art_api_campaigns__campaign_id__members__member_id__art_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/members/{member_id}/sheet": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download a member's character sheet */
        get: operations["get_member_sheet_api_campaigns__campaign_id__members__member_id__sheet_get"];
        put?: never;
        /** Upload a member's character sheet */
        post: operations["upload_member_sheet_api_campaigns__campaign_id__members__member_id__sheet_post"];
        /** Remove a member's character sheet */
        delete: operations["delete_member_sheet_api_campaigns__campaign_id__members__member_id__sheet_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/members/{member_id}/sheet/duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Duplicate a blank sheet into a member's slot
         * @description Copy a blank library book or campaign file PDF into the member's sheet slot.
         */
        post: operations["duplicate_member_sheet_api_campaigns__campaign_id__members__member_id__sheet_duplicate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/members/{member_id}/token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a member's character token */
        get: operations["get_member_token_api_campaigns__campaign_id__members__member_id__token_get"];
        put?: never;
        /** Upload a member's character token */
        post: operations["upload_member_token_api_campaigns__campaign_id__members__member_id__token_post"];
        /** Remove a member's character token */
        delete: operations["delete_member_token_api_campaigns__campaign_id__members__member_id__token_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/members/{user_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a member */
        delete: operations["remove_member_api_campaigns__campaign_id__members__user_id__delete"];
        options?: never;
        head?: never;
        /** Accept or decline an invitation */
        patch: operations["update_member_status_api_campaigns__campaign_id__members__user_id__patch"];
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/resource-group-order": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set the resource panel's group display order (categories + type groups)
         * @description Persist the display order of the resource panel's groups.
         *
         *     Accepts an ordered list of group keys mixing the built-in type groups
         *     ("type:book" etc.) with resource categories ("cat:<id>"). Unknown keys and
         *     type-group keys are stored verbatim so the order survives; category keys are
         *     validated against this campaign's resource categories and silently dropped if
         *     they no longer exist.
         */
        put: operations["set_resource_group_order_api_campaigns__campaign_id__resource_group_order_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/resources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List linked resources */
        get: operations["list_resources_api_campaigns__campaign_id__resources_get"];
        put?: never;
        /** Link a resource to a campaign */
        post: operations["add_resource_api_campaigns__campaign_id__resources_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/resources/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Link many resources at once
         * @description Link many resources at once. Duplicates and unknown types are skipped
         *     silently so one bad entry doesn't fail the whole batch. Returns the rows
         *     that were actually created.
         */
        post: operations["bulk_add_resources_api_campaigns__campaign_id__resources_bulk_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/resources/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Reorder resources (drag-and-drop)
         * @description Apply a new manual order from an ordered list of resource ids.
         */
        put: operations["reorder_resources_api_campaigns__campaign_id__resources_reorder_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/resources/{resource_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Unlink a resource */
        delete: operations["remove_resource_api_campaigns__campaign_id__resources__resource_id__delete"];
        options?: never;
        head?: never;
        /** Update resource visibility/category */
        patch: operations["update_resource_api_campaigns__campaign_id__resources__resource_id__patch"];
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/schedule": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get campaign schedule and next sessions */
        get: operations["get_schedule_api_campaigns__campaign_id__schedule_get"];
        /** Create or update campaign schedule */
        put: operations["upsert_schedule_api_campaigns__campaign_id__schedule_put"];
        post?: never;
        /** Remove campaign schedule */
        delete: operations["delete_schedule_api_campaigns__campaign_id__schedule_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List session notes */
        get: operations["list_sessions_api_campaigns__campaign_id__sessions_get"];
        put?: never;
        /** Create a session note */
        post: operations["create_session_api_campaigns__campaign_id__sessions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/sessions/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search session notes */
        get: operations["search_session_notes_api_campaigns__campaign_id__sessions_search_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/sessions/{session_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a session note with all notes */
        get: operations["get_session_api_campaigns__campaign_id__sessions__session_id__get"];
        put?: never;
        post?: never;
        /** Delete a session note */
        delete: operations["delete_session_api_campaigns__campaign_id__sessions__session_id__delete"];
        options?: never;
        head?: never;
        /** Update session title */
        patch: operations["update_session_api_campaigns__campaign_id__sessions__session_id__patch"];
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/sessions/{session_id}/notes/gm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Save GM notes (owner only) */
        put: operations["upsert_gm_note_api_campaigns__campaign_id__sessions__session_id__notes_gm_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/sessions/{session_id}/notes/player": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Save own player note */
        put: operations["upsert_player_note_api_campaigns__campaign_id__sessions__session_id__notes_player_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/sheet-sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List blank sheets a member can duplicate
         * @description List blank sheets a member can duplicate: library character-sheet books +
         *     campaign PDF files.
         */
        get: operations["list_sheet_sources_api_campaigns__campaign_id__sheet_sources_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/wiki": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List visible wiki pages */
        get: operations["list_pages_api_campaigns__campaign_id__wiki_get"];
        put?: never;
        /** Create a wiki page */
        post: operations["create_page_api_campaigns__campaign_id__wiki_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/wiki/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export campaign wiki (md zip or json bundle)
         * @description Export a campaign's wiki as a markdown zip, a single markdown file, or a
         *     JSON bundle.
         *
         *     Available to any campaign viewer, not just the owner: a player who is leaving
         *     (or moving to another platform) can take their copy of the campaign with them.
         *     Deliberately still works on an archived campaign — archiving is exactly when
         *     someone wants their notes out — since exporting reads rather than writes.
         *
         *     Everyone receives only what they can already see in the app: pages that fail
         *     ``can_view_page`` are omitted entirely, and ``||GM secrets||`` are stripped
         *     from a player's bodies. The page filter now applies to the campaign owner
         *     too — since ``gm`` visibility means "author only", a GM is no more entitled
         *     to export a player's self-only note than to read it (issue #232). Secrets
         *     remain GM-only regardless of who authored the page holding them.
         */
        get: operations["export_wiki_api_campaigns__campaign_id__wiki_export_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/wiki/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Import wiki pages from a file or a picked folder
         * @description Import wiki pages from a file, or from a whole picked folder (owner only).
         *
         *     Two shapes, one endpoint. `file` is a single upload - markdown, a Grimoire or
         *     LegendKeeper JSON, or a zip. `files` (with a `paths` entry per file, the
         *     browser's `webkitRelativePath`) is a folder pick, which arrives as loose
         *     files because a browser has no archive step: the whole set is imported in one
         *     request so nesting and cross-links resolve together, the same as for a zip.
         */
        post: operations["import_wiki_api_campaigns__campaign_id__wiki_import_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/wiki/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Reorder wiki pages (drag-and-drop)
         * @description Apply a new manual order, expressed relative to what this user can see.
         *
         *     ``sort_order`` is global but a user only ever sees a subset of the campaign's
         *     pages, so their submitted list cannot be written as absolute positions —
         *     doing that would renumber pages they can't see and shuffle the wiki for
         *     everyone else. Instead we treat the submission as an ordering *of the slots
         *     the movable pages already occupy*: collect those pages' current sort_order
         *     values, then redeal them in the requested order. Every other page — invisible
         *     to this user, or visible but not writable by them — keeps the exact
         *     sort_order it had, so its position relative to the untouched pages is
         *     preserved.
         *
         *     A user needs write access to move a page (issue #232): a page they may read
         *     but not edit is skipped and holds its slot.
         */
        put: operations["reorder_pages_api_campaigns__campaign_id__wiki_reorder_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/wiki/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search wiki pages */
        get: operations["search_pages_api_campaigns__campaign_id__wiki_search_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/wiki/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the campaign's note templates
         * @description This campaign's templates, plus what the server allows.
         *
         *     Owner-only, matching import: everything on this list exists to write a page.
         */
        get: operations["list_wiki_templates_api_campaigns__campaign_id__wiki_templates_get"];
        put?: never;
        /**
         * Write a new note template
         * @description Write a new template by hand (owner only).
         *
         *     Page defaults (title/icon/visibility/…) arrive as fields and are stored as a
         *     frontmatter block on the body, which is the same shape a downloaded or
         *     uploaded template has — so all three kinds round-trip identically.
         */
        post: operations["create_wiki_template_api_campaigns__campaign_id__wiki_templates_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/wiki/templates/browse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Browse the community note-template catalogue
         * @description The community catalogue, as a folder tree.
         *
         *     A dead or unreachable catalogue is reported as a 502 with the underlying
         *     message, so the browser can say "couldn't reach it" rather than failing
         *     opaquely — the rest of the wiki is unaffected.
         */
        get: operations["browse_wiki_templates_api_campaigns__campaign_id__wiki_templates_browse_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/wiki/templates/download/{template_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Download a community note template into the campaign
         * @description Copy a community template into this campaign (owner only).
         *
         *     Downloading the same template twice is allowed and makes a second copy —
         *     templates are per-campaign working copies, and a GM may well want a tweaked
         *     variant alongside the original.
         */
        post: operations["download_wiki_template_api_campaigns__campaign_id__wiki_templates_download__template_id__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/wiki/templates/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add a note template from an uploaded .md file
         * @description Add a template from an uploaded ``.md`` or ``.zip`` (owner only).
         *
         *     Two shapes are accepted:
         *
         *       * A bare markdown file — the frontmatter names the template, falling back
         *         to the filename.
         *       * A `.zip` in the community repo's folder layout (`<id>/<id>.yml` plus
         *         `<id>/<id>.md`), which is exactly what *export* produces. The manifest
         *         supplies name/category/description, so a template survives an
         *         export/import round trip with its metadata intact.
         *
         *     Deliberately available even when downloading is disabled: that is how a GM
         *     on a locked-down server uses a community template — copy the files across
         *     and upload them.
         */
        post: operations["upload_wiki_template_api_campaigns__campaign_id__wiki_templates_upload_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/wiki/templates/{template_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a note template incl. its body
         * @description One template including its body — the editor's read.
         */
        get: operations["get_wiki_template_api_campaigns__campaign_id__wiki_templates__template_id__get"];
        put?: never;
        post?: never;
        /** Delete a note template */
        delete: operations["delete_wiki_template_api_campaigns__campaign_id__wiki_templates__template_id__delete"];
        options?: never;
        head?: never;
        /**
         * Edit a note template
         * @description Edit a template. Every field is optional; only what is sent changes.
         */
        patch: operations["update_wiki_template_api_campaigns__campaign_id__wiki_templates__template_id__patch"];
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/wiki/templates/{template_id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export a note template as a .zip folder
         * @description Download a template as the folder the community repo expects.
         *
         *     A `.zip` holding ``<id>/<id>.yml`` and ``<id>/<id>.md`` — drop it into a
         *     fork of the community repo, or keep it as a backup.
         */
        get: operations["export_wiki_template_api_campaigns__campaign_id__wiki_templates__template_id__export_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/wiki/templates/{template_id}/use": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a wiki page from a note template
         * @description Create a wiki page from one of this campaign's templates (owner only).
         */
        post: operations["use_wiki_template_api_campaigns__campaign_id__wiki_templates__template_id__use_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/wiki/titles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Wiki page titles for [[link]] autocomplete
         * @description Page list backing the `[[link]]` autocomplete.
         *
         *     Each entry carries the page id and its headings so the editor can offer both
         *     `[[Title]]` and `[[Title:#Heading]]` completions, plus `ambiguous` — true when
         *     another visible page shares this slug. The editor appends `:id-<id>` only for
         *     ambiguous titles, keeping ordinary links readable while still being able to
         *     address a colliding page at all (issue #287).
         *
         *     GM-only spans are stripped from players' bodies before headings are read, so
         *     a heading hidden inside `||...||` can't leak through the autocomplete.
         */
        get: operations["page_titles_api_campaigns__campaign_id__wiki_titles_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/wiki/{page_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a wiki page */
        get: operations["get_page_api_campaigns__campaign_id__wiki__page_id__get"];
        put?: never;
        post?: never;
        /** Delete a wiki page */
        delete: operations["delete_page_api_campaigns__campaign_id__wiki__page_id__delete"];
        options?: never;
        head?: never;
        /** Update a wiki page */
        patch: operations["update_page_api_campaigns__campaign_id__wiki__page_id__patch"];
        trace?: never;
    };
    "/api/campaigns/{campaign_id}/wiki/{page_id}/hide": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Hide a wiki page from your own view
         * @description Hide a page from this user's own view.
         *
         *     Per-user decluttering, so it is available on any page the user can see —
         *     including one they cannot edit or delete, which is the whole point: a player
         *     facing fifty GM pages can put the ones they don't need away without touching
         *     anybody else's wiki. Hiding a parent hides its subtree (resolved on read, see
         *     `hidden_page_ids`), so only the row for the page the user clicked is stored.
         *
         *     Deliberately not gated on `assert_not_archived`: hiding writes nothing to the
         *     campaign's content, and an archived campaign is still one you might want to
         *     tidy.
         *
         *     Refused in a personal campaign, where the feature has no premise: the only
         *     notes to hide are your own, and deleting already covers those. The UI offers
         *     no control there, so this is closing the API behind it rather than a rule a
         *     user could trip over.
         */
        post: operations["hide_page_api_campaigns__campaign_id__wiki__page_id__hide_post"];
        /**
         * Un-hide a wiki page you had hidden
         * @description Restore a page this user had hidden.
         *
         *     Only clears the user's own row. A page hidden because an ancestor is hidden
         *     has no row of its own, so un-hiding it individually is a no-op — the ancestor
         *     is what has to come back.
         *
         *     Unlike `hide_page`, this is *not* refused in a personal campaign. Rows can
         *     predate the campaign becoming personal or the guard existing at all, and
         *     refusing here would strand them: the page would stay hidden with nothing in
         *     the UI or API able to bring it back. Clearing state is always safe.
         */
        delete: operations["unhide_page_api_campaigns__campaign_id__wiki__page_id__hide_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/cancel-scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel running scan
         * @description Requests a graceful stop of the currently running library scan or indexing job (`stop_requested`). A scan whose process died - its heartbeat has not moved for five minutes - is cleared outright instead (`cleared_stale`). Admin role required.
         */
        post: operations["cancel_scan_api_cancel_scan_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/changelog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Release changelog
         * @description Returns the parsed contents of CHANGELOG.md for the About dialog, newest release first. Login required, matching /about - it is build information rather than public content. `releases` is empty when the running image ships without a changelog file, which the dialog treats as 'no changelog to show' rather than an error.
         */
        get: operations["get_changelog_api_changelog_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the user's characters
         * @description Characters this user can read: their own, plus their parties' sheets.
         */
        get: operations["list_characters_api_characters_get"];
        put?: never;
        /**
         * Create a character
         * @description Create a character against an installed schema.
         */
        post: operations["create_character_api_characters_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Import a character from an exported file
         * @description Rebuild a character from an exported file.
         *
         *     The schema is installed from the file when the importer does not already
         *     have it — a character is unreadable without one, and asking them to find it
         *     separately would make sharing a two-step affair. An installed copy is
         *     preferred: theirs may be newer.
         */
        post: operations["import_character_api_characters_import_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/import/external": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Import a character from another tool's file or link
         * @description Build a character from another tool's file or link.
         *
         *     A one-time copy, not a sync: the character is the player's from then on,
         *     and editing it never reaches back to where it came from.
         */
        post: operations["import_external_api_characters_import_external_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/importers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List installed character importers
         * @description The importers this user can run, and those the catalogue offers that
         *     they could install - or ask an admin to.
         */
        get: operations["list_importers_api_characters_importers_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/importers/{importer_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a character importer you installed
         * @description Remove an importer from the caller's own account. Characters already
         *     imported with it are untouched.
         */
        delete: operations["uninstall_user_importer_api_characters_importers__importer_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/importers/{importer_id}/install": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Install a file-only character importer for yourself
         * @description Install an importer into the caller's own account, or update their copy.
         *
         *     Only one that reads uploaded files with YAML - anything that fetches links
         *     or runs a script is refused here, whatever the index claims, because the
         *     downloaded manifest is what is checked.
         */
        post: operations["install_user_importer_api_characters_importers__importer_id__install_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/schemas": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List installed character schemas
         * @description Every schema this user has installed.
         */
        get: operations["list_schemas_api_characters_schemas_get"];
        put?: never;
        /**
         * Install a pasted character schema
         * @description Install a pasted schema, replacing this user's copy if it exists.
         *
         *     Validation happens here rather than at render: a schema that names an
         *     unknown field type or hides a script in its layout is rejected with a
         *     message saying so, which is far better than a sheet that draws nothing
         *     later.
         *
         *     The sheet arrives either already parsed (``document``) or as text, which is
         *     read as JSON and then as YAML. A custom sheet's HTML and CSS may come as
         *     their own fields rather than escaped into the document, matching how the
         *     community repo keeps them in sibling files.
         */
        post: operations["import_schema_api_characters_schemas_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/schemas/browse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Browse the community sheet catalogue
         * @description The community catalogue of character sheets.
         *
         *     Any account may browse and install: a sheet lives in one user's account and
         *     changes nothing for anyone else, so there is no admin step — the same rule
         *     themes follow.
         */
        get: operations["browse_sheets_api_characters_schemas_browse_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/schemas/install/{sheet_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Install a sheet from the catalogue
         * @description Install one sheet from the catalogue into this user's account.
         */
        post: operations["install_sheet_api_characters_schemas_install__sheet_id__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/schemas/{schema_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a schema and its document
         * @description One schema, with the validated document needed to render its sheet.
         */
        get: operations["get_schema_api_characters_schemas__schema_id__get"];
        put?: never;
        post?: never;
        /**
         * Uninstall a schema
         * @description Uninstall a schema. Characters built on it are deliberately kept.
         *
         *     Removing a sheet definition must not delete the characters someone wrote
         *     with it — they open read-only from stored data until the schema is
         *     reinstalled, which is why ``schema_ref`` is a soft reference.
         */
        delete: operations["delete_schema_api_characters_schemas__schema_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/{character_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a character with computed values
         * @description One character, with its values and freshly computed derived values.
         *
         *     A campaign member may read a party member's sheet; only the owner edits it.
         */
        get: operations["get_character_api_characters__character_id__get"];
        /**
         * Update a character
         * @description Update a character's name and/or field values.
         *
         *     ``data`` is a partial patch: only the fields it names are touched, so two
         *     tabs editing different parts of a sheet do not clobber each other.
         */
        put: operations["update_character_api_characters__character_id__put"];
        post?: never;
        /**
         * Delete a character
         * @description Delete a character.
         */
        delete: operations["delete_character_api_characters__character_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/{character_id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export a character as a self-contained file
         * @description Export a character as a self-contained file.
         *
         *     Readable by anyone who can read the sheet, so a GM can archive a party
         *     member's character. Every reference is denormalised and the schema travels
         *     with it, which is what makes the file open on an instance that has neither.
         */
        get: operations["export_character_api_characters__character_id__export_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/{character_id}/images/{field}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * An image field's picture
         * @description Serve an image field's picture to anyone who may read the character.
         *
         *     Read from the stored value alone, not the reader's copy of the sheet: a
         *     party member may have a different version installed, or none.
         */
        get: operations["get_image_api_characters__character_id__images__field__get"];
        put?: never;
        /**
         * Set the picture an image field holds
         * @description Set an image field's picture. Only the character's owner may.
         */
        post: operations["upload_image_api_characters__character_id__images__field__post"];
        /**
         * Remove an image field's picture
         * @description Remove an image field's picture.
         *
         *     Allowed for a field the sheet no longer declares, as long as what it holds
         *     is a picture: the player should be able to clear one the sheet left behind.
         */
        delete: operations["delete_image_api_characters__character_id__images__field__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/{character_id}/portrait": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A character's portrait image
         * @description Serve a portrait to anyone who may read the character.
         */
        get: operations["get_portrait_api_characters__character_id__portrait_get"];
        put?: never;
        /**
         * Set a character's portrait
         * @description Set a character's portrait. Only the character's owner may.
         */
        post: operations["upload_portrait_api_characters__character_id__portrait_post"];
        /**
         * Remove a character's portrait
         * @description Remove a character's portrait.
         */
        delete: operations["delete_portrait_api_characters__character_id__portrait_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/codex/books/{book_id}/link": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Unlink a book from Grimoire Codex DB
         * @description Clears the book's codex_id. Nothing changes in Grimoire Codex DB.
         */
        delete: operations["unlink_book_api_codex_books__book_id__link_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/codex/books/{book_id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send a book to Grimoire Codex DB
         * @description Creates the book in Grimoire Codex DB, or sends the chosen fields as a correction to the linked record. Grimoire Codex DB decides whether it applies at once or waits for review.
         */
        post: operations["submit_book_api_codex_books__book_id__submit_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/codex/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Grimoire Codex DB settings
         * @description Admin only. The API token comes from GRIMOIRE_CODEX_DB_API_TOKEN and is never returned.
         */
        get: operations["get_settings_api_codex_settings_get"];
        /**
         * Update Grimoire Codex DB settings
         * @description Admin only. Settings pinned by a GRIMOIRE_CODEX_DB_* environment variable are read-only.
         */
        put: operations["update_settings_api_codex_settings_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/codex/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Grimoire Codex DB status
         * @description Whether Grimoire Codex DB is on for this server (GRIMOIRE_CODEX_DB_API_TOKEN is set), and its address.
         */
        get: operations["get_status_api_codex_status_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/codex/systems/{system_id}/link": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Unlink a game system from Grimoire Codex DB
         * @description Clears the system's codex_id. Nothing changes in Grimoire Codex DB.
         */
        delete: operations["unlink_system_api_codex_systems__system_id__link_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/codex/systems/{system_id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send a game system to Grimoire Codex DB
         * @description Creates the system in Grimoire Codex DB, or sends the chosen fields as a correction.
         */
        post: operations["submit_system_api_codex_systems__system_id__submit_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/codex/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Test the Grimoire Codex DB connection
         * @description Admin only. Reaches Grimoire Codex DB and reports the account the API token belongs to.
         */
        post: operations["test_connection_api_codex_test_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/content/packs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List installed content packs
         * @description Every installed content pack, with its licence and credit.
         */
        get: operations["list_packs_api_content_packs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/content/packs/reload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Re-read content packs from disk (admin)
         * @description Re-read every content pack from disk.
         *
         *     Packs load at startup and on rescan, but an admin who has just dropped a
         *     directory in should not have to restart to see it. The directory is the
         *     source of truth, so this is a re-read rather than a merge: a pack whose
         *     files changed is replaced, and one whose directory is gone loses its rows.
         */
        post: operations["reload_packs_api_content_packs_reload_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/content/{schema_id}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Resolve many entry references at once
         * @description Resolve many references at once, for rendering a sheet.
         *
         *     A sheet with twenty referenced spells must not make twenty requests. Ids
         *     that no installed pack provides come back marked `missing` rather than being
         *     omitted, so the sheet can say "this entry is not installed" instead of
         *     silently dropping something the player chose.
         */
        get: operations["resolve_entries_api_content__schema_id__resolve_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/content/{schema_id}/types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The content types a schema declares
         * @description The content types this user's copy of a schema declares.
         */
        get: operations["list_content_types_api_content__schema_id__types_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/content/{schema_id}/{content_type}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Browse a content type
         * @description Browse one content type: search, filter, sort, paginate.
         *
         *     Filters arrive as `filter[field]=value` query parameters, which is why this
         *     handler takes the raw request — FastAPI cannot express that bracketed shape
         *     as a typed parameter.
         */
        get: operations["browse_content_api_content__schema_id___content_type__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/content/{schema_id}/{content_type}/{entry_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * One catalog entry
         * @description One catalog entry in full.
         */
        get: operations["get_entry_api_content__schema_id___content_type___entry_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/dice-materials": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List all dice/materials */
        get: operations["list_dice_materials_api_dice_materials_get"];
        put?: never;
        /** Create a custom dice/material (admin) */
        post: operations["create_dice_material_api_dice_materials_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/dice-materials/{material_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a dice/material (admin; blocked if in use unless force=true) */
        delete: operations["delete_dice_material_api_dice_materials__material_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/downloads/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download an archive of files
         * @description Stream a collection of files as a single archive. `fmt` controls the format: `zip` (default), `tar`, `tar.gz`, `tar.bz2`. `type` controls the scope: `system`, `system_category`, `book_folder`, `map_folder`, `token_folder`, `audio_folder`, `tag` (everything carrying a tag, grouped by resource type), `tag_type` (one type's slice of a tag), `tag_folder` (one tagged folder), or `library_folder` (admin-only; any folder as it sits on disk, indexed or not).
         */
        get: operations["download_archive_api_downloads_archive_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/duplicates/cancel-scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Stop a running duplicate scan
         * @description Stop a running scan, or clear one that is no longer running at all.
         *
         *     Asking a live scan to stop only sets a flag for its thread to notice, which
         *     is right: the thread has partial results to discard on the way out. But a
         *     scan whose process was killed leaves that flag pointing at nothing, and the
         *     status stays ``running`` forever - Stop appears dead and every later scan is
         *     refused as already running (issue #304). So a status whose heartbeat has
         *     gone stale is cleared here directly, which is the only path that can
         *     recover it from the UI.
         */
        post: operations["cancel_scan_api_duplicates_cancel_scan_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/duplicates/compare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Side-by-side comparison of two to four items
         * @description Everything needed to render two (to four) copies side by side.
         *
         *     Page images come from the existing per-item routes, which already work for a
         *     variant, so this returns only what the client cannot compute for itself: the
         *     metadata diff, the reference counts that decide which copy is worth keeping,
         *     and how far a synced page-flip can run.
         */
        get: operations["compare_items_api_duplicates_compare_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/duplicates/describe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set the kind and label one version shows in the picker
         * @description Set the kind and label one version shows in the picker.
         *
         *     The one edit that reaches a main version: without it the main copy of a
         *     family is always "Main version", however much more the user knows about it.
         */
        post: operations["describe_variant_api_duplicates_describe_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/duplicates/dismiss": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mark a group as not duplicates
         * @description Record that a group is not a set of duplicates.
         *
         *     Remembered pair-wise, so the judgement still applies when a later scan finds
         *     a third copy - see services/duplicates/dismissals.py.
         */
        post: operations["dismiss_group_api_duplicates_dismiss_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/duplicates/dismissals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List dismissed groups
         * @description Groups the user has marked as not-duplicates, so they can be undone.
         */
        get: operations["list_dismissals_api_duplicates_dismissals_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/duplicates/dismissals/{dismissal_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Undo a dismissal
         * @description Forget a dismissal so the group can surface on the next scan.
         */
        delete: operations["undismiss_group_api_duplicates_dismissals__dismissal_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/duplicates/groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Candidate duplicate groups from the last scan
         * @description Candidate groups from the most recent completed scan.
         *
         *     Groups whose members have since been deleted or already resolved into a
         *     variant family are filtered out here rather than deleted from the table: a
         *     read should not mutate, and the next scan clears them anyway.
         */
        get: operations["list_groups_api_duplicates_groups_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/duplicates/items/{resource_type}/{item_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete one duplicate record, and optionally its file
         * @description Delete one record — the duplicate the user chose to drop.
         *
         *     Refuses to silently orphan a family: an item with variants must say what
         *     becomes of them, because a variant left pointing at a deleted parent would
         *     vanish from every view while its file sat on disk forever.
         */
        delete: operations["delete_item_api_duplicates_items__resource_type___item_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/duplicates/link": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * File items under a parent as its variants
         * @description File one or more items under a parent as its variants.
         *
         *     Skip-and-continue per child, matching the bulk-update contract: one bad id in
         *     a batch of five should not cost the user the other four links.
         */
        post: operations["link_variants_api_duplicates_link_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/duplicates/merge-metadata": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Copy metadata fields from one copy onto another
         * @description Copy chosen metadata fields from one record onto another.
         *
         *     Keeping the file with the worse metadata should not be a punishment (issue
         *     #304), so the good record's title, authors, and tags can move across before
         *     the other copy is deleted.
         */
        post: operations["merge_metadata_api_duplicates_merge_metadata_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/duplicates/promote": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Make a different copy the main version of an existing family
         * @description Make a different copy the main version of an existing family.
         *
         *     Unlike :func:`link_variants` this is one indivisible change rather than a
         *     per-child batch: the old parent and all of its children move together, and a
         *     partial application would leave a family split across two parents.
         */
        post: operations["promote_variant_api_duplicates_promote_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/duplicates/scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start a duplicate-detection scan
         * @description Kick off a detection pass in the background.
         *
         *     Refuses while a library scan is running: detection reads a snapshot of the
         *     library, and comparing rows the scanner is actively rewriting produces groups
         *     that are wrong by the time they are displayed.
         */
        post: operations["start_scan_api_duplicates_scan_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/duplicates/scan-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Progress of the duplicate-detection scan
         * @description Progress of the duplicate scan, for the settings panel to poll.
         */
        get: operations["get_scan_status_api_duplicates_scan_status_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/duplicates/unlink": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Promote variants back to standalone entries
         * @description Promote variants back to standalone entries.
         */
        post: operations["unlink_variants_api_duplicates_unlink_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/favorites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List current user's favorites */
        get: operations["list_favorites_api_favorites_get"];
        put?: never;
        /** Add a favorite */
        post: operations["add_favorite_api_favorites_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/favorites/{item_type}/{item_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a favorite */
        delete: operations["remove_favorite_api_favorites__item_type___item_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/files/browse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a library folder with indexing state
         * @description List one library folder, merged with what Grimoire knows about its files.
         *
         *     The listing is deliberately DB-aware rather than a raw directory read: the
         *     point of managing files *inside* Grimoire is seeing which entries are indexed
         *     records carrying tags and progress, and which are loose files the scanner
         *     ignored. A pure filesystem listing would make those indistinguishable.
         *
         *     Bounded on purpose. A single folder can hold tens of thousands of files, and
         *     an unbounded listing would serialise all of them, ship them, and hand the
         *     browser a list it cannot usefully render. ``limit`` caps the entries returned
         *     and ``total`` reports the true count, so the UI can say what it is hiding
         *     rather than silently showing a partial folder.
         */
        get: operations["browse_api_files_browse_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/files/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Remove a file or folder from the index, or from disk
         * @description Soft by default: removes the indexed record and everything keyed to it while leaving the files alone, so a rescan re-adds whatever is still present and not excluded. Set `delete_files` to also unlink the files, which is irreversible. Non-empty folders require `confirm_name`.
         */
        post: operations["delete_entry_api_files_delete_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/files/folder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a folder, optionally as a container or NSFW
         * @description Create a folder, writing container/NSFW marker files when asked.
         */
        post: operations["create_folder_api_files_folder_post"];
        /**
         * Delete a folder, recursively when confirmed by name
         * @description Deletes a folder holding nothing but markers and empty descendants. One still holding content is refused with 428 until `confirm_name` matches the folder's own name.
         */
        delete: operations["delete_folder_api_files_folder_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/files/folder/contents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Report whether a folder holds content
         * @description Whether a folder holds content, so the UI can pick the right guard.
         *
         *     Asked before opening the delete dialog: an empty folder gets a plain
         *     confirmation, a full one gets the type-the-name prompt. Answering this
         *     server-side keeps one definition of "empty" — the browse listing hides
         *     sidecars and marker files, so a UI counting rows would disagree with the
         *     check the delete itself performs.
         */
        get: operations["folder_contents_api_files_folder_contents_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/files/folder/markers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set a folder's container/NSFW markers
         * @description Set or clear a folder's container-kind, NSFW, and frame markers.
         */
        put: operations["update_markers_api_files_folder_markers_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/files/folder/scaffold": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create the standard category folders in a system folder
         * @description Create the standard category folders inside a system folder.
         */
        post: operations["scaffold_categories_api_files_folder_scaffold_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/files/move": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Move files or folders, preserving their metadata
         * @description Move files/folders into a destination folder, relinking their records.
         */
        post: operations["move_files_api_files_move_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/files/rename": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rename a file or folder on disk
         * @description Rename a file or folder on disk, relinking every record beneath it.
         */
        post: operations["rename_file_api_files_rename_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/files/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload a single file into a library folder
         * @description Multipart upload of one file. Send files individually so progress can be reported per file and failures retried in isolation. `on_conflict` is `rename` (default), `skip`, or `replace`, which overwrites an indexed book's file and keeps its record (409 when the path is not an indexed book, or while a scan or OCR run is in progress).
         */
        post: operations["upload_file_api_files_upload_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/genres": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List all genres (tiered)
         * @description Return all genres, ordered for a tiered picker (parents then children).
         */
        get: operations["list_genres_api_genres_get"];
        put?: never;
        /** Create a custom genre (admin) */
        post: operations["create_genre_api_genres_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/genres/{genre_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a genre (admin; blocked if in use unless force=true) */
        delete: operations["delete_genre_api_genres__genre_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Liveness/readiness probe
         * @description Unauthenticated readiness probe used by the container HEALTHCHECK.
         *
         *     Verifies the app can reach its dependencies: the database (always) and the
         *     Valkey/Redis page cache (only when configured). Returns HTTP 200 with a
         *     per-check status when everything is reachable, and HTTP 503 otherwise so
         *     orchestrators mark a wedged container unhealthy rather than "up".
         */
        get: operations["health_api_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/latest-release": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Latest published release
         * @description Returns the latest GitHub release version for the update-available check. Proxied server-side (and cached) so the browser makes a same-origin request that privacy browsers and request blockers won't block. Login required.
         */
        get: operations["get_latest_release_api_latest_release_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/licenses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List all licenses */
        get: operations["list_licenses_api_licenses_get"];
        put?: never;
        /** Create a custom license (admin) */
        post: operations["create_license_api_licenses_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/licenses/{license_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a license (admin; blocked if in use unless force=true) */
        delete: operations["delete_license_api_licenses__license_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Application logs
         * @description Returns recent application log entries from the in-memory ring buffer (up to 20 000 entries). The `level` filter follows standard log hierarchy: `debug` returns all levels, `info` returns info/warning/error/critical, etc. Console output is controlled by the `LOG_LEVEL` environment variable, but this endpoint always has access to DEBUG-level logs regardless of that setting. For live polling, pass `after_seq` set to the `max_seq` value from the previous response - only entries with a higher sequence number are returned, making polling exact regardless of how fast entries arrive. **Admin only.**
         */
        get: operations["get_logs_api_logs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maintenance/cleanup-missing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Remove DB entries for missing files */
        post: operations["cleanup_missing_api_maintenance_cleanup_missing_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maintenance/sidecars/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Write metadata sidecars for the whole library
         * @description Backfill metadata sidecars for the whole library.
         *
         *     Runs inline rather than in the background: it is admin-triggered, bounded by
         *     the library size, and the operator wants the per-item outcome — how many
         *     files were skipped as foreign, and whether the mount is writable — in the
         *     response rather than in a log they have to go find.
         */
        post: operations["export_sidecars_api_maintenance_sidecars_export_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maintenance/sidecars/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read metadata sidecar export settings
         * @description Current metadata sidecar export configuration.
         */
        get: operations["get_sidecar_settings_api_maintenance_sidecars_settings_get"];
        /**
         * Configure metadata sidecar export
         * @description Enable, disable, or reconfigure sidecar export.
         */
        put: operations["update_sidecar_settings_api_maintenance_sidecars_settings_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/map-folders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List map folders
         * @description Returns all known map folder paths and their associated tags.
         */
        get: operations["list_map_folders_api_map_folders_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Set tags on a map folder
         * @description Creates or replaces the tag list for a folder path. GM or admin role required.
         */
        patch: operations["update_map_folder_api_map_folders_patch"];
        trace?: never;
    };
    "/api/map-folders/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk set map folder tags
         * @description Sets tags on many map folders in one transaction. Body: {folders: [{path, tags}]}. GM or admin role required.
         */
        post: operations["bulk_update_map_folders_api_map_folders_bulk_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List maps
         * @description Returns a paginated list of maps. Filter by `map_type` or `folder`.
         */
        get: operations["list_maps_api_maps_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk update maps
         * @description Applies per-map edits for many maps in one transaction. Body: {items: [{id, description?, tags?, map_type?, grid_size?}]}. Unknown ids are reported in `errors` and skipped. GM or admin role required.
         */
        post: operations["bulk_update_maps_api_maps_bulk_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/bulk/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk add tags to maps
         * @description Additively applies tags to many maps in one transaction. Body: {ids: [...], tags: [...]}. GM or admin role required.
         */
        post: operations["bulk_add_map_tags_api_maps_bulk_tags_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Folders holding matching maps
         * @description Every folder that holds maps matching the filters, with how many. Takes the same filters as the list; the gallery renders folders from this and opens each with the list's `folder` parameter (issue #221).
         */
        get: operations["list_map_groups_api_maps_groups_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/{map_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a map
         * @description Returns full map metadata including pixel dimensions, DPI, detected grid size, and folder tags.
         */
        get: operations["get_map_api_maps__map_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update map metadata
         * @description Updates editable fields on a map (description, tags, map_type, grid_size). GM or admin role required.
         */
        patch: operations["update_map_api_maps__map_id__patch"];
        trace?: never;
    };
    "/api/maps/{map_id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Export map pages or cut-outs
         * @description As `POST /books/{id}/export`, for a PDF map. 400 for non-PDF maps.
         */
        post: operations["export_map_pages_api_maps__map_id__export_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/{map_id}/export.uvtt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export a map as Universal VTT
         * @description Builds a Universal VTT (`.uvtt`) file for a raster map: the image as base64 WebP, the grid resolution, and any walls/portals/lights authored in the in-app editor (empty arrays when nothing has been authored). The grid is the manual override when one is set, else the detected grid, else a 140px default. The file is assembled on demand and never written into the library. 400 for PDF, video, archive, or existing Universal VTT maps.
         */
        get: operations["export_map_uvtt_api_maps__map_id__export_uvtt_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/{map_id}/export/save": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Save a map export into the library
         * @description As `POST /books/{id}/export/save`, for a PDF map. Admin role required.
         */
        post: operations["save_map_export_api_maps__map_id__export_save_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/{map_id}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download map file
         * @description Streams the original map image or PDF.
         */
        get: operations["serve_map_file_api_maps__map_id__file_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/{map_id}/otfbm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * OTFBM setup for a map
         * @description How to set a map up as an OTFBM background for Avrae's `!map`: the whole-cell map size, the cell size (`?cell=`, 20-100; defaults to a suggestion of at most 70 and never above the map's own cell size), and the size the image is resized to so each cell is exactly that many pixels. Uses the same resolved grid as the Universal VTT export. 403 unless you may create share links; 400 for PDF, video and archive maps.
         */
        get: operations["get_map_otfbm_api_maps__map_id__otfbm_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/{map_id}/otfbm/image": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export a map as an OTFBM background
         * @description The map resized so each grid cell is `?cell=` pixels (as in `GET /maps/{id}/otfbm`), as a JPEG -- or a PNG when the map has transparency, since OTFBM does not accept WebP. Returned as an attachment named `<slug>-<W>x<H>c<cell>`; never written into the library. 403 unless you may create share links; 400 for PDF, video and archive maps.
         */
        get: operations["export_map_otfbm_image_api_maps__map_id__otfbm_image_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/{map_id}/page/{page_num}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Render a map page
         * @description Renders a single page of a PDF map to WebP (`?width=` sets the target pixel width, default 1600, max 3000). Image maps are streamed as-is and only accept page 1.
         */
        get: operations["serve_map_page_api_maps__map_id__page__page_num__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/{map_id}/page/{page_num}/shapes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Suggest cut-outs on a map page
         * @description As `GET /books/{id}/page/{n}/shapes`, for a PDF map. 400 for non-PDF maps.
         */
        get: operations["detect_map_page_shapes_api_maps__map_id__page__page_num__shapes_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/{map_id}/page/{page_num}/size": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a map page's size
         * @description The PDF map page's width and height in points. 400 for non-PDF maps.
         */
        get: operations["get_map_page_size_api_maps__map_id__page__page_num__size_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/{map_id}/thumbnail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Map thumbnail
         * @description Returns the pregenerated WebP thumbnail for a map. 404 if not yet generated.
         */
        get: operations["serve_map_thumbnail_api_maps__map_id__thumbnail_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/{map_id}/vtt/authoring": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get authored Universal VTT geometry
         * @description Returns the walls, portals, lights and environment authored for a map in the in-app editor, along with the resolved grid to draw them on. `data` is null when nothing has been authored.
         */
        get: operations["get_map_authoring_api_maps__map_id__vtt_authoring_get"];
        /**
         * Replace authored Universal VTT geometry
         * @description Replaces a map's authored walls/portals/lights in one atomic write. Body: {data: {...}} — send `{"data": null}` to clear everything. Coordinates are in grid units. Nothing is written to the library: the `.uvtt` is built on demand by the export endpoint. GM or admin role required.
         */
        put: operations["update_map_authoring_api_maps__map_id__vtt_authoring_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/{map_id}/vtt/data": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Universal VTT grid and feature data
         * @description Returns the grid resolution and wall/portal/light counts parsed from a `.uvtt`/`.dd2vtt` file, with the embedded image omitted. 400 if the map is not a Universal VTT file.
         */
        get: operations["get_map_vtt_data_api_maps__map_id__vtt_data_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/{map_id}/vtt/image": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Universal VTT map image
         * @description Decodes and streams the base64 battlemap image embedded in a `.uvtt`/`.dd2vtt` file, so the browser never downloads the base64 envelope. 400 if the map is not a Universal VTT file or carries no image.
         */
        get: operations["serve_map_vtt_image_api_maps__map_id__vtt_image_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/model-folders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List model folders
         * @description Returns all known model folder paths and their associated tags.
         */
        get: operations["list_model_folders_api_model_folders_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Set tags on a model folder
         * @description Creates or replaces the tag list for a folder path. GM or admin role required.
         */
        patch: operations["update_model_folder_api_model_folders_patch"];
        trace?: never;
    };
    "/api/model-folders/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk set model folder tags
         * @description Sets tags on many model folders in one transaction. Body: {folders: [{path, tags}]}. GM or admin role required.
         */
        post: operations["bulk_update_model_folders_api_model_folders_bulk_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List 3D models
         * @description Returns a paginated list of 3D models.
         */
        get: operations["list_models_api_models_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/models/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk update models
         * @description Applies per-model edits for many models in one transaction. Body: {items: [{id, description?, tags?, is_explicit?, is_supported?}]}. Unknown ids are reported in `errors` and skipped. GM or admin role required.
         */
        post: operations["bulk_update_models_api_models_bulk_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/models/bulk/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk add tags to models
         * @description Additively applies tags to many models in one transaction. Body: {ids: [...], tags: [...]}. GM or admin role required.
         */
        post: operations["bulk_add_model_tags_api_models_bulk_tags_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/models/groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Folders holding matching 3D models
         * @description Every folder that holds 3D models matching the filters, with how many. Takes the same filters as the list; the gallery renders folders from this and opens each with the list's `folder` parameter (issue #221).
         */
        get: operations["list_model_groups_api_models_groups_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/models/{model_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a 3D model
         * @description Returns full model metadata including folder tags, mesh size, the presupported/unsupported flag, and whether the browser viewer can render this file.
         */
        get: operations["get_model_api_models__model_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update model metadata
         * @description Updates editable fields on a model (description, tags, is_explicit, is_supported). GM or admin role required.
         */
        patch: operations["update_model_api_models__model_id__patch"];
        trace?: never;
    };
    "/api/models/{model_id}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download model file
         * @description Streams the original mesh file. Also the source the 3D viewer loads.
         */
        get: operations["serve_model_file_api_models__model_id__file_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/models/{model_id}/thumbnail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Model thumbnail
         * @description Returns the pregenerated WebP thumbnail for a model. 404 if not yet generated, or for a format that cannot be rendered server-side.
         */
        get: operations["serve_model_thumbnail_api_models__model_id__thumbnail_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/parent-systems": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List all parent systems */
        get: operations["list_parent_systems_api_parent_systems_get"];
        put?: never;
        /** Create a custom parent system (admin) */
        post: operations["create_parent_system_api_parent_systems_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/parent-systems/{parent_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a parent system (admin; blocked if in use unless force=true) */
        delete: operations["delete_parent_system_api_parent_systems__parent_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rescan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rescan and reindex library
         * @description Triggers a background rescan, adding new files and indexing unindexed PDFs. Optionally scope to a subtree (`scope`, e.g. "books/D&D 5e/adventure") and re-apply sidecar metadata (`metadata_mode`: new|missing|replace). Admin role required.
         */
        post: operations["rescan_library_api_rescan_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rulesets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List rulesets this user can read
         * @description Every ruleset this user can read: the server's, their tables', and their own.
         */
        get: operations["list_rulesets_api_rulesets_get"];
        put?: never;
        /**
         * Create a ruleset for a campaign, or for the server
         * @description Add a ruleset to a campaign, or to the server if you are an admin.
         */
        post: operations["create_ruleset_api_rulesets_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rulesets/installable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Content packs that can be imported into a ruleset
         * @description Filesystem content packs that can be copied into a ruleset.
         *
         *     This is how the 5.5e SRD reaches a table: an admin installs the pack once,
         *     and any GM imports it into their campaign's ruleset in a click.
         */
        get: operations["list_installable_packs_api_rulesets_installable_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rulesets/packs/browse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Browse the community catalogue of content packs
         * @description The community catalogue of content packs.
         *
         *     Any account may browse, so a GM can see what the SRD would give their table
         *     before asking an admin for it. Installing is the admin-only step, because a
         *     pack is server-wide.
         */
        get: operations["browse_packs_api_rulesets_packs_browse_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rulesets/packs/install/{pack_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Install a content pack from the catalogue (admin)
         * @description Download one pack from the catalogue and load it into the catalog.
         *
         *     Admin only: a pack is server-wide, so installing one changes what every
         *     table on this instance can reach.
         */
        post: operations["install_pack_api_rulesets_packs_install__pack_id__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rulesets/packs/{pack_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Uninstall a content pack (admin)
         * @description Remove an installed content pack, its directory and its rows. Admin only.
         *
         *     Characters referencing its entries keep their references, which read as
         *     "not installed" until it comes back. A ruleset that imported the pack keeps
         *     its own copy of the entries - that is what importing is for.
         */
        delete: operations["uninstall_pack_api_rulesets_packs__pack_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rulesets/{ruleset_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One ruleset */
        get: operations["get_ruleset_api_rulesets__ruleset_id__get"];
        /** Rename a ruleset or change its credit */
        put: operations["update_ruleset_api_rulesets__ruleset_id__put"];
        post?: never;
        /**
         * Delete a ruleset and its entries
         * @description Delete a ruleset and its entries.
         *
         *     Characters referencing them are left alone: a reference is soft, so the
         *     sheet marks the entry missing rather than losing the row.
         */
        delete: operations["delete_ruleset_api_rulesets__ruleset_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rulesets/{ruleset_id}/entries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A ruleset's entries */
        get: operations["list_entries_api_rulesets__ruleset_id__entries_get"];
        put?: never;
        /** Write an entry */
        post: operations["create_entry_api_rulesets__ruleset_id__entries_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rulesets/{ruleset_id}/entries/{entry_row_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One entry */
        get: operations["get_entry_api_rulesets__ruleset_id__entries__entry_row_id__get"];
        /** Edit an entry */
        put: operations["update_entry_api_rulesets__ruleset_id__entries__entry_row_id__put"];
        post?: never;
        /** Delete an entry */
        delete: operations["delete_entry_api_rulesets__ruleset_id__entries__entry_row_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rulesets/{ruleset_id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export a ruleset
         * @description Export a ruleset as a portable document.
         */
        get: operations["export_ruleset_api_rulesets__ruleset_id__export_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rulesets/{ruleset_id}/fork": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Copy a catalogue entry into this ruleset
         * @description Copy a catalogue entry into this ruleset so it can be edited.
         *
         *     Pack content is read-only and server-wide, so changing a spell means taking
         *     a copy that belongs to a table you run.
         */
        post: operations["fork_entry_api_rulesets__ruleset_id__fork_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rulesets/{ruleset_id}/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Import content into a ruleset
         * @description Add entries to a ruleset, from an installed pack or a pasted document.
         */
        post: operations["import_into_ruleset_api_rulesets__ruleset_id__import_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/saved-filters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the user's saved filters
         * @description List the current user's saved filters, optionally limited to one scope.
         */
        get: operations["list_saved_filters_api_saved_filters_get"];
        put?: never;
        /**
         * Create/overwrite a saved filter
         * @description Create a preset. Re-saving an existing (scope, name) overwrites its state.
         */
        post: operations["create_saved_filter_api_saved_filters_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/saved-filters/{filter_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a saved filter
         * @description Delete one of the current user's saved filters.
         */
        delete: operations["delete_saved_filter_api_saved_filters__filter_id__delete"];
        options?: never;
        head?: never;
        /**
         * Rename, re-save state, or set default
         * @description Rename a preset, replace its state, and/or set it as the scope default.
         */
        patch: operations["update_saved_filter_api_saved_filters__filter_id__patch"];
        trace?: never;
    };
    "/api/scan-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Scan status
         * @description Returns current scan state: running, phase (scanning|indexing), progress counters, and new-item counts from the last scan.
         */
        get: operations["get_scan_status_api_scan_status_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Full-text search
         * @description Searches indexed book pages using SQLite FTS5, and books, maps, tokens and audio by their own metadata. Optionally scope to a single book (`book_id`) or game system (`system_id`). Supports `field:value` filters (`title:avatar`, `author:"Ben Robbins"`, `tag:dungeon`); a metadata filter suppresses page-text search, and `text:` forces it. Returns snippets with HTML `<mark>` highlights.
         */
        get: operations["search_library_api_search_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/search/fields": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Searchable fields
         * @description The `field:` prefixes the search box accepts, with their aliases. Powers the in-app search help popover.
         */
        get: operations["search_fields_api_search_fields_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get app settings */
        get: operations["get_settings_api_settings_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update app settings */
        patch: operations["update_settings_api_settings_patch"];
        trace?: never;
    };
    "/api/settings/oidc-button-icon": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload the OIDC login-button icon
         * @description Admin-only. Multipart `file`: PNG, JPEG, WebP, GIF or SVG, max 1 MB. The image is re-encoded server-side (SVGs are rasterized) to a PNG at most 192 px on its longest side, so the uploaded bytes are never served as-is. 400 when `OIDC_BUTTON_ICON` pins the icon. Returns the full settings.
         */
        post: operations["upload_oidc_button_icon_api_settings_oidc_button_icon_post"];
        /**
         * Remove the OIDC login-button icon
         * @description Admin-only. Deletes the uploaded icon so the button shows text only. 400 when `OIDC_BUTTON_ICON` pins the icon. Returns the full settings.
         */
        delete: operations["delete_oidc_button_icon_api_settings_oidc_button_icon_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/ui": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * UI settings (any authenticated user)
         * @description Returns the subset of settings that affect UI visibility for all users.
         */
        get: operations["get_ui_settings_api_settings_ui_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/share-links": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List my share links
         * @description Your share links, newest first, each with its current `state` (active, disabled, revoked, expired, suspended - you may no longer share - or unavailable - the item is gone or you can no longer read it). Filter with `resource_type`, `resource_id` and `variant`.
         */
        get: operations["list_share_links_api_share_links_get"];
        put?: never;
        /**
         * Create a share link
         * @description Creates a public link to one book, map, token, audio track or model you can read. Optional `label`, `expires_in_days` (null for never) and `password`. `variant: "otfbm"` (maps only, with an optional `cell` of 20-100) makes the link serve the map resized as an OTFBM background instead of the original. 403 when share links are off or you may not create them.
         */
        post: operations["create_share_link_api_share_links_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/share-links/all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List every share link
         * @description Every user's share links, with their owners. Admin only, and not with an API key: the live link URLs are credentials.
         */
        get: operations["list_all_share_links_api_share_links_all_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/share-links/permission": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Whether I may create share links
         * @description Your effective permission and which layer decided it (instance, role or override).
         */
        get: operations["get_share_permission_api_share_links_permission_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/share-links/users/{user_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a user's share links
         * @description One user's share links, for the user admin page. Admin only, and not with an API key: the live link URLs are credentials.
         */
        get: operations["list_user_share_links_api_share_links_users__user_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/share-links/{link_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a share link
         * @description Removes the link entirely; it stops working if it had not been revoked.
         */
        delete: operations["delete_share_link_api_share_links__link_id__delete"];
        options?: never;
        head?: never;
        /**
         * Change a share link
         * @description Change the label, expiry (`expires_in_days`, null for never) or password (null or empty to remove it). Your own links, or anyone's for an admin.
         */
        patch: operations["update_share_link_api_share_links__link_id__patch"];
        trace?: never;
    };
    "/api/share-links/{link_id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Revoke a share link
         * @description Stops the link working for good. It stays listed as revoked until deleted.
         */
        post: operations["revoke_share_link_api_share_links__link_id__revoke_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/share/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Fetch a shared item
         * @description Serves the shared item inline (`?download=1` for an attachment). Image maps, tokens, books, audio and models serve their file (audio supports Range requests); a PDF map serves its first page as WebP and a Universal VTT map its embedded image. 401 when the link needs a password; 404 for any link that does not work.
         */
        get: operations["share_content_api_share__token__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/share/{token}/meta": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Describe a share link
         * @description What the share page needs: the item's name, type and file URLs. For a password-protected link only `password_required` and `unlocked` are returned until it is unlocked. 404 for any link that does not work.
         */
        get: operations["share_meta_api_share__token__meta_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/share/{token}/unlock": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Unlock a password-protected share link
         * @description Checks the password and sets an HttpOnly cookie, scoped to this link's URLs, that unlocks it in this browser for 12 hours. 403 for a wrong password; wrong guesses are throttled per client and link.
         */
        post: operations["unlock_share_api_share__token__unlock_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/share/{token}/{filename}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Fetch a shared item by filename
         * @description The same as `GET /api/share/{token}`. The filename is ignored; it is there for tools that infer a file's type from the URL's extension.
         */
        get: operations["share_content_api_share__token___filename__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Library statistics
         * @description Returns library counts. Accepts a session, or an `X-API-Key` with the `stats` permission for external integrations such as Homepage. Guests are refused: the counts describe the whole library.
         */
        get: operations["get_stats_api_stats_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/system-families": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List all system families */
        get: operations["list_system_families_api_system_families_get"];
        put?: never;
        /** Create a custom system family (admin) */
        post: operations["create_system_family_api_system_families_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/system-families/{family_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a system family (admin; blocked if in use unless force=true) */
        delete: operations["delete_system_family_api_system_families__family_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/systems": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List all game systems
         * @description Returns all game systems with book counts, tags, genre, and mechanics. Systems nested inside a container folder are omitted by default; pass `parent_id` to list one container's children, or `include_children=true` for a flat list of everything.
         */
        get: operations["list_systems_api_systems_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/systems/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk update game systems
         * @description Applies per-system edits for many systems in one transaction. Body: {items: [{id, ...GameSystemUpdate fields}]}. Unknown ids and name clashes are reported in `errors` and skipped. GM or admin role required.
         */
        post: operations["bulk_update_systems_api_systems_bulk_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/systems/bulk/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk add tags to game systems
         * @description Additively applies tags to many systems in one transaction. Body: {ids: [...], tags: [...]}. GM or admin role required.
         */
        post: operations["bulk_add_system_tags_api_systems_bulk_tags_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/systems/{system_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a game system
         * @description Returns full details for a game system including all associated books grouped by category. For a container folder, `children` holds the systems nested inside it.
         */
        get: operations["get_system_api_systems__system_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update game system metadata
         * @description Updates editable fields on a game system. GM or admin role required.
         */
        patch: operations["update_system_api_systems__system_id__patch"];
        trace?: never;
    };
    "/api/systems/{system_id}/book-facets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Filter options for a system's shelf
         * @description The tags, genres, product-code prefixes and categories on the shelf.
         */
        get: operations["list_system_book_facets_api_systems__system_id__book_facets_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/systems/{system_id}/book-folders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List book folders
         * @description Returns all known book subcategory folder paths for a system and their associated tags.
         */
        get: operations["list_book_folders_api_systems__system_id__book_folders_get"];
        put?: never;
        post?: never;
        /**
         * Delete a book folder
         * @description Removes a book subcategory folder row and its tags. Pass the folder's `path` as a query parameter. GM or admin role required.
         */
        delete: operations["delete_book_folder_api_systems__system_id__book_folders_delete"];
        options?: never;
        head?: never;
        /**
         * Set tags on a book folder
         * @description Creates or replaces the tag list for a book subcategory folder. `path` must be `{system_id}/{category}/{subfolder...}` for this system. GM or admin role required.
         */
        patch: operations["update_book_folder_api_systems__system_id__book_folders_patch"];
        trace?: never;
    };
    "/api/systems/{system_id}/book-groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Folders on a system's shelf
         * @description Every category and subfolder holding books that match the shelf filters, with counts - the grouped shelf is drawn from this.
         */
        get: operations["list_system_book_groups_api_systems__system_id__book_groups_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/systems/{system_id}/books": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A page of a system's books
         * @description Books matching the shelf filters, sorted and paged. With `category` (and optionally `folder`) it lists one folder of the grouped shelf (issue #221).
         */
        get: operations["list_system_books_api_systems__system_id__books_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/systems/{system_id}/cover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * System cover image
         * @description Serves the system's folder cover art or uploaded cover image. 404 when the system has neither (clients fall back to `cover_book_id`).
         */
        get: operations["serve_system_cover_api_systems__system_id__cover_get"];
        put?: never;
        /**
         * Upload a system cover
         * @description Stores a cover image for the system. PNG/JPEG/WebP/GIF, max 10 MB. A `cover.*` file in the system's library folder still takes precedence. GM or admin role required.
         */
        post: operations["upload_system_cover_api_systems__system_id__cover_post"];
        /**
         * Remove an uploaded system cover
         * @description Deletes the uploaded cover image. Folder cover art is library-managed and is not affected. GM or admin role required.
         */
        delete: operations["delete_system_cover_api_systems__system_id__cover_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/systems/{system_id}/cover/from-source": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set a system cover from an existing image
         * @description Copies an image Grimoire already holds — a library map or token, book cover, or audio artwork — into the system cover. Body: {source_type, source_id}. A `cover.*` file in the system's library folder still takes precedence. GM or admin role required.
         */
        post: operations["set_system_cover_from_source_api_systems__system_id__cover_from_source_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/systems/{system_id}/metadata-fetch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Fetch metadata for review
         * @description Fetches one candidate's fields and diffs them against the system's current values. Writes nothing. GM or admin role required.
         */
        post: operations["fetch_metadata_api_systems__system_id__metadata_fetch_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/systems/{system_id}/metadata-search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Search a metadata source
         * @description Returns ranked candidate matches for this system from one add-on. An empty query defaults to the system's name. GM or admin role required.
         */
        post: operations["search_metadata_api_systems__system_id__metadata_search_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/systems/{system_id}/metadata-sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List metadata sources
         * @description Returns installed, enabled add-ons that can supply game system metadata. GM or admin role required.
         */
        get: operations["list_metadata_sources_api_systems__system_id__metadata_sources_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List tags
         * @description All tags, or (with ``in_use_by``) just those used on a resource type.
         *
         *     Folder-derived tags (from ``tags.json``/folder tagging) are merged in and
         *     counted by the items they cover, so they appear in the tags view alongside
         *     shared item tags. Each tag carries ``is_favorite`` for the current user.
         */
        get: operations["list_tags_api_tags_get"];
        put?: never;
        /**
         * Create a tag
         * @description Create a tag up-front (idempotent by internal key).
         */
        post: operations["create_tag_api_tags_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tags/{internal}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a tag
         * @description Delete a tag: unlink it from every resource and strip it from any folder
         *     tags. Folder-derived tags (no shared-tag row) are still handled — their folder
         *     associations are removed (a rescan may reapply them from ``tags.json``).
         */
        delete: operations["delete_tag_api_tags__internal__delete"];
        options?: never;
        head?: never;
        /**
         * Rename a tag's display value
         * @description Rename a tag. Its ``internal`` match key follows the new display when the
         *     normalized form changes (so a typo fix like ``freinds`` → ``friends`` also
         *     fixes search-by-internal); if that key already exists, the tags are merged.
         */
        patch: operations["update_tag_display_api_tags__internal__patch"];
        trace?: never;
    };
    "/api/tags/{internal}/folder-items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Items inside a tagged folder
         * @description A page of everything inside one folder carrying the tag.
         */
        get: operations["tag_folder_items_api_tags__internal__folder_items_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tags/{internal}/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Items carrying a tag
         * @description Per-type counts and the folders carrying the tag, plus a page of the items carrying it directly (`limit`/`offset`, optionally one `resource_type`). A folder's contents come from `/folder-items` (issue #221).
         */
        get: operations["tag_items_api_tags__internal__items_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tags/{internal}/merge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Merge a tag into another
         * @description Merge this tag into another: re-point all links, then delete this tag.
         */
        post: operations["merge_tag_api_tags__internal__merge_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/themes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List installed themes
         * @description The user's installed themes and their selection in one app_mode.
         */
        get: operations["list_themes_api_themes_get"];
        put?: never;
        /**
         * Install a pasted or uploaded theme
         * @description Install a theme the user pasted or uploaded.
         *
         *     Works regardless of the download kill-switch: this is the air-gapped escape
         *     hatch, and nothing here touches the network.
         */
        post: operations["import_theme_api_themes_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/themes/browse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Browse the community catalogue
         * @description The community catalogue, marking the ones this user already has.
         */
        get: operations["browse_themes_api_themes_browse_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/themes/install/{theme_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Install a theme from the catalogue
         * @description Download one theme from the catalogue into the user's account.
         */
        post: operations["install_theme_api_themes_install__theme_id__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/themes/selection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set the active mode and theme
         * @description Set the user's mode and/or active theme.
         */
        put: operations["select_theme_api_themes_selection_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/themes/source": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set the catalogue URL (admin)
         * @description Point the catalogue at a fork or mirror. Server-wide, so admin-only.
         */
        put: operations["set_theme_source_api_themes_source_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/themes/{theme_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Uninstall a theme
         * @description Uninstall one of the user's themes.
         */
        delete: operations["delete_theme_api_themes__theme_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/token-folders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List token folders
         * @description Returns all known token folder paths and their associated tags.
         */
        get: operations["list_token_folders_api_token_folders_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Set tags on a token folder
         * @description Creates or replaces the tag list for a folder path. GM or admin role required.
         */
        patch: operations["update_token_folder_api_token_folders_patch"];
        trace?: never;
    };
    "/api/token-folders/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk set token folder tags
         * @description Sets tags on many token folders in one transaction. Body: {folders: [{path, tags}]}. GM or admin role required.
         */
        post: operations["bulk_update_token_folders_api_token_folders_bulk_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/token-frames": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List token frames
         * @description Returns every frame image found in a `.frames-container` folder under the token library. Built-in frames ship with the frontend and are not listed here.
         */
        get: operations["list_token_frames_api_token_frames_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/token-frames/{frame_id}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Serve a token frame image
         * @description Serves one frame by the opaque id returned from the listing.
         */
        get: operations["serve_token_frame_api_token_frames__frame_id__file_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List tokens
         * @description Returns a paginated list of tokens.
         */
        get: operations["list_tokens_api_tokens_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tokens/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk update tokens
         * @description Applies per-token edits for many tokens in one transaction. Body: {items: [{id, description?, tags?, is_explicit?}]}. Unknown ids are reported in `errors` and skipped. GM or admin role required.
         */
        post: operations["bulk_update_tokens_api_tokens_bulk_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tokens/bulk/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bulk add tags to tokens
         * @description Additively applies tags to many tokens in one transaction. Body: {ids: [...], tags: [...]}. GM or admin role required.
         */
        post: operations["bulk_add_token_tags_api_tokens_bulk_tags_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tokens/groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Folders holding matching tokens
         * @description Every folder that holds tokens matching the filters, with how many. Takes the same filters as the list; the gallery renders folders from this and opens each with the list's `folder` parameter (issue #221).
         */
        get: operations["list_token_groups_api_tokens_groups_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tokens/{token_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a token
         * @description Returns full token metadata including folder tags.
         */
        get: operations["get_token_api_tokens__token_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update token metadata
         * @description Updates editable fields on a token (description, tags). GM or admin role required.
         */
        patch: operations["update_token_api_tokens__token_id__patch"];
        trace?: never;
    };
    "/api/tokens/{token_id}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download token file
         * @description Streams the original token image.
         */
        get: operations["serve_token_file_api_tokens__token_id__file_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tokens/{token_id}/thumbnail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Token thumbnail
         * @description Returns the pregenerated WebP thumbnail for a token. 404 if not yet generated.
         */
        get: operations["serve_token_thumbnail_api_tokens__token_id__thumbnail_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List all users */
        get: operations["list_users_api_users_get"];
        put?: never;
        /** Create a user */
        post: operations["create_user_api_users_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/guests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List guest accounts
         * @description Lists all per-campaign guest accounts with their campaign and inviter.
         */
        get: operations["list_guests_api_users_guests_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete own account */
        delete: operations["delete_own_account_api_users_me_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me/opds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get OPDS feed status
         * @description Return OPDS availability and the user's current feed URL (if enabled).
         */
        get: operations["get_opds_status_api_users_me_opds_get"];
        put?: never;
        post?: never;
        /**
         * Revoke OPDS token
         * @description Revoke the user's OPDS token. The feed URL immediately stops working.
         */
        delete: operations["revoke_opds_token_api_users_me_opds_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me/opds/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Generate/regenerate OPDS token
         * @description Generate (or regenerate) the user's OPDS token. Old token is immediately revoked.
         */
        post: operations["generate_opds_token_api_users_me_opds_generate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Change own password */
        patch: operations["change_own_password_api_users_me_password_patch"];
        trace?: never;
    };
    "/api/users/me/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update own preferences */
        patch: operations["update_own_preferences_api_users_me_preferences_patch"];
        trace?: never;
    };
    "/api/users/{user_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a user
         * @description Permanently deletes a user. Cannot delete yourself or the last admin.
         */
        delete: operations["delete_user_api_users__user_id__delete"];
        options?: never;
        head?: never;
        /**
         * Update user role or password
         * @description Change a user's role or reset their password. Cannot demote the last admin.
         */
        patch: operations["update_user_api_users__user_id__patch"];
        trace?: never;
    };
    "/api/users/{user_id}/access-grants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a user's access grants
         * @description Admin only. Lists the restricted systems/books this user has been granted.
         */
        get: operations["list_access_grants_api_users__user_id__access_grants_get"];
        put?: never;
        /**
         * Grant a user access to a restricted system or book
         * @description Admin only, and only for GMs. Re-granting an existing scope updates its level rather than erroring.
         */
        post: operations["create_access_grant_api_users__user_id__access_grants_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{user_id}/access-grants/{grant_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke an access grant
         * @description Revoke one grant.
         */
        delete: operations["delete_access_grant_api_users__user_id__access_grants__grant_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{user_id}/convert": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Convert a guest to a permanent user
         * @description Promotes a guest account to a permanent user, keeping its campaign membership and character. A password is required only when password auth is enabled.
         */
        post: operations["convert_guest_api_users__user_id__convert_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{user_id}/merge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Merge guest accounts into one account
         * @description Folds one or more guest accounts into the target account, moving their campaign memberships, notes, and characters across and deleting the emptied sources. Sources must be guests; the target may be a guest or a permanent user.
         */
        post: operations["merge_guests_api_users__user_id__merge_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/{full_path}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Serve Frontend */
        get: operations["serve_frontend__full_path__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AboutResponse */
        AboutResponse: {
            /** Commit Hash */
            commit_hash?: string | null;
            /** Python Version */
            python_version: string;
            /** Version */
            version: string;
        };
        /**
         * AccessGrantCreate
         * @description Grant a user access to one restricted system or book (issue #258).
         */
        AccessGrantCreate: {
            /**
             * Level
             * @default gm
             */
            level?: string;
            /** Scope Id */
            scope_id: string;
            /** Scope Type */
            scope_type: string;
        };
        /** AccessGrantOut */
        AccessGrantOut: {
            /** Id */
            id: string;
            /** Level */
            level: string;
            /** Scope Id */
            scope_id: string;
            /** Scope Name */
            scope_name: string;
            /** Scope Type */
            scope_type: string;
            /** User Id */
            user_id: string;
        };
        /**
         * AddonInstall
         * @description Install/update request.
         *
         *     ``approve_script`` is the operator's explicit consent to run third-party
         *     code, collected per add-on at install time. It is meaningless for YAML-only
         *     add-ons and ignored for them.
         */
        AddonInstall: {
            /**
             * Approve Script
             * @default false
             */
            approve_script?: boolean;
            /** Index Url */
            index_url?: string | null;
        };
        /** AddonListResponse */
        AddonListResponse: {
            /** Allow Scripts */
            allow_scripts: boolean;
            /** Available */
            available: components["schemas"]["AvailableAddon"][];
            /** Default Index Url */
            default_index_url: string;
            /** Index Generated */
            index_generated?: string | null;
            /** Index Url */
            index_url?: string | null;
            /** Index Urls */
            index_urls?: string[];
            /** Installed */
            installed: components["schemas"]["InstalledAddon"][];
            /** Source Contents */
            source_contents?: {
                [key: string]: string[];
            };
            /** Trusted Index Urls */
            trusted_index_urls?: string[];
        };
        /** AddonSettingsResponse */
        AddonSettingsResponse: {
            /** Allow Scripts */
            allow_scripts: boolean;
            /** Index Url */
            index_url?: string | null;
            /** Index Urls */
            index_urls?: string[];
        };
        /** AddonSettingsUpdate */
        AddonSettingsUpdate: {
            /** Allow Scripts */
            allow_scripts?: boolean | null;
            /** Index Url */
            index_url?: string | null;
            /** Index Urls */
            index_urls?: string[] | null;
        };
        /** AddonUpdate */
        AddonUpdate: {
            /** Enabled */
            enabled?: boolean | null;
            /** Script Approved */
            script_approved?: boolean | null;
        };
        /** AddonUpdateFailure */
        AddonUpdateFailure: {
            /** Error */
            error: string;
            /** Id */
            id: string;
        };
        /**
         * AddonUpdated
         * @description One add-on that updated cleanly. `from`/`to` are the two versions.
         */
        AddonUpdated: {
            /** From */
            from: string;
            /** Id */
            id: string;
            /** To */
            to: string;
        };
        /**
         * AdminCampaignOut
         * @description The minimal read-only campaign view for the admin user page.
         */
        AdminCampaignOut: {
            /** Description */
            description?: string | null;
            /** Id */
            id: string;
            /** Is Gm Campaign */
            is_gm_campaign?: boolean | null;
            /** Name */
            name: string;
            /** System Id */
            system_id?: string | null;
            /** System Name */
            system_name?: string | null;
        };
        /** ApiKeyCreate */
        ApiKeyCreate: {
            /** Expires At */
            expires_at?: string | null;
            /** Name */
            name: string;
            /** Permissions */
            permissions?: {
                [key: string]: string;
            };
        };
        /**
         * ApiKeyOut
         * @description A key as listed: everything but the secret, which is never stored.
         */
        ApiKeyOut: {
            /** Created At */
            created_at?: string | null;
            /** Expired */
            expired: boolean;
            /** Expires At */
            expires_at?: string | null;
            /** Id */
            id: string;
            /** Last Used At */
            last_used_at?: string | null;
            /** Name */
            name: string;
            /** Permissions */
            permissions: {
                [key: string]: string;
            };
            /** Prefix */
            prefix: string;
            /** User Id */
            user_id: string;
            /** Username */
            username?: string | null;
        };
        /** ApiKeyPermissionOut */
        ApiKeyPermissionOut: {
            /** Description */
            description: string;
            /** Group */
            group: string;
            /** Id */
            id: string;
            /** Levels */
            levels: string[];
            /** Tags */
            tags: string[];
        };
        /**
         * ApiKeyUpdate
         * @description Every field optional; send ``expires_at: null`` to make a key never expire.
         */
        ApiKeyUpdate: {
            /** Expires At */
            expires_at?: string | null;
            /** Name */
            name?: string | null;
            /** Permissions */
            permissions?: {
                [key: string]: string;
            } | null;
        };
        /**
         * ApiKeyWithSecret
         * @description Create/regenerate response: the only time the full key is returned.
         */
        ApiKeyWithSecret: {
            api_key: components["schemas"]["ApiKeyOut"];
            /** Key */
            key: string;
        };
        /**
         * AudioBulkItem
         * @description One Audio entry in a bulk update.
         */
        AudioBulkItem: {
            /** Description */
            description?: string | null;
            /** Id */
            id: string;
            /** Tags */
            tags?: string[] | null;
        };
        /**
         * AudioBulkUpdate
         * @description A batch of Audio updates applied in one transaction.
         */
        AudioBulkUpdate: {
            /** Items */
            items: components["schemas"]["AudioBulkItem"][];
        };
        /** AudioChapterOut */
        AudioChapterOut: {
            /** Start */
            start: number;
            /** Title */
            title: string;
        };
        /**
         * AudioChaptersResponse
         * @description `GET /audio/{id}/chapters` - empty for a track without chapter markers.
         */
        AudioChaptersResponse: {
            /** Chapters */
            chapters: components["schemas"]["AudioChapterOut"][];
        };
        /** AudioCoverResponse */
        AudioCoverResponse: {
            /** Cover Image */
            cover_image: string;
        };
        /**
         * AudioCoverSourceIn
         * @description Set a track's cover from an image Grimoire already holds (issue #286).
         *
         *     `source_type` is one of `services.image_source.SOURCE_TYPES`; the
         *     campaign-scoped `campaign_file` kind is not reachable here, since a track
         *     has no campaign context to resolve it against.
         */
        AudioCoverSourceIn: {
            /** Source Id */
            source_id: string;
            /** Source Type */
            source_type: string;
        };
        /**
         * AudioDetailResponse
         * @description `GET /audio/{id}` — the serialized track plus its folder context.
         */
        AudioDetailResponse: {
            /** Added At */
            added_at?: string | null;
            /** Album */
            album: string;
            /** Artist */
            artist: string;
            /** Description */
            description?: string | null;
            /** Disc Number */
            disc_number?: number | null;
            /** Duration */
            duration: number;
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Folder Path */
            folder_path: string;
            /** Folder Tags */
            folder_tags: string[];
            /** Has Artwork */
            has_artwork: boolean;
            /**
             * Has Cover
             * @default false
             */
            has_cover?: boolean;
            /** Id */
            id: string;
            /** Is Archive */
            is_archive: boolean;
            /** Is Missing */
            is_missing: boolean;
            /** Relative Path */
            relative_path: string;
            /** Tags */
            tags: string[];
            /** Title */
            title: string;
            /** Track Number */
            track_number?: number | null;
            /**
             * Variant Count
             * @default 0
             */
            variant_count?: number;
            /**
             * Variant Kind
             * @default
             */
            variant_kind?: string;
            /** Variant Kinds */
            variant_kinds?: string[];
            /**
             * Variant Label
             * @default
             */
            variant_label?: string;
            /**
             * Variant Main Filename
             * @default
             */
            variant_main_filename?: string;
            /** Variant Main Id */
            variant_main_id?: string | null;
            /**
             * Variant Main Kind
             * @default
             */
            variant_main_kind?: string;
            /**
             * Variant Main Label
             * @default
             */
            variant_main_label?: string;
            /** Variant Parent Id */
            variant_parent_id?: string | null;
            /**
             * Variants
             * @default []
             */
            variants?: components["schemas"]["VariantEntry"][];
        };
        /** AudioFoldersResponse */
        AudioFoldersResponse: {
            /** Folders */
            folders: components["schemas"]["backend__routers__audio___schemas__FolderTagsOut"][];
        };
        /** AudioListResponse */
        AudioListResponse: {
            /** Audio */
            audio: components["schemas"]["AudioOut"][];
            /** Total */
            total: number;
        };
        /**
         * AudioOut
         * @description One audio track, as built by `core._serialize`.
         *
         *     Columns declared `default=...` rather than `nullable=False` can still hold
         *     NULL (the default only applies at insert, and rows predating a column
         *     migration keep NULL), so those are Optional. `duration`/`title`/`artist`/
         *     `album`/`has_artwork`/`is_missing` are coalesced by the serializer
         *     (`a.duration or 0.0`, `bool(...)`) and so stay required.
         */
        AudioOut: {
            /** Added At */
            added_at?: string | null;
            /** Album */
            album: string;
            /** Artist */
            artist: string;
            /** Description */
            description?: string | null;
            /** Disc Number */
            disc_number?: number | null;
            /** Duration */
            duration: number;
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Has Artwork */
            has_artwork: boolean;
            /**
             * Has Cover
             * @default false
             */
            has_cover?: boolean;
            /** Id */
            id: string;
            /** Is Archive */
            is_archive: boolean;
            /** Is Missing */
            is_missing: boolean;
            /** Relative Path */
            relative_path: string;
            /** Tags */
            tags: string[];
            /** Title */
            title: string;
            /** Track Number */
            track_number?: number | null;
            /**
             * Variant Count
             * @default 0
             */
            variant_count?: number;
            /** Variant Kinds */
            variant_kinds?: string[];
        };
        /** AudioSetCreate */
        AudioSetCreate: {
            /**
             * Entries
             * @default []
             */
            entries?: components["schemas"]["SetEntryIn"][];
            /** Kind */
            kind: string;
            layout?: components["schemas"]["LayoutIn"] | null;
            /** Name */
            name: string;
        };
        /**
         * AudioSetOut
         * @description One saved set, as built by `core._serialize`.
         *
         *     ``entries`` lists only what the user can still play; ``missing`` counts the
         *     saved entries dropped because the track is gone from the library or is no
         *     longer shared with them. ``layout`` is null for a playlist.
         */
        AudioSetOut: {
            /** Entries */
            entries: components["schemas"]["SetEntryOut"][];
            /** Id */
            id: string;
            /** Kind */
            kind: string;
            /** Layout */
            layout?: {
                [key: string]: unknown;
            } | null;
            /** Missing */
            missing: number;
            /** Name */
            name: string;
            /** Updated At */
            updated_at?: string | null;
        };
        /**
         * AudioSetSummary
         * @description A set as listed: everything but the entries, plus a count of them.
         *
         *     The list view only needs a name and a size, and a user with many large sets
         *     should not pay for every track's metadata to render it.
         */
        AudioSetSummary: {
            /** Count */
            count: number;
            /** Id */
            id: string;
            /** Kind */
            kind: string;
            /** Layout */
            layout?: {
                [key: string]: unknown;
            } | null;
            /** Name */
            name: string;
            /** Updated At */
            updated_at?: string | null;
        };
        /**
         * AudioSetUpdate
         * @description Rename and/or re-save. ``kind`` is fixed once created.
         */
        AudioSetUpdate: {
            /** Entries */
            entries?: components["schemas"]["SetEntryIn"][] | null;
            layout?: components["schemas"]["LayoutIn"] | null;
            /** Name */
            name?: string | null;
        };
        /** AudioSetsResponse */
        AudioSetsResponse: {
            /** Sets */
            sets: components["schemas"]["AudioSetSummary"][];
        };
        /** AudioUpdate */
        AudioUpdate: {
            /** Description */
            description?: string | null;
            /** Tags */
            tags?: string[] | null;
        };
        /** AuthConfigResponse */
        AuthConfigResponse: {
            /** Custom Login Message */
            custom_login_message: string;
            /** Custom Login Message Enabled */
            custom_login_message_enabled: boolean;
            /** Guest Access Enabled */
            guest_access_enabled: boolean;
            /** Oidc Auto Launch */
            oidc_auto_launch: boolean;
            /**
             * Oidc Button Bg Color
             * @default
             */
            oidc_button_bg_color?: string;
            /**
             * Oidc Button Border Color
             * @default
             */
            oidc_button_border_color?: string;
            /**
             * Oidc Button Icon Url
             * @default
             */
            oidc_button_icon_url?: string;
            /** Oidc Button Radius */
            oidc_button_radius?: number | null;
            /** Oidc Button Text */
            oidc_button_text: string;
            /**
             * Oidc Button Text Color
             * @default
             */
            oidc_button_text_color?: string;
            /** Oidc Enabled */
            oidc_enabled: boolean;
            /** Password Auth Enabled */
            password_auth_enabled: boolean;
        };
        /** AuthMeResponse */
        AuthMeResponse: {
            /** Allow Explicit */
            allow_explicit: boolean;
            /** Api Keys Allowed */
            api_keys_allowed: boolean;
            /** Campaign Access */
            campaign_access: boolean;
            /** Display Name */
            display_name?: string | null;
            /** Email */
            email?: string | null;
            /**
             * Explicit Locked
             * @default false
             */
            explicit_locked?: boolean;
            /** Id */
            id: string;
            /** Oidc Linked */
            oidc_linked: boolean;
            /** Role */
            role?: string | null;
            /**
             * Share Links Allowed
             * @default false
             */
            share_links_allowed?: boolean;
            /** Username */
            username: string;
        };
        /** AuthStatusResponse */
        AuthStatusResponse: {
            /** Initialized */
            initialized: boolean;
            /** Password Min Length */
            password_min_length: number;
            /** Share Link Password Min Length */
            share_link_password_min_length: number;
        };
        /**
         * AvailabilityCell
         * @description One member's answer for one date. Both keys are null/False when they have
         *     not responded (the handler substitutes ``{"status": None, ...}``).
         */
        AvailabilityCell: {
            /** Is Cancelled */
            is_cancelled?: boolean | null;
            /** Status */
            status?: string | null;
        };
        /** AvailabilityOut */
        AvailabilityOut: {
            /** Cancelled Dates */
            cancelled_dates: string[];
            /** Next Sessions */
            next_sessions: string[];
            /** Rows */
            rows: components["schemas"]["AvailabilityRow"][];
        };
        /** AvailabilityRow */
        AvailabilityRow: {
            /** Dates */
            dates: {
                [key: string]: components["schemas"]["AvailabilityCell"];
            };
            /** Display Name */
            display_name?: string | null;
            /** Is Owner */
            is_owner: boolean;
            /** User Id */
            user_id: string;
            /** Username */
            username: string;
        };
        /** AvailabilitySetOut */
        AvailabilitySetOut: {
            /** Is Cancelled */
            is_cancelled?: boolean | null;
            /** Session Date */
            session_date: string;
            /** Status */
            status?: string | null;
        };
        /** AvailabilityUpdate */
        AvailabilityUpdate: {
            /** Is Cancelled */
            is_cancelled?: boolean | null;
            /** Status */
            status: string;
            /** User Id */
            user_id?: string | null;
        };
        /**
         * AvailableAddon
         * @description One row of the cached community index, as offered to the admin UI.
         *
         *     Mirrors `addons.manifest.IndexEntry`, whose optional fields all default to
         *     `""`/`False`, so none can be null.
         */
        AvailableAddon: {
            /** Author */
            author: string;
            /** Author Url */
            author_url: string;
            /** Available In */
            available_in?: {
                [key: string]: unknown;
            }[];
            /** Changelog */
            changelog?: components["schemas"]["ChangelogEntry"][] | null;
            /** Description */
            description: string;
            /** Homepage */
            homepage: string;
            /** Id */
            id: string;
            /**
             * Index Url
             * @default
             */
            index_url?: string | null;
            /** Installed */
            installed: boolean;
            /** Kind */
            kind: string;
            /** Name */
            name: string;
            /** Requires Script */
            requires_script: boolean;
            /** Script Sha256 */
            script_sha256: string;
            /**
             * Source Url
             * @default
             */
            source_url?: string | null;
            /** Target */
            target: string;
            /** Update Available */
            update_available: boolean;
            /** Version */
            version: string;
        };
        /**
         * AvailableImporter
         * @description An importer the catalogue offers that the caller does not have.
         */
        AvailableImporter: {
            /**
             * Author
             * @default
             */
            author?: string;
            /**
             * Author Url
             * @default
             */
            author_url?: string;
            /**
             * Description
             * @default
             */
            description?: string;
            /**
             * Homepage
             * @default
             */
            homepage?: string;
            /** Id */
            id: string;
            /**
             * Index Url
             * @default
             */
            index_url?: string;
            /**
             * Install As
             * @enum {string}
             */
            install_as: "user" | "server" | "settings" | "admin";
            /** Name */
            name: string;
            /**
             * Requires Script
             * @default false
             */
            requires_script?: boolean;
            /**
             * Sheet
             * @default
             */
            sheet?: string;
            /**
             * Sheet Name
             * @default
             */
            sheet_name?: string;
            /**
             * Version
             * @default
             */
            version?: string;
        };
        /**
         * BackupItem
         * @description One backup archive on disk.
         */
        BackupItem: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Filename */
            filename: string;
            /** Id */
            id: string;
            /** Size Bytes */
            size_bytes: number;
            /** Version */
            version: string;
        };
        /**
         * BackupListResponse
         * @description The backup listing, newest first, plus where they are stored.
         */
        BackupListResponse: {
            /** Backups */
            backups: components["schemas"]["BackupItem"][];
            /** Directory */
            directory: string;
            /** Total Bytes */
            total_bytes: number;
        };
        /**
         * BackupSettingsPatch
         * @description Partial update of backup settings. Omitted fields are left alone.
         */
        BackupSettingsPatch: {
            /** Backup Dir */
            backup_dir?: string | null;
            /** Backup Retention Count */
            backup_retention_count?: number | null;
            /** Backup Retention Gb */
            backup_retention_gb?: number | null;
            /** Backup Schedule */
            backup_schedule?: string | null;
            /** Backup Schedule Hour */
            backup_schedule_hour?: number | null;
            /** Backup Schedule Minute */
            backup_schedule_minute?: number | null;
            /** Backup Schedule Weekday */
            backup_schedule_weekday?: number | null;
        };
        /**
         * BackupSettingsResponse
         * @description Effective backup settings. `*_env_locked` marks fields pinned by env vars
         *     and therefore read-only in the admin UI.
         */
        BackupSettingsResponse: {
            /** Backup Dir */
            backup_dir: string;
            /** Backup Retention Count */
            backup_retention_count: number;
            /** Backup Retention Gb */
            backup_retention_gb: number;
            /** Backup Schedule */
            backup_schedule: string;
            /** Backup Schedule Hour */
            backup_schedule_hour: number;
            /** Backup Schedule Minute */
            backup_schedule_minute: number;
            /** Backup Schedule Weekday */
            backup_schedule_weekday: number;
            /** Dir Env Locked */
            dir_env_locked: boolean;
            /** Retention Count Env Locked */
            retention_count_env_locked: boolean;
            /** Retention Gb Env Locked */
            retention_gb_env_locked: boolean;
            /** Schedule Env Locked */
            schedule_env_locked: boolean;
        };
        /**
         * BannerFocusIn
         * @description Vertical focal point of the banner in the 2:1 hero: 0 (top) to 100 (bottom).
         */
        BannerFocusIn: {
            /** Focus Y */
            focus_y: number;
        };
        /** BannerFocusOut */
        BannerFocusOut: {
            /** Banner Focus Y */
            banner_focus_y: number;
        };
        /**
         * BannerSourceIn
         * @description Set the banner from an image Grimoire already holds (issue #286).
         *
         *     `source_type` is one of the kinds `services.image_source.SOURCE_TYPES`
         *     accepts; `campaign_file` resolves against this campaign's own uploads.
         */
        BannerSourceIn: {
            /** Source Id */
            source_id: string;
            /** Source Type */
            source_type: string;
        };
        /** BannerUploadOut */
        BannerUploadOut: {
            /** Banner Path */
            banner_path: string;
        };
        /** Body_duplicate_member_sheet_api_campaigns__campaign_id__members__member_id__sheet_duplicate_post */
        Body_duplicate_member_sheet_api_campaigns__campaign_id__members__member_id__sheet_duplicate_post: {
            /** Source Id */
            source_id: string;
            /** Source Type */
            source_type: string;
        };
        /** Body_import_wiki_api_campaigns__campaign_id__wiki_import_post */
        Body_import_wiki_api_campaigns__campaign_id__wiki_import_post: {
            /** File */
            file?: string | null;
            /**
             * Files
             * @default []
             */
            files?: string[];
            /**
             * Paths
             * @default []
             */
            paths?: string[];
        };
        /** Body_upload_audio_cover_api_audio__audio_id__cover_post */
        Body_upload_audio_cover_api_audio__audio_id__cover_post: {
            /** File */
            file: string;
        };
        /** Body_upload_banner_api_campaigns__campaign_id__banner_post */
        Body_upload_banner_api_campaigns__campaign_id__banner_post: {
            /** File */
            file: string;
        };
        /** Body_upload_campaign_file_api_campaigns__campaign_id__files_post */
        Body_upload_campaign_file_api_campaigns__campaign_id__files_post: {
            /**
             * Category Id
             * @default
             */
            category_id?: string;
            /** File */
            file: string;
            /**
             * New Category Name
             * @default
             */
            new_category_name?: string;
        };
        /** Body_upload_campaign_image_api_campaigns__campaign_id__images_post */
        Body_upload_campaign_image_api_campaigns__campaign_id__images_post: {
            /**
             * Category Id
             * @default
             */
            category_id?: string;
            /** File */
            file: string;
            /**
             * New Category Name
             * @default
             */
            new_category_name?: string;
        };
        /** Body_upload_file_api_files_upload_post */
        Body_upload_file_api_files_upload_post: {
            /** Destination */
            destination: string;
            /** File */
            file: string;
            /**
             * On Conflict
             * @default rename
             */
            on_conflict?: string;
            /**
             * Relative Dir
             * @default
             */
            relative_dir?: string;
        };
        /** Body_upload_image_api_characters__character_id__images__field__post */
        Body_upload_image_api_characters__character_id__images__field__post: {
            /** File */
            file: string;
        };
        /** Body_upload_member_art_api_campaigns__campaign_id__members__member_id__art_post */
        Body_upload_member_art_api_campaigns__campaign_id__members__member_id__art_post: {
            /** File */
            file: string;
        };
        /** Body_upload_member_sheet_api_campaigns__campaign_id__members__member_id__sheet_post */
        Body_upload_member_sheet_api_campaigns__campaign_id__members__member_id__sheet_post: {
            /** File */
            file: string;
        };
        /** Body_upload_member_token_api_campaigns__campaign_id__members__member_id__token_post */
        Body_upload_member_token_api_campaigns__campaign_id__members__member_id__token_post: {
            /** File */
            file: string;
        };
        /** Body_upload_oidc_button_icon_api_settings_oidc_button_icon_post */
        Body_upload_oidc_button_icon_api_settings_oidc_button_icon_post: {
            /** File */
            file: string;
        };
        /** Body_upload_portrait_api_characters__character_id__portrait_post */
        Body_upload_portrait_api_characters__character_id__portrait_post: {
            /** File */
            file: string;
        };
        /** Body_upload_system_cover_api_systems__system_id__cover_post */
        Body_upload_system_cover_api_systems__system_id__cover_post: {
            /** File */
            file: string;
        };
        /** Body_upload_wiki_template_api_campaigns__campaign_id__wiki_templates_upload_post */
        Body_upload_wiki_template_api_campaigns__campaign_id__wiki_templates_upload_post: {
            /** File */
            file: string;
        };
        /**
         * BookBulkItem
         * @description One Book entry in a bulk update.
         */
        BookBulkItem: {
            /** Access Level */
            access_level?: string | null;
            /** Artists */
            artists?: string[] | null;
            /** Authors */
            authors?: string[] | null;
            /** Category */
            category?: string | null;
            /** Codex Id */
            codex_id?: string | null;
            /** Day */
            day?: number | null;
            /** Description */
            description?: string | null;
            /** Genres */
            genres?: string[] | null;
            /** Id */
            id: string;
            /** Is Explicit */
            is_explicit?: boolean | null;
            /** Isbn */
            isbn?: string | null;
            /** Language */
            language?: string | null;
            /** License */
            license?: string | null;
            /** Month */
            month?: number | null;
            /** Product Code */
            product_code?: string | null;
            /** Publisher */
            publisher?: string | null;
            /** Publisher Url */
            publisher_url?: string | null;
            /** Tags */
            tags?: string[] | null;
            /** Title */
            title?: string | null;
            /** Urls */
            urls?: components["schemas"]["LinkEntry"][] | null;
            /** Version */
            version?: string | null;
            /** Year */
            year?: number | null;
        };
        /**
         * BookBulkUpdate
         * @description A batch of Book updates applied in one transaction.
         */
        BookBulkUpdate: {
            /** Items */
            items: components["schemas"]["BookBulkItem"][];
        };
        /**
         * BookDetail
         * @description One book, as built by `core.get_book`.
         */
        BookDetail: {
            /** Added At */
            added_at?: string | null;
            /** Artists */
            artists: string[];
            /** Authors */
            authors: string[];
            /** Category */
            category?: string | null;
            /** Codex Id */
            codex_id?: string | null;
            /** Content Token */
            content_token?: string | null;
            /** Day */
            day?: number | null;
            /** Description */
            description?: string | null;
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            game_system?: components["schemas"]["BookSystemRef"] | null;
            /** Genres */
            genres: string[];
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Id */
            id: string;
            /** Index Failed */
            index_failed?: boolean | null;
            /** Indexed */
            indexed?: boolean | null;
            /** Is Explicit */
            is_explicit: boolean;
            /** Is Missing */
            is_missing: boolean;
            /** Isbn */
            isbn: string;
            /** Language */
            language: string;
            /** License */
            license: string;
            /** Mime Type */
            mime_type?: string | null;
            /** Month */
            month?: number | null;
            /** Ocr Dpi */
            ocr_dpi?: number | null;
            /** Ocr Indexed */
            ocr_indexed: boolean;
            /**
             * Ocr Pages Skipped
             * @default 0
             */
            ocr_pages_skipped?: number;
            /** Ocr Pending */
            ocr_pending: boolean;
            /** Page Count */
            page_count?: number | null;
            /**
             * Product Code
             * @default
             */
            product_code?: string;
            /** Publisher */
            publisher?: string | null;
            /** Publisher Url */
            publisher_url?: string | null;
            /** Relative Path */
            relative_path?: string | null;
            /** Tags */
            tags: string[];
            /** Title */
            title: string;
            /** Urls */
            urls: components["schemas"]["LinkRef"][];
            /**
             * Variant Kind
             * @default
             */
            variant_kind?: string;
            /**
             * Variant Label
             * @default
             */
            variant_label?: string;
            /**
             * Variant Main Filename
             * @default
             */
            variant_main_filename?: string;
            /** Variant Main Id */
            variant_main_id?: string | null;
            /**
             * Variant Main Kind
             * @default
             */
            variant_main_kind?: string;
            /**
             * Variant Main Label
             * @default
             */
            variant_main_label?: string;
            /** Variant Parent Id */
            variant_parent_id?: string | null;
            /**
             * Variants
             * @default []
             */
            variants?: components["schemas"]["VariantEntry"][];
            /** Version */
            version: string;
            /** Year */
            year?: number | null;
        };
        /** BookFolderOut */
        BookFolderOut: {
            /** Path */
            path: string;
            /** Tags */
            tags: string[];
        };
        /** BookFolderUpdate */
        BookFolderUpdate: {
            /** Path */
            path: string;
            /** Tags */
            tags: string[];
        };
        /** BookFoldersResponse */
        BookFoldersResponse: {
            /** Folders */
            folders: components["schemas"]["BookFolderOut"][];
        };
        /**
         * BookListItem
         * @description One row of `list_books` — a deliberately smaller shape than `get_book`.
         */
        BookListItem: {
            /** Added At */
            added_at?: string | null;
            /** Category */
            category?: string | null;
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Game System Id */
            game_system_id?: string | null;
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Id */
            id: string;
            /** Index Failed */
            index_failed?: boolean | null;
            /** Indexed */
            indexed?: boolean | null;
            /** Is Explicit */
            is_explicit: boolean;
            /** Is Missing */
            is_missing: boolean;
            /** Mime Type */
            mime_type?: string | null;
            /** Ocr Indexed */
            ocr_indexed: boolean;
            /** Page Count */
            page_count?: number | null;
            /** Title */
            title: string;
            /**
             * Variant Count
             * @default 0
             */
            variant_count?: number;
        };
        /** BookListResponse */
        BookListResponse: {
            /** Books */
            books: components["schemas"]["BookListItem"][];
            /** Total */
            total: number;
        };
        /**
         * BookOut
         * @description One book, as built by `_serializers.serialize_book`.
         *
         *     The variant count comes from the mixin, so this row carries the same
         *     "has other versions" signal as the /books list rows do.
         */
        BookOut: {
            /** Added At */
            added_at?: string | null;
            /** Artists */
            artists: string[];
            /** Authors */
            authors: string[];
            /** Category */
            category?: string | null;
            /** Codex Id */
            codex_id?: string | null;
            /** Day */
            day?: number | null;
            /** Description */
            description?: string | null;
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Genres */
            genres: string[];
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Id */
            id: string;
            /** Index Error */
            index_error?: string | null;
            /** Index Failed */
            index_failed?: boolean | null;
            /** Indexed */
            indexed?: boolean | null;
            /** Is Explicit */
            is_explicit: boolean;
            /** Is Missing */
            is_missing: boolean;
            /** Isbn */
            isbn: string;
            /** Language */
            language: string;
            /** License */
            license: string;
            /** Mime Type */
            mime_type?: string | null;
            /** Month */
            month?: number | null;
            /** Ocr Dpi */
            ocr_dpi?: number | null;
            /** Ocr Indexed */
            ocr_indexed: boolean;
            /**
             * Ocr Pages Skipped
             * @default 0
             */
            ocr_pages_skipped?: number;
            /** Page Count */
            page_count?: number | null;
            /**
             * Product Code
             * @default
             */
            product_code?: string;
            /** Publisher */
            publisher?: string | null;
            /** Publisher Url */
            publisher_url?: string | null;
            /** Relative Path */
            relative_path: string;
            /** Tags */
            tags: string[];
            /** Title */
            title: string;
            /** Urls */
            urls: components["schemas"]["LinkRef"][];
            /**
             * Variant Count
             * @default 0
             */
            variant_count?: number;
            /** Variant Kinds */
            variant_kinds?: string[];
            /** Version */
            version: string;
            /** Year */
            year?: number | null;
        };
        /**
         * BookSystemRef
         * @description The book's game system, or null when it belongs to none.
         */
        BookSystemRef: {
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Slug */
            slug: string;
        };
        /** BookUpdate */
        BookUpdate: {
            /** Access Level */
            access_level?: string | null;
            /** Artists */
            artists?: string[] | null;
            /** Authors */
            authors?: string[] | null;
            /** Category */
            category?: string | null;
            /** Codex Id */
            codex_id?: string | null;
            /** Day */
            day?: number | null;
            /** Description */
            description?: string | null;
            /** Genres */
            genres?: string[] | null;
            /** Is Explicit */
            is_explicit?: boolean | null;
            /** Isbn */
            isbn?: string | null;
            /** Language */
            language?: string | null;
            /** License */
            license?: string | null;
            /** Month */
            month?: number | null;
            /** Product Code */
            product_code?: string | null;
            /** Publisher */
            publisher?: string | null;
            /** Publisher Url */
            publisher_url?: string | null;
            /** Tags */
            tags?: string[] | null;
            /** Title */
            title?: string | null;
            /** Urls */
            urls?: components["schemas"]["LinkEntry"][] | null;
            /** Version */
            version?: string | null;
            /** Year */
            year?: number | null;
        };
        /** BookmarkCreate */
        BookmarkCreate: {
            /** Book Id */
            book_id: string;
            /**
             * Label
             * @default
             */
            label?: string | null;
            /**
             * Notes
             * @default
             */
            notes?: string | null;
            /** Page Number */
            page_number: number;
            /** Selected Text */
            selected_text?: string | null;
        };
        /**
         * BookmarkOut
         * @description One bookmark, as built by `_helpers._serialize`.
         */
        BookmarkOut: {
            /** Book Id */
            book_id: string;
            /** Created At */
            created_at: string;
            /** Id */
            id: string;
            /** Label */
            label?: string | null;
            /** Notes */
            notes: string;
            /** Page Number */
            page_number: number;
            /** Selected Text */
            selected_text?: string | null;
        };
        /** BookmarkUpdate */
        BookmarkUpdate: {
            /** Label */
            label: string;
            /** Notes */
            notes?: string | null;
        };
        /**
         * BrowseEntry
         * @description One row in a folder listing — a folder or an indexed/unindexed file.
         */
        BrowseEntry: {
            /**
             * Accepts Container Kind
             * @default false
             */
            accepts_container_kind?: boolean;
            /**
             * Accepts Frames Marker
             * @default false
             */
            accepts_frames_marker?: boolean;
            /**
             * Category Host
             * @default false
             */
            category_host?: boolean;
            /** Child Count */
            child_count?: number | null;
            /** Collection */
            collection?: string | null;
            /** Container Kind */
            container_kind?: string | null;
            /**
             * Frames Container
             * @default false
             */
            frames_container?: boolean;
            /**
             * Has Thumbnail
             * @default false
             */
            has_thumbnail?: boolean;
            /** Is Dir */
            is_dir: boolean;
            /**
             * Is Missing
             * @default false
             */
            is_missing?: boolean;
            /** Name */
            name: string;
            /**
             * Nsfw
             * @default false
             */
            nsfw?: boolean;
            /** Path */
            path: string;
            /** Record Id */
            record_id?: string | null;
            /** Size */
            size?: number | null;
            /** Title */
            title?: string | null;
            /**
             * Unreadable Name
             * @default false
             */
            unreadable_name?: boolean;
        };
        /** BrowseResponse */
        BrowseResponse: {
            /**
             * Category Host
             * @default false
             */
            category_host?: boolean;
            /**
             * Children Accept Container Kind
             * @default false
             */
            children_accept_container_kind?: boolean;
            /**
             * Children Accept Frames Marker
             * @default false
             */
            children_accept_frames_marker?: boolean;
            /** Entries */
            entries: components["schemas"]["BrowseEntry"][];
            /** Parent */
            parent?: string | null;
            /** Path */
            path: string;
            /** Singletons Taken */
            singletons_taken?: {
                [key: string]: string;
            };
            /**
             * Total
             * @default 0
             */
            total?: number;
            /**
             * Truncated
             * @default false
             */
            truncated?: boolean;
            /** Writable */
            writable: boolean;
        };
        /**
         * BuiltInTheme
         * @description A theme bundled with the app — named here, coloured in the stylesheet.
         */
        BuiltInTheme: {
            /** App Mode */
            app_mode: string;
            /** Id */
            id: string;
            /** Name */
            name: string;
        };
        /**
         * BulkAddTags
         * @description Additively apply ``tags`` to every id in ``ids``.
         *
         *     Backs the bulk action bar's tag input. Additive by design: it never removes
         *     tags an item already carries.
         */
        BulkAddTags: {
            /** Ids */
            ids: string[];
            /** Tags */
            tags: string[];
        };
        /**
         * BulkFolderTags
         * @description Set tags on many folder paths at once (maps/tokens/audio folder tagging).
         */
        BulkFolderTags: {
            /** Folders */
            folders: components["schemas"]["FolderTagsEntry"][];
        };
        /** BulkItemError */
        BulkItemError: {
            /** Detail */
            detail: string;
            /** Id */
            id: string;
        };
        /**
         * BulkResult
         * @description ``run_bulk_update``'s response: no ``tags`` key.
         *
         *     Kept separate from :class:`BulkTagResult` rather than carrying an optional
         *     ``tags`` field, because an ``Optional`` field is *materialised* as an
         *     explicit ``tags: null`` by the response serializer — adding a key these
         *     endpoints never returned. Use :class:`BulkTagResult` for the add-tags
         *     routes, which really do return it.
         */
        BulkResult: {
            /** Errors */
            errors: components["schemas"]["BulkItemError"][];
            /** Updated */
            updated: string[];
        };
        /**
         * BulkTagResult
         * @description ``run_bulk_add_tags``'s response: the base shape plus per-id display tags.
         */
        BulkTagResult: {
            /** Errors */
            errors: components["schemas"]["BulkItemError"][];
            /** Tags */
            tags: {
                [key: string]: string[];
            };
            /** Updated */
            updated: string[];
        };
        /**
         * CalendarSubscriptionOut
         * @description The caller's ICS subscription state.
         *
         *     Every URL is null unless the user has minted a token *and* BASE_URL names a
         *     real public origin — a feed URL built from the localhost default would be
         *     unreachable from the calendar app that has to poll it.
         */
        CalendarSubscriptionOut: {
            /** Base Url Configured */
            base_url_configured: boolean;
            /** Campaign Feed Url */
            campaign_feed_url?: string | null;
            /** Feed Url */
            feed_url?: string | null;
            /** Has Token */
            has_token: boolean;
            /** Webcal Url */
            webcal_url?: string | null;
        };
        /** CampaignArchive */
        CampaignArchive: {
            /** Archived */
            archived: boolean;
        };
        /**
         * CampaignCategoryOut
         * @description One GM-defined category, from ``categories._serialize``.
         */
        CampaignCategoryOut: {
            /** Icon */
            icon?: string | null;
            /** Icon Color */
            icon_color?: string | null;
            /** Id */
            id: string;
            /** Kind */
            kind: string;
            /** Name */
            name: string;
            /** Sort Order */
            sort_order?: number | null;
        };
        /**
         * CampaignConvert
         * @description Promote a personal campaign to a GM-run (group) one.
         *
         *     One-way by design: the reverse would strand members, guests, and the
         *     schedule, none of which a personal campaign can hold. ``gm_title`` is
         *     optional and defaults to the campaign's existing title.
         */
        CampaignConvert: {
            /** Gm Title */
            gm_title?: string | null;
        };
        /** CampaignCreate */
        CampaignCreate: {
            /**
             * Description
             * @default
             */
            description?: string;
            /**
             * Gm Title
             * @default Game Master
             */
            gm_title?: string;
            /**
             * Is Gm Campaign
             * @default false
             */
            is_gm_campaign?: boolean;
            /** Name */
            name: string;
            /** Parent Campaign Id */
            parent_campaign_id?: string | null;
            /** Resources */
            resources?: components["schemas"]["CampaignResourceInput"][] | null;
            /** System Id */
            system_id?: string | null;
            /** System Name */
            system_name?: string | null;
        };
        /**
         * CampaignInviteOut
         * @description One pending invitation from ``list_invites``.
         */
        CampaignInviteOut: {
            /** Campaign Id */
            campaign_id: string;
            /** Description */
            description?: string | null;
            /** Name */
            name: string;
            /** Owner Display Name */
            owner_display_name: string;
        };
        /**
         * CampaignMemberOut
         * @description One row of ``_helpers.build_members`` / ``core._members``.
         *
         *     Three shapes share this model: the GM owner row, a player row, and the
         *     lighter row ``list_campaigns`` builds. Only the keys common to all of them
         *     are required; everything a single shape omits is Optional.
         */
        CampaignMemberOut: {
            /** Campaign Access */
            campaign_access?: boolean | null;
            /** Character Name */
            character_name?: string | null;
            /** Character Sheet Filename */
            character_sheet_filename?: string | null;
            /** Character Sheet Url */
            character_sheet_url?: string | null;
            /** Display Name */
            display_name?: string | null;
            /** Guest Code */
            guest_code?: string | null;
            /** Has Art */
            has_art?: boolean | null;
            /** Has Sheet */
            has_sheet?: boolean | null;
            /** Has Token */
            has_token?: boolean | null;
            /** Id */
            id?: string | null;
            /** Is Guest */
            is_guest?: boolean | null;
            /** Is Owner */
            is_owner?: boolean | null;
            /** Status */
            status?: string | null;
            /** User Id */
            user_id: string;
            /** Username */
            username: string;
        };
        /**
         * CampaignOut
         * @description A campaign as built by ``_helpers.serialize_campaign``.
         *
         *     ``invitation_status`` and ``resources`` are added by individual handlers
         *     (``list_campaigns`` and ``get_campaign`` respectively) rather than by the
         *     serializer, so both are Optional.
         */
        CampaignOut: {
            /** Archived At */
            archived_at?: string | null;
            /**
             * Banner Focus Y
             * @default 50
             */
            banner_focus_y?: number;
            /** Created At */
            created_at: string;
            /** Description */
            description?: string | null;
            /** Gm Title */
            gm_title?: string | null;
            /** Has Banner */
            has_banner: boolean;
            /** Has Schedule */
            has_schedule: boolean;
            /** Id */
            id: string;
            /** Invitation Status */
            invitation_status?: string | null;
            /** Is Archived */
            is_archived: boolean;
            /** Is Gm Campaign */
            is_gm_campaign?: boolean | null;
            /** Last Accessed At */
            last_accessed_at?: string | null;
            /** Locked */
            locked: boolean;
            /** Members */
            members: components["schemas"]["CampaignMemberOut"][];
            /** Name */
            name: string;
            /** Next Session */
            next_session?: string | null;
            /** Owner Display Name */
            owner_display_name: string;
            /** Owner Has Campaign Access */
            owner_has_campaign_access: boolean;
            /** Owner Id */
            owner_id: string;
            /** Parent Campaign Id */
            parent_campaign_id?: string | null;
            /** Resource Group Order */
            resource_group_order: string[];
            /** Resources */
            resources?: components["schemas"]["CampaignResourceRef"][] | null;
            /** System Display Name */
            system_display_name: string;
            /** System Id */
            system_id?: string | null;
            /** System Name */
            system_name?: string | null;
            /** Updated At */
            updated_at: string;
        };
        /** CampaignResourceInput */
        CampaignResourceInput: {
            /** Resource Id */
            resource_id: string;
            /** Resource Type */
            resource_type: string;
            /** Shared User Ids */
            shared_user_ids?: string[] | null;
            /**
             * Visibility
             * @default gm
             */
            visibility?: string;
        };
        /**
         * CampaignResourceRef
         * @description The trimmed resource rows embedded in ``get_campaign``'s payload.
         */
        CampaignResourceRef: {
            /** Category Id */
            category_id?: string | null;
            /** Id */
            id: string;
            /** Resource Id */
            resource_id: string;
            /** Resource Type */
            resource_type: string;
            /** Visibility */
            visibility?: string | null;
        };
        /** CampaignUpdate */
        CampaignUpdate: {
            /** Description */
            description?: string | null;
            /** Gm Title */
            gm_title?: string | null;
            /** Name */
            name?: string | null;
            /** Parent Campaign Id */
            parent_campaign_id?: string | null;
            /** System Id */
            system_id?: string | null;
            /** System Name */
            system_name?: string | null;
        };
        /**
         * CatalogEntry
         * @description One catalog entry as the browser lists it.
         */
        CatalogEntry: {
            /** Content Type */
            content_type: string;
            /** Data */
            data?: {
                [key: string]: unknown;
            };
            /**
             * Display
             * @default
             */
            display?: string;
            /** Entry Id */
            entry_id: string;
            /** Name */
            name: string;
            /**
             * Owner Name
             * @default
             */
            owner_name?: string;
            /** Row Id */
            row_id?: string | null;
            /**
             * Ruleset
             * @default false
             */
            ruleset?: boolean;
            /** Ruleset Id */
            ruleset_id?: string | null;
            /**
             * Ruleset Name
             * @default
             */
            ruleset_name?: string;
            /** Source */
            source: string;
        };
        /** CatalogResponse */
        CatalogResponse: {
            /** Entries */
            entries: components["schemas"]["CatalogEntry"][];
            /** Filters Available */
            filters_available?: {
                [key: string]: components["schemas"]["FilterOption"][];
            };
            /** Page */
            page: number;
            /** Page Size */
            page_size: number;
            /** Total */
            total: number;
        };
        /** CatalogueFolderOut */
        CatalogueFolderOut: {
            /** Name */
            name: string;
            /** Path */
            path: string;
            /** Templates */
            templates: components["schemas"]["CatalogueTemplateOut"][];
        };
        /**
         * CataloguePack
         * @description One content pack the community catalogue offers.
         *
         *     ``id`` is namespaced by its source so two catalogues offering the same pack
         *     stay distinct; ``pack_id`` is what the pack calls itself, and what it
         *     installs as.
         */
        CataloguePack: {
            /**
             * Attribution
             * @default
             */
            attribution?: string;
            /** Content Types */
            content_types?: string[];
            /**
             * Description
             * @default
             */
            description?: string;
            /**
             * Entry Count
             * @default 0
             */
            entry_count?: number;
            /** Files */
            files?: components["schemas"]["CataloguePackFile"][];
            /** Id */
            id: string;
            /**
             * Index Url
             * @default
             */
            index_url?: string;
            /**
             * Installed
             * @default false
             */
            installed?: boolean;
            /**
             * Installed Version
             * @default
             */
            installed_version?: string;
            /**
             * License
             * @default
             */
            license?: string;
            /**
             * License Url
             * @default
             */
            license_url?: string;
            /** Name */
            name: string;
            /** Pack Id */
            pack_id: string;
            /**
             * Schema Id
             * @default
             */
            schema_id?: string;
            /**
             * Source Url
             * @default
             */
            source_url?: string;
            /**
             * Total Bytes
             * @default 0
             */
            total_bytes?: number;
            /**
             * Update Available
             * @default false
             */
            update_available?: boolean;
            /**
             * Version
             * @default
             */
            version?: string;
        };
        /** CataloguePackFile */
        CataloguePackFile: {
            /**
             * Bytes
             * @default 0
             */
            bytes?: number;
            /** Name */
            name: string;
            /** Path */
            path: string;
            /** Sha256 */
            sha256: string;
        };
        /**
         * CatalogueSheet
         * @description One sheet the community catalogue offers.
         *
         *     ``id`` is namespaced by its source so two catalogues offering the same
         *     sheet stay distinct; ``raw_id`` is what the sheet calls itself.
         */
        CatalogueSheet: {
            /**
             * Attribution
             * @default
             */
            attribution?: string;
            /**
             * Author
             * @default
             */
            author?: string;
            /**
             * Author Url
             * @default
             */
            author_url?: string;
            /**
             * Custom Layout
             * @default false
             */
            custom_layout?: boolean;
            /**
             * Description
             * @default
             */
            description?: string;
            /**
             * Field Count
             * @default 0
             */
            field_count?: number;
            /**
             * Grimoire Min Version
             * @default
             */
            grimoire_min_version?: string;
            /**
             * Homepage
             * @default
             */
            homepage?: string;
            /** Id */
            id: string;
            /**
             * Index Url
             * @default
             */
            index_url?: string;
            /**
             * Installed
             * @default false
             */
            installed?: boolean;
            /**
             * Layout Path
             * @default
             */
            layout_path?: string;
            /**
             * Layout Sha256
             * @default
             */
            layout_sha256?: string;
            /**
             * License
             * @default
             */
            license?: string;
            /**
             * License Url
             * @default
             */
            license_url?: string;
            /** Name */
            name: string;
            /**
             * Path
             * @default
             */
            path?: string;
            /**
             * Raw Id
             * @default
             */
            raw_id?: string;
            /**
             * Sha256
             * @default
             */
            sha256?: string;
            /**
             * Styles Path
             * @default
             */
            styles_path?: string;
            /**
             * Styles Sha256
             * @default
             */
            styles_sha256?: string;
            /**
             * System
             * @default
             */
            system?: string;
            /**
             * Version
             * @default
             */
            version?: string;
        };
        /**
         * CatalogueSourceError
         * @description A configured source that could not be read.
         */
        CatalogueSourceError: {
            /** Error */
            error: string;
            /** Url */
            url: string;
        };
        /**
         * CatalogueTemplateOut
         * @description One community template entry, from ``catalogue.build_tree``.
         *
         *     Every field is bounded/coalesced to a string by ``_clean_str`` there.
         */
        CatalogueTemplateOut: {
            /** Author */
            author: string;
            /** Author Url */
            author_url: string;
            /**
             * Available In
             * @default []
             */
            available_in?: {
                [key: string]: unknown;
            }[];
            /** Category */
            category: string;
            /** Description */
            description: string;
            /** Id */
            id: string;
            /** Index Url */
            index_url?: string | null;
            /** Name */
            name: string;
            /** System */
            system: string;
            /** Version */
            version: string;
        };
        /**
         * CatalogueTheme
         * @description One catalogue row from `services.themes.list_entries`.
         *
         *     Every field is coerced to a bounded string or list there, so none can be
         *     null. `installed` is stamped on by the handler after the fact.
         */
        CatalogueTheme: {
            /** App Mode */
            app_mode: string;
            /** Author */
            author: string;
            /** Author Url */
            author_url: string;
            /** Description */
            description: string;
            /** Grimoire Min Version */
            grimoire_min_version: string;
            /** Id */
            id: string;
            /** Index Url */
            index_url: string;
            /** Installed */
            installed: boolean;
            /** Mode */
            mode: string;
            /** Modes */
            modes: string[];
            /** Name */
            name: string;
            /** Path */
            path: string;
            /** Sha256 */
            sha256: string;
            /** Version */
            version: string;
        };
        /** CategoryCreate */
        CategoryCreate: {
            /** Icon */
            icon?: string | null;
            /** Icon Color */
            icon_color?: string | null;
            /** Kind */
            kind: string;
            /** Name */
            name: string;
        };
        /** CategoryReorder */
        CategoryReorder: {
            /** Ordered Ids */
            ordered_ids: string[];
        };
        /** CategoryUpdate */
        CategoryUpdate: {
            /** Icon */
            icon?: string | null;
            /** Icon Color */
            icon_color?: string | null;
            /** Name */
            name?: string | null;
        };
        /** ChangelogEntry */
        ChangelogEntry: {
            /** Changes */
            changes: string[];
            /** Version */
            version: string;
        };
        /** ChangelogRelease */
        ChangelogRelease: {
            /** Date */
            date?: string | null;
            /** Sections */
            sections: components["schemas"]["ChangelogSection"][];
            /** Summary */
            summary?: string | null;
            /** Version */
            version: string;
        };
        /**
         * ChangelogResponse
         * @description Newest release first. Empty when the image ships without a changelog.
         */
        ChangelogResponse: {
            /** Releases */
            releases: components["schemas"]["ChangelogRelease"][];
        };
        /**
         * ChangelogSection
         * @description One category of entries within a release (``Added``, ``Fixed``, …).
         */
        ChangelogSection: {
            /** Entries */
            entries: string[];
            /** Title */
            title: string;
        };
        /** CharacterCreate */
        CharacterCreate: {
            /** Campaign Id */
            campaign_id?: string | null;
            /** Data */
            data?: {
                [key: string]: unknown;
            };
            /**
             * Name
             * @default
             */
            name?: string;
            /** Schema Ref */
            schema_ref: string;
        };
        /** CharacterDeletedResponse */
        CharacterDeletedResponse: {
            /**
             * Deleted
             * @default true
             */
            deleted?: boolean;
            /** Id */
            id: string;
        };
        /**
         * CharacterDetail
         * @description A character with its values, derived values, and any validator results.
         */
        CharacterDetail: {
            /** Campaign Id */
            campaign_id?: string | null;
            /** Campaign Name */
            campaign_name?: string | null;
            /** Computed */
            computed?: {
                [key: string]: unknown;
            };
            /** Created At */
            created_at?: string | null;
            /** Data */
            data?: {
                [key: string]: unknown;
            };
            /** Entries */
            entries?: {
                [key: string]: unknown;
            };
            /** Id */
            id: string;
            /** Name */
            name: string;
            /**
             * Owned
             * @default true
             */
            owned?: boolean;
            portrait_crop?: components["schemas"]["PortraitCrop"] | null;
            /** Portrait Path */
            portrait_path?: string | null;
            /** Portrait Version */
            portrait_version?: number | null;
            /**
             * Schema Missing
             * @default false
             */
            schema_missing?: boolean;
            /**
             * Schema Name
             * @default
             */
            schema_name?: string;
            /** Schema Ref */
            schema_ref: string;
            /**
             * Status
             * @default active
             */
            status?: string;
            /**
             * System
             * @default
             */
            system?: string;
            /** Updated At */
            updated_at?: string | null;
            /** Validators */
            validators?: components["schemas"]["ValidatorResult"][];
        };
        /**
         * CharacterExport
         * @description A self-contained character file.
         *
         *     Every reference is denormalised into `entries`, and the schema travels with
         *     it, so the file opens on an instance that has neither the pack nor the
         *     ruleset content it was built from.
         */
        CharacterExport: {
            /**
             * $Schema
             * @default
             */
            $schema?: string;
            /** Data */
            data?: {
                [key: string]: unknown;
            };
            /** Entries */
            entries?: {
                [key: string]: unknown;
            };
            /** Images */
            images?: {
                [key: string]: string;
            };
            /**
             * Name
             * @default
             */
            name?: string;
            /** Portrait */
            portrait?: string | null;
            portrait_crop?: components["schemas"]["PortraitCrop"] | null;
            /** Schema */
            schema?: {
                [key: string]: unknown;
            };
            /**
             * Schema Id
             * @default
             */
            schema_id?: string;
            /**
             * Status
             * @default active
             */
            status?: string;
        };
        /** CharacterImport */
        CharacterImport: {
            /**
             * Import Entries
             * @default true
             */
            import_entries?: boolean;
            /** Payload */
            payload: {
                [key: string]: unknown;
            };
        };
        /** CharacterListResponse */
        CharacterListResponse: {
            /** Characters */
            characters: components["schemas"]["CharacterSummary"][];
        };
        /**
         * CharacterSummary
         * @description One character, without its data — enough for the list view.
         */
        CharacterSummary: {
            /** Campaign Id */
            campaign_id?: string | null;
            /** Campaign Name */
            campaign_name?: string | null;
            /** Created At */
            created_at?: string | null;
            /** Id */
            id: string;
            /** Name */
            name: string;
            /**
             * Owned
             * @default true
             */
            owned?: boolean;
            portrait_crop?: components["schemas"]["PortraitCrop"] | null;
            /** Portrait Path */
            portrait_path?: string | null;
            /** Portrait Version */
            portrait_version?: number | null;
            /**
             * Schema Missing
             * @default false
             */
            schema_missing?: boolean;
            /**
             * Schema Name
             * @default
             */
            schema_name?: string;
            /** Schema Ref */
            schema_ref: string;
            /**
             * Status
             * @default active
             */
            status?: string;
            /**
             * System
             * @default
             */
            system?: string;
            /** Updated At */
            updated_at?: string | null;
        };
        /** CharacterUpdate */
        CharacterUpdate: {
            /** Campaign Id */
            campaign_id?: string | null;
            /** Data */
            data?: {
                [key: string]: unknown;
            } | null;
            /** Name */
            name?: string | null;
            portrait_crop?: components["schemas"]["PortraitCrop"] | null;
            /** Status */
            status?: string | null;
            /** Unset */
            unset?: string[];
        };
        /**
         * CleanupCounts
         * @description Per-collection counts of DB rows removed for missing files.
         */
        CleanupCounts: {
            /** Audio */
            audio: number;
            /** Books */
            books: number;
            /** Maps */
            maps: number;
            /** Systems */
            systems: number;
            /** Tokens */
            tokens: number;
        };
        /** CleanupResponse */
        CleanupResponse: {
            removed: components["schemas"]["CleanupCounts"];
        };
        /** CodexAccount */
        CodexAccount: {
            /** Name */
            name: string;
            /** Role */
            role: string;
        };
        /** CodexSettingsResponse */
        CodexSettingsResponse: {
            /** Locked */
            locked: string[];
            /** Send Hashes */
            send_hashes: boolean;
            /** Url */
            url: string;
        };
        /** CodexSettingsUpdate */
        CodexSettingsUpdate: {
            /** Send Hashes */
            send_hashes?: boolean | null;
            /** Url */
            url?: string | null;
        };
        /** CodexStatus */
        CodexStatus: {
            /** Enabled */
            enabled: boolean;
            /** Url */
            url: string;
        };
        /** CodexSubmit */
        CodexSubmit: {
            /** Fields */
            fields?: string[] | null;
            /**
             * Note
             * @default
             */
            note?: string;
        };
        /** CodexSubmitResponse */
        CodexSubmitResponse: {
            /** Codex Id */
            codex_id?: string | null;
            /** Edit Url */
            edit_url: string;
            /** Linked */
            linked: boolean;
            /** Status */
            status: string;
        };
        /** CodexTestResponse */
        CodexTestResponse: {
            account?: components["schemas"]["CodexAccount"] | null;
            /** Ok */
            ok: boolean;
            /** Url */
            url: string;
        };
        /** CompareDifference */
        CompareDifference: {
            /** Field */
            field: string;
            /** Same */
            same: boolean;
            /** Values */
            values: (string | null)[];
        };
        /**
         * CompareItem
         * @description One side of a side-by-side comparison.
         */
        CompareItem: {
            /** Content Hash */
            content_hash?: string | null;
            /** Created At */
            created_at?: string | null;
            /** Description */
            description?: string | null;
            /** File Size */
            file_size: number;
            /** Filename */
            filename: string;
            /** Game System Id */
            game_system_id?: string | null;
            /** Game System Name */
            game_system_name?: string | null;
            /**
             * Has Thumbnail
             * @default false
             */
            has_thumbnail?: boolean;
            /** Id */
            id: string;
            /**
             * Is Missing
             * @default false
             */
            is_missing?: boolean;
            /** Mime Type */
            mime_type?: string | null;
            /** Page Count */
            page_count?: number | null;
            /**
             * Reference Counts
             * @default {}
             */
            reference_counts?: {
                [key: string]: number;
            };
            /** Relative Path */
            relative_path: string;
            /**
             * Suggested Kind
             * @default
             */
            suggested_kind?: string;
            /**
             * Suggested Label
             * @default
             */
            suggested_label?: string;
            /**
             * Tags
             * @default []
             */
            tags?: string[];
            /** Title */
            title?: string | null;
            /**
             * Variant Kind
             * @default
             */
            variant_kind?: string;
            /**
             * Variant Label
             * @default
             */
            variant_label?: string;
            variant_main?: components["schemas"]["VariantMain"] | null;
            /** Variant Parent Id */
            variant_parent_id?: string | null;
            /**
             * Variants
             * @default []
             */
            variants?: components["schemas"]["VariantEntry"][];
        };
        /** CompareResult */
        CompareResult: {
            /** Differences */
            differences: components["schemas"]["CompareDifference"][];
            /** Items */
            items: components["schemas"]["CompareItem"][];
            /**
             * Page Count Min
             * @default 0
             */
            page_count_min?: number;
            /**
             * Resource Type
             * @enum {string}
             */
            resource_type: "book" | "map" | "token" | "audio" | "model";
            /** Suggested Parent Id */
            suggested_parent_id?: string | null;
        };
        /** ContentTypeListResponse */
        ContentTypeListResponse: {
            /** Content Types */
            content_types: components["schemas"]["ContentTypeSummary"][];
        };
        /**
         * ContentTypeSummary
         * @description A content type a schema declares, for building the browser's chrome.
         */
        ContentTypeSummary: {
            /**
             * Compact Display
             * @default
             */
            compact_display?: string;
            /**
             * Entry Count
             * @default 0
             */
            entry_count?: number;
            /** Fields */
            fields?: {
                [key: string]: unknown;
            };
            /** Filter Fields */
            filter_fields?: string[];
            /**
             * Icon
             * @default
             */
            icon?: string;
            /**
             * Identity Field
             * @default name
             */
            identity_field?: string;
            /**
             * Label
             * @default
             */
            label?: string;
            /**
             * Label Plural
             * @default
             */
            label_plural?: string;
            /** Name */
            name: string;
            /** Search Fields */
            search_fields?: string[];
            /** Sort Default */
            sort_default?: string[];
        };
        /** CreateFolderRequest */
        CreateFolderRequest: {
            /**
             * Container Kind
             * @default
             */
            container_kind?: string;
            /**
             * Frames Container
             * @default false
             */
            frames_container?: boolean;
            /** Name */
            name: string;
            /**
             * Nsfw
             * @default false
             */
            nsfw?: boolean;
            /** Parent */
            parent: string;
        };
        /** DeleteFolderRequest */
        DeleteFolderRequest: {
            /** Confirm Name */
            confirm_name?: string | null;
            /** Path */
            path: string;
        };
        /**
         * DeleteItemRequest
         * @description ``reparent_to`` is required when the item being deleted has variants.
         *
         *     Empty string means "promote them all to standalone entries"; an id names
         *     which variant inherits the others. Both are explicit so deleting a parent can
         *     never silently hide its children.
         */
        DeleteItemRequest: {
            /**
             * Delete File
             * @default true
             */
            delete_file?: boolean;
            /** Reparent To */
            reparent_to?: string | null;
        };
        /** DeleteItemResult */
        DeleteItemResult: {
            /** File Deleted */
            file_deleted: boolean;
            /** Id */
            id: string;
            /** Path */
            path: string;
            /**
             * Reparented
             * @default 0
             */
            reparented?: number;
        };
        /**
         * DeleteRequest
         * @description A file or folder to remove, with the typed-name guard for full folders.
         */
        DeleteRequest: {
            /** Confirm Name */
            confirm_name?: string | null;
            /**
             * Delete Files
             * @default false
             */
            delete_files?: boolean;
            /** Path */
            path: string;
        };
        /**
         * DeleteResponse
         * @description What the delete actually removed, for the confirmation message.
         */
        DeleteResponse: {
            /**
             * Files
             * @default 0
             */
            files?: number;
            /**
             * Files Deleted
             * @default true
             */
            files_deleted?: boolean;
            /** Path */
            path: string;
            /**
             * Records
             * @default 0
             */
            records?: number;
        };
        /** DeletedResponse */
        DeletedResponse: {
            /**
             * Deleted
             * @default true
             */
            deleted?: boolean;
            /** Id */
            id: string;
        };
        /**
         * DescribeRequest
         * @description Rename one family member in the picker, from either end.
         *
         *     For a variant this is the kind/label a link set. For a main version it is
         *     what replaces "Main version"; an empty kind and label restore that.
         */
        DescribeRequest: {
            /** Id */
            id: string;
            /**
             * Kind
             * @default
             */
            kind?: string;
            /**
             * Label
             * @default
             */
            label?: string;
            /**
             * Resource Type
             * @enum {string}
             */
            resource_type: "book" | "map" | "token" | "audio" | "model";
        };
        /** DescribeResult */
        DescribeResult: {
            /** Id */
            id: string;
            /** Kind */
            kind: string;
            /** Label */
            label: string;
        };
        /** DetectShapesResponse */
        DetectShapesResponse: {
            /** Shapes */
            shapes: components["schemas"]["DetectedShape"][];
        };
        /** DetectedShape */
        DetectedShape: {
            /** H */
            h: number;
            /**
             * Shape
             * @enum {string}
             */
            shape: "rect" | "ellipse";
            /** W */
            w: number;
            /** X */
            x: number;
            /** Y */
            y: number;
        };
        /** DiceMaterialCreate */
        DiceMaterialCreate: {
            /**
             * Group
             * @default Custom
             */
            group?: string | null;
            /** Name */
            name: string;
        };
        /**
         * DiceMaterialOut
         * @description Dice/materials add a picker grouping label, coalesced to "Custom".
         */
        DiceMaterialOut: {
            /** Group */
            group: string;
            /** Id */
            id: string;
            /** Is Default */
            is_default: boolean;
            /** Name */
            name: string;
            /** Sort Order */
            sort_order: number;
        };
        /** DiceMaterialsResponse */
        DiceMaterialsResponse: {
            /** Dice Materials */
            dice_materials: components["schemas"]["DiceMaterialOut"][];
        };
        /** DiscoverRequest */
        DiscoverRequest: {
            /** Issuer Url */
            issuer_url: string;
        };
        /**
         * DiscoverResponse
         * @description The endpoint URLs pulled out of the IdP's discovery document.
         *
         *     The handler defaults each key to `""` / `[]` when absent, but the document
         *     itself is untrusted third-party JSON: an IdP that emits an explicit
         *     `"userinfo_endpoint": null` would pass that null straight through, so every
         *     field is Optional rather than a strict `str`.
         */
        DiscoverResponse: {
            /** Authorization Endpoint */
            authorization_endpoint?: string | null;
            /** End Session Endpoint */
            end_session_endpoint?: string | null;
            /** Id Token Signing Alg Values Supported */
            id_token_signing_alg_values_supported?: string[] | null;
            /** Issuer */
            issuer?: string | null;
            /** Jwks Uri */
            jwks_uri?: string | null;
            /** Token Endpoint */
            token_endpoint?: string | null;
            /** Userinfo Endpoint */
            userinfo_endpoint?: string | null;
        };
        /** DismissRequest */
        DismissRequest: {
            /** Member Ids */
            member_ids: string[];
            /**
             * Note
             * @default
             */
            note?: string;
            /**
             * Resource Type
             * @enum {string}
             */
            resource_type: "book" | "map" | "token" | "audio" | "model";
        };
        /** DismissalListResponse */
        DismissalListResponse: {
            /**
             * Dismissals
             * @default []
             */
            dismissals?: components["schemas"]["DismissalOut"][];
        };
        /** DismissalOut */
        DismissalOut: {
            /** Created At */
            created_at?: string | null;
            /** Id */
            id: string;
            /**
             * Member Ids
             * @default []
             */
            member_ids?: string[];
            /**
             * Member Names
             * @default []
             */
            member_names?: string[];
            /**
             * Note
             * @default
             */
            note?: string;
            /** Resource Type */
            resource_type: string;
        };
        /** DuplicateGroupOut */
        DuplicateGroupOut: {
            /** Confidence */
            confidence: number;
            /**
             * Edges
             * @default []
             */
            edges?: components["schemas"]["GroupEdge"][];
            /** Id */
            id: string;
            /**
             * Members
             * @default []
             */
            members?: components["schemas"]["GroupMember"][];
            /**
             * Reason Text
             * @default
             */
            reason_text?: string;
            /**
             * Reasons
             * @default []
             */
            reasons?: string[];
            /** Resource Type */
            resource_type: string;
            /** Suggested Parent Id */
            suggested_parent_id?: string | null;
        };
        /**
         * EligibleMemberOut
         * @description One invitable user from ``eligible_members``.
         */
        EligibleMemberOut: {
            /** Already Invited */
            already_invited: boolean;
            /** Campaign Access */
            campaign_access: boolean;
            /** Display Name */
            display_name?: string | null;
            /** Id */
            id: string;
            /** Role */
            role?: string | null;
            /** Username */
            username: string;
        };
        /** EntryCreate */
        EntryCreate: {
            /** Content Type */
            content_type: string;
            /** Data */
            data?: {
                [key: string]: unknown;
            };
            /**
             * Entry Id
             * @default
             */
            entry_id?: string;
            /** Forked From */
            forked_from?: string | null;
        };
        /** EntryUpdate */
        EntryUpdate: {
            /** Data */
            data?: {
                [key: string]: unknown;
            } | null;
        };
        /** ExportRegionIn */
        ExportRegionIn: {
            /** H */
            h: number;
            /**
             * Name
             * @default
             */
            name?: string;
            /** Pages */
            pages: number[];
            /**
             * Shape
             * @default rect
             * @enum {string}
             */
            shape?: "rect" | "ellipse";
            /** W */
            w: number;
            /** X */
            x: number;
            /** Y */
            y: number;
        };
        /** ExportRequest */
        ExportRequest: {
            /**
             * Dpi
             * @default 150
             */
            dpi?: number;
            /**
             * Format
             * @default pdf
             * @enum {string}
             */
            format?: "pdf" | "png" | "jpeg" | "webp";
            /**
             * Join Spreads
             * @default false
             */
            join_spreads?: boolean;
            /**
             * Kind
             * @enum {string}
             */
            kind: "pages" | "regions";
            /**
             * Pages
             * @default
             */
            pages?: string;
            /** Regions */
            regions?: components["schemas"]["ExportRegionIn"][];
            /**
             * Spread Offset
             * @default 0
             * @enum {integer}
             */
            spread_offset?: 0 | 1;
        };
        /**
         * ExternalCharacterImport
         * @description Another tool's character: a file's text, or a link to it.
         *
         *     ``importer_id`` is optional - the importer that recognises the file or
         *     link is chosen automatically, and naming one only settles a tie.
         */
        ExternalCharacterImport: {
            /** Campaign Id */
            campaign_id?: string | null;
            /**
             * Filename
             * @default
             */
            filename?: string;
            /** Importer Id */
            importer_id?: string | null;
            /** Inputs */
            inputs?: {
                [key: string]: string;
            };
            /**
             * Text
             * @default
             */
            text?: string;
            /**
             * Url
             * @default
             */
            url?: string;
        };
        /** FavoriteAudioItem */
        FavoriteAudioItem: {
            /** Duration */
            duration: number;
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Has Artwork */
            has_artwork: boolean;
            /** Item Id */
            item_id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            item_type: "audio";
            /** Tags */
            tags: string[];
            /** Title */
            title: string;
        };
        /** FavoriteBookItem */
        FavoriteBookItem: {
            /** Category */
            category?: string | null;
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Index Failed */
            index_failed?: boolean | null;
            /** Indexed */
            indexed?: boolean | null;
            /** Item Id */
            item_id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            item_type: "book";
            /** Page Count */
            page_count?: number | null;
            /** Title */
            title: string;
        };
        /** FavoriteIn */
        FavoriteIn: {
            /** Item Id */
            item_id: string;
            /** Item Type */
            item_type: string;
        };
        /** FavoriteMapItem */
        FavoriteMapItem: {
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Item Id */
            item_id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            item_type: "map";
            /** Tags */
            tags: string[];
        };
        /** FavoriteModelItem */
        FavoriteModelItem: {
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /**
             * Is Presupported
             * @default false
             */
            is_presupported?: boolean;
            /**
             * Is Unsupported
             * @default false
             */
            is_unsupported?: boolean;
            /** Item Id */
            item_id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            item_type: "model";
            /** Tags */
            tags: string[];
            /** Triangle Count */
            triangle_count?: number | null;
        };
        /**
         * FavoriteRef
         * @description Bare (type, id) pair — one per stored favorite row, including rows whose
         *     target has since been deleted and so has no entry in `items`.
         */
        FavoriteRef: {
            /** Item Id */
            item_id: string;
            /** Item Type */
            item_type: string;
        };
        /** FavoriteSystemItem */
        FavoriteSystemItem: {
            /** Container Kind */
            container_kind: string;
            /** Cover Book Id */
            cover_book_id?: string | null;
            /** Has Cover */
            has_cover: boolean;
            /** Item Id */
            item_id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            item_type: "system";
            /** Name */
            name: string;
            /** Publishers */
            publishers: components["schemas"]["PublisherRef"][];
        };
        /** FavoriteTagItem */
        FavoriteTagItem: {
            /** Count */
            count: number;
            /** Display */
            display: string;
            /** Internal */
            internal: string;
            /** Item Id */
            item_id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            item_type: "tag";
        };
        /** FavoriteTokenItem */
        FavoriteTokenItem: {
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Item Id */
            item_id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            item_type: "token";
            /** Tags */
            tags: string[];
        };
        /** FavoritesResponse */
        FavoritesResponse: {
            /** Favorites */
            favorites: components["schemas"]["FavoriteRef"][];
            /** Items */
            items: (components["schemas"]["FavoriteBookItem"] | components["schemas"]["FavoriteMapItem"] | components["schemas"]["FavoriteTokenItem"] | components["schemas"]["FavoriteAudioItem"] | components["schemas"]["FavoriteModelItem"] | components["schemas"]["FavoriteSystemItem"] | components["schemas"]["FavoriteTagItem"])[];
        };
        /** FilterOption */
        FilterOption: {
            /** Count */
            count: number;
            /** Value */
            value: unknown;
        };
        /**
         * FolderContentsResponse
         * @description Whether a folder holds anything, so the UI knows which guard to show.
         */
        FolderContentsResponse: {
            /** Has Content */
            has_content: boolean;
            /** Name */
            name: string;
            /** Path */
            path: string;
        };
        /**
         * FolderGroup
         * @description One folder holding matching items.
         */
        FolderGroup: {
            /** Count */
            count: number;
            /** Path */
            path: string;
        };
        /**
         * FolderGroupsResponse
         * @description Every folder holding items that match the filters, with counts.
         */
        FolderGroupsResponse: {
            /** Groups */
            groups: components["schemas"]["FolderGroup"][];
            /** Total */
            total: number;
        };
        /**
         * FolderResponse
         * @description A folder's location and what it declares about itself on disk.
         */
        FolderResponse: {
            /**
             * Container Kind
             * @default
             */
            container_kind?: string;
            /**
             * Frames Container
             * @default false
             */
            frames_container?: boolean;
            /** Markers */
            markers?: string[];
            /** Name */
            name?: string | null;
            /**
             * Nsfw
             * @default false
             */
            nsfw?: boolean;
            /** Path */
            path: string;
        };
        /** FolderTagsEntry */
        FolderTagsEntry: {
            /** Path */
            path: string;
            /** Tags */
            tags: string[];
        };
        /** FolderTagsUpdate */
        FolderTagsUpdate: {
            /** Path */
            path: string;
            /** Tags */
            tags: string[];
        };
        /**
         * ForkRequest
         * @description Copy a catalogue entry into a ruleset you can edit.
         */
        ForkRequest: {
            /** Content Type */
            content_type: string;
            /** Entry Id */
            entry_id: string;
            /**
             * Source
             * @default
             */
            source?: string;
        };
        /** FrameListResponse */
        FrameListResponse: {
            /** Frames */
            frames: components["schemas"]["FrameOut"][];
        };
        /**
         * FrameOut
         * @description One user-supplied frame image discovered under a ``.frames-container`` directory.
         */
        FrameOut: {
            /** Format */
            format: string;
            /**
             * Group
             * @default
             */
            group?: string;
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Token Id */
            token_id?: string | null;
            /**
             * Variants
             * @default []
             */
            variants?: components["schemas"]["FrameVariantOut"][];
        };
        /**
         * FrameVariantOut
         * @description One other version of a frame — a black-and-white cut, a recolour, an errata pass.
         *
         *     Deliberately the same ``id``/``name`` shape as a frame itself: a version is a
         *     real frame file the editor composites exactly like any other, so the picker
         *     hands it to the same image URL builder rather than taking a second path.
         */
        FrameVariantOut: {
            /**
             * Format
             * @default
             */
            format?: string;
            /**
             * Group
             * @default
             */
            group?: string;
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Token Id */
            token_id?: string | null;
            /**
             * Variant Kind
             * @default
             */
            variant_kind?: string;
            /**
             * Variant Label
             * @default
             */
            variant_label?: string;
        };
        /**
         * GMNoteOut
         * @description ``upsert_gm_note`` echoes both halves of the stored GM note back.
         */
        GMNoteOut: {
            /** External Content */
            external_content?: string | null;
            /** Internal Content */
            internal_content?: string | null;
        };
        /** GMNoteUpdate */
        GMNoteUpdate: {
            /** External Content */
            external_content?: string | null;
            /** Internal Content */
            internal_content?: string | null;
        };
        /**
         * GMSessionNoteOut
         * @description The GM note block on ``get_session``.
         *
         *     Every key is Optional: the handler returns ``{}`` when the session has no GM
         *     note at all, and omits ``internal_content`` entirely for non-owners.
         */
        GMSessionNoteOut: {
            /** External Content */
            external_content?: string | null;
            /** Internal Content */
            internal_content?: string | null;
            /** Updated At */
            updated_at?: string | null;
        };
        /**
         * GameSystemBulkItem
         * @description One GameSystem entry in a bulk update.
         */
        GameSystemBulkItem: {
            /** Access Level */
            access_level?: string | null;
            /** Character Builder Url */
            character_builder_url?: string | null;
            /** Character Builder Urls */
            character_builder_urls?: components["schemas"]["LinkEntry"][] | null;
            /** Codex Id */
            codex_id?: string | null;
            /** Cover Book Id */
            cover_book_id?: string | null;
            /** Description */
            description?: string | null;
            /** Dice Materials */
            dice_materials?: string[] | null;
            /** Edition */
            edition?: string | null;
            /** Genre */
            genre?: string | null;
            /** Genres */
            genres?: string[] | null;
            /** Id */
            id: string;
            /** Is Explicit */
            is_explicit?: boolean | null;
            /** License */
            license?: string | null;
            /** Name */
            name?: string | null;
            /** Parent System */
            parent_system?: string | null;
            /** Publishers */
            publishers?: components["schemas"]["PublisherEntry"][] | null;
            /** System Family */
            system_family?: string | null;
            /** Tags */
            tags?: string[] | null;
            /** Urls */
            urls?: components["schemas"]["LinkEntry"][] | null;
            /** Year */
            year?: number | null;
        };
        /**
         * GameSystemBulkUpdate
         * @description A batch of GameSystem updates applied in one transaction.
         */
        GameSystemBulkUpdate: {
            /** Items */
            items: components["schemas"]["GameSystemBulkItem"][];
        };
        /** GameSystemUpdate */
        GameSystemUpdate: {
            /** Access Level */
            access_level?: string | null;
            /** Character Builder Url */
            character_builder_url?: string | null;
            /** Character Builder Urls */
            character_builder_urls?: components["schemas"]["LinkEntry"][] | null;
            /** Codex Id */
            codex_id?: string | null;
            /** Cover Book Id */
            cover_book_id?: string | null;
            /** Description */
            description?: string | null;
            /** Dice Materials */
            dice_materials?: string[] | null;
            /** Edition */
            edition?: string | null;
            /** Genre */
            genre?: string | null;
            /** Genres */
            genres?: string[] | null;
            /** Is Explicit */
            is_explicit?: boolean | null;
            /** License */
            license?: string | null;
            /** Name */
            name?: string | null;
            /** Parent System */
            parent_system?: string | null;
            /** Publishers */
            publishers?: components["schemas"]["PublisherEntry"][] | null;
            /** System Family */
            system_family?: string | null;
            /** Tags */
            tags?: string[] | null;
            /** Urls */
            urls?: components["schemas"]["LinkEntry"][] | null;
            /** Year */
            year?: number | null;
        };
        /** GenreCreate */
        GenreCreate: {
            /** Name */
            name: string;
            /** Parent Id */
            parent_id?: string | null;
        };
        /**
         * GenreOut
         * @description One genre, as built by `_helpers.serialize_genre`.
         */
        GenreOut: {
            /** Id */
            id: string;
            /** Is Default */
            is_default: boolean;
            /** Name */
            name: string;
            /** Parent Id */
            parent_id?: string | null;
            /** Sort Order */
            sort_order: number;
        };
        /** GenresResponse */
        GenresResponse: {
            /** Genres */
            genres: components["schemas"]["GenreOut"][];
        };
        /**
         * GroupEdge
         * @description One pairwise match inside a group — the unit review actually works in.
         */
        GroupEdge: {
            /** A */
            a: string;
            /** B */
            b: string;
            /**
             * Reason
             * @default
             */
            reason?: string;
            /**
             * Score
             * @default 0
             */
            score?: number;
        };
        /**
         * GroupListResponse
         * @description A page of candidate groups from the most recent completed scan.
         */
        GroupListResponse: {
            /**
             * Groups
             * @default []
             */
            groups?: components["schemas"]["DuplicateGroupOut"][];
            /** Scan Id */
            scan_id?: string | null;
            /**
             * Total
             * @default 0
             */
            total?: number;
        };
        /**
         * GroupMember
         * @description One candidate inside a group, with everything the review row shows.
         */
        GroupMember: {
            /** Content Hash */
            content_hash?: string | null;
            /**
             * File Size
             * @default 0
             */
            file_size?: number;
            /** Filename */
            filename: string;
            /** Game System Name */
            game_system_name?: string | null;
            /**
             * Has Thumbnail
             * @default false
             */
            has_thumbnail?: boolean;
            /** Id */
            id: string;
            /**
             * Is Missing
             * @default false
             */
            is_missing?: boolean;
            /** Page Count */
            page_count?: number | null;
            /**
             * Reference Counts
             * @default {}
             */
            reference_counts?: {
                [key: string]: number;
            };
            /** Relative Path */
            relative_path: string;
            /**
             * Suggested Kind
             * @default other
             */
            suggested_kind?: string;
            /**
             * Suggested Label
             * @default
             */
            suggested_label?: string;
            /** Title */
            title?: string | null;
        };
        /**
         * GuestConvert
         * @description Promote a guest to a permanent account. Password is optional because it's
         *     only applied when password auth is enabled (validated in the handler).
         */
        GuestConvert: {
            /** Password */
            password?: string | null;
            /**
             * Role
             * @default player
             */
            role?: string;
            /** Username */
            username: string;
        };
        /** GuestCreate */
        GuestCreate: {
            /**
             * Nickname
             * @default
             */
            nickname?: string;
        };
        /** GuestLoginRequest */
        GuestLoginRequest: {
            /** Code */
            code: string;
        };
        /**
         * GuestLoginResponse
         * @description Guest login adds the campaign the invite code was scoped to.
         */
        GuestLoginResponse: {
            /** Campaign Id */
            campaign_id: string;
            /** Token */
            token: string;
            user: components["schemas"]["LoginUser"];
        };
        /**
         * GuestMerge
         * @description Fold one or more guest accounts into a single target account.
         *
         *     The same person invited to several campaigns ends up with one guest account
         *     per campaign; this collapses them so they have a single login.
         */
        GuestMerge: {
            /** Source Ids */
            source_ids: string[];
        };
        /**
         * GuestMergeResponse
         * @description The surviving account plus what the merge moved and removed.
         */
        GuestMergeResponse: {
            /** Display Name */
            display_name?: string | null;
            /** Id */
            id: string;
            /** Memberships Moved */
            memberships_moved: number;
            /** Merged Ids */
            merged_ids: string[];
        };
        /**
         * GuestShareTemplateOut
         * @description Copy-paste share text and links for a guest invite code.
         */
        GuestShareTemplateOut: {
            /** Code */
            code?: string | null;
            /** Discord Message */
            discord_message: string;
            /** Link */
            link: string;
            /** Mailto Url */
            mailto_url: string;
            /** Message */
            message: string;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /**
         * HealthChecks
         * @description Per-dependency status. `database` is always probed; `valkey` only appears
         *     when a Valkey/Redis cache is configured, so it is Optional.
         */
        HealthChecks: {
            /** Database */
            database: string;
            /** Valkey */
            valkey?: string | null;
        };
        /** HealthResponse */
        HealthResponse: {
            checks: components["schemas"]["HealthChecks"];
            /** Status */
            status: string;
        };
        /** ImageFieldResponse */
        ImageFieldResponse: {
            /** Field */
            field: string;
            /** Value */
            value: string;
        };
        /**
         * ImportRequest
         * @description Add entries to a ruleset, from a pack document or an installed pack.
         */
        ImportRequest: {
            /**
             * Conflict
             * @default skip
             */
            conflict?: string;
            /** Document */
            document?: {
                [key: string]: unknown;
            } | null;
            /**
             * Pack Id
             * @default
             */
            pack_id?: string;
            /**
             * Text
             * @default
             */
            text?: string;
        };
        /** ImportResponse */
        ImportResponse: {
            /** Failed */
            failed?: {
                [key: string]: unknown;
            }[];
            /**
             * Imported
             * @default 0
             */
            imported?: number;
            /**
             * Overwritten
             * @default 0
             */
            overwritten?: number;
            /**
             * Renamed
             * @default 0
             */
            renamed?: number;
            /**
             * Skipped
             * @default 0
             */
            skipped?: number;
        };
        /**
         * ImportedCharacter
         * @description The new character, and what the import could not match.
         */
        ImportedCharacter: {
            /** Campaign Id */
            campaign_id?: string | null;
            /** Campaign Name */
            campaign_name?: string | null;
            /** Computed */
            computed?: {
                [key: string]: unknown;
            };
            /** Created At */
            created_at?: string | null;
            /** Data */
            data?: {
                [key: string]: unknown;
            };
            /** Entries */
            entries?: {
                [key: string]: unknown;
            };
            /** Id */
            id: string;
            /**
             * Importer Id
             * @default
             */
            importer_id?: string;
            /**
             * Importer Name
             * @default
             */
            importer_name?: string;
            /** Name */
            name: string;
            /**
             * Owned
             * @default true
             */
            owned?: boolean;
            portrait_crop?: components["schemas"]["PortraitCrop"] | null;
            /** Portrait Path */
            portrait_path?: string | null;
            /** Portrait Version */
            portrait_version?: number | null;
            /**
             * Schema Missing
             * @default false
             */
            schema_missing?: boolean;
            /**
             * Schema Name
             * @default
             */
            schema_name?: string;
            /** Schema Ref */
            schema_ref: string;
            /**
             * Status
             * @default active
             */
            status?: string;
            /**
             * System
             * @default
             */
            system?: string;
            /** Unmatched */
            unmatched?: string[];
            /** Updated At */
            updated_at?: string | null;
            /** Validators */
            validators?: components["schemas"]["ValidatorResult"][];
        };
        /**
         * ImporterInputSummary
         * @description A field the import dialog shows for an importer - an API key, say.
         */
        ImporterInputSummary: {
            /**
             * Help
             * @default
             */
            help?: string;
            /** Key */
            key: string;
            /** Label */
            label: string;
            /**
             * Required
             * @default false
             */
            required?: boolean;
            /**
             * Secret
             * @default false
             */
            secret?: boolean;
            /**
             * When
             * @default always
             * @enum {string}
             */
            when?: "always" | "file" | "link";
        };
        /** ImporterListResponse */
        ImporterListResponse: {
            /** Available */
            available?: components["schemas"]["AvailableImporter"][];
            /**
             * Downloads Enabled
             * @default true
             */
            downloads_enabled?: boolean;
            /** Importers */
            importers: components["schemas"]["ImporterSummary"][];
        };
        /**
         * ImporterSummary
         * @description One installed character-importer add-on, as the import dialog shows it.
         */
        ImporterSummary: {
            /**
             * Accepts Files
             * @default false
             */
            accepts_files?: boolean;
            /**
             * Accepts Url
             * @default false
             */
            accepts_url?: boolean;
            /**
             * Attribution
             * @default
             */
            attribution?: string;
            /**
             * Author
             * @default
             */
            author?: string;
            /**
             * Author Url
             * @default
             */
            author_url?: string;
            /**
             * Available Version
             * @default
             */
            available_version?: string;
            /**
             * Description
             * @default
             */
            description?: string;
            /** Extensions */
            extensions?: string[];
            /**
             * Homepage
             * @default
             */
            homepage?: string;
            /** Id */
            id: string;
            /** Inputs */
            inputs?: components["schemas"]["ImporterInputSummary"][];
            /** Name */
            name: string;
            /**
             * Scope
             * @default server
             * @enum {string}
             */
            scope?: "server" | "user";
            /** Sheet */
            sheet: string;
            /**
             * Sheet Installed
             * @default false
             */
            sheet_installed?: boolean;
            /**
             * Sheet Name
             * @default
             */
            sheet_name?: string;
            /**
             * Url Hint
             * @default
             */
            url_hint?: string;
            /**
             * Version
             * @default
             */
            version?: string;
        };
        /**
         * InstallablePack
         * @description A filesystem content pack that can be copied into a ruleset.
         */
        InstallablePack: {
            /**
             * Attribution
             * @default
             */
            attribution?: string;
            /**
             * Description
             * @default
             */
            description?: string;
            /**
             * Entry Count
             * @default 0
             */
            entry_count?: number;
            /**
             * License
             * @default
             */
            license?: string;
            /**
             * License Url
             * @default
             */
            license_url?: string;
            /** Name */
            name: string;
            /** Pack Id */
            pack_id: string;
            /** Schema Id */
            schema_id: string;
            /**
             * Version
             * @default
             */
            version?: string;
        };
        /** InstallablePackListResponse */
        InstallablePackListResponse: {
            /** Packs */
            packs: components["schemas"]["InstallablePack"][];
        };
        /**
         * InstalledAddon
         * @description One installed add-on, as built by `addons.registry.describe`.
         *
         *     Every field is read off a validated `AddonManifest` (whose optional strings
         *     default to `""`, never null) or coerced by `describe` itself, so nothing
         *     here can be absent. `available_version`/`update_available` are seeded to
         *     `""`/`False` by `describe` and overwritten by the list handler when the
         *     add-on also appears in the cached index — a hand-placed add-on keeps the
         *     seeded values rather than dropping the keys.
         */
        InstalledAddon: {
            /** Attribution */
            attribution: string;
            /** Author */
            author: string;
            /** Author Url */
            author_url: string;
            /** Available In */
            available_in?: {
                [key: string]: unknown;
            }[];
            /** Available Version */
            available_version: string;
            /** Blocked Reason */
            blocked_reason: string;
            /** Changelog */
            changelog?: components["schemas"]["ChangelogEntry"][] | null;
            /** Description */
            description: string;
            /** Enabled */
            enabled: boolean;
            /** Homepage */
            homepage: string;
            /** Id */
            id: string;
            /**
             * Index Url
             * @default
             */
            index_url?: string | null;
            /** Kind */
            kind: string;
            /** Name */
            name: string;
            /** Requires Script */
            requires_script: boolean;
            /** Runnable */
            runnable: boolean;
            /** Script Approved */
            script_approved: boolean;
            /** Source */
            source: string;
            /**
             * Source Url
             * @default
             */
            source_url?: string | null;
            /** Target */
            target: string;
            /** Update Available */
            update_available: boolean;
            /** Version */
            version: string;
        };
        /** InstalledPack */
        InstalledPack: {
            /**
             * Entry Count
             * @default 0
             */
            entry_count?: number;
            /**
             * Name
             * @default
             */
            name?: string;
            /** Pack Id */
            pack_id: string;
            /**
             * Schema Id
             * @default
             */
            schema_id?: string;
        };
        /**
         * InstalledTheme
         * @description One of the user's installed themes, as built by `core._serialize`.
         *
         *     `mode` and `app_mode` are coalesced by the serializer (`theme.mode or
         *     "dark"`), and `variants`/`modes`/`is_community` are always computed, so
         *     those stay required. The three `source_*` columns are null for a theme the
         *     user authored rather than downloaded, and `tokens` falls back to
         *     `sanitize_tokens(theme.tokens)`, which returns nothing for a row whose
         *     tokens are empty or unrecognised.
         */
        InstalledTheme: {
            /** App Mode */
            app_mode: string;
            /** Id */
            id: string;
            /** Is Community */
            is_community: boolean;
            /** Mode */
            mode: string;
            /** Modes */
            modes: string[];
            /** Name */
            name: string;
            /** Source Id */
            source_id?: string | null;
            /** Source Url */
            source_url?: string | null;
            /** Source Version */
            source_version?: string | null;
            /** Tokens */
            tokens?: {
                [key: string]: string;
            } | null;
            /** Variants */
            variants: {
                [key: string]: {
                    [key: string]: string;
                };
            };
        };
        /** InvitePayload */
        InvitePayload: {
            /** User Id */
            user_id: string;
        };
        /**
         * LatestReleaseResponse
         * @description None when version checking is disabled or the GitHub proxy call failed.
         */
        LatestReleaseResponse: {
            /** Latest Version */
            latest_version?: string | null;
        };
        /** LayoutIn */
        LayoutIn: {
            /**
             * Cols
             * @default 4
             */
            cols?: number;
            /**
             * Rows
             * @default 4
             */
            rows?: number;
        };
        /** LicenseCreate */
        LicenseCreate: {
            /** Name */
            name: string;
        };
        /** LicensesResponse */
        LicensesResponse: {
            /** Licenses */
            licenses: components["schemas"]["LookupOut"][];
        };
        /**
         * LinkChild
         * @description One item to file under a parent, with the label the picker will show.
         */
        LinkChild: {
            /** Id */
            id: string;
            /** Kind */
            kind: string;
            /**
             * Label
             * @default
             */
            label?: string;
        };
        /**
         * LinkEntry
         * @description A labeled link sent by a client (publisher page, character builder…).
         */
        LinkEntry: {
            /**
             * Label
             * @default
             */
            label?: string;
            /**
             * Url
             * @default
             */
            url?: string;
        };
        /**
         * LinkRef
         * @description A labeled link as returned, with any non-http(s) URL blanked.
         */
        LinkRef: {
            /**
             * Label
             * @default
             */
            label?: string;
            /**
             * Url
             * @default
             */
            url?: string;
        };
        /** LinkRequest */
        LinkRequest: {
            /** Children */
            children: components["schemas"]["LinkChild"][];
            /** Parent Id */
            parent_id: string;
            /** Parent Kind */
            parent_kind?: string | null;
            /** Parent Label */
            parent_label?: string | null;
            /**
             * Resource Type
             * @enum {string}
             */
            resource_type: "book" | "map" | "token" | "audio" | "model";
        };
        /**
         * LinkResult
         * @description Per-item outcome, mirroring the bulk-update contract.
         *
         *     A bad id in a batch skips that one item rather than failing the request, so
         *     the user keeps the links that were valid.
         */
        LinkResult: {
            /**
             * Errors
             * @default []
             */
            errors?: {
                [key: string]: unknown;
            }[];
            /** Linked */
            linked: string[];
            /** Parent Id */
            parent_id: string;
        };
        /**
         * LinkedResourceOut
         * @description One linked resource, as built by ``resources._serialize``.
         *
         *     ``shared_user_ids`` is only added when ``include_shares`` is set (the owner's
         *     view), so it is Optional. The same shape is returned by the file/image upload
         *     handlers, which build the dict by hand and omit both ``has_thumbnail`` and
         *     ``shared_user_ids``.
         */
        LinkedResourceOut: {
            /** Category Id */
            category_id?: string | null;
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Id */
            id: string;
            /** Is Image */
            is_image: boolean;
            /** Name */
            name: string;
            /** Resource Id */
            resource_id: string;
            /** Resource Type */
            resource_type: string;
            /** Shared User Ids */
            shared_user_ids?: string[] | null;
            /** Sort Order */
            sort_order?: number | null;
            /** Visibility */
            visibility?: string | null;
        };
        /**
         * LogEntry
         * @description One ring-buffer entry, as built by `config._LogEntry.to_dict`.
         */
        LogEntry: {
            /** Level */
            level: string;
            /** Logger */
            logger: string;
            /** Message */
            message: string;
            /** Seq */
            seq: number;
            /** Timestamp */
            timestamp: string;
        };
        /** LoginRequest */
        LoginRequest: {
            /** Password */
            password: string;
            /** Username */
            username: string;
        };
        /**
         * LoginResponse
         * @description Body shared by setup/login/refresh, as built by `_helpers.issue_login`.
         *
         *     The refresh token is deliberately absent — it travels only as an HttpOnly
         *     cookie, so it must not appear in the schema either.
         */
        LoginResponse: {
            /** Token */
            token: string;
            user: components["schemas"]["LoginUser"];
        };
        /**
         * LoginUser
         * @description The abbreviated user block returned by every login-ish endpoint.
         */
        LoginUser: {
            /**
             * Api Keys Allowed
             * @default false
             */
            api_keys_allowed?: boolean;
            /** Display Name */
            display_name?: string | null;
            /** Id */
            id: string;
            /** Role */
            role?: string | null;
            /**
             * Share Links Allowed
             * @default false
             */
            share_links_allowed?: boolean;
            /** Username */
            username: string;
        };
        /** LogsResponse */
        LogsResponse: {
            /** Entries */
            entries: components["schemas"]["LogEntry"][];
            /** Level */
            level: string;
            /** Limit */
            limit: number;
            /** Max Seq */
            max_seq: number;
            /** Offset */
            offset: number;
            /** Total */
            total: number;
        };
        /** LookupDeleteResponse */
        LookupDeleteResponse: {
            /** Removed Usage */
            removed_usage: number;
            /** Status */
            status: string;
        };
        /**
         * LookupOut
         * @description A flat lookup value — system family, parent system, or license.
         */
        LookupOut: {
            /** Id */
            id: string;
            /** Is Default */
            is_default: boolean;
            /** Name */
            name: string;
            /** Sort Order */
            sort_order: number;
        };
        /**
         * MapBulkItem
         * @description One Map entry in a bulk update.
         */
        MapBulkItem: {
            /** Description */
            description?: string | null;
            /** Grid Height */
            grid_height?: number | null;
            /** Grid Px */
            grid_px?: number | null;
            /** Grid Size */
            grid_size?: string | null;
            /** Grid Width */
            grid_width?: number | null;
            /** Id */
            id: string;
            /** Map Type */
            map_type?: string | null;
            /** Tags */
            tags?: string[] | null;
        };
        /**
         * MapBulkUpdate
         * @description A batch of Map updates applied in one transaction.
         */
        MapBulkUpdate: {
            /** Items */
            items: components["schemas"]["MapBulkItem"][];
        };
        /**
         * MapDetailResponse
         * @description `GET /maps/{id}` — map metadata, folder context, and image info.
         *
         *     Everything from `_map_image_info` is nullable by construction: the dict is
         *     seeded with `None`s and only filled in when the file could be measured
         *     (archives, unreadable files, and PDFs all leave some or all of it None).
         */
        MapDetailResponse: {
            /** Description */
            description?: string | null;
            /** Dpi */
            dpi?: number | null;
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Folder Path */
            folder_path: string;
            /** Folder Tags */
            folder_tags: string[];
            grid?: components["schemas"]["MapGrid"] | null;
            /** Grid Height */
            grid_height?: number | null;
            /** Grid Px */
            grid_px?: number | null;
            /** Grid Size */
            grid_size?: string | null;
            /** Grid Width */
            grid_width?: number | null;
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Id */
            id: string;
            /** Is Archive */
            is_archive: boolean;
            /** Is Missing */
            is_missing: boolean;
            /** Is Pdf */
            is_pdf: boolean;
            /** Map Type */
            map_type?: string | null;
            /**
             * Media Kind
             * @default image
             */
            media_kind?: string;
            /** Page Count */
            page_count?: number | null;
            /** Pixel Height */
            pixel_height?: number | null;
            /** Pixel Width */
            pixel_width?: number | null;
            /** Relative Path */
            relative_path: string;
            /** Tags */
            tags: string[];
            /**
             * Variant Kind
             * @default
             */
            variant_kind?: string;
            /**
             * Variant Label
             * @default
             */
            variant_label?: string;
            /**
             * Variant Main Filename
             * @default
             */
            variant_main_filename?: string;
            /** Variant Main Id */
            variant_main_id?: string | null;
            /**
             * Variant Main Kind
             * @default
             */
            variant_main_kind?: string;
            /**
             * Variant Main Label
             * @default
             */
            variant_main_label?: string;
            /** Variant Parent Id */
            variant_parent_id?: string | null;
            /**
             * Variants
             * @default []
             */
            variants?: components["schemas"]["VariantEntry"][];
        };
        /** MapFoldersResponse */
        MapFoldersResponse: {
            /** Folders */
            folders: components["schemas"]["backend__routers__maps___schemas__FolderTagsOut"][];
        };
        /**
         * MapGrid
         * @description Detected grid dimensions for a map (see `_helpers._map_image_info`).
         *
         *     `cell_px` is only present on the DPI/computed branches — the filename branch
         *     omits it, and PDF maps have it stripped — so it is Optional.
         *
         *     Floats rather than ints: a manual override may carry a fractional cell count
         *     for a map that bleeds part of a cell past its grid (issue #125). Inferred
         *     grids still come back whole.
         */
        MapGrid: {
            /** Cell Px */
            cell_px?: number | null;
            /** Height */
            height: number;
            /** Source */
            source: string;
            /** Width */
            width: number;
        };
        /** MapListResponse */
        MapListResponse: {
            /** Maps */
            maps: components["schemas"]["MapOut"][];
            /** Total */
            total: number;
        };
        /**
         * MapOut
         * @description One map, as returned by the list endpoint.
         *
         *     `description`/`map_type`/`file_size`/`has_thumbnail` are declared
         *     `default=...` on `GenericMap` rather than NOT NULL, so NULL is still
         *     representable (the default applies at insert only, and rows predating a
         *     column migration keep NULL) — hence Optional. `is_missing`/`is_archive` are
         *     coalesced with `bool(...)` by the handler and stay required.
         */
        MapOut: {
            /** Added At */
            added_at?: string | null;
            /** Description */
            description?: string | null;
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Id */
            id: string;
            /** Is Archive */
            is_archive: boolean;
            /** Is Missing */
            is_missing: boolean;
            /** Map Type */
            map_type?: string | null;
            /** Relative Path */
            relative_path: string;
            /** Tags */
            tags: string[];
            /**
             * Variant Count
             * @default 0
             */
            variant_count?: number;
            /** Variant Kinds */
            variant_kinds?: string[];
        };
        /** MapUpdate */
        MapUpdate: {
            /** Description */
            description?: string | null;
            /** Grid Height */
            grid_height?: number | null;
            /** Grid Px */
            grid_px?: number | null;
            /** Grid Size */
            grid_size?: string | null;
            /** Grid Width */
            grid_width?: number | null;
            /** Map Type */
            map_type?: string | null;
            /** Tags */
            tags?: string[] | null;
        };
        /** MarkersRequest */
        MarkersRequest: {
            /** Container Kind */
            container_kind?: string | null;
            /** Frames Container */
            frames_container?: boolean | null;
            /** Nsfw */
            nsfw?: boolean | null;
            /** Path */
            path: string;
        };
        /** MemberArtUploadOut */
        MemberArtUploadOut: {
            /** Character Art Path */
            character_art_path: string;
        };
        /**
         * MemberInviteOut
         * @description ``invite_member`` — literal ``{"user_id", "status"}``.
         */
        MemberInviteOut: {
            /** Status */
            status: string;
            /** User Id */
            user_id: string;
        };
        /**
         * MemberSheetOut
         * @description Returned by both the sheet upload and the blank-sheet duplicate.
         */
        MemberSheetOut: {
            /** Character Sheet Filename */
            character_sheet_filename?: string | null;
            /** Character Sheet Path */
            character_sheet_path: string;
        };
        /**
         * MemberStatusOut
         * @description ``update_member_status`` — the member's post-update state.
         */
        MemberStatusOut: {
            /** Character Name */
            character_name?: string | null;
            /** Character Sheet Url */
            character_sheet_url?: string | null;
            /** Status */
            status?: string | null;
            /** User Id */
            user_id: string;
        };
        /** MemberStatusUpdate */
        MemberStatusUpdate: {
            /** Character Name */
            character_name?: string | null;
            /** Character Sheet Url */
            character_sheet_url?: string | null;
            /** Status */
            status?: string | null;
        };
        /** MemberTokenUploadOut */
        MemberTokenUploadOut: {
            /** Character Token Path */
            character_token_path: string;
        };
        /** MergeMetadataRequest */
        MergeMetadataRequest: {
            /** Fields */
            fields: string[];
            /**
             * Overwrite
             * @default false
             */
            overwrite?: boolean;
            /**
             * Resource Type
             * @enum {string}
             */
            resource_type: "book" | "map" | "token" | "audio" | "model";
            /** Source Id */
            source_id: string;
            /** Target Id */
            target_id: string;
        };
        /** MergeMetadataResult */
        MergeMetadataResult: {
            /** Skipped */
            skipped: string[];
            /** Updated */
            updated: string[];
        };
        /**
         * MetadataCandidate
         * @description One ranked search candidate (same shape from script and declarative paths).
         */
        MetadataCandidate: {
            /** Identity */
            identity: string;
            /** Label */
            label: string;
            /** Score */
            score: number;
            /** Url */
            url: string;
        };
        /**
         * MetadataDiffField
         * @description One field compared against the resource, from `addons.build_diff`.
         */
        MetadataDiffField: {
            /** Current */
            current?: unknown | null;
            /** Field */
            field: string;
            /** Incoming */
            incoming: unknown;
            /** Status */
            status: string;
        };
        /**
         * MetadataFetch
         * @description Fetch one candidate's fields for review.
         */
        MetadataFetch: {
            /**
             * Identity
             * @default
             */
            identity?: string;
            /**
             * Paste
             * @default
             */
            paste?: string;
            /**
             * Query
             * @default
             */
            query?: string;
            /** Source Id */
            source_id: string;
        };
        /** MetadataFetchResponse */
        MetadataFetchResponse: {
            /** Attribution */
            attribution: string;
            /** Fields */
            fields: components["schemas"]["MetadataDiffField"][];
            /** Identity */
            identity: string;
            /** Source Id */
            source_id: string;
            /** Url */
            url: string;
        };
        /** MetadataSearchResponse */
        MetadataSearchResponse: {
            /** Query */
            query: string;
            /** Results */
            results: components["schemas"]["MetadataCandidate"][];
        };
        /**
         * MetadataSource
         * @description One installed add-on able to supply metadata, from `list_sources`.
         */
        MetadataSource: {
            /** Attribution */
            attribution?: string | null;
            /** Description */
            description?: string | null;
            /** Homepage */
            homepage?: string | null;
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Supports Paste */
            supports_paste: boolean;
        };
        /** MetadataSourcesResponse */
        MetadataSourcesResponse: {
            /** Sources */
            sources: components["schemas"]["MetadataSource"][];
        };
        /**
         * Model3DBulkItem
         * @description One Model3D entry in a bulk update.
         */
        Model3DBulkItem: {
            /** Description */
            description?: string | null;
            /** Id */
            id: string;
            /** Is Explicit */
            is_explicit?: boolean | null;
            /** Is Supported */
            is_supported?: boolean | null;
            /** Tags */
            tags?: string[] | null;
        };
        /**
         * Model3DBulkUpdate
         * @description A batch of Model3D updates applied in one transaction.
         */
        Model3DBulkUpdate: {
            /** Items */
            items: components["schemas"]["Model3DBulkItem"][];
        };
        /**
         * Model3DDetailResponse
         * @description ``GET /models/{id}`` — metadata, folder context, and viewer capability.
         *
         *     ``viewer_loader`` names the frontend loader for this format ("stl", "gltf",
         *     …) and is empty for a format with no viewer. It comes from the backend's
         *     format table so the extension→loader mapping has one home rather than being
         *     mirrored by hand in the client.
         *
         *     ``viewer_available`` is the question the detail view actually asks: it is
         *     false for a format with no loader *and* for a mesh too large to hand a
         *     browser, so the client can offer a download instead of hanging a tab.
         *
         *     ``viewer_oversized`` splits that second case back out. When it is true the
         *     file is a supported format held back only by its size, so the client offers
         *     to load it anyway behind a warning; when it is false alongside a false
         *     ``viewer_available`` the format simply has no loader and a download is the
         *     only option.
         */
        Model3DDetailResponse: {
            /** Added At */
            added_at?: string | null;
            /** Description */
            description?: string | null;
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Folder Path */
            folder_path: string;
            /** Folder Tags */
            folder_tags: string[];
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Id */
            id: string;
            /** Is Archive */
            is_archive: boolean;
            /** Is Explicit */
            is_explicit: boolean;
            /** Is Missing */
            is_missing: boolean;
            /** Is Presupported */
            is_presupported: boolean;
            /** Is Supported */
            is_supported?: boolean | null;
            /** Is Unsupported */
            is_unsupported: boolean;
            /** Relative Path */
            relative_path: string;
            /** Tags */
            tags: string[];
            /** Triangle Count */
            triangle_count?: number | null;
            /**
             * Variant Count
             * @default 0
             */
            variant_count?: number;
            /**
             * Variant Kind
             * @default
             */
            variant_kind?: string;
            /** Variant Kinds */
            variant_kinds?: string[];
            /**
             * Variant Label
             * @default
             */
            variant_label?: string;
            /**
             * Variant Main Filename
             * @default
             */
            variant_main_filename?: string;
            /** Variant Main Id */
            variant_main_id?: string | null;
            /**
             * Variant Main Kind
             * @default
             */
            variant_main_kind?: string;
            /**
             * Variant Main Label
             * @default
             */
            variant_main_label?: string;
            /** Variant Parent Id */
            variant_parent_id?: string | null;
            /**
             * Variants
             * @default []
             */
            variants?: components["schemas"]["VariantEntry"][];
            /**
             * Viewer Available
             * @default false
             */
            viewer_available?: boolean;
            /**
             * Viewer Loader
             * @default
             */
            viewer_loader?: string;
            /**
             * Viewer Oversized
             * @default false
             */
            viewer_oversized?: boolean;
        };
        /** Model3DFoldersResponse */
        Model3DFoldersResponse: {
            /** Folders */
            folders: components["schemas"]["backend__routers__models___schemas__FolderTagsOut"][];
        };
        /** Model3DListResponse */
        Model3DListResponse: {
            /** Models */
            models: components["schemas"]["Model3DOut"][];
            /** Total */
            total: number;
        };
        /**
         * Model3DOut
         * @description One model, as returned by the list endpoint.
         *
         *     ``is_presupported``/``is_unsupported`` are derived from the tri-state
         *     ``is_supported`` column rather than exposing it directly: the gallery's badge
         *     system shows a badge for any truthy value, so a single tri-state field would
         *     render "presupported" and then nothing at all for both the unsupported and
         *     the unknown case — losing the distinction that matters most here. Two plain
         *     booleans, both false when unknown, say it unambiguously.
         */
        Model3DOut: {
            /** Added At */
            added_at?: string | null;
            /** Description */
            description?: string | null;
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Id */
            id: string;
            /** Is Archive */
            is_archive: boolean;
            /** Is Explicit */
            is_explicit: boolean;
            /** Is Missing */
            is_missing: boolean;
            /** Is Presupported */
            is_presupported: boolean;
            /** Is Unsupported */
            is_unsupported: boolean;
            /** Relative Path */
            relative_path: string;
            /** Tags */
            tags: string[];
            /** Triangle Count */
            triangle_count?: number | null;
            /**
             * Variant Count
             * @default 0
             */
            variant_count?: number;
            /** Variant Kinds */
            variant_kinds?: string[];
        };
        /** Model3DUpdate */
        Model3DUpdate: {
            /** Description */
            description?: string | null;
            /** Is Explicit */
            is_explicit?: boolean | null;
            /** Is Supported */
            is_supported?: boolean | null;
            /** Tags */
            tags?: string[] | null;
        };
        /** MoveRequest */
        MoveRequest: {
            /** Destination */
            destination: string;
            /**
             * On Conflict
             * @default skip
             */
            on_conflict?: string;
            /** Sources */
            sources: string[];
        };
        /** MoveResponse */
        MoveResponse: {
            /** Count */
            count: number;
            /** Moved */
            moved: {
                [key: string]: unknown;
            }[];
            /** Skipped */
            skipped: {
                [key: string]: unknown;
            }[];
        };
        /** OpdsStatusResponse */
        OpdsStatusResponse: {
            /** Feed Url */
            feed_url?: string | null;
            /** Has Token */
            has_token?: boolean | null;
            /** Opds Enabled */
            opds_enabled: boolean;
        };
        /**
         * OtfbmPlanResponse
         * @description `GET /maps/{id}/otfbm` — how to set the map up in OTFBM (issue #551).
         *
         *     `width`/`height` are the whole-cell `-mapsize`, `cell` the `-options c`
         *     value, and `image_width`/`image_height` the size the background is resized
         *     to so that each of its cells is exactly `cell` pixels.
         */
        OtfbmPlanResponse: {
            /** Cell */
            cell: number;
            /** Grid Source */
            grid_source: string;
            /** Height */
            height: number;
            /** Image Height */
            image_height: number;
            /** Image Width */
            image_width: number;
            /** Max Cell */
            max_cell: number;
            /** Min Cell */
            min_cell: number;
            /** Source Px */
            source_px: number;
            /** Suggested Cell */
            suggested_cell: number;
            /**
             * Truncated
             * @default false
             */
            truncated?: boolean;
            /** Width */
            width: number;
        };
        /** PackCatalogueResponse */
        PackCatalogueResponse: {
            /**
             * Can Install
             * @default false
             */
            can_install?: boolean;
            /**
             * Downloads Enabled
             * @default true
             */
            downloads_enabled?: boolean;
            /** Errors */
            errors?: {
                [key: string]: unknown;
            }[];
            /** Packs */
            packs?: components["schemas"]["CataloguePack"][];
            /** Sources */
            sources?: string[];
        };
        /** PackListResponse */
        PackListResponse: {
            /** Packs */
            packs: components["schemas"]["PackSummary"][];
        };
        /**
         * PackSummary
         * @description An installed content pack, with the credit it must be shown under.
         */
        PackSummary: {
            /**
             * Attribution
             * @default
             */
            attribution?: string;
            /**
             * Description
             * @default
             */
            description?: string;
            /**
             * Entry Count
             * @default 0
             */
            entry_count?: number;
            /**
             * License
             * @default
             */
            license?: string;
            /**
             * License Url
             * @default
             */
            license_url?: string;
            /** Name */
            name: string;
            /** Pack Id */
            pack_id: string;
            /** Schema Id */
            schema_id: string;
            /**
             * Source Url
             * @default
             */
            source_url?: string;
            /**
             * Version
             * @default
             */
            version?: string;
        };
        /** PageSizeResponse */
        PageSizeResponse: {
            /** Height */
            height: number;
            /** Width */
            width: number;
        };
        /** PageTextResponse */
        PageTextResponse: {
            /** Text */
            text: string;
        };
        /**
         * PageWord
         * @description One word's bounding box, in PDF points.
         */
        PageWord: {
            /** Text */
            text: string;
            /** X0 */
            x0: number;
            /** X1 */
            x1: number;
            /** Y0 */
            y0: number;
            /** Y1 */
            y1: number;
        };
        /** PageWordsResponse */
        PageWordsResponse: {
            /** Height */
            height: number;
            /** Width */
            width: number;
            /** Words */
            words: components["schemas"]["PageWord"][];
        };
        /** ParentSystemCreate */
        ParentSystemCreate: {
            /** Name */
            name: string;
        };
        /** ParentSystemsResponse */
        ParentSystemsResponse: {
            /** Parent Systems */
            parent_systems: components["schemas"]["LookupOut"][];
        };
        /** PasswordChange */
        PasswordChange: {
            /** Current Password */
            current_password: string;
            /** New Password */
            new_password: string;
        };
        /** PasswordChangeResponse */
        PasswordChangeResponse: {
            /** Sessions Revoked */
            sessions_revoked: number;
            /** Status */
            status: string;
        };
        /**
         * PlayerNoteOut
         * @description ``upsert_player_note`` echoes the saved content back.
         */
        PlayerNoteOut: {
            /** Content */
            content: string;
        };
        /** PlayerNoteUpdate */
        PlayerNoteUpdate: {
            /** Content */
            content: string;
        };
        /** PlayerSessionNoteOut */
        PlayerSessionNoteOut: {
            /** Content */
            content?: string | null;
            /** Display Name */
            display_name?: string | null;
            /** Updated At */
            updated_at?: string | null;
            /** User Id */
            user_id: string;
            /** Username */
            username: string;
        };
        /**
         * PortraitCrop
         * @description Which part of a portrait a frame shows.
         *
         *     ``x`` and ``y`` are the focus point, as percentages across and down the
         *     image; ``zoom`` magnifies about it. A frame of any shape keeps the focus
         *     point in view, so one choice serves the square header, the list's card and
         *     a tall panel on the sheet alike.
         */
        PortraitCrop: {
            /**
             * X
             * @default 50
             */
            x?: number;
            /**
             * Y
             * @default 50
             */
            y?: number;
            /**
             * Zoom
             * @default 1
             */
            zoom?: number;
        };
        /** PortraitResponse */
        PortraitResponse: {
            /** Portrait Path */
            portrait_path: string;
            /** Portrait Version */
            portrait_version?: number | null;
        };
        /**
         * PreferencesResponse
         * @description Echoes the stored values, which are all nullable columns.
         */
        PreferencesResponse: {
            /** Allow Explicit */
            allow_explicit?: boolean | null;
            /** Display Name */
            display_name?: string | null;
            /** Email */
            email?: string | null;
            /**
             * Explicit Locked
             * @default false
             */
            explicit_locked?: boolean;
        };
        /** PreferencesUpdate */
        PreferencesUpdate: {
            /** Allow Explicit */
            allow_explicit?: boolean | null;
            /** Display Name */
            display_name?: string | null;
            /** Email */
            email?: string | null;
        };
        /**
         * PromoteRequest
         * @description Hand an existing family a different main version.
         *
         *     ``kind``/``label`` describe the *old* parent once it becomes a variant —
         *     the copy being demoted is the one that now needs describing.
         */
        PromoteRequest: {
            /**
             * Kind
             * @default other
             */
            kind?: string;
            /**
             * Label
             * @default
             */
            label?: string;
            /** New Parent Id */
            new_parent_id: string;
            /** Old Parent Id */
            old_parent_id: string;
            /**
             * Resource Type
             * @enum {string}
             */
            resource_type: "book" | "map" | "token" | "audio" | "model";
        };
        /** PromoteResult */
        PromoteResult: {
            /**
             * Moved
             * @default 0
             */
            moved?: number;
            /** New Parent Id */
            new_parent_id: string;
        };
        /** PublisherEntry */
        PublisherEntry: {
            /** Name */
            name: string;
            /**
             * Url
             * @default
             */
            url?: string;
        };
        /**
         * PublisherRef
         * @description A publisher on a game system: a name with an optional link.
         *
         *     Mirrors ``systems._schemas.PublisherEntry`` (the request-side model) for use
         *     by the response models that surface the ``publishers`` column. A link that
         *     is not http(s) comes back blank (see ``_link_urls``).
         */
        PublisherRef: {
            /**
             * Name
             * @default
             */
            name?: string;
            /**
             * Url
             * @default
             */
            url?: string;
        };
        /** RefreshIndexResponse */
        RefreshIndexResponse: {
            /** Count */
            count: number;
            /** Errors */
            errors?: {
                [key: string]: unknown;
            }[];
            /** Status */
            status: string;
        };
        /** ReindexResponse */
        ReindexResponse: {
            /** Ocr Dpi */
            ocr_dpi?: number | null;
            /** Status */
            status: string;
        };
        /** RenameRequest */
        RenameRequest: {
            /** New Name */
            new_name: string;
            /** Path */
            path: string;
        };
        /**
         * RenameResponse
         * @description Where the item ended up, and how many records followed it.
         */
        RenameResponse: {
            /** From */
            from: string;
            /** Records */
            records: number;
            /** To */
            to: string;
        };
        /**
         * RescanRequest
         * @description Body for POST /rescan.
         *
         *     scope restricts the rescan to a subtree relative to the library root, e.g.
         *     "books/D&D 5e/adventure" or "maps/Forests".  Omitted = whole library.
         *     metadata_mode controls sidecar metadata re-application on already-indexed books.
         */
        RescanRequest: {
            /**
             * Metadata Mode
             * @default new
             * @enum {string}
             */
            metadata_mode?: "new" | "missing" | "replace";
            /** Scope */
            scope?: string | null;
        };
        /** ResolveResponse */
        ResolveResponse: {
            /** Entries */
            entries: {
                [key: string]: components["schemas"]["ResolvedEntry"];
            };
        };
        /**
         * ResolvedEntry
         * @description An entry resolved from a character's reference.
         *
         *     ``missing`` is true when the reference points at something no installed pack
         *     provides — the pack was removed, or the character came from another server.
         *     The sheet still renders; it shows what the character stored.
         */
        ResolvedEntry: {
            /**
             * Content Type
             * @default
             */
            content_type?: string;
            /** Data */
            data?: {
                [key: string]: unknown;
            };
            /** Entry Id */
            entry_id: string;
            /**
             * Missing
             * @default false
             */
            missing?: boolean;
            /**
             * Name
             * @default
             */
            name?: string;
            /** Source */
            source?: string | null;
        };
        /** ResourceAdd */
        ResourceAdd: {
            /** Category Id */
            category_id?: string | null;
            /** Resource Id */
            resource_id: string;
            /** Resource Type */
            resource_type: string;
            /** Shared User Ids */
            shared_user_ids?: string[] | null;
            /**
             * Visibility
             * @default gm
             */
            visibility?: string;
        };
        /** ResourceBulkAdd */
        ResourceBulkAdd: {
            /** Resources */
            resources: components["schemas"]["ResourceAdd"][];
        };
        /** ResourceGroupOrder */
        ResourceGroupOrder: {
            /** Ordered Keys */
            ordered_keys: string[];
        };
        /**
         * ResourceGroupOrderOut
         * @description ``set_resource_group_order`` — the ack plus the cleaned key list.
         */
        ResourceGroupOrderOut: {
            /** Ok */
            ok: boolean;
            /** Resource Group Order */
            resource_group_order: string[];
        };
        /** ResourceReorder */
        ResourceReorder: {
            /** Ordered Ids */
            ordered_ids: string[];
        };
        /**
         * ResourceSearchHit
         * @description One book/map/token/audio hit from ``search_resources_global``.
         */
        ResourceSearchHit: {
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Name */
            name: string;
            /** Resource Id */
            resource_id: string;
            /** Resource Type */
            resource_type: string;
            /** Subtitle */
            subtitle: string;
            /**
             * Variant Kind
             * @default
             */
            variant_kind?: string;
            /**
             * Variant Label
             * @default
             */
            variant_label?: string;
            /**
             * Variants
             * @default []
             */
            variants?: components["schemas"]["ResourceSearchVariant"][];
        };
        /**
         * ResourceSearchVariant
         * @description One other version of a search hit — a gridless cut, a recolour, a remix.
         *
         *     Carries only what a picker needs to offer the choice; the row itself already
         *     supplies the folder and the rest of the context.
         */
        ResourceSearchVariant: {
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Name */
            name: string;
            /** Resource Id */
            resource_id: string;
            /** Resource Type */
            resource_type: string;
            /**
             * Variant Kind
             * @default
             */
            variant_kind?: string;
            /**
             * Variant Label
             * @default
             */
            variant_label?: string;
        };
        /** ResourceUpdate */
        ResourceUpdate: {
            /** Category Id */
            category_id?: string | null;
            /** Shared User Ids */
            shared_user_ids?: string[] | null;
            /** Visibility */
            visibility?: string | null;
        };
        /** RevokeOtherSessionsResponse */
        RevokeOtherSessionsResponse: {
            /** Kept Current */
            kept_current: boolean;
            /** Ok */
            ok: boolean;
            /** Revoked */
            revoked: number;
        };
        /** RevokeSessionResponse */
        RevokeSessionResponse: {
            /** Ok */
            ok: boolean;
            /** Revoked */
            revoked: number;
        };
        /** RulesetCreate */
        RulesetCreate: {
            /**
             * Attribution
             * @default
             */
            attribution?: string;
            /** Campaign Id */
            campaign_id?: string | null;
            /**
             * Description
             * @default
             */
            description?: string;
            /**
             * License
             * @default
             */
            license?: string;
            /**
             * License Url
             * @default
             */
            license_url?: string;
            /** Name */
            name: string;
            /** Schema Id */
            schema_id: string;
        };
        /** RulesetEntryDetail */
        RulesetEntryDetail: {
            /** Content Type */
            content_type: string;
            /** Data */
            data?: {
                [key: string]: unknown;
            };
            /**
             * Editable
             * @default false
             */
            editable?: boolean;
            /** Entry Id */
            entry_id: string;
            /** Forked From */
            forked_from?: string | null;
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Ruleset Id */
            ruleset_id: string;
        };
        /** RulesetEntryListResponse */
        RulesetEntryListResponse: {
            /** Entries */
            entries: components["schemas"]["RulesetEntrySummary"][];
        };
        /** RulesetEntrySummary */
        RulesetEntrySummary: {
            /** Content Type */
            content_type: string;
            /**
             * Editable
             * @default false
             */
            editable?: boolean;
            /** Entry Id */
            entry_id: string;
            /** Forked From */
            forked_from?: string | null;
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Ruleset Id */
            ruleset_id: string;
        };
        /** RulesetExport */
        RulesetExport: {
            /**
             * $Schema
             * @default
             */
            $schema?: string;
            /**
             * Attribution
             * @default
             */
            attribution?: string;
            /**
             * Description
             * @default
             */
            description?: string;
            /** Entries */
            entries?: {
                [key: string]: {
                    [key: string]: unknown;
                }[];
            };
            /**
             * License
             * @default
             */
            license?: string;
            /**
             * License Url
             * @default
             */
            license_url?: string;
            /**
             * Name
             * @default
             */
            name?: string;
            /**
             * Schema Id
             * @default
             */
            schema_id?: string;
            /**
             * Version
             * @default 1.0.0
             */
            version?: string;
        };
        /** RulesetListResponse */
        RulesetListResponse: {
            /** Rulesets */
            rulesets: components["schemas"]["RulesetSummary"][];
        };
        /**
         * RulesetSummary
         * @description One ruleset as the manager lists it.
         */
        RulesetSummary: {
            /**
             * Attribution
             * @default
             */
            attribution?: string;
            /** Campaign Id */
            campaign_id?: string | null;
            /**
             * Campaign Name
             * @default
             */
            campaign_name?: string;
            /** Created At */
            created_at?: string | null;
            /**
             * Description
             * @default
             */
            description?: string;
            /**
             * Editable
             * @default false
             */
            editable?: boolean;
            /**
             * Entry Count
             * @default 0
             */
            entry_count?: number;
            /** Id */
            id: string;
            /**
             * License
             * @default
             */
            license?: string;
            /**
             * License Url
             * @default
             */
            license_url?: string;
            /** Name */
            name: string;
            /**
             * Personal
             * @default false
             */
            personal?: boolean;
            /** Schema Id */
            schema_id: string;
            /** Source Pack Id */
            source_pack_id?: string | null;
            /** Updated At */
            updated_at?: string | null;
            /**
             * Version
             * @default
             */
            version?: string;
        };
        /** RulesetUpdate */
        RulesetUpdate: {
            /** Attribution */
            attribution?: string | null;
            /** Description */
            description?: string | null;
            /** License */
            license?: string | null;
            /** License Url */
            license_url?: string | null;
            /** Name */
            name?: string | null;
        };
        /** SaveExportRequest */
        SaveExportRequest: {
            /** Destination */
            destination: string;
            /**
             * Dpi
             * @default 150
             */
            dpi?: number;
            /**
             * Format
             * @default pdf
             * @enum {string}
             */
            format?: "pdf" | "png" | "jpeg" | "webp";
            /**
             * Join Spreads
             * @default false
             */
            join_spreads?: boolean;
            /**
             * Kind
             * @enum {string}
             */
            kind: "pages" | "regions";
            /**
             * Pages
             * @default
             */
            pages?: string;
            /** Regions */
            regions?: components["schemas"]["ExportRegionIn"][];
            /**
             * Spread Offset
             * @default 0
             * @enum {integer}
             */
            spread_offset?: 0 | 1;
        };
        /** SaveExportResponse */
        SaveExportResponse: {
            /** Folder */
            folder: string;
            /** Saved */
            saved: components["schemas"]["SavedFile"][];
        };
        /** SavedFile */
        SavedFile: {
            /** Name */
            name: string;
            /** Path */
            path: string;
            /** Size */
            size: number;
        };
        /** SavedFilterCreate */
        SavedFilterCreate: {
            /**
             * Is Default
             * @default false
             */
            is_default?: boolean;
            /** Name */
            name: string;
            /** Scope */
            scope: string;
            /**
             * State
             * @default {}
             */
            state?: {
                [key: string]: unknown;
            };
        };
        /**
         * SavedFilterOut
         * @description One preset, as built by `core._serialize`.
         *
         *     `scope` and `name` are NOT NULL columns; `state` and `is_default` are
         *     coalesced by the serializer (`f.state or {}`, `bool(f.is_default)`), so all
         *     four stay required even though the columns only carry a `default=`.
         */
        SavedFilterOut: {
            /** Id */
            id: string;
            /** Is Default */
            is_default: boolean;
            /** Name */
            name: string;
            /** Scope */
            scope: string;
            /** State */
            state: {
                [key: string]: unknown;
            };
        };
        /** SavedFilterUpdate */
        SavedFilterUpdate: {
            /** Is Default */
            is_default?: boolean | null;
            /** Name */
            name?: string | null;
            /** State */
            state?: {
                [key: string]: unknown;
            } | null;
        };
        /** SavedFiltersResponse */
        SavedFiltersResponse: {
            /** Filters */
            filters: components["schemas"]["SavedFilterOut"][];
        };
        /** ScaffoldRequest */
        ScaffoldRequest: {
            /** Path */
            path: string;
        };
        /**
         * ScaffoldResponse
         * @description Which category folders were made, and which were already there.
         */
        ScaffoldResponse: {
            /** Created */
            created: string[];
            /** Existing */
            existing: string[];
            /** Path */
            path: string;
        };
        /**
         * ScanRequest
         * @description Which collections to scan, and how hard to look.
         *
         *     Empty ``resource_types`` means all four. ``accuracy`` trades certainty for
         *     reach: ``exact`` finds only byte-identical files and never a false positive,
         *     while the looser levels take longer and return matches that need judging.
         */
        ScanRequest: {
            /**
             * Accuracy
             * @default medium
             * @enum {string}
             */
            accuracy?: "exact" | "high" | "medium" | "low";
            /**
             * Resource Types
             * @default []
             */
            resource_types?: ("book" | "map" | "token" | "audio" | "model")[];
        };
        /** ScanStatus */
        ScanStatus: {
            /** Accuracy */
            accuracy?: string | null;
            /** Error */
            error?: string | null;
            /** Finished At */
            finished_at?: string | null;
            /**
             * Groups Found
             * @default 0
             */
            groups_found?: number;
            /** Heartbeat */
            heartbeat?: string | null;
            /** Phase */
            phase?: string | null;
            /** Resource Type */
            resource_type?: string | null;
            /**
             * Running
             * @default false
             */
            running?: boolean;
            /** Scan Id */
            scan_id?: string | null;
            /**
             * Scanned
             * @default 0
             */
            scanned?: number;
            /** Started At */
            started_at?: string | null;
            /**
             * Total
             * @default 0
             */
            total?: number;
        };
        /**
         * ScanStatusResponse
         * @description Live scan state, mirroring `_helpers._DEFAULT_STATUS`.
         *
         *     The counters are Optional because the payload can come back from Valkey,
         *     where a status blob written by an older build may predate a counter that was
         *     added since; a strict model would raise on those. `phase` and `ocr_current`
         *     are None whenever no scan is in flight, which is the common case.
         */
        ScanStatusResponse: {
            /** Heartbeat */
            heartbeat?: string | null;
            /** Indexed */
            indexed?: number | null;
            /** New Audio */
            new_audio?: number | null;
            /** New Books */
            new_books?: number | null;
            /** New Maps */
            new_maps?: number | null;
            /** New Models */
            new_models?: number | null;
            /** New Tokens */
            new_tokens?: number | null;
            /** Ocr Current */
            ocr_current?: string | null;
            /** Ocr Done */
            ocr_done?: number | null;
            /** Phase */
            phase?: string | null;
            /** Running */
            running: boolean;
            /** Scanned Audio */
            scanned_audio?: number | null;
            /** Scanned Books */
            scanned_books?: number | null;
            /** Scanned Maps */
            scanned_maps?: number | null;
            /** Scanned Models */
            scanned_models?: number | null;
            /** Scanned Tokens */
            scanned_tokens?: number | null;
            /** Thumbs Current */
            thumbs_current?: string | null;
            /** Thumbs Done */
            thumbs_done?: number | null;
            /** To Index */
            to_index?: number | null;
            /** Total Audio */
            total_audio?: number | null;
            /** Total Books */
            total_books?: number | null;
            /** Total Maps */
            total_maps?: number | null;
            /** Total Models */
            total_models?: number | null;
            /** Total Ocr */
            total_ocr?: number | null;
            /** Total Thumbs */
            total_thumbs?: number | null;
            /** Total Tokens */
            total_tokens?: number | null;
            /** Updated Books */
            updated_books?: number | null;
        };
        /** ScanTriggerResult */
        ScanTriggerResult: {
            /** Status */
            status: string;
        };
        /**
         * ScheduleOut
         * @description The campaign schedule. ``definition`` is a free-form JSON column, and is
         *     null when no schedule row exists.
         */
        ScheduleOut: {
            /** Definition */
            definition?: {
                [key: string]: unknown;
            } | null;
            /** Enabled */
            enabled: boolean;
            /** Next Sessions */
            next_sessions: string[];
        };
        /** ScheduleUpsert */
        ScheduleUpsert: {
            /** Biweekly Reference */
            biweekly_reference?: string | null;
            /** Custom Dates */
            custom_dates?: string[] | null;
            /**
             * Days
             * @default []
             */
            days?: number[];
            /**
             * Enabled
             * @default true
             */
            enabled?: boolean;
            /**
             * Frequency
             * @default weekly
             */
            frequency?: string;
            /** Monthly Week */
            monthly_week?: number | null;
            /** Time Local */
            time_local?: string | null;
            /** Time Utc */
            time_utc?: string | null;
            /** Timezone */
            timezone?: string | null;
        };
        /** SchemaDeletedResponse */
        SchemaDeletedResponse: {
            /**
             * Deleted
             * @default true
             */
            deleted?: boolean;
            /** Schema Id */
            schema_id: string;
        };
        /**
         * SchemaDetail
         * @description A schema with its validated document, for rendering a sheet.
         */
        SchemaDetail: {
            /**
             * Character Count
             * @default 0
             */
            character_count?: number;
            /**
             * Description
             * @default
             */
            description?: string;
            /** Document */
            document?: {
                [key: string]: unknown;
            };
            /** Id */
            id: string;
            /**
             * Is Community
             * @default false
             */
            is_community?: boolean;
            /** Name */
            name: string;
            /** Schema Id */
            schema_id: string;
            /** Source Id */
            source_id?: string | null;
            /** Source Url */
            source_url?: string | null;
            /** Source Version */
            source_version?: string | null;
            /**
             * System
             * @default
             */
            system?: string;
            /**
             * Version
             * @default
             */
            version?: string;
        };
        /**
         * SchemaImport
         * @description A pasted or uploaded sheet.
         *
         *     Three ways to give the sheet itself, in order of preference:
         *
         *     * ``document`` — already-parsed JSON, which is what the catalogue installer
         *       and older clients send.
         *     * ``text`` — the sheet as typed, parsed as JSON and then as YAML. A sheet is
         *       a document people hand-write, and YAML is far kinder to write by hand than
         *       JSON: no quoting every key, no trailing-comma errors, and comments.
         *
         *     ``layout`` and ``styles`` carry a custom sheet's HTML and CSS as their own
         *     fields. A layout inlined into JSON has to be escaped, which turns a readable
         *     template into one unbroken line of ``\"`` and ``\n`` — the community repo
         *     keeps them in sibling files for exactly that reason, and pasting one should
         *     not be worse than installing one. Given here, they override whatever the
         *     document holds.
         */
        SchemaImport: {
            /** Document */
            document?: {
                [key: string]: unknown;
            };
            /**
             * Layout
             * @default
             */
            layout?: string;
            /** Source Id */
            source_id?: string | null;
            /** Source Url */
            source_url?: string | null;
            /** Source Version */
            source_version?: string | null;
            /**
             * Styles
             * @default
             */
            styles?: string;
            /**
             * Text
             * @default
             */
            text?: string;
        };
        /** SchemaListResponse */
        SchemaListResponse: {
            /** Schemas */
            schemas: components["schemas"]["SchemaSummary"][];
        };
        /**
         * SchemaSummary
         * @description One installed schema, without its document — enough to list and pick.
         */
        SchemaSummary: {
            /**
             * Character Count
             * @default 0
             */
            character_count?: number;
            /**
             * Description
             * @default
             */
            description?: string;
            /** Id */
            id: string;
            /**
             * Is Community
             * @default false
             */
            is_community?: boolean;
            /** Name */
            name: string;
            /** Schema Id */
            schema_id: string;
            /** Source Id */
            source_id?: string | null;
            /** Source Url */
            source_url?: string | null;
            /** Source Version */
            source_version?: string | null;
            /**
             * System
             * @default
             */
            system?: string;
            /**
             * Version
             * @default
             */
            version?: string;
        };
        /** SearchAudioHit */
        SearchAudioHit: {
            /** Filename */
            filename: string;
            /**
             * Has Thumbnail
             * @default false
             */
            has_thumbnail?: boolean;
            /** Id */
            id: string;
            /** Relative Path */
            relative_path: string;
            /** Tags */
            tags: string[];
            /** Title */
            title?: string | null;
        };
        /**
         * SearchBookMatch
         * @description A book matched on its own metadata rather than its page text (issue #343).
         *
         *     Distinct from :class:`SearchHit`, which is always a *page*. This one carries
         *     no page number or snippet — a title match is about the book itself — and adds
         *     the cover/authors the client shows on a pinned row.
         */
        SearchBookMatch: {
            /** Authors */
            authors: string[];
            /** Category */
            category?: string | null;
            /** Game System */
            game_system: string;
            /** Game System Id */
            game_system_id: string;
            /** Has Thumbnail */
            has_thumbnail: boolean;
            /** Id */
            id: string;
            /** Page Count */
            page_count: number;
            /**
             * Product Code
             * @default
             */
            product_code?: string;
            /** Publisher */
            publisher: string;
            /** Tags */
            tags: string[];
            /** Title */
            title: string;
            /** Year */
            year?: number | null;
        };
        /**
         * SearchField
         * @description One documented `field:` prefix, for the in-app help popover.
         */
        SearchField: {
            /** Aliases */
            aliases: string[];
            /** Field */
            field: string;
        };
        /** SearchFieldsResponse */
        SearchFieldsResponse: {
            /** Fields */
            fields: components["schemas"]["SearchField"][];
        };
        /**
         * SearchHit
         * @description One FTS5 page match, enriched with its parent book.
         */
        SearchHit: {
            /** Category */
            category?: string | null;
            /** Game System */
            game_system: string;
            /** Game System Id */
            game_system_id: string;
            /** Id */
            id: string;
            /** Page Number */
            page_number: number;
            /** Snippet */
            snippet: string;
            /** Title */
            title: string;
        };
        /** SearchMapHit */
        SearchMapHit: {
            /** Filename */
            filename: string;
            /**
             * Has Thumbnail
             * @default false
             */
            has_thumbnail?: boolean;
            /** Id */
            id: string;
            /** Relative Path */
            relative_path: string;
            /** Tags */
            tags: string[];
        };
        /** SearchModelHit */
        SearchModelHit: {
            /** Filename */
            filename: string;
            /**
             * Has Thumbnail
             * @default false
             */
            has_thumbnail?: boolean;
            /** Id */
            id: string;
            /** Relative Path */
            relative_path: string;
            /** Tags */
            tags: string[];
        };
        /** SearchResponse */
        SearchResponse: {
            /** Audio */
            audio: components["schemas"]["SearchAudioHit"][];
            /**
             * Book Matches
             * @default []
             */
            book_matches?: components["schemas"]["SearchBookMatch"][];
            /**
             * Fields
             * @default []
             */
            fields?: string[];
            /** Maps */
            maps: components["schemas"]["SearchMapHit"][];
            /**
             * Models
             * @default []
             */
            models?: components["schemas"]["SearchModelHit"][];
            /** Query */
            query: string;
            /** Results */
            results: components["schemas"]["SearchHit"][];
            /** Tokens */
            tokens: components["schemas"]["SearchTokenHit"][];
            /** Total */
            total: number;
        };
        /** SearchTokenHit */
        SearchTokenHit: {
            /** Filename */
            filename: string;
            /**
             * Has Thumbnail
             * @default false
             */
            has_thumbnail?: boolean;
            /** Id */
            id: string;
            /** Relative Path */
            relative_path: string;
            /** Tags */
            tags: string[];
        };
        /** SessionDateCancelOut */
        SessionDateCancelOut: {
            /** Is Cancelled */
            is_cancelled?: boolean | null;
            /** Session Date */
            session_date: string;
        };
        /** SessionDetailOut */
        SessionDetailOut: {
            /** Campaign Id */
            campaign_id: string;
            gm_note: components["schemas"]["GMSessionNoteOut"];
            /** Id */
            id: string;
            /** Player Notes */
            player_notes: components["schemas"]["PlayerSessionNoteOut"][];
            /** Session Date */
            session_date: string;
            /** Title */
            title?: string | null;
        };
        /** SessionNoteCreate */
        SessionNoteCreate: {
            /** Session Date */
            session_date: string;
            /**
             * Title
             * @default
             */
            title?: string;
        };
        /** SessionNoteSearchHit */
        SessionNoteSearchHit: {
            /** Author Display Name */
            author_display_name?: string | null;
            /** Author Id */
            author_id?: string | null;
            /** Author Username */
            author_username: string;
            /** Note Type */
            note_type: string;
            /** Session Date */
            session_date: string;
            /** Session Id */
            session_id: string;
            /** Session Title */
            session_title?: string | null;
            /** Snippet */
            snippet: string;
        };
        /** SessionNoteSearchOut */
        SessionNoteSearchOut: {
            /** Query */
            query: string;
            /** Results */
            results: components["schemas"]["SessionNoteSearchHit"][];
        };
        /** SessionNoteUpdate */
        SessionNoteUpdate: {
            /** Title */
            title?: string | null;
        };
        /**
         * SessionOut
         * @description One live session row, as built by `core._session_payload`.
         */
        SessionOut: {
            /** Created At */
            created_at?: string | null;
            /** Current */
            current: boolean;
            /** Expires At */
            expires_at?: string | null;
            /** Id */
            id: string;
            /** Ip Address */
            ip_address?: string | null;
            /** Last Used At */
            last_used_at?: string | null;
            /** Origin */
            origin: string;
            /** User Agent */
            user_agent?: string | null;
        };
        /**
         * SessionSummaryOut
         * @description A session note's identity — list/create/update all return this shape.
         */
        SessionSummaryOut: {
            /** Id */
            id: string;
            /** Session Date */
            session_date: string;
            /** Title */
            title?: string | null;
        };
        /**
         * SetEntryIn
         * @description One saved track/pad. ``loop`` is only meaningful for a soundboard pad.
         */
        SetEntryIn: {
            /** Audio Id */
            audio_id: string;
            /**
             * Loop
             * @default false
             */
            loop?: boolean;
        };
        /**
         * SetEntryOut
         * @description A resolved entry: the saved id plus the track's current metadata.
         *
         *     Titles are resolved on read rather than stored, so a title edited in the
         *     library shows through on every set that references it.
         */
        SetEntryOut: {
            /** Artist */
            artist: string;
            /** Audio Id */
            audio_id: string;
            /** Has Artwork */
            has_artwork: boolean;
            /** Loop */
            loop: boolean;
            /** Title */
            title: string;
        };
        /** SettingsPatch */
        SettingsPatch: {
            /** Campaign Upload Max File Mb */
            campaign_upload_max_file_mb?: number | null;
            /** Campaign Upload Max Total Mb */
            campaign_upload_max_total_mb?: number | null;
            /** Campaign Uploads Disabled */
            campaign_uploads_disabled?: boolean | null;
            /** Cleanup On Rescan */
            cleanup_on_rescan?: boolean | null;
            /** Custom Login Message */
            custom_login_message?: string | null;
            /** Custom Login Message Enabled */
            custom_login_message_enabled?: boolean | null;
            /** Disable Folder Category Inference */
            disable_folder_category_inference?: boolean | null;
            /** Guest Access Enabled */
            guest_access_enabled?: boolean | null;
            /** Hide Audio */
            hide_audio?: boolean | null;
            /** Hide Campaigns */
            hide_campaigns?: boolean | null;
            /** Hide Maps */
            hide_maps?: boolean | null;
            /** Hide Models */
            hide_models?: boolean | null;
            /** Hide Tokens */
            hide_tokens?: boolean | null;
            /** Oidc Authorization Endpoint */
            oidc_authorization_endpoint?: string | null;
            /** Oidc Auto Launch */
            oidc_auto_launch?: boolean | null;
            /** Oidc Auto Register */
            oidc_auto_register?: boolean | null;
            /** Oidc Button Bg Color */
            oidc_button_bg_color?: string | null;
            /** Oidc Button Border Color */
            oidc_button_border_color?: string | null;
            /** Oidc Button Radius */
            oidc_button_radius?: string | null;
            /** Oidc Button Text */
            oidc_button_text?: string | null;
            /** Oidc Button Text Color */
            oidc_button_text_color?: string | null;
            /** Oidc Client Id */
            oidc_client_id?: string | null;
            /** Oidc Client Secret */
            oidc_client_secret?: string | null;
            /** Oidc Enabled */
            oidc_enabled?: boolean | null;
            /** Oidc End Session Endpoint */
            oidc_end_session_endpoint?: string | null;
            /** Oidc Groups Claim */
            oidc_groups_claim?: string | null;
            /** Oidc Issuer Url */
            oidc_issuer_url?: string | null;
            /** Oidc Jwks Uri */
            oidc_jwks_uri?: string | null;
            /** Oidc Match By */
            oidc_match_by?: string | null;
            /** Oidc Permissions Claim */
            oidc_permissions_claim?: string | null;
            /** Oidc Signing Alg */
            oidc_signing_alg?: string | null;
            /** Oidc Token Endpoint */
            oidc_token_endpoint?: string | null;
            /** Oidc Token Issuer */
            oidc_token_issuer?: string | null;
            /** Oidc Userinfo Endpoint */
            oidc_userinfo_endpoint?: string | null;
            /** Password Auth Enabled */
            password_auth_enabled?: boolean | null;
            /** Rescan Schedule Enabled */
            rescan_schedule_enabled?: boolean | null;
            /** Rescan Schedule Hour */
            rescan_schedule_hour?: number | null;
            /** Rescan Schedule Interval */
            rescan_schedule_interval?: string | null;
            /** Rescan Schedule Minute */
            rescan_schedule_minute?: number | null;
            /** Rescan Schedule Weekday */
            rescan_schedule_weekday?: number | null;
            /** Restricted Categories */
            restricted_categories?: {
                [key: string]: unknown;
            } | null;
            /** Share Links Role Gm */
            share_links_role_gm?: boolean | null;
            /** Share Links Role Player */
            share_links_role_player?: boolean | null;
            /** Show Stat Audio */
            show_stat_audio?: boolean | null;
            /** Show Stat Books */
            show_stat_books?: boolean | null;
            /** Show Stat Library Size */
            show_stat_library_size?: boolean | null;
            /** Show Stat Maps */
            show_stat_maps?: boolean | null;
            /** Show Stat Models */
            show_stat_models?: boolean | null;
            /** Show Stat Pages */
            show_stat_pages?: boolean | null;
            /** Show Stat Size */
            show_stat_size?: boolean | null;
            /** Show Stat Systems */
            show_stat_systems?: boolean | null;
            /** Show Stat Tokens */
            show_stat_tokens?: boolean | null;
        };
        /**
         * SettingsResponse
         * @description The full admin settings payload, as built by `_helpers._to_typed`.
         *
         *     Every field is derived from the string-valued `app_settings` table through
         *     `_DEFAULTS`, so each one is always present and already coerced to its final
         *     type — none can come back null. The `*_env_locked` booleans say whether the
         *     matching field is pinned by an environment variable and so read-only in the
         *     admin UI.
         */
        SettingsResponse: {
            /** Cleanup On Rescan */
            cleanup_on_rescan: boolean;
            /** Custom Login Message */
            custom_login_message: string;
            /** Custom Login Message Enabled */
            custom_login_message_enabled: boolean;
            /** Disable Folder Category Inference */
            disable_folder_category_inference: boolean;
            /** Disable Folder Category Inference Env Locked */
            disable_folder_category_inference_env_locked: boolean;
            /** Guest Access Enabled */
            guest_access_enabled: boolean;
            /** Guest Access Env Locked */
            guest_access_env_locked: boolean;
            /** Hide Audio */
            hide_audio: boolean;
            /** Hide Campaigns */
            hide_campaigns: boolean;
            /** Hide Maps */
            hide_maps: boolean;
            /** Hide Models */
            hide_models: boolean;
            /** Hide Tokens */
            hide_tokens: boolean;
            /** Oidc Authorization Endpoint */
            oidc_authorization_endpoint: string;
            /** Oidc Authorization Endpoint Env Locked */
            oidc_authorization_endpoint_env_locked: boolean;
            /** Oidc Auto Launch */
            oidc_auto_launch: boolean;
            /** Oidc Auto Launch Env Locked */
            oidc_auto_launch_env_locked: boolean;
            /** Oidc Auto Register */
            oidc_auto_register: boolean;
            /** Oidc Auto Register Env Locked */
            oidc_auto_register_env_locked: boolean;
            /** Oidc Button Bg Color */
            oidc_button_bg_color: string;
            /** Oidc Button Bg Color Env Locked */
            oidc_button_bg_color_env_locked: boolean;
            /** Oidc Button Border Color */
            oidc_button_border_color: string;
            /** Oidc Button Border Color Env Locked */
            oidc_button_border_color_env_locked: boolean;
            /** Oidc Button Icon Env Locked */
            oidc_button_icon_env_locked: boolean;
            /** Oidc Button Icon Url */
            oidc_button_icon_url: string;
            /** Oidc Button Radius */
            oidc_button_radius: string;
            /** Oidc Button Radius Env Locked */
            oidc_button_radius_env_locked: boolean;
            /** Oidc Button Text */
            oidc_button_text: string;
            /** Oidc Button Text Color */
            oidc_button_text_color: string;
            /** Oidc Button Text Color Env Locked */
            oidc_button_text_color_env_locked: boolean;
            /** Oidc Button Text Env Locked */
            oidc_button_text_env_locked: boolean;
            /** Oidc Client Id */
            oidc_client_id: string;
            /** Oidc Client Id Env Locked */
            oidc_client_id_env_locked: boolean;
            /** Oidc Client Secret Env Locked */
            oidc_client_secret_env_locked: boolean;
            /** Oidc Client Secret Length */
            oidc_client_secret_length: number;
            /** Oidc Client Secret Set */
            oidc_client_secret_set: boolean;
            /** Oidc Enabled */
            oidc_enabled: boolean;
            /** Oidc Enabled Env Locked */
            oidc_enabled_env_locked: boolean;
            /** Oidc End Session Endpoint */
            oidc_end_session_endpoint: string;
            /** Oidc End Session Endpoint Env Locked */
            oidc_end_session_endpoint_env_locked: boolean;
            /** Oidc Groups Claim */
            oidc_groups_claim: string;
            /** Oidc Groups Claim Env Locked */
            oidc_groups_claim_env_locked: boolean;
            /** Oidc Issuer Url */
            oidc_issuer_url: string;
            /** Oidc Issuer Url Env Locked */
            oidc_issuer_url_env_locked: boolean;
            /** Oidc Jwks Uri */
            oidc_jwks_uri: string;
            /** Oidc Jwks Uri Env Locked */
            oidc_jwks_uri_env_locked: boolean;
            /** Oidc Match By */
            oidc_match_by: string;
            /** Oidc Match By Env Locked */
            oidc_match_by_env_locked: boolean;
            /** Oidc Permissions Claim */
            oidc_permissions_claim: string;
            /** Oidc Permissions Claim Env Locked */
            oidc_permissions_claim_env_locked: boolean;
            /** Oidc Redirect Uri */
            oidc_redirect_uri: string;
            /** Oidc Signing Alg */
            oidc_signing_alg: string;
            /** Oidc Signing Alg Env Locked */
            oidc_signing_alg_env_locked: boolean;
            /** Oidc Token Endpoint */
            oidc_token_endpoint: string;
            /** Oidc Token Endpoint Env Locked */
            oidc_token_endpoint_env_locked: boolean;
            /** Oidc Token Issuer */
            oidc_token_issuer: string;
            /** Oidc Token Issuer Env Locked */
            oidc_token_issuer_env_locked: boolean;
            /** Oidc Userinfo Endpoint */
            oidc_userinfo_endpoint: string;
            /** Oidc Userinfo Endpoint Env Locked */
            oidc_userinfo_endpoint_env_locked: boolean;
            /** Password Auth Enabled */
            password_auth_enabled: boolean;
            /** Password Auth Env Locked */
            password_auth_env_locked: boolean;
            /** Rescan Schedule Enabled */
            rescan_schedule_enabled: boolean;
            /** Rescan Schedule Hour */
            rescan_schedule_hour: number;
            /** Rescan Schedule Interval */
            rescan_schedule_interval: string;
            /** Rescan Schedule Minute */
            rescan_schedule_minute: number;
            /** Rescan Schedule Weekday */
            rescan_schedule_weekday: number;
            /** Restricted Categories */
            restricted_categories: {
                [key: string]: unknown;
            };
            /** Share Links Enabled */
            share_links_enabled: boolean;
            /** Share Links Role Gm */
            share_links_role_gm: boolean;
            /** Share Links Role Player */
            share_links_role_player: boolean;
            /** Show Stat Audio */
            show_stat_audio: boolean;
            /** Show Stat Books */
            show_stat_books: boolean;
            /** Show Stat Library Size */
            show_stat_library_size: boolean;
            /** Show Stat Maps */
            show_stat_maps: boolean;
            /** Show Stat Models */
            show_stat_models: boolean;
            /** Show Stat Pages */
            show_stat_pages: boolean;
            /** Show Stat Size */
            show_stat_size: boolean;
            /** Show Stat Systems */
            show_stat_systems: boolean;
            /** Show Stat Tokens */
            show_stat_tokens: boolean;
        };
        /** SetupRequest */
        SetupRequest: {
            /** Password */
            password: string;
            /** Username */
            username: string;
        };
        /** ShareLinkCreate */
        ShareLinkCreate: {
            /** Cell */
            cell?: number | null;
            /** Expires In Days */
            expires_in_days?: number | null;
            /**
             * Label
             * @default
             */
            label?: string;
            /** Password */
            password?: string | null;
            /** Resource Id */
            resource_id: string;
            /**
             * Resource Type
             * @enum {string}
             */
            resource_type: "book" | "map" | "token" | "audio" | "model";
            /** Variant */
            variant?: "otfbm" | null;
        };
        /** ShareLinkOut */
        ShareLinkOut: {
            /** Created At */
            created_at?: string | null;
            /** Expires At */
            expires_at?: string | null;
            /** File Url */
            file_url?: string | null;
            /** Filename */
            filename: string;
            /** Has Password */
            has_password: boolean;
            /** Id */
            id: string;
            /** Label */
            label: string;
            /** Last Used At */
            last_used_at?: string | null;
            /** Resource Id */
            resource_id: string;
            /** Resource Name */
            resource_name: string;
            /** Resource Type */
            resource_type: string;
            /** Revoked At */
            revoked_at?: string | null;
            /** State */
            state: string;
            /** Url */
            url?: string | null;
            /**
             * Use Count
             * @default 0
             */
            use_count?: number;
            /** User Id */
            user_id?: string | null;
            /** Username */
            username?: string | null;
            /** Variant */
            variant?: string | null;
            /** Variant Options */
            variant_options?: {
                [key: string]: unknown;
            } | null;
        };
        /**
         * ShareLinkPermission
         * @description Whether the caller may create share links, and which layer decided.
         */
        ShareLinkPermission: {
            /** Allowed */
            allowed: boolean;
            /** Enabled */
            enabled: boolean;
            /** Override */
            override: string;
            /** Role Allows */
            role_allows: boolean;
            /** Source */
            source: string;
        };
        /**
         * ShareLinkUpdate
         * @description Only the fields sent are changed. `expires_in_days: null` makes the link
         *     never expire; `password: null` (or "") removes the password.
         */
        ShareLinkUpdate: {
            /** Expires In Days */
            expires_in_days?: number | null;
            /** Label */
            label?: string | null;
            /** Password */
            password?: string | null;
        };
        /**
         * ShareMetaResponse
         * @description `GET /api/share/{token}/meta`. Only the first two fields are present until
         *     a password-protected link is unlocked.
         */
        ShareMetaResponse: {
            /** Download Url */
            download_url?: string | null;
            /** Expires At */
            expires_at?: string | null;
            /** File Size */
            file_size?: number | null;
            /** File Url */
            file_url?: string | null;
            /** Filename */
            filename?: string | null;
            /** Label */
            label?: string | null;
            /** Media Kind */
            media_kind?: string | null;
            /** Media Type */
            media_type?: string | null;
            /** Name */
            name?: string | null;
            /** Password Required */
            password_required: boolean;
            /** Resource Type */
            resource_type?: string | null;
            /** Unlocked */
            unlocked: boolean;
        };
        /** ShareUnlock */
        ShareUnlock: {
            /** Password */
            password: string;
        };
        /** ShareUnlockResponse */
        ShareUnlockResponse: {
            /** Unlocked */
            unlocked: boolean;
        };
        /** SheetCatalogueResponse */
        SheetCatalogueResponse: {
            /**
             * Downloads Enabled
             * @default true
             */
            downloads_enabled?: boolean;
            /** Errors */
            errors?: components["schemas"]["CatalogueSourceError"][];
            /**
             * Index Url
             * @default
             */
            index_url?: string;
            /** Sheets */
            sheets: components["schemas"]["CatalogueSheet"][];
            /** Sources */
            sources?: string[];
        };
        /**
         * SheetSourceOut
         * @description One blank sheet a member can duplicate.
         */
        SheetSourceOut: {
            /** Id */
            id: string;
            /** Name */
            name: string;
        };
        /** SheetSourcesOut */
        SheetSourcesOut: {
            /** Books */
            books: components["schemas"]["SheetSourceOut"][];
            /** Files */
            files: components["schemas"]["SheetSourceOut"][];
        };
        /**
         * ShelfFacetsResponse
         * @description The values the shelf's filter menus offer, over the whole visible shelf.
         */
        ShelfFacetsResponse: {
            /** Categories */
            categories: string[];
            /** Genres */
            genres: string[];
            /** Product Code Prefixes */
            product_code_prefixes: string[];
            /** Tags */
            tags: string[];
        };
        /**
         * ShelfFolderGroup
         * @description One stored directory on the shelf holding matching books.
         */
        ShelfFolderGroup: {
            /** Category */
            category: string;
            /** Count */
            count: number;
            /** Dir */
            dir: string;
            /** First */
            first?: number | string | null;
            /** Path */
            path: string;
        };
        /** ShelfGroupsResponse */
        ShelfGroupsResponse: {
            /** Groups */
            groups: components["schemas"]["ShelfFolderGroup"][];
            /** Total */
            total: number;
        };
        /**
         * SidecarExportResponse
         * @description Outcome of a sidecar backfill run.
         */
        SidecarExportResponse: {
            /** Covers */
            covers: number;
            /** Errors */
            errors: string[];
            /** Failed */
            failed: number;
            /** Read Only */
            read_only: boolean;
            /** Skipped Foreign */
            skipped_foreign: number;
            /** Skipped Missing */
            skipped_missing: number;
            /** Written */
            written: number;
        };
        /**
         * SidecarSettings
         * @description Metadata sidecar export configuration (issue #300).
         */
        SidecarSettings: {
            /**
             * Covers
             * @description Write the cover image next to the metadata file.
             * @default false
             */
            covers?: boolean;
            /**
             * Formats
             * @description Enabled sidecar formats: opf, nfo, json, yaml. Empty disables export.
             */
            formats?: string[];
            /**
             * Overwrite Foreign
             * @description Allow a backfill to replace sidecars Grimoire did not write.
             * @default false
             */
            overwrite_foreign?: boolean;
        };
        /**
         * StatsResponse
         * @description Library counts for the dashboard and external integrations.
         */
        StatsResponse: {
            /** Audio */
            audio: number;
            /** Books */
            books: number;
            /** Game Systems */
            game_systems: number;
            /** Indexed Books */
            indexed_books: number;
            /** Library Size Mb */
            library_size_mb: number;
            /** Maps */
            maps: number;
            /** Models */
            models: number;
            /** Tokens */
            tokens: number;
            /** Total Pages */
            total_pages: number;
            /** Total Size Mb */
            total_size_mb: number;
        };
        /**
         * SuggestedResourceOut
         * @description One suggested (system) book for the create wizard.
         */
        SuggestedResourceOut: {
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Name */
            name: string;
            /** Resource Id */
            resource_id: string;
            /** Resource Type */
            resource_type: string;
            /** Subtitle */
            subtitle?: string | null;
            /** Suggested */
            suggested: boolean;
        };
        /**
         * SystemBooksPage
         * @description One page of a system's books matching the shelf filters (issue #221).
         */
        SystemBooksPage: {
            /** Books */
            books: components["schemas"]["BookOut"][];
            /** Total */
            total: number;
        };
        /** SystemCoverResponse */
        SystemCoverResponse: {
            /** Cover Image */
            cover_image: string;
        };
        /**
         * SystemCoverSourceIn
         * @description Set a system cover from an image Grimoire already holds (issue #286).
         *
         *     `source_type` is one of `services.image_source.SOURCE_TYPES`; the
         *     campaign-scoped `campaign_file` kind is not reachable here, since a system
         *     has no campaign context to resolve it against.
         */
        SystemCoverSourceIn: {
            /** Source Id */
            source_id: string;
            /** Source Type */
            source_type: string;
        };
        /**
         * SystemDetail
         * @description `get_system` adds the system's books and, for a container, its children.
         */
        SystemDetail: {
            /** Book Count */
            book_count: number;
            /** Books */
            books: components["schemas"]["BookOut"][];
            /**
             * Category Depth
             * @default 2
             */
            category_depth?: number;
            /** Character Builder Url */
            character_builder_url?: string | null;
            /** Character Builder Urls */
            character_builder_urls: components["schemas"]["LinkRef"][];
            /** Child Count */
            child_count: number;
            /** Children */
            children: components["schemas"]["SystemSummary"][];
            /** Codex Id */
            codex_id?: string | null;
            /** Container Kind */
            container_kind: string;
            /** Cover Book Id */
            cover_book_id?: string | null;
            /** Cover Image */
            cover_image?: string | null;
            /** Description */
            description?: string | null;
            /** Dice Materials */
            dice_materials: string[];
            /** Edition */
            edition: string;
            /** Genre */
            genre?: string | null;
            /** Genres */
            genres: string[];
            /** Has Cover */
            has_cover: boolean;
            /** Id */
            id: string;
            /** Is Explicit */
            is_explicit: boolean;
            /** Is One Page */
            is_one_page: boolean;
            /** Is System Agnostic */
            is_system_agnostic: boolean;
            /** License */
            license: string;
            /** Name */
            name: string;
            /** Name Is Custom */
            name_is_custom: boolean;
            /** Parent Id */
            parent_id?: string | null;
            /** Parent Is One Page */
            parent_is_one_page: boolean;
            /** Parent Name */
            parent_name: string;
            /** Parent System */
            parent_system: string;
            /** Publishers */
            publishers: components["schemas"]["PublisherRef"][];
            /** Scope Path */
            scope_path?: string | null;
            /** Slug */
            slug: string;
            /** System Family */
            system_family: string;
            /** Tags */
            tags: string[];
            /** Total Page Count */
            total_page_count: number;
            /** Urls */
            urls: components["schemas"]["LinkRef"][];
            /** Year */
            year?: number | null;
        };
        /** SystemFamiliesResponse */
        SystemFamiliesResponse: {
            /** Families */
            families: components["schemas"]["LookupOut"][];
        };
        /** SystemFamilyCreate */
        SystemFamilyCreate: {
            /** Name */
            name: string;
        };
        /**
         * SystemSummary
         * @description A game system, as built by `_serializers.serialize_system_summary`.
         */
        SystemSummary: {
            /** Book Count */
            book_count: number;
            /**
             * Category Depth
             * @default 2
             */
            category_depth?: number;
            /** Character Builder Url */
            character_builder_url?: string | null;
            /** Character Builder Urls */
            character_builder_urls: components["schemas"]["LinkRef"][];
            /** Child Count */
            child_count: number;
            /** Codex Id */
            codex_id?: string | null;
            /** Container Kind */
            container_kind: string;
            /** Cover Book Id */
            cover_book_id?: string | null;
            /** Cover Image */
            cover_image?: string | null;
            /** Description */
            description?: string | null;
            /** Dice Materials */
            dice_materials: string[];
            /** Edition */
            edition: string;
            /** Genre */
            genre?: string | null;
            /** Genres */
            genres: string[];
            /** Has Cover */
            has_cover: boolean;
            /** Id */
            id: string;
            /** Is Explicit */
            is_explicit: boolean;
            /** Is One Page */
            is_one_page: boolean;
            /** Is System Agnostic */
            is_system_agnostic: boolean;
            /** License */
            license: string;
            /** Name */
            name: string;
            /** Name Is Custom */
            name_is_custom: boolean;
            /** Parent Id */
            parent_id?: string | null;
            /** Parent Is One Page */
            parent_is_one_page: boolean;
            /** Parent Name */
            parent_name: string;
            /** Parent System */
            parent_system: string;
            /** Publishers */
            publishers: components["schemas"]["PublisherRef"][];
            /** Slug */
            slug: string;
            /** System Family */
            system_family: string;
            /** Tags */
            tags: string[];
            /** Total Page Count */
            total_page_count: number;
            /** Urls */
            urls: components["schemas"]["LinkRef"][];
            /** Year */
            year?: number | null;
        };
        /**
         * TagCreate
         * @description Create a tag up-front (optional; tags are also created on first use).
         */
        TagCreate: {
            /** Display */
            display?: string | null;
            /** Value */
            value: string;
        };
        /**
         * TagCreatedResponse
         * @description A newly created tag. All three columns are NOT NULL.
         */
        TagCreatedResponse: {
            /** Category */
            category: string;
            /** Display */
            display: string;
            /** Internal */
            internal: string;
        };
        /**
         * TagDisplayUpdate
         * @description Rename a tag's human-facing display value.
         *
         *     The internal key follows the new display when its normalized form changes,
         *     so the new value has to be addressable too — which is what lets a tag that
         *     already contains a slash be renamed out of trouble.
         */
        TagDisplayUpdate: {
            /** Display */
            display: string;
        };
        /**
         * TagFolderItemsResponse
         * @description One page of the items inside a tagged folder.
         */
        TagFolderItemsResponse: {
            /** Items */
            items: (components["schemas"]["TaggedBookItem"] | components["schemas"]["TaggedMapItem"] | components["schemas"]["TaggedTokenItem"] | components["schemas"]["TaggedAudioItem"] | components["schemas"]["TaggedModelItem"] | components["schemas"]["TaggedSystemItem"])[];
            /** Total */
            total: number;
        };
        /**
         * TagItemsResponse
         * @description A tag's summary plus one page of the items carrying it directly.
         */
        TagItemsResponse: {
            /** Category */
            category: string;
            /** Counts */
            counts: {
                [key: string]: number;
            };
            /** Display */
            display: string;
            /** Folders */
            folders: components["schemas"]["TaggedFolder"][];
            /** Internal */
            internal: string;
            /** Items */
            items: (components["schemas"]["TaggedBookItem"] | components["schemas"]["TaggedMapItem"] | components["schemas"]["TaggedTokenItem"] | components["schemas"]["TaggedAudioItem"] | components["schemas"]["TaggedModelItem"] | components["schemas"]["TaggedSystemItem"])[];
            /** Total */
            total: number;
        };
        /**
         * TagListItem
         * @description One row of the tags listing, after folder tags are merged in.
         *
         *     `category` comes from `tag_service.effective_category`, which always returns
         *     a string. A folder-only tag has no `Tag` row, so its entry is built from
         *     scratch by `_merge_folder_tags` — the same four keys either way, plus the
         *     `is_favorite` flag the handler stamps on every row before returning.
         */
        TagListItem: {
            /** Category */
            category: string;
            /** Count */
            count: number;
            /** Display */
            display: string;
            /** Internal */
            internal: string;
            /** Is Favorite */
            is_favorite: boolean;
        };
        /**
         * TagMerge
         * @description Merge this tag into another, re-pointing all its resource links.
         */
        TagMerge: {
            /** Into */
            into: string;
        };
        /**
         * TagRenamedResponse
         * @description The result of a rename or merge — no `category` is returned by either.
         */
        TagRenamedResponse: {
            /** Display */
            display: string;
            /** Internal */
            internal: string;
        };
        /** TaggedAudioItem */
        TaggedAudioItem: {
            /** Duration */
            duration: number;
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Has Artwork */
            has_artwork: boolean;
            /** Item Id */
            item_id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            item_type: "audio";
            /** Title */
            title: string;
        };
        /** TaggedBookItem */
        TaggedBookItem: {
            /** Category */
            category?: string | null;
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Index Failed */
            index_failed?: boolean | null;
            /** Indexed */
            indexed?: boolean | null;
            /** Item Id */
            item_id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            item_type: "book";
            /** Page Count */
            page_count?: number | null;
            /** Title */
            title: string;
        };
        /**
         * TaggedFolder
         * @description A folder carrying the tag, with how many items it holds.
         *
         *     The items come a page at a time from ``/tags/{internal}/folder-items``,
         *     addressed by ``key`` (the folder record's own path; ``path`` is for display).
         */
        TaggedFolder: {
            /** Count */
            count: number;
            /** Key */
            key: string;
            /** Path */
            path: string;
            /** Resource Type */
            resource_type: string;
        };
        /** TaggedMapItem */
        TaggedMapItem: {
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Item Id */
            item_id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            item_type: "map";
        };
        /** TaggedModelItem */
        TaggedModelItem: {
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /**
             * Is Presupported
             * @default false
             */
            is_presupported?: boolean;
            /**
             * Is Unsupported
             * @default false
             */
            is_unsupported?: boolean;
            /** Item Id */
            item_id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            item_type: "model";
            /** Triangle Count */
            triangle_count?: number | null;
        };
        /** TaggedSystemItem */
        TaggedSystemItem: {
            /** Cover Book Id */
            cover_book_id?: string | null;
            /** Item Id */
            item_id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            item_type: "system";
            /** Name */
            name: string;
            /** Publishers */
            publishers: components["schemas"]["PublisherRef"][];
        };
        /** TaggedTokenItem */
        TaggedTokenItem: {
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Item Id */
            item_id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            item_type: "token";
        };
        /** TagsResponse */
        TagsResponse: {
            /** Tags */
            tags: components["schemas"]["TagListItem"][];
        };
        /** ThemeBrowseResponse */
        ThemeBrowseResponse: {
            /** Default Index Url */
            default_index_url: string;
            /** Generated */
            generated: string;
            /** Index Url */
            index_url: string;
            /** Is Custom Url */
            is_custom_url: boolean;
            /** Themes */
            themes: components["schemas"]["CatalogueTheme"][];
        };
        /** ThemeDeletedResponse */
        ThemeDeletedResponse: {
            /** Ok */
            ok: boolean;
        };
        /**
         * ThemeImport
         * @description A theme pasted or uploaded by the user.
         *
         *     Loosely typed on purpose: the real validation is
         *     ``services.themes.parse_theme``, which drops unknown tokens and unsafe
         *     colours. Duplicating the allowlist here would give two places to keep in
         *     step and no extra safety.
         */
        ThemeImport: {
            /** App Mode */
            app_mode?: string | null;
            /** Id */
            id?: string | null;
            /** Mode */
            mode?: string | null;
            /** Name */
            name?: string | null;
            /**
             * Tokens
             * @default {}
             */
            tokens?: {
                [key: string]: unknown;
            };
            /**
             * Variants
             * @default {}
             */
            variants?: {
                [key: string]: unknown;
            };
            /** Version */
            version?: string | null;
        };
        /** ThemeListResponse */
        ThemeListResponse: {
            /** App Mode */
            app_mode: string;
            /** App Modes */
            app_modes: string[];
            /** Built In */
            built_in: components["schemas"]["BuiltInTheme"][];
            /** Default Index Url */
            default_index_url: string;
            /** Downloads Enabled */
            downloads_enabled: boolean;
            /** Index Url */
            index_url: string;
            /** Installed */
            installed: components["schemas"]["InstalledTheme"][];
            /** Is Custom Url */
            is_custom_url: boolean;
            /** Mode */
            mode: string;
            /** Theme Id */
            theme_id: string;
        };
        /**
         * ThemeSelection
         * @description The user's active appearance: a mode, and optionally an installed theme.
         */
        ThemeSelection: {
            /** App Mode */
            app_mode?: string | null;
            /** Mode */
            mode?: string | null;
            /** Theme Id */
            theme_id?: string | null;
        };
        /**
         * ThemeSelectionResponse
         * @description The active app_mode plus the selection within it.
         */
        ThemeSelectionResponse: {
            /** App Mode */
            app_mode: string;
            /** Mode */
            mode: string;
            /** Theme Id */
            theme_id: string;
        };
        /** ThemeSourceResponse */
        ThemeSourceResponse: {
            /** Index Url */
            index_url: string;
            /** Is Custom Url */
            is_custom_url: boolean;
        };
        /**
         * ThemeSourceUpdate
         * @description An operator pointing the catalogue at a fork or mirror.
         */
        ThemeSourceUpdate: {
            /** Index Url */
            index_url?: string | null;
        };
        /**
         * TocEntry
         * @description One PDF outline node; `children` nests the levels below it.
         */
        TocEntry: {
            /** Children */
            children: components["schemas"]["TocEntry"][];
            /** Level */
            level: number;
            /** Page */
            page: number;
            /** Title */
            title: string;
        };
        /** TocResponse */
        TocResponse: {
            /** Toc */
            toc: components["schemas"]["TocEntry"][];
        };
        /**
         * TokenBulkItem
         * @description One Token entry in a bulk update.
         */
        TokenBulkItem: {
            /** Description */
            description?: string | null;
            /** Id */
            id: string;
            /** Is Explicit */
            is_explicit?: boolean | null;
            /** Tags */
            tags?: string[] | null;
        };
        /**
         * TokenBulkUpdate
         * @description A batch of Token updates applied in one transaction.
         */
        TokenBulkUpdate: {
            /** Items */
            items: components["schemas"]["TokenBulkItem"][];
        };
        /**
         * TokenDetailResponse
         * @description `GET /tokens/{id}` — token metadata, folder context, and image size.
         *
         *     `pixel_width`/`pixel_height` are None for archives and for any image PIL
         *     cannot open.
         */
        TokenDetailResponse: {
            /** Added At */
            added_at?: string | null;
            /** Description */
            description?: string | null;
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Folder Path */
            folder_path: string;
            /** Folder Tags */
            folder_tags: string[];
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Id */
            id: string;
            /** Is Archive */
            is_archive: boolean;
            /** Is Explicit */
            is_explicit: boolean;
            /** Is Missing */
            is_missing: boolean;
            /** Pixel Height */
            pixel_height?: number | null;
            /** Pixel Width */
            pixel_width?: number | null;
            /** Relative Path */
            relative_path: string;
            /** Tags */
            tags: string[];
            /**
             * Variant Count
             * @default 0
             */
            variant_count?: number;
            /**
             * Variant Kind
             * @default
             */
            variant_kind?: string;
            /** Variant Kinds */
            variant_kinds?: string[];
            /**
             * Variant Label
             * @default
             */
            variant_label?: string;
            /**
             * Variant Main Filename
             * @default
             */
            variant_main_filename?: string;
            /** Variant Main Id */
            variant_main_id?: string | null;
            /**
             * Variant Main Kind
             * @default
             */
            variant_main_kind?: string;
            /**
             * Variant Main Label
             * @default
             */
            variant_main_label?: string;
            /** Variant Parent Id */
            variant_parent_id?: string | null;
            /**
             * Variants
             * @default []
             */
            variants?: components["schemas"]["VariantEntry"][];
        };
        /** TokenFoldersResponse */
        TokenFoldersResponse: {
            /** Folders */
            folders: components["schemas"]["backend__routers__tokens___schemas__FolderTagsOut"][];
            /**
             * Frame Folders
             * @default []
             */
            frame_folders?: string[];
        };
        /** TokenListResponse */
        TokenListResponse: {
            /** Tokens */
            tokens: components["schemas"]["TokenOut"][];
            /** Total */
            total: number;
        };
        /**
         * TokenOut
         * @description One token, as returned by the list endpoint.
         *
         *     `description`/`file_size`/`has_thumbnail` are declared `default=...` on
         *     `Token` rather than NOT NULL, so NULL is still representable (the default
         *     applies at insert only, and rows predating a column migration keep NULL) —
         *     hence Optional. `is_explicit`/`is_missing`/`is_archive` are coalesced with
         *     `bool(...)` by the handler and stay required.
         */
        TokenOut: {
            /** Added At */
            added_at?: string | null;
            /** Description */
            description?: string | null;
            /** File Size */
            file_size?: number | null;
            /** Filename */
            filename: string;
            /** Has Thumbnail */
            has_thumbnail?: boolean | null;
            /** Id */
            id: string;
            /** Is Archive */
            is_archive: boolean;
            /** Is Explicit */
            is_explicit: boolean;
            /** Is Missing */
            is_missing: boolean;
            /** Relative Path */
            relative_path: string;
            /** Tags */
            tags: string[];
            /**
             * Variant Count
             * @default 0
             */
            variant_count?: number;
            /** Variant Kinds */
            variant_kinds?: string[];
        };
        /** TokenUpdate */
        TokenUpdate: {
            /** Description */
            description?: string | null;
            /** Is Explicit */
            is_explicit?: boolean | null;
            /** Tags */
            tags?: string[] | null;
        };
        /**
         * UISettingsResponse
         * @description The visibility subset any authenticated user may read.
         */
        UISettingsResponse: {
            /** Api Keys Enabled */
            api_keys_enabled: boolean;
            /** Campaign Upload Max File Mb */
            campaign_upload_max_file_mb: number;
            /** Campaign Upload Max Total Mb */
            campaign_upload_max_total_mb: number;
            /** Campaign Uploads Disabled */
            campaign_uploads_disabled: boolean;
            /** Guest Access Enabled */
            guest_access_enabled: boolean;
            /** Hide Audio */
            hide_audio: boolean;
            /** Hide Campaigns */
            hide_campaigns: boolean;
            /** Hide Maps */
            hide_maps: boolean;
            /** Hide Models */
            hide_models: boolean;
            /** Hide Tokens */
            hide_tokens: boolean;
            /** Library Writable */
            library_writable: boolean;
            /** Mcp Enabled */
            mcp_enabled: boolean;
            /** Share Links Enabled */
            share_links_enabled: boolean;
            /** Show Stat Audio */
            show_stat_audio: boolean;
            /** Show Stat Books */
            show_stat_books: boolean;
            /** Show Stat Library Size */
            show_stat_library_size: boolean;
            /** Show Stat Maps */
            show_stat_maps: boolean;
            /** Show Stat Models */
            show_stat_models: boolean;
            /** Show Stat Pages */
            show_stat_pages: boolean;
            /** Show Stat Size */
            show_stat_size: boolean;
            /** Show Stat Systems */
            show_stat_systems: boolean;
            /** Show Stat Tokens */
            show_stat_tokens: boolean;
        };
        /** UnlinkRequest */
        UnlinkRequest: {
            /**
             * Ids
             * @default []
             */
            ids?: string[];
            /** Parent Id */
            parent_id?: string | null;
            /**
             * Resource Type
             * @enum {string}
             */
            resource_type: "book" | "map" | "token" | "audio" | "model";
        };
        /** UnlinkResult */
        UnlinkResult: {
            /** Unlinked */
            unlinked: string[];
        };
        /** UpdateAllResponse */
        UpdateAllResponse: {
            /** Failed */
            failed: components["schemas"]["AddonUpdateFailure"][];
            /** Status */
            status: string;
            /** Updated */
            updated: components["schemas"]["AddonUpdated"][];
        };
        /**
         * UploadResponse
         * @description Where an uploaded file landed. `name` may differ from what was sent when
         *     the conflict policy suffixed it. `record_id` and `replaced` are set when
         *     `on_conflict=replace` overwrote an indexed book, which keeps its id.
         */
        UploadResponse: {
            /** Name */
            name: string;
            /** Path */
            path: string;
            /** Record Id */
            record_id?: string | null;
            /**
             * Replaced
             * @default false
             */
            replaced?: boolean;
            /** Size */
            size: number;
        };
        /** UserCreate */
        UserCreate: {
            /** Allow Explicit */
            allow_explicit?: boolean | null;
            /** Api Keys Enabled */
            api_keys_enabled?: boolean | null;
            /** Campaign Access */
            campaign_access?: boolean | null;
            /** Email */
            email?: string | null;
            /** Password */
            password?: string | null;
            /**
             * Role
             * @default player
             */
            role?: string;
            /** Share Links */
            share_links?: ("role" | "allow" | "deny") | null;
            /** Username */
            username: string;
        };
        /** UserImporterInstalled */
        UserImporterInstalled: {
            /** Id */
            id: string;
            /** Name */
            name: string;
            /**
             * Version
             * @default
             */
            version?: string;
        };
        /**
         * UserOut
         * @description A user row in the admin list, and the body returned by create/convert.
         *
         *     The three handlers emit slightly different subsets of these keys — the admin
         *     list and `convert_guest` include `display_name`/`created_at`, `create_user`
         *     does not — so every key that is not in all of them is Optional.
         */
        UserOut: {
            /** Allow Explicit */
            allow_explicit: boolean;
            /** Api Keys Enabled */
            api_keys_enabled: boolean;
            /** Campaign Access */
            campaign_access: boolean;
            /** Campaign Count */
            campaign_count: number;
            /** Created At */
            created_at?: string | null;
            /** Display Name */
            display_name?: string | null;
            /** Email */
            email?: string | null;
            /**
             * Explicit Locked
             * @default false
             */
            explicit_locked?: boolean;
            /** Id */
            id: string;
            /** Oidc Linked */
            oidc_linked: boolean;
            /** Role */
            role?: string | null;
            /**
             * Share Links
             * @default role
             */
            share_links?: string;
            /**
             * Share Links Allowed
             * @default false
             */
            share_links_allowed?: boolean;
            /**
             * Share Links Source
             * @default role
             */
            share_links_source?: string;
            /** Username */
            username: string;
        };
        /** UserUpdate */
        UserUpdate: {
            /** Allow Explicit */
            allow_explicit?: boolean | null;
            /** Api Keys Enabled */
            api_keys_enabled?: boolean | null;
            /** Campaign Access */
            campaign_access?: boolean | null;
            /** Email */
            email?: string | null;
            /** Password */
            password?: string | null;
            /** Role */
            role?: string | null;
            /** Share Links */
            share_links?: ("role" | "allow" | "deny") | null;
        };
        /**
         * UserUpdateResponse
         * @description `update_user` returns a deliberately narrower body than `UserOut`.
         */
        UserUpdateResponse: {
            /** Allow Explicit */
            allow_explicit: boolean;
            /** Api Keys Enabled */
            api_keys_enabled: boolean;
            /** Campaign Access */
            campaign_access: boolean;
            /** Email */
            email?: string | null;
            /** Id */
            id: string;
            /** Role */
            role?: string | null;
            /**
             * Share Links
             * @default role
             */
            share_links?: string;
            /**
             * Share Links Allowed
             * @default false
             */
            share_links_allowed?: boolean;
            /**
             * Share Links Source
             * @default role
             */
            share_links_source?: string;
            /** Username */
            username: string;
        };
        /** ValidationError */
        ValidationError: {
            /** Context */
            ctx?: Record<string, never>;
            /** Input */
            input?: unknown;
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
        /**
         * ValidatorResult
         * @description One schema validator that fired against a character.
         */
        ValidatorResult: {
            /** Field */
            field?: string | null;
            /**
             * Message
             * @default
             */
            message?: string;
            /** Rule */
            rule: string;
            /**
             * Severity
             * @default warning
             */
            severity?: string;
        };
        /**
         * VariantEntry
         * @description One row of a version picker: another copy of the same thing.
         *
         *     Mirrors `services.variants.serialize_variant`. The collection-specific
         *     fields are optional rather than branching this model per resource type —
         *     a map has no page count, a token has no title.
         */
        VariantEntry: {
            /** File Size */
            file_size: number;
            /** Filename */
            filename: string;
            /** Id */
            id: string;
            /** Is Missing */
            is_missing: boolean;
            /** Kind */
            kind: string;
            /** Label */
            label: string;
            /** Mime Type */
            mime_type?: string | null;
            /** Page Count */
            page_count?: number | null;
            /** Relative Path */
            relative_path: string;
            /** Title */
            title?: string | null;
        };
        /**
         * VariantMain
         * @description The parent of an item that is itself a variant, named for the UI.
         *
         *     `VariantEntry` describes a family member seen from the parent; this is the
         *     same relationship read from the other end, plus the size of the family it
         *     heads. The duplicate compare view needs it to turn "promote its main version
         *     instead" from a description of a dead end into something the user can act
         *     on.
         */
        VariantMain: {
            /** Filename */
            filename: string;
            /** Id */
            id: string;
            /** Relative Path */
            relative_path: string;
            /** Title */
            title?: string | null;
            /**
             * Variant Count
             * @default 0
             */
            variant_count?: number;
        };
        /** VerifyIndexResponse */
        VerifyIndexResponse: {
            /** Trusted Index Urls */
            trusted_index_urls?: string[];
            /** Url */
            url: string;
            /** Verified */
            verified: boolean;
        };
        /**
         * VttAuthoringResponse
         * @description `GET /maps/{id}/vtt/authoring` — the document plus the grid to draw it on.
         *
         *     `data` is None when nothing has been authored. Pixel dimensions are
         *     Optional for the same reason as on `MapDetailResponse`: a file that could
         *     not be measured reports None rather than failing the request.
         */
        VttAuthoringResponse: {
            /** Data */
            data?: {
                [key: string]: unknown;
            } | null;
            /** Filename */
            filename: string;
            grid: components["schemas"]["MapGrid"];
            /**
             * Image Url
             * @default
             */
            image_url?: string;
            /**
             * Is Vtt
             * @default false
             */
            is_vtt?: boolean;
            /**
             * Light Count
             * @default 0
             */
            light_count?: number;
            /** Map Id */
            map_id: string;
            /**
             * Object Wall Count
             * @default 0
             */
            object_wall_count?: number;
            /** Pixel Height */
            pixel_height?: number | null;
            /** Pixel Width */
            pixel_width?: number | null;
            /**
             * Portal Count
             * @default 0
             */
            portal_count?: number;
            /**
             * Seeded From File
             * @default false
             */
            seeded_from_file?: boolean;
            /**
             * Wall Count
             * @default 0
             */
            wall_count?: number;
        };
        /** VttAuthoringSaveResponse */
        VttAuthoringSaveResponse: {
            /**
             * Light Count
             * @default 0
             */
            light_count?: number;
            /**
             * Object Wall Count
             * @default 0
             */
            object_wall_count?: number;
            /**
             * Portal Count
             * @default 0
             */
            portal_count?: number;
            /** Status */
            status: string;
            /**
             * Wall Count
             * @default 0
             */
            wall_count?: number;
        };
        /**
         * VttAuthoringUpdate
         * @description `PUT /maps/{id}/vtt/authoring` — replaces the whole document.
         *
         *     `data: null` clears everything authored on the map.
         */
        VttAuthoringUpdate: {
            data?: components["schemas"]["VttDocumentIn"] | null;
        };
        /**
         * VttDataResponse
         * @description Parsed Universal VTT metadata (`GET /maps/{id}/vtt/data`).
         *
         *     Every field is Optional/defaulted: exporters differ in which keys they write,
         *     and a file may legitimately have no lights, portals, or walls.
         */
        VttDataResponse: {
            /** Format */
            format?: number | null;
            /** Grid Height */
            grid_height?: number | null;
            /** Grid Width */
            grid_width?: number | null;
            /**
             * Has Image
             * @default false
             */
            has_image?: boolean;
            /**
             * Light Count
             * @default 0
             */
            light_count?: number;
            /**
             * Object Wall Count
             * @default 0
             */
            object_wall_count?: number;
            /** Pixels Per Grid */
            pixels_per_grid?: number | null;
            /**
             * Portal Count
             * @default 0
             */
            portal_count?: number;
            /**
             * Wall Count
             * @default 0
             */
            wall_count?: number;
        };
        /**
         * VttDocumentIn
         * @description A whole authored document: the editor's drawing, in grid units.
         *
         *     `pixels_per_grid` records the grid the geometry was drawn against. It is
         *     stored because everything here is scale-relative — replacing the source
         *     image with a different size would otherwise invalidate every wall silently.
         */
        VttDocumentIn: {
            environment?: components["schemas"]["VttEnvironmentIn"] | null;
            grid_offset?: components["schemas"]["VttPoint"] | null;
            /** Lights */
            lights?: components["schemas"]["VttLightIn"][];
            /** Line Of Sight */
            line_of_sight?: components["schemas"]["VttPoint"][][];
            /** Objects Line Of Sight */
            objects_line_of_sight?: components["schemas"]["VttPoint"][][];
            /**
             * Pixels Per Grid
             * @default 0
             */
            pixels_per_grid?: number;
            /** Portals */
            portals?: components["schemas"]["VttPortalIn"][];
        };
        /**
         * VttEnvironmentIn
         * @description `baked_lighting` means the image already has its lighting painted in.
         */
        VttEnvironmentIn: {
            /** Ambient Light */
            ambient_light?: string | null;
            /**
             * Baked Lighting
             * @default false
             */
            baked_lighting?: boolean;
        };
        /**
         * VttLightIn
         * @description A light source. `range` is in grid squares; `color` is ARGB hex.
         *
         *     `intensity` has no scale agreed between VTTs, so it is carried through
         *     verbatim rather than normalised to any one of them.
         */
        VttLightIn: {
            /** Color */
            color?: string | null;
            /**
             * Intensity
             * @default 1
             */
            intensity?: number;
            position: components["schemas"]["VttPoint"];
            /**
             * Range
             * @default 0
             */
            range?: number;
            /**
             * Shadows
             * @default true
             */
            shadows?: boolean;
        };
        /**
         * VttPoint
         * @description A point in **grid units** (not pixels), as the UVTT format itself uses.
         */
        VttPoint: {
            /** X */
            x: number;
            /** Y */
            y: number;
        };
        /**
         * VttPortalIn
         * @description A door or window.
         *
         *     `bounds` is the pair of endpoints defining the door line, and is the field
         *     that matters: `position` and `rotation` are derived from it on export
         *     because several importers ignore one or the other.
         *
         *     `closed` is the door/window discriminator — True is a door, False a window.
         */
        VttPortalIn: {
            /** Bounds */
            bounds: components["schemas"]["VttPoint"][];
            /**
             * Closed
             * @default true
             */
            closed?: boolean;
            /**
             * Freestanding
             * @default false
             */
            freestanding?: boolean;
        };
        /**
         * WikiHeadingOut
         * @description One ATX heading from ``wikilinks.extract_headings``.
         */
        WikiHeadingOut: {
            /** Level */
            level: number;
            /** Text */
            text: string;
        };
        /** WikiImportOut */
        WikiImportOut: {
            /** Format */
            format: string;
            /** Imported */
            imported: number;
            /** Pages */
            pages: components["schemas"]["WikiPageSummaryOut"][];
        };
        /** WikiPageCreate */
        WikiPageCreate: {
            /**
             * Body
             * @default
             */
            body?: string;
            /** Icon */
            icon?: string | null;
            /** Icon Color */
            icon_color?: string | null;
            /**
             * Page Type
             * @default note
             */
            page_type?: string;
            /** Parent Id */
            parent_id?: string | null;
            /** Session Date */
            session_date?: string | null;
            /** Shared User Ids */
            shared_user_ids?: string[] | null;
            /** Shared Write User Ids */
            shared_write_user_ids?: string[] | null;
            /**
             * Title
             * @default
             */
            title?: string;
            /**
             * Visibility
             * @default gm
             */
            visibility?: string;
        };
        /**
         * WikiPageDetailOut
         * @description One page in full, from ``get_page``.
         */
        WikiPageDetailOut: {
            /** Backlinks */
            backlinks: components["schemas"]["WikiPageSummaryOut"][];
            /** Body */
            body?: string | null;
            /** Campaign Id */
            campaign_id: string;
            /** Can Delete */
            can_delete: boolean;
            /** Can Edit */
            can_edit: boolean;
            /** Created By Id */
            created_by_id?: string | null;
            /** Created By Name */
            created_by_name?: string | null;
            /** Icon */
            icon?: string | null;
            /** Icon Color */
            icon_color?: string | null;
            /** Id */
            id: string;
            /** Is Hidden */
            is_hidden: boolean;
            /** Is Mine */
            is_mine: boolean;
            /** Page Type */
            page_type?: string | null;
            /** Parent Id */
            parent_id?: string | null;
            /** Session Date */
            session_date?: string | null;
            /** Shared User Ids */
            shared_user_ids: string[];
            /** Shared Write User Ids */
            shared_write_user_ids: string[];
            /** Slug */
            slug: string;
            /** Title */
            title: string;
            /** Updated At */
            updated_at?: string | null;
            /** Visibility */
            visibility?: string | null;
        };
        /**
         * WikiPageHiddenOut
         * @description ``hide_page`` / ``unhide_page`` — ``{"ok", "hidden"}``.
         */
        WikiPageHiddenOut: {
            /** Hidden */
            hidden: boolean;
            /** Ok */
            ok: boolean;
        };
        /**
         * WikiPageListItem
         * @description A page in ``list_pages``: the summary plus this viewer's permissions.
         */
        WikiPageListItem: {
            /** Can Delete */
            can_delete: boolean;
            /** Can Edit */
            can_edit: boolean;
            /** Icon */
            icon?: string | null;
            /** Icon Color */
            icon_color?: string | null;
            /** Id */
            id: string;
            /** Is Hidden */
            is_hidden: boolean;
            /** Is Mine */
            is_mine: boolean;
            /** Page Type */
            page_type?: string | null;
            /** Parent Id */
            parent_id?: string | null;
            /** Session Date */
            session_date?: string | null;
            /** Slug */
            slug: string;
            /** Sort Order */
            sort_order?: number | null;
            /** Title */
            title: string;
            /** Updated At */
            updated_at?: string | null;
            /** Visibility */
            visibility?: string | null;
        };
        /**
         * WikiPageSearchHit
         * @description A search hit: the summary plus a body excerpt (may be empty).
         */
        WikiPageSearchHit: {
            /** Icon */
            icon?: string | null;
            /** Icon Color */
            icon_color?: string | null;
            /** Id */
            id: string;
            /** Page Type */
            page_type?: string | null;
            /** Parent Id */
            parent_id?: string | null;
            /** Session Date */
            session_date?: string | null;
            /** Slug */
            slug: string;
            /** Snippet */
            snippet: string;
            /** Sort Order */
            sort_order?: number | null;
            /** Title */
            title: string;
            /** Updated At */
            updated_at?: string | null;
            /** Visibility */
            visibility?: string | null;
        };
        /**
         * WikiPageSummaryOut
         * @description A page's metadata, as built by ``wiki._page_summary``.
         *
         *     ``create_page`` / ``update_page`` return exactly this; the list and search
         *     endpoints extend it (see the subclasses below).
         */
        WikiPageSummaryOut: {
            /** Icon */
            icon?: string | null;
            /** Icon Color */
            icon_color?: string | null;
            /** Id */
            id: string;
            /** Page Type */
            page_type?: string | null;
            /** Parent Id */
            parent_id?: string | null;
            /** Session Date */
            session_date?: string | null;
            /** Slug */
            slug: string;
            /** Sort Order */
            sort_order?: number | null;
            /** Title */
            title: string;
            /** Updated At */
            updated_at?: string | null;
            /** Visibility */
            visibility?: string | null;
        };
        /**
         * WikiPageTitleOut
         * @description One autocomplete entry backing the `[[link]]` picker.
         */
        WikiPageTitleOut: {
            /** Ambiguous */
            ambiguous: boolean;
            /** Headings */
            headings: components["schemas"]["WikiHeadingOut"][];
            /** Id */
            id: string;
            /** Parent Title */
            parent_title?: string | null;
            /** Slug */
            slug: string;
            /** Title */
            title: string;
        };
        /** WikiPageUpdate */
        WikiPageUpdate: {
            /** Body */
            body?: string | null;
            /** Icon */
            icon?: string | null;
            /** Icon Color */
            icon_color?: string | null;
            /** Page Type */
            page_type?: string | null;
            /** Parent Id */
            parent_id?: string | null;
            /** Session Date */
            session_date?: string | null;
            /** Shared User Ids */
            shared_user_ids?: string[] | null;
            /** Shared Write User Ids */
            shared_write_user_ids?: string[] | null;
            /** Title */
            title?: string | null;
            /** Visibility */
            visibility?: string | null;
        };
        /** WikiReorder */
        WikiReorder: {
            /** Ordered Ids */
            ordered_ids: string[];
        };
        /** WikiSearchOut */
        WikiSearchOut: {
            /** Query */
            query: string;
            /** Results */
            results: components["schemas"]["WikiPageSearchHit"][];
        };
        /** WikiTemplateBrowseOut */
        WikiTemplateBrowseOut: {
            /** Campaign System */
            campaign_system: string;
            /** Default Index Url */
            default_index_url?: string | null;
            /** Downloaded Ids */
            downloaded_ids: string[];
            /** Folders */
            folders: components["schemas"]["CatalogueFolderOut"][];
            /** Generated */
            generated: string;
            /** Index Url */
            index_url: string;
            /** Is Custom Url */
            is_custom_url: boolean;
        };
        /** WikiTemplateDefaults */
        WikiTemplateDefaults: {
            /**
             * Icon
             * @default
             */
            icon?: string;
            /**
             * Icon Color
             * @default
             */
            icon_color?: string;
            /**
             * Page Type
             * @default note
             */
            page_type?: string;
            /**
             * Title
             * @default
             */
            title?: string;
            /**
             * Visibility
             * @default gm
             */
            visibility?: string;
        };
        /**
         * WikiTemplateDefaultsOut
         * @description The page defaults a template seeds a new page with.
         *
         *     Read out of the body's frontmatter with ``.get(key, "")`` defaults, so every
         *     field is a plain string even when the block is absent.
         */
        WikiTemplateDefaultsOut: {
            /** Icon */
            icon: string;
            /** Icon Color */
            icon_color: string;
            /** Page Type */
            page_type: string;
            /** Title */
            title: string;
            /** Visibility */
            visibility: string;
        };
        /**
         * WikiTemplateDetailOut
         * @description A template including its body, from ``wiki_templates._detail``.
         */
        WikiTemplateDetailOut: {
            /** Body */
            body: string;
            /** Category */
            category: string;
            /** Created At */
            created_at?: string | null;
            defaults: components["schemas"]["WikiTemplateDefaultsOut"];
            /** Description */
            description: string;
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Source Id */
            source_id?: string | null;
            /** Source Url */
            source_url?: string | null;
            /** Source Version */
            source_version?: string | null;
            /** System */
            system: string;
        };
        /** WikiTemplateInput */
        WikiTemplateInput: {
            /**
             * Body
             * @default
             */
            body?: string;
            /**
             * Category
             * @default
             */
            category?: string;
            defaults?: components["schemas"]["WikiTemplateDefaults"] | null;
            /**
             * Description
             * @default
             */
            description?: string;
            /** Name */
            name: string;
        };
        /** WikiTemplateListOut */
        WikiTemplateListOut: {
            /** Authored System */
            authored_system: string;
            /** Campaign System */
            campaign_system: string;
            /** Categories */
            categories: string[];
            /** Downloads Enabled */
            downloads_enabled: boolean;
            /** Templates */
            templates: components["schemas"]["WikiTemplateSummaryOut"][];
        };
        /**
         * WikiTemplateSummaryOut
         * @description One template's metadata, from ``wiki_templates._summary``.
         *
         *     ``system``/``category``/``description`` are coalesced by the serializer
         *     (``t.system or ""``), so they are required despite being nullable columns.
         */
        WikiTemplateSummaryOut: {
            /** Category */
            category: string;
            /** Created At */
            created_at?: string | null;
            /** Description */
            description: string;
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Source Id */
            source_id?: string | null;
            /** Source Url */
            source_url?: string | null;
            /** Source Version */
            source_version?: string | null;
            /** System */
            system: string;
        };
        /** WikiTemplateUpdate */
        WikiTemplateUpdate: {
            /** Body */
            body?: string | null;
            /** Category */
            category?: string | null;
            defaults?: components["schemas"]["WikiTemplateDefaults"] | null;
            /** Description */
            description?: string | null;
            /** Name */
            name?: string | null;
        };
        /**
         * WikiTemplateUseOut
         * @description ``use_wiki_template`` — deliberately the importer's shape, so the client
         *     treats "used a template" and "imported a file" alike.
         */
        WikiTemplateUseOut: {
            /** Imported */
            imported: number;
            /** Pages */
            pages: components["schemas"]["WikiPageSummaryOut"][];
            /** Template Id */
            template_id: string;
        };
        /** StatusResponse */
        backend__routers__addons___schemas__StatusResponse: {
            /** Status */
            status: string;
        };
        /**
         * FolderTagsOut
         * @description One folder path and its tags.
         *
         *     Note the list/update endpoints differ: `GET /audio-folders` returns display
         *     tags, while the PATCH/bulk writes echo back the stored internal keys.
         */
        backend__routers__audio___schemas__FolderTagsOut: {
            /** Path */
            path: string;
            /** Tags */
            tags: string[];
        };
        /** StatusResponse */
        backend__routers__audio___schemas__StatusResponse: {
            /** Status */
            status: string;
        };
        /** StatusResponse */
        backend__routers__audio_sets___schemas__StatusResponse: {
            /** Status */
            status: string;
        };
        /** OkResponse */
        backend__routers__auth___schemas__OkResponse: {
            /** Ok */
            ok: boolean;
        };
        /** StatusResponse */
        backend__routers__bookmarks___schemas__StatusResponse: {
            /** Status */
            status: string;
        };
        /**
         * MetadataSearch
         * @description Search an installed add-on for candidates matching this book.
         */
        backend__routers__books___schemas__MetadataSearch: {
            /**
             * Query
             * @default
             */
            query?: string;
            /** Source Id */
            source_id: string;
        };
        /** StatusResponse */
        backend__routers__books___schemas__StatusResponse: {
            /** Status */
            status: string;
        };
        /**
         * GuestOut
         * @description One guest, as built by ``guests._serialize_guest``.
         */
        backend__routers__campaigns___response_schemas__GuestOut: {
            /** Character Name */
            character_name?: string | null;
            /** Guest Code */
            guest_code?: string | null;
            /** Has Art */
            has_art: boolean;
            /** Has Sheet */
            has_sheet: boolean;
            /**
             * Has Token
             * @default false
             */
            has_token?: boolean;
            /** Id */
            id: string;
            /** Nickname */
            nickname?: string | null;
            /** Status */
            status?: string | null;
            /** User Id */
            user_id: string;
        };
        /**
         * OkResponse
         * @description ``{"ok": True}`` — the reorder endpoints' acknowledgement.
         */
        backend__routers__campaigns___response_schemas__OkResponse: {
            /** Ok */
            ok: boolean;
        };
        /** StatusResponse */
        backend__routers__codex___schemas__StatusResponse: {
            /** Status */
            status: string;
        };
        /**
         * StatusResponse
         * @description `{"status": ...}` — the rescan/cancel acknowledgements.
         */
        backend__routers__library___schemas__StatusResponse: {
            /** Status */
            status: string;
        };
        /**
         * FolderTagsOut
         * @description One folder path and its tags.
         *
         *     Note the list/update endpoints differ: `GET /map-folders` returns display
         *     tags, while the PATCH/bulk writes echo back the stored internal keys.
         */
        backend__routers__maps___schemas__FolderTagsOut: {
            /** Path */
            path: string;
            /** Tags */
            tags: string[];
        };
        /**
         * StatusResponse
         * @description Write-endpoint acknowledgement.
         *
         *     `grid_warning` rides along when a saved grid override looks implausible for
         *     the map's pixel dimensions. The write still succeeded — some maps really do
         *     have odd grids — so this is advisory, for the UI to surface as a
         *     confirmable notice rather than an error.
         */
        backend__routers__maps___schemas__StatusResponse: {
            /** Grid Warning */
            grid_warning?: {
                [key: string]: unknown;
            } | null;
            /** Status */
            status: string;
        };
        /**
         * FolderTagsOut
         * @description One folder path and its tags.
         *
         *     Note the list/update endpoints differ: ``GET /model-folders`` returns display
         *     tags, while the PATCH/bulk writes echo back the stored internal keys.
         */
        backend__routers__models___schemas__FolderTagsOut: {
            /** Path */
            path: string;
            /** Tags */
            tags: string[];
        };
        /** StatusResponse */
        backend__routers__models___schemas__StatusResponse: {
            /** Status */
            status: string;
        };
        /** StatusResponse */
        backend__routers__saved_filters___schemas__StatusResponse: {
            /** Status */
            status: string;
        };
        /** StatusResponse */
        backend__routers__share_links___schemas__StatusResponse: {
            /** Status */
            status: string;
        };
        /**
         * MetadataSearch
         * @description Search an installed add-on for candidates matching this system.
         */
        backend__routers__systems___schemas__MetadataSearch: {
            /**
             * Query
             * @default
             */
            query?: string;
            /** Source Id */
            source_id: string;
        };
        /** StatusResponse */
        backend__routers__systems___schemas__StatusResponse: {
            /** Status */
            status: string;
        };
        /**
         * FolderTagsOut
         * @description One folder path and its tags.
         *
         *     Note the list/update endpoints differ: `GET /token-folders` returns display
         *     tags, while the PATCH/bulk writes echo back the stored internal keys.
         */
        backend__routers__tokens___schemas__FolderTagsOut: {
            /** Path */
            path: string;
            /** Tags */
            tags: string[];
        };
        /** StatusResponse */
        backend__routers__tokens___schemas__StatusResponse: {
            /** Status */
            status: string;
        };
        /**
         * GuestOut
         * @description One guest account, with the campaign it is scoped to and its inviter.
         */
        backend__routers__users___schemas__GuestOut: {
            /** Campaign Id */
            campaign_id?: string | null;
            /** Campaign Name */
            campaign_name?: string | null;
            /** Created At */
            created_at?: string | null;
            /** Display Name */
            display_name?: string | null;
            /** Id */
            id: string;
            /** Invited By */
            invited_by?: string | null;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    get_about_api_about_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AboutResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_addons_api_addons_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AddonListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    refresh_index_api_addons_refresh_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RefreshIndexResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_addon_settings_api_addons_settings_patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AddonSettingsUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AddonSettingsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_all_addons_api_addons_update_all_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UpdateAllResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    verify_index_api_addons_verify_index_get: {
        parameters: {
            query?: {
                url?: string;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VerifyIndexResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    uninstall_addon_api_addons__addon_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                addon_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__addons___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_addon_api_addons__addon_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                addon_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AddonUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InstalledAddon"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    install_addon_api_addons__addon_id__install_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                addon_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AddonInstall"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InstalledAddon"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_api_keys_api_api_keys_get: {
        parameters: {
            query?: {
                /** @description Admins only: every user's keys, not just your own */
                all?: boolean;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_api_key_api_api_keys_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApiKeyCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyWithSecret"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_permissions_api_api_keys_permissions_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyPermissionOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_api_key_api_api_keys__key_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                key_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_api_key_api_api_keys__key_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                key_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApiKeyUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    regenerate_api_key_api_api_keys__key_id__regenerate_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                key_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyWithSecret"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_audio_api_audio_get: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                /** @description Search text. Matches the name, folder path, and tags; accepts the search page's `field:value` prefixes (`tag:`, `title:`, `filename:`, `artist:`, `album:`). */
                q?: string;
                /** @description Tag filter as JSON: a list of `{mode: include|exclude, tags: [...]}` groups (tags OR'd within a group, groups AND'd), or a flat list of tags that must all match. Folder tags count for everything beneath the folder. `__grim:none__`/`__grim:any__` match items with no tags / any tag. */
                tags?: string | null;
                /** @description Only the caller's favorites. */
                favorites?: boolean;
                /** @description Only items added at or after this time (undated items never match). */
                added_since?: string | null;
                /** @description Only items directly in this folder (collection-relative, `""` for the root). Omit for the whole collection. */
                folder?: string | null;
                /** @description One of: added_at, duration, name, path, size, title, track. `path` is folder order. */
                sort?: string;
                order?: "asc" | "desc";
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AudioListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_audio_folders_api_audio_folders_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AudioFoldersResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_audio_folder_api_audio_folders_patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FolderTagsUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__audio___schemas__FolderTagsOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_update_audio_folders_api_audio_folders_bulk_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkFolderTags"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AudioFoldersResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_audio_sets_api_audio_sets_get: {
        parameters: {
            query?: {
                kind?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AudioSetsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_audio_set_api_audio_sets_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AudioSetCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AudioSetOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_audio_set_api_audio_sets__set_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                set_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AudioSetOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_audio_set_api_audio_sets__set_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                set_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__audio_sets___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_audio_set_api_audio_sets__set_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                set_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AudioSetUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AudioSetOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_update_audio_api_audio_bulk_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AudioBulkUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_add_audio_tags_api_audio_bulk_tags_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkAddTags"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkTagResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_audio_groups_api_audio_groups_get: {
        parameters: {
            query?: {
                /** @description Search text. Matches the name, folder path, and tags; accepts the search page's `field:value` prefixes (`tag:`, `title:`, `filename:`, `artist:`, `album:`). */
                q?: string;
                /** @description Tag filter as JSON: a list of `{mode: include|exclude, tags: [...]}` groups (tags OR'd within a group, groups AND'd), or a flat list of tags that must all match. Folder tags count for everything beneath the folder. `__grim:none__`/`__grim:any__` match items with no tags / any tag. */
                tags?: string | null;
                /** @description Only the caller's favorites. */
                favorites?: boolean;
                /** @description Only items added at or after this time (undated items never match). */
                added_since?: string | null;
                /** @description Only items directly in this folder (collection-relative, `""` for the root). Omit for the whole collection. */
                folder?: string | null;
                /** @description One of: added_at, duration, name, path, size, title, track. `path` is folder order. */
                sort?: string;
                order?: "asc" | "desc";
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FolderGroupsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_audio_api_audio__audio_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                audio_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AudioDetailResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_audio_api_audio__audio_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                audio_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AudioUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__audio___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_audio_artwork_api_audio__audio_id__artwork_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                audio_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_audio_chapters_api_audio__audio_id__chapters_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                audio_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AudioChaptersResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_audio_cover_api_audio__audio_id__cover_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                audio_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_audio_cover_api_audio__audio_id__cover_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                audio_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_audio_cover_api_audio__audio_id__cover_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AudioCoverResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_audio_cover_api_audio__audio_id__cover_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                audio_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__audio___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_audio_cover_from_source_api_audio__audio_id__cover_from_source_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                audio_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AudioCoverSourceIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AudioCoverResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_audio_file_api_audio__audio_id__file_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                audio_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    auth_config_api_auth_config_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthConfigResponse"];
                };
            };
        };
    };
    guest_login_api_auth_guest_login_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GuestLoginRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GuestLoginResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    auth_login_api_auth_login_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    auth_logout_api_auth_logout_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: {
                grimoire_refresh?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__auth___schemas__OkResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    auth_me_api_auth_me_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthMeResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_oidc_button_icon_api_auth_openid_button_icon_get: {
        parameters: {
            query?: {
                v?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    oidc_callback_api_auth_openid_callback_get: {
        parameters: {
            query?: {
                code?: string | null;
                state?: string | null;
                error?: string | null;
                error_description?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    discover_api_auth_openid_discover_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DiscoverRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiscoverResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    oidc_login_api_auth_openid_login_get: {
        parameters: {
            query?: {
                return_to?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    auth_refresh_api_auth_refresh_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: {
                grimoire_refresh?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_sessions_api_auth_sessions_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    revoke_other_sessions_api_auth_sessions_others_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RevokeOtherSessionsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    revoke_one_session_api_auth_sessions__session_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                session_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RevokeSessionResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    auth_setup_api_auth_setup_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetupRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    auth_status_api_auth_status_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthStatusResponse"];
                };
            };
        };
    };
    list_backups_api_backups_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BackupListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_backup_api_backups_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BackupItem"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_backup_settings_api_backups_settings_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BackupSettingsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_backup_settings_api_backups_settings_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BackupSettingsPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BackupSettingsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_backup_api_backups__backup_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                backup_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    download_backup_api_backups__backup_id__download_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                backup_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_bookmarks_api_bookmarks_get: {
        parameters: {
            query: {
                book_id: string;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BookmarkOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_bookmark_api_bookmarks_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BookmarkCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BookmarkOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_bookmark_api_bookmarks__bookmark_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                bookmark_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__bookmarks___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_bookmark_api_bookmarks__bookmark_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                bookmark_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BookmarkUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BookmarkOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_books_api_books_get: {
        parameters: {
            query?: {
                system_id?: string | null;
                category?: string | null;
                limit?: number;
                offset?: number;
                sort?: "title" | "added_at";
                order?: ("asc" | "desc") | null;
                added_since?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BookListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_update_books_api_books_bulk_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BookBulkUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_add_book_tags_api_books_bulk_tags_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkAddTags"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkTagResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_book_api_books__book_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BookDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_book_api_books__book_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BookUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__books___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    export_book_api_books__book_id__export_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExportRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    save_book_export_api_books__book_id__export_save_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveExportRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SaveExportResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_book_file_api_books__book_id__file_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    fetch_metadata_api_books__book_id__metadata_fetch_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MetadataFetch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetadataFetchResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_metadata_api_books__book_id__metadata_search_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["backend__routers__books___schemas__MetadataSearch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetadataSearchResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_metadata_sources_api_books__book_id__metadata_sources_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetadataSourcesResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_book_page_api_books__book_id__page__page_num__get: {
        parameters: {
            query?: {
                width?: number;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
                page_num: number;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    detect_book_page_shapes_api_books__book_id__page__page_num__shapes_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
                page_num: number;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DetectShapesResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_book_page_size_api_books__book_id__page__page_num__size_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
                page_num: number;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PageSizeResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_page_text_api_books__book_id__page__page_num__text_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
                page_num: number;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PageTextResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_book_page_tile_api_books__book_id__page__page_num__tile_get: {
        parameters: {
            query: {
                width: number;
                col: number;
                row: number;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
                page_num: number;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_page_words_api_books__book_id__page__page_num__words_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
                page_num: number;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PageWordsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    reindex_book_api_books__book_id__reindex_post: {
        parameters: {
            query?: {
                /** @description Optional OCR resolution override (DPI, 72–600) for this book. Omit to use the global OCR_DPI default. */
                ocr_dpi?: number | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReindexResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    rescan_book_api_books__book_id__rescan_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__books___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_book_thumbnail_api_books__book_id__thumbnail_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_book_toc_api_books__book_id__toc_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TocResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_campaigns_api_campaigns_get: {
        parameters: {
            query?: {
                include_archived?: boolean;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CampaignOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_campaign_api_campaigns_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CampaignCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CampaignOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    admin_list_user_campaigns_api_campaigns_admin_by_user__user_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                user_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminCampaignOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_calendar_subscription_api_campaigns_calendar_subscription_get: {
        parameters: {
            query?: {
                campaign_id?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarSubscriptionOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    generate_calendar_token_api_campaigns_calendar_subscription_post: {
        parameters: {
            query?: {
                campaign_id?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarSubscriptionOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    revoke_calendar_token_api_campaigns_calendar_subscription_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarSubscriptionOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    all_campaigns_calendar_feed_api_campaigns_calendar__token__all_ics_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Per-user calendar feed token */
                token: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    campaign_calendar_feed_api_campaigns_calendar__token___campaign_id__ics_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Per-user calendar feed token */
                token: string;
                /** @description Campaign to publish */
                campaign_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_invites_api_campaigns_invites_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CampaignInviteOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_resources_global_api_campaigns_resources_search_get: {
        parameters: {
            query?: {
                q?: string;
                resource_type?: string | null;
                system_id?: string | null;
                limit?: number;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResourceSearchHit"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    suggested_resources_api_campaigns_resources_suggested__system_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SuggestedResourceOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_campaign_api_campaigns__campaign_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CampaignOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_campaign_api_campaigns__campaign_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_campaign_api_campaigns__campaign_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CampaignUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CampaignOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_campaign_archived_api_campaigns__campaign_id__archive_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CampaignArchive"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CampaignOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_availability_api_campaigns__campaign_id__availability_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AvailabilityOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_availability_api_campaigns__campaign_id__availability__session_date__put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                session_date: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AvailabilityUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AvailabilitySetOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    cancel_session_date_api_campaigns__campaign_id__availability__session_date__cancel_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                session_date: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionDateCancelOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_banner_api_campaigns__campaign_id__banner_get: {
        parameters: {
            query?: {
                size?: string;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_banner_api_campaigns__campaign_id__banner_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_banner_api_campaigns__campaign_id__banner_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BannerUploadOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_banner_api_campaigns__campaign_id__banner_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_banner_focus_api_campaigns__campaign_id__banner_focus_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BannerFocusIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BannerFocusOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_banner_from_source_api_campaigns__campaign_id__banner_from_source_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BannerSourceIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BannerUploadOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    download_campaign_calendar_api_campaigns__campaign_id__calendar_ics_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_categories_api_campaigns__campaign_id__categories_get: {
        parameters: {
            query?: {
                kind?: string;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CampaignCategoryOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_category_api_campaigns__campaign_id__categories_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CampaignCategoryOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    reorder_categories_api_campaigns__campaign_id__categories_reorder_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryReorder"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__campaigns___response_schemas__OkResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_category_api_campaigns__campaign_id__categories__category_id__delete: {
        parameters: {
            query?: {
                mode?: string;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                category_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_category_api_campaigns__campaign_id__categories__category_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                category_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CampaignCategoryOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    convert_campaign_to_group_api_campaigns__campaign_id__convert_to_group_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CampaignConvert"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CampaignOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    eligible_members_api_campaigns__campaign_id__eligible_members_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EligibleMemberOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_campaign_file_api_campaigns__campaign_id__files_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_campaign_file_api_campaigns__campaign_id__files_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinkedResourceOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_campaign_file_api_campaigns__campaign_id__files__file_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                file_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_guests_api_campaigns__campaign_id__guests_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__campaigns___response_schemas__GuestOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_guest_api_campaigns__campaign_id__guests_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GuestCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__campaigns___response_schemas__GuestOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    remove_guest_api_campaigns__campaign_id__guests__member_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                member_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    regenerate_guest_code_api_campaigns__campaign_id__guests__member_id__regenerate_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                member_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__campaigns___response_schemas__GuestOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    guest_share_template_api_campaigns__campaign_id__guests__member_id__share_template_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                member_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GuestShareTemplateOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_campaign_image_api_campaigns__campaign_id__images_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_campaign_image_api_campaigns__campaign_id__images_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinkedResourceOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    invite_member_api_campaigns__campaign_id__invite_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InvitePayload"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberInviteOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_member_art_api_campaigns__campaign_id__members__member_id__art_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                member_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_member_art_api_campaigns__campaign_id__members__member_id__art_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                member_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_member_art_api_campaigns__campaign_id__members__member_id__art_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberArtUploadOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_member_art_api_campaigns__campaign_id__members__member_id__art_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                member_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_member_sheet_api_campaigns__campaign_id__members__member_id__sheet_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                member_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_member_sheet_api_campaigns__campaign_id__members__member_id__sheet_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                member_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_member_sheet_api_campaigns__campaign_id__members__member_id__sheet_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberSheetOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_member_sheet_api_campaigns__campaign_id__members__member_id__sheet_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                member_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    duplicate_member_sheet_api_campaigns__campaign_id__members__member_id__sheet_duplicate_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                member_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Body_duplicate_member_sheet_api_campaigns__campaign_id__members__member_id__sheet_duplicate_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberSheetOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_member_token_api_campaigns__campaign_id__members__member_id__token_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                member_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_member_token_api_campaigns__campaign_id__members__member_id__token_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                member_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_member_token_api_campaigns__campaign_id__members__member_id__token_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberTokenUploadOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_member_token_api_campaigns__campaign_id__members__member_id__token_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                member_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    remove_member_api_campaigns__campaign_id__members__user_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                user_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_member_status_api_campaigns__campaign_id__members__user_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                user_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemberStatusUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberStatusOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_resource_group_order_api_campaigns__campaign_id__resource_group_order_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResourceGroupOrder"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResourceGroupOrderOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_resources_api_campaigns__campaign_id__resources_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinkedResourceOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    add_resource_api_campaigns__campaign_id__resources_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResourceAdd"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinkedResourceOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_add_resources_api_campaigns__campaign_id__resources_bulk_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResourceBulkAdd"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinkedResourceOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    reorder_resources_api_campaigns__campaign_id__resources_reorder_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResourceReorder"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__campaigns___response_schemas__OkResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    remove_resource_api_campaigns__campaign_id__resources__resource_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                resource_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_resource_api_campaigns__campaign_id__resources__resource_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                resource_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResourceUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinkedResourceOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_schedule_api_campaigns__campaign_id__schedule_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduleOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upsert_schedule_api_campaigns__campaign_id__schedule_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScheduleUpsert"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduleOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_schedule_api_campaigns__campaign_id__schedule_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_sessions_api_campaigns__campaign_id__sessions_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionSummaryOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_session_api_campaigns__campaign_id__sessions_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SessionNoteCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionSummaryOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_session_notes_api_campaigns__campaign_id__sessions_search_get: {
        parameters: {
            query: {
                q: string;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNoteSearchOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_session_api_campaigns__campaign_id__sessions__session_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                session_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionDetailOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_session_api_campaigns__campaign_id__sessions__session_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                session_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_session_api_campaigns__campaign_id__sessions__session_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                session_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SessionNoteUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionSummaryOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upsert_gm_note_api_campaigns__campaign_id__sessions__session_id__notes_gm_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                session_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GMNoteUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GMNoteOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upsert_player_note_api_campaigns__campaign_id__sessions__session_id__notes_player_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                session_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlayerNoteUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlayerNoteOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_sheet_sources_api_campaigns__campaign_id__sheet_sources_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SheetSourcesOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_pages_api_campaigns__campaign_id__wiki_get: {
        parameters: {
            query?: {
                /** @description Only pages this user authored */
                mine?: boolean;
                /** @description Include pages this user hid */
                include_hidden?: boolean;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiPageListItem"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_page_api_campaigns__campaign_id__wiki_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WikiPageCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiPageSummaryOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    export_wiki_api_campaigns__campaign_id__wiki_export_get: {
        parameters: {
            query?: {
                format?: string;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    import_wiki_api_campaigns__campaign_id__wiki_import_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: {
            content: {
                "multipart/form-data": components["schemas"]["Body_import_wiki_api_campaigns__campaign_id__wiki_import_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiImportOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    reorder_pages_api_campaigns__campaign_id__wiki_reorder_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WikiReorder"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__campaigns___response_schemas__OkResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_pages_api_campaigns__campaign_id__wiki_search_get: {
        parameters: {
            query: {
                q: string;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiSearchOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_wiki_templates_api_campaigns__campaign_id__wiki_templates_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiTemplateListOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_wiki_template_api_campaigns__campaign_id__wiki_templates_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WikiTemplateInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiTemplateDetailOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    browse_wiki_templates_api_campaigns__campaign_id__wiki_templates_browse_get: {
        parameters: {
            query?: {
                refresh?: boolean;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiTemplateBrowseOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    download_wiki_template_api_campaigns__campaign_id__wiki_templates_download__template_id__post: {
        parameters: {
            query?: {
                index_url?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                template_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiTemplateDetailOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_wiki_template_api_campaigns__campaign_id__wiki_templates_upload_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_wiki_template_api_campaigns__campaign_id__wiki_templates_upload_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiTemplateDetailOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_wiki_template_api_campaigns__campaign_id__wiki_templates__template_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                template_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiTemplateDetailOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_wiki_template_api_campaigns__campaign_id__wiki_templates__template_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                template_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_wiki_template_api_campaigns__campaign_id__wiki_templates__template_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                template_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WikiTemplateUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiTemplateDetailOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    export_wiki_template_api_campaigns__campaign_id__wiki_templates__template_id__export_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                template_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    use_wiki_template_api_campaigns__campaign_id__wiki_templates__template_id__use_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                template_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiTemplateUseOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    page_titles_api_campaigns__campaign_id__wiki_titles_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiPageTitleOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_page_api_campaigns__campaign_id__wiki__page_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                page_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiPageDetailOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_page_api_campaigns__campaign_id__wiki__page_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                page_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_page_api_campaigns__campaign_id__wiki__page_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                page_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WikiPageUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiPageSummaryOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    hide_page_api_campaigns__campaign_id__wiki__page_id__hide_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                page_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiPageHiddenOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    unhide_page_api_campaigns__campaign_id__wiki__page_id__hide_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                campaign_id: string;
                page_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiPageHiddenOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    cancel_scan_api_cancel_scan_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__library___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_changelog_api_changelog_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChangelogResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_characters_api_characters_get: {
        parameters: {
            query?: {
                schema_ref?: string | null;
                campaign_id?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_character_api_characters_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CharacterCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    import_character_api_characters_import_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CharacterImport"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    import_external_api_characters_import_external_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExternalCharacterImport"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportedCharacter"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_importers_api_characters_importers_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImporterListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    uninstall_user_importer_api_characters_importers__importer_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                importer_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterDeletedResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    install_user_importer_api_characters_importers__importer_id__install_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                importer_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserImporterInstalled"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_schemas_api_characters_schemas_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SchemaListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    import_schema_api_characters_schemas_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SchemaImport"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SchemaDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    browse_sheets_api_characters_schemas_browse_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SheetCatalogueResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    install_sheet_api_characters_schemas_install__sheet_id__post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                sheet_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SchemaDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_schema_api_characters_schemas__schema_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                schema_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SchemaDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_schema_api_characters_schemas__schema_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                schema_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SchemaDeletedResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_character_api_characters__character_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                character_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_character_api_characters__character_id__put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                character_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CharacterUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_character_api_characters__character_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                character_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterDeletedResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    export_character_api_characters__character_id__export_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                character_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterExport"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_image_api_characters__character_id__images__field__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                character_id: string;
                field: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_image_api_characters__character_id__images__field__post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                character_id: string;
                field: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_image_api_characters__character_id__images__field__post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImageFieldResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_image_api_characters__character_id__images__field__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                character_id: string;
                field: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterDeletedResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_portrait_api_characters__character_id__portrait_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                character_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_portrait_api_characters__character_id__portrait_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                character_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_portrait_api_characters__character_id__portrait_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PortraitResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_portrait_api_characters__character_id__portrait_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                character_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterDeletedResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    unlink_book_api_codex_books__book_id__link_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__codex___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    submit_book_api_codex_books__book_id__submit_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                book_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CodexSubmit"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CodexSubmitResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_settings_api_codex_settings_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CodexSettingsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_settings_api_codex_settings_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CodexSettingsUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CodexSettingsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_status_api_codex_status_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CodexStatus"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    unlink_system_api_codex_systems__system_id__link_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__codex___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    submit_system_api_codex_systems__system_id__submit_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CodexSubmit"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CodexSubmitResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    test_connection_api_codex_test_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CodexTestResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_packs_api_content_packs_get: {
        parameters: {
            query?: {
                schema_id?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PackListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    reload_packs_api_content_packs_reload_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PackListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    resolve_entries_api_content__schema_id__resolve_get: {
        parameters: {
            query?: {
                /** @description Comma-separated entry ids */
                ids?: string;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                schema_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResolveResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_content_types_api_content__schema_id__types_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                schema_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentTypeListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    browse_content_api_content__schema_id___content_type__get: {
        parameters: {
            query?: {
                search?: string;
                sort?: string;
                page?: number;
                page_size?: number;
                include_rulesets?: boolean;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                schema_id: string;
                content_type: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_entry_api_content__schema_id___content_type___entry_id__get: {
        parameters: {
            query?: {
                source?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                schema_id: string;
                content_type: string;
                entry_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogEntry"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_dice_materials_api_dice_materials_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiceMaterialsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_dice_material_api_dice_materials_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DiceMaterialCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiceMaterialOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_dice_material_api_dice_materials__material_id__delete: {
        parameters: {
            query?: {
                force?: boolean;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                material_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LookupDeleteResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    download_archive_api_downloads_archive_get: {
        parameters: {
            query: {
                /** @description Scope: system | system_category | book_folder | map_folder | token_folder | audio_folder | model_folder | library_folder | tag | tag_type | tag_folder */
                type: string;
                /** @description Archive format: zip | tar | tar.gz | tar.bz2 */
                fmt?: string;
                /** @description System ID (system / system_category / book_folder) */
                id?: string | null;
                /** @description Book category slug (system_category) */
                category?: string | null;
                /** @description Tag internal key (tag / tag_type / tag_folder) */
                tag?: string | null;
                /** @description Resource type to scope a tag archive to: book | map | token | audio | model (tag_type / tag_folder) */
                resource_type?: string | null;
                /** @description Folder path (book_folder / map_folder / token_folder / audio_folder / model_folder / library_folder — the latter is library-root-relative) */
                folder?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    cancel_scan_api_duplicates_cancel_scan_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScanTriggerResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    compare_items_api_duplicates_compare_get: {
        parameters: {
            query: {
                resource_type: string;
                ids: string[];
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompareResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    describe_variant_api_duplicates_describe_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DescribeRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DescribeResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    dismiss_group_api_duplicates_dismiss_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DismissRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DismissalOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_dismissals_api_duplicates_dismissals_get: {
        parameters: {
            query?: {
                resource_type?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DismissalListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    undismiss_group_api_duplicates_dismissals__dismissal_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                dismissal_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScanTriggerResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_groups_api_duplicates_groups_get: {
        parameters: {
            query?: {
                resource_type?: string | null;
                min_confidence?: number;
                limit?: number;
                offset?: number;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GroupListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_item_api_duplicates_items__resource_type___item_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                resource_type: string;
                item_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["DeleteItemRequest"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeleteItemResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    link_variants_api_duplicates_link_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LinkRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinkResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    merge_metadata_api_duplicates_merge_metadata_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MergeMetadataRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MergeMetadataResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    promote_variant_api_duplicates_promote_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PromoteRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PromoteResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    start_scan_api_duplicates_scan_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ScanRequest"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScanTriggerResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_scan_status_api_duplicates_scan_status_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScanStatus"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    unlink_variants_api_duplicates_unlink_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UnlinkRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnlinkResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_favorites_api_favorites_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FavoritesResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    add_favorite_api_favorites_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FavoriteIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FavoriteRef"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    remove_favorite_api_favorites__item_type___item_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                item_type: string;
                item_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    browse_api_files_browse_get: {
        parameters: {
            query?: {
                path?: string;
                limit?: number;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BrowseResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_entry_api_files_delete_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeleteRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeleteResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_folder_api_files_folder_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateFolderRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FolderResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_folder_api_files_folder_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeleteFolderRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeleteResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    folder_contents_api_files_folder_contents_get: {
        parameters: {
            query: {
                path: string;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FolderContentsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_markers_api_files_folder_markers_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MarkersRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FolderResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    scaffold_categories_api_files_folder_scaffold_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScaffoldRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScaffoldResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    move_files_api_files_move_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MoveRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MoveResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    rename_file_api_files_rename_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RenameRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RenameResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_file_api_files_upload_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_file_api_files_upload_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UploadResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_genres_api_genres_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenresResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_genre_api_genres_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenreCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenreOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_genre_api_genres__genre_id__delete: {
        parameters: {
            query?: {
                force?: boolean;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                genre_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LookupDeleteResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    health_api_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description All dependencies reachable */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
            /** @description A dependency is unreachable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
        };
    };
    get_latest_release_api_latest_release_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LatestReleaseResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_licenses_api_licenses_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LicensesResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_license_api_licenses_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LicenseCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LookupOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_license_api_licenses__license_id__delete: {
        parameters: {
            query?: {
                force?: boolean;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                license_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LookupDeleteResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_logs_api_logs_get: {
        parameters: {
            query?: {
                /** @description Minimum log level to return */
                level?: "debug" | "info" | "warning" | "error" | "critical";
                /** @description Maximum number of entries to return */
                limit?: number;
                /** @description Entries to skip from the newest end (historical pagination, ignored when after_seq is set) */
                offset?: number;
                /** @description Return only entries with seq > this value (live-poll cursor) */
                after_seq?: number | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LogsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    cleanup_missing_api_maintenance_cleanup_missing_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CleanupResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    export_sidecars_api_maintenance_sidecars_export_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SidecarExportResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_sidecar_settings_api_maintenance_sidecars_settings_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SidecarSettings"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_sidecar_settings_api_maintenance_sidecars_settings_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SidecarSettings"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SidecarSettings"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_map_folders_api_map_folders_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MapFoldersResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_map_folder_api_map_folders_patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FolderTagsUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__maps___schemas__FolderTagsOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_update_map_folders_api_map_folders_bulk_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkFolderTags"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MapFoldersResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_maps_api_maps_get: {
        parameters: {
            query?: {
                map_type?: string | null;
                limit?: number;
                offset?: number;
                /** @description Search text. Matches the name, folder path, and tags; accepts the search page's `field:value` prefixes (`tag:`, `title:`, `filename:`, `artist:`, `album:`). */
                q?: string;
                /** @description Tag filter as JSON: a list of `{mode: include|exclude, tags: [...]}` groups (tags OR'd within a group, groups AND'd), or a flat list of tags that must all match. Folder tags count for everything beneath the folder. `__grim:none__`/`__grim:any__` match items with no tags / any tag. */
                tags?: string | null;
                /** @description Only the caller's favorites. */
                favorites?: boolean;
                /** @description Only items added at or after this time (undated items never match). */
                added_since?: string | null;
                /** @description Only items directly in this folder (collection-relative, `""` for the root). Omit for the whole collection. */
                folder?: string | null;
                /** @description One of: added_at, duration, name, path, size, title, track. `path` is folder order. */
                sort?: string;
                order?: "asc" | "desc";
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MapListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_update_maps_api_maps_bulk_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MapBulkUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_add_map_tags_api_maps_bulk_tags_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkAddTags"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkTagResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_map_groups_api_maps_groups_get: {
        parameters: {
            query?: {
                map_type?: string | null;
                /** @description Search text. Matches the name, folder path, and tags; accepts the search page's `field:value` prefixes (`tag:`, `title:`, `filename:`, `artist:`, `album:`). */
                q?: string;
                /** @description Tag filter as JSON: a list of `{mode: include|exclude, tags: [...]}` groups (tags OR'd within a group, groups AND'd), or a flat list of tags that must all match. Folder tags count for everything beneath the folder. `__grim:none__`/`__grim:any__` match items with no tags / any tag. */
                tags?: string | null;
                /** @description Only the caller's favorites. */
                favorites?: boolean;
                /** @description Only items added at or after this time (undated items never match). */
                added_since?: string | null;
                /** @description Only items directly in this folder (collection-relative, `""` for the root). Omit for the whole collection. */
                folder?: string | null;
                /** @description One of: added_at, duration, name, path, size, title, track. `path` is folder order. */
                sort?: string;
                order?: "asc" | "desc";
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FolderGroupsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_map_api_maps__map_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MapDetailResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_map_api_maps__map_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MapUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__maps___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    export_map_pages_api_maps__map_id__export_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExportRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    export_map_uvtt_api_maps__map_id__export_uvtt_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    save_map_export_api_maps__map_id__export_save_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveExportRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SaveExportResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_map_file_api_maps__map_id__file_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_map_otfbm_api_maps__map_id__otfbm_get: {
        parameters: {
            query?: {
                cell?: number | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OtfbmPlanResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    export_map_otfbm_image_api_maps__map_id__otfbm_image_get: {
        parameters: {
            query?: {
                cell?: number | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_map_page_api_maps__map_id__page__page_num__get: {
        parameters: {
            query?: {
                width?: number;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
                page_num: number;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    detect_map_page_shapes_api_maps__map_id__page__page_num__shapes_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
                page_num: number;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DetectShapesResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_map_page_size_api_maps__map_id__page__page_num__size_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
                page_num: number;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PageSizeResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_map_thumbnail_api_maps__map_id__thumbnail_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_map_authoring_api_maps__map_id__vtt_authoring_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VttAuthoringResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_map_authoring_api_maps__map_id__vtt_authoring_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VttAuthoringUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VttAuthoringSaveResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_map_vtt_data_api_maps__map_id__vtt_data_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VttDataResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_map_vtt_image_api_maps__map_id__vtt_image_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                map_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_model_folders_api_model_folders_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Model3DFoldersResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_model_folder_api_model_folders_patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FolderTagsUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__models___schemas__FolderTagsOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_update_model_folders_api_model_folders_bulk_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkFolderTags"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Model3DFoldersResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_models_api_models_get: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                /** @description Search text. Matches the name, folder path, and tags; accepts the search page's `field:value` prefixes (`tag:`, `title:`, `filename:`, `artist:`, `album:`). */
                q?: string;
                /** @description Tag filter as JSON: a list of `{mode: include|exclude, tags: [...]}` groups (tags OR'd within a group, groups AND'd), or a flat list of tags that must all match. Folder tags count for everything beneath the folder. `__grim:none__`/`__grim:any__` match items with no tags / any tag. */
                tags?: string | null;
                /** @description Only the caller's favorites. */
                favorites?: boolean;
                /** @description Only items added at or after this time (undated items never match). */
                added_since?: string | null;
                /** @description Only items directly in this folder (collection-relative, `""` for the root). Omit for the whole collection. */
                folder?: string | null;
                /** @description One of: added_at, duration, name, path, size, title, track. `path` is folder order. */
                sort?: string;
                order?: "asc" | "desc";
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Model3DListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_update_models_api_models_bulk_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Model3DBulkUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_add_model_tags_api_models_bulk_tags_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkAddTags"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkTagResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_model_groups_api_models_groups_get: {
        parameters: {
            query?: {
                /** @description Search text. Matches the name, folder path, and tags; accepts the search page's `field:value` prefixes (`tag:`, `title:`, `filename:`, `artist:`, `album:`). */
                q?: string;
                /** @description Tag filter as JSON: a list of `{mode: include|exclude, tags: [...]}` groups (tags OR'd within a group, groups AND'd), or a flat list of tags that must all match. Folder tags count for everything beneath the folder. `__grim:none__`/`__grim:any__` match items with no tags / any tag. */
                tags?: string | null;
                /** @description Only the caller's favorites. */
                favorites?: boolean;
                /** @description Only items added at or after this time (undated items never match). */
                added_since?: string | null;
                /** @description Only items directly in this folder (collection-relative, `""` for the root). Omit for the whole collection. */
                folder?: string | null;
                /** @description One of: added_at, duration, name, path, size, title, track. `path` is folder order. */
                sort?: string;
                order?: "asc" | "desc";
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FolderGroupsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_model_api_models__model_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                model_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Model3DDetailResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_model_api_models__model_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                model_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Model3DUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__models___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_model_file_api_models__model_id__file_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                model_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_model_thumbnail_api_models__model_id__thumbnail_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                model_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_parent_systems_api_parent_systems_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ParentSystemsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_parent_system_api_parent_systems_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ParentSystemCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LookupOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_parent_system_api_parent_systems__parent_id__delete: {
        parameters: {
            query?: {
                force?: boolean;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                parent_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LookupDeleteResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    rescan_library_api_rescan_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["RescanRequest"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__library___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_rulesets_api_rulesets_get: {
        parameters: {
            query?: {
                schema_id?: string | null;
                campaign_id?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RulesetListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_ruleset_api_rulesets_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RulesetCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RulesetSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_installable_packs_api_rulesets_installable_get: {
        parameters: {
            query?: {
                schema_id?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InstallablePackListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    browse_packs_api_rulesets_packs_browse_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PackCatalogueResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    install_pack_api_rulesets_packs_install__pack_id__post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                pack_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InstalledPack"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    uninstall_pack_api_rulesets_packs__pack_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                pack_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeletedResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_ruleset_api_rulesets__ruleset_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                ruleset_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RulesetSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_ruleset_api_rulesets__ruleset_id__put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                ruleset_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RulesetUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RulesetSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_ruleset_api_rulesets__ruleset_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                ruleset_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeletedResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_entries_api_rulesets__ruleset_id__entries_get: {
        parameters: {
            query?: {
                content_type?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                ruleset_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RulesetEntryListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_entry_api_rulesets__ruleset_id__entries_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                ruleset_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EntryCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RulesetEntryDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_entry_api_rulesets__ruleset_id__entries__entry_row_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                ruleset_id: string;
                entry_row_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RulesetEntryDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_entry_api_rulesets__ruleset_id__entries__entry_row_id__put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                ruleset_id: string;
                entry_row_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EntryUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RulesetEntryDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_entry_api_rulesets__ruleset_id__entries__entry_row_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                ruleset_id: string;
                entry_row_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeletedResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    export_ruleset_api_rulesets__ruleset_id__export_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                ruleset_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RulesetExport"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    fork_entry_api_rulesets__ruleset_id__fork_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                ruleset_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ForkRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RulesetEntryDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    import_into_ruleset_api_rulesets__ruleset_id__import_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                ruleset_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_saved_filters_api_saved_filters_get: {
        parameters: {
            query?: {
                scope?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SavedFiltersResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_saved_filter_api_saved_filters_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SavedFilterCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SavedFilterOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_saved_filter_api_saved_filters__filter_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                filter_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__saved_filters___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_saved_filter_api_saved_filters__filter_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                filter_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SavedFilterUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SavedFilterOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_scan_status_api_scan_status_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScanStatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_library_api_search_get: {
        parameters: {
            query: {
                q: string;
                limit?: number;
                book_id?: string | null;
                system_id?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SearchResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_fields_api_search_fields_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SearchFieldsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_settings_api_settings_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_settings_api_settings_patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SettingsPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_oidc_button_icon_api_settings_oidc_button_icon_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_oidc_button_icon_api_settings_oidc_button_icon_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_oidc_button_icon_api_settings_oidc_button_icon_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_ui_settings_api_settings_ui_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UISettingsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_share_links_api_share_links_get: {
        parameters: {
            query?: {
                resource_type?: string | null;
                resource_id?: string | null;
                variant?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShareLinkOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_share_link_api_share_links_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ShareLinkCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShareLinkOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_all_share_links_api_share_links_all_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShareLinkOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_share_permission_api_share_links_permission_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShareLinkPermission"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_user_share_links_api_share_links_users__user_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                user_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShareLinkOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_share_link_api_share_links__link_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                link_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__share_links___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_share_link_api_share_links__link_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                link_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ShareLinkUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShareLinkOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    revoke_share_link_api_share_links__link_id__revoke_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                link_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShareLinkOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    share_content_api_share__token__get: {
        parameters: {
            query?: {
                filename?: string | null;
                /** @description Serve as an attachment rather than inline. */
                download?: boolean;
            };
            header?: never;
            path: {
                token: string;
            };
            cookie?: {
                grimoire_share?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    share_meta_api_share__token__meta_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
            };
            cookie?: {
                grimoire_share?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShareMetaResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    unlock_share_api_share__token__unlock_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ShareUnlock"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShareUnlockResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    share_content_api_share__token___filename__get: {
        parameters: {
            query?: {
                /** @description Serve as an attachment rather than inline. */
                download?: boolean;
            };
            header?: never;
            path: {
                token: string;
                filename: string | null;
            };
            cookie?: {
                grimoire_share?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_stats_api_stats_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_system_families_api_system_families_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemFamiliesResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_system_family_api_system_families_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SystemFamilyCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LookupOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_system_family_api_system_families__family_id__delete: {
        parameters: {
            query?: {
                force?: boolean;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                family_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LookupDeleteResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_systems_api_systems_get: {
        parameters: {
            query?: {
                sort?: string;
                order?: string;
                genre?: string | null;
                family?: string | null;
                parent_system?: string | null;
                edition?: string | null;
                license?: string | null;
                explicit?: boolean | null;
                parent_id?: string | null;
                include_children?: boolean;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemSummary"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_update_systems_api_systems_bulk_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GameSystemBulkUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_add_system_tags_api_systems_bulk_tags_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkAddTags"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkTagResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_system_api_systems__system_id__get: {
        parameters: {
            query?: {
                book_sort?: string;
                book_order?: string;
                explicit?: boolean | null;
                genre?: string | null;
                category?: string | null;
                /** @description Include every book in the response. The detail view passes false and pages the shelf through `/books` and `/book-groups` instead (issue #221). */
                include_books?: boolean;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_system_api_systems__system_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GameSystemUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__systems___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_system_book_facets_api_systems__system_id__book_facets_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShelfFacetsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_book_folders_api_systems__system_id__book_folders_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BookFoldersResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_book_folder_api_systems__system_id__book_folders_delete: {
        parameters: {
            query: {
                path: string;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__systems___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_book_folder_api_systems__system_id__book_folders_patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BookFolderUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BookFolderOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_system_book_groups_api_systems__system_id__book_groups_get: {
        parameters: {
            query?: {
                /** @description Search text: title, filename or product code, plus the search page's `field:value` prefixes (`author:`, `year:`, `tag:`, `code:`, `publisher:`...). */
                q?: string;
                /** @description Tag filter as JSON: `{mode, tags}` groups or a flat list (see the media list endpoints). Matches the book's own tags. */
                tags?: string | null;
                /** @description Only the caller's favorites. */
                favorites?: boolean;
                added_since?: string | null;
                /** @description Only explicit (true) or not (false). */
                explicit?: boolean | null;
                /** @description A genre, or `__grim:none__`/`__grim:any__`. */
                genre?: string | null;
                /** @description A product-code prefix (`PZO`), or `__grim:none__`/`__grim:any__`. */
                product_code?: string | null;
                /** @description Only this category. */
                category?: string | null;
                /** @description Only books directly in this subfolder of `category` (`""` for the category's own directory). */
                folder?: string | null;
                /** @description One of: added_at, page_count, product_code, size, title, year. */
                sort?: string;
                order?: "asc" | "desc";
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShelfGroupsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_system_books_api_systems__system_id__books_get: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                /** @description Search text: title, filename or product code, plus the search page's `field:value` prefixes (`author:`, `year:`, `tag:`, `code:`, `publisher:`...). */
                q?: string;
                /** @description Tag filter as JSON: `{mode, tags}` groups or a flat list (see the media list endpoints). Matches the book's own tags. */
                tags?: string | null;
                /** @description Only the caller's favorites. */
                favorites?: boolean;
                added_since?: string | null;
                /** @description Only explicit (true) or not (false). */
                explicit?: boolean | null;
                /** @description A genre, or `__grim:none__`/`__grim:any__`. */
                genre?: string | null;
                /** @description A product-code prefix (`PZO`), or `__grim:none__`/`__grim:any__`. */
                product_code?: string | null;
                /** @description Only this category. */
                category?: string | null;
                /** @description Only books directly in this subfolder of `category` (`""` for the category's own directory). */
                folder?: string | null;
                /** @description One of: added_at, page_count, product_code, size, title, year. */
                sort?: string;
                order?: "asc" | "desc";
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemBooksPage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_system_cover_api_systems__system_id__cover_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_system_cover_api_systems__system_id__cover_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_system_cover_api_systems__system_id__cover_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemCoverResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_system_cover_api_systems__system_id__cover_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__systems___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_system_cover_from_source_api_systems__system_id__cover_from_source_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SystemCoverSourceIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemCoverResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    fetch_metadata_api_systems__system_id__metadata_fetch_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MetadataFetch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetadataFetchResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_metadata_api_systems__system_id__metadata_search_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["backend__routers__systems___schemas__MetadataSearch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetadataSearchResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_metadata_sources_api_systems__system_id__metadata_sources_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                system_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetadataSourcesResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_tags_api_tags_get: {
        parameters: {
            query?: {
                /** @description Restrict to tags used on this resource type (system|book|map|token|audio); each result carries a usage count. Omit for all tags. */
                in_use_by?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TagsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_tag_api_tags_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TagCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TagCreatedResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_tag_api_tags__internal__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                internal: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_tag_display_api_tags__internal__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                internal: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TagDisplayUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TagRenamedResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    tag_folder_items_api_tags__internal__folder_items_get: {
        parameters: {
            query: {
                /** @description The folder's resource type. */
                resource_type: string;
                /** @description The folder's `key` from `/items`. */
                folder: string;
                limit?: number;
                offset?: number;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                internal: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TagFolderItemsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    tag_items_api_tags__internal__items_get: {
        parameters: {
            query?: {
                /** @description Restrict the counts, folders and item page to one resource type. */
                resource_type?: string | null;
                /** @description Directly-tagged items to return; 0 for just the counts and folders. */
                limit?: number;
                offset?: number;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                internal: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TagItemsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    merge_tag_api_tags__internal__merge_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                internal: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TagMerge"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TagRenamedResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_themes_api_themes_get: {
        parameters: {
            query?: {
                app_mode?: string | null;
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThemeListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    import_theme_api_themes_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ThemeImport"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InstalledTheme"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    browse_themes_api_themes_browse_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThemeBrowseResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    install_theme_api_themes_install__theme_id__post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                theme_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InstalledTheme"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    select_theme_api_themes_selection_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ThemeSelection"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThemeSelectionResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_theme_source_api_themes_source_put: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ThemeSourceUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThemeSourceResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_theme_api_themes__theme_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                theme_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThemeDeletedResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_token_folders_api_token_folders_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenFoldersResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_token_folder_api_token_folders_patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FolderTagsUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__tokens___schemas__FolderTagsOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_update_token_folders_api_token_folders_bulk_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkFolderTags"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenFoldersResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_token_frames_api_token_frames_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FrameListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_token_frame_api_token_frames__frame_id__file_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                frame_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_tokens_api_tokens_get: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                /** @description Search text. Matches the name, folder path, and tags; accepts the search page's `field:value` prefixes (`tag:`, `title:`, `filename:`, `artist:`, `album:`). */
                q?: string;
                /** @description Tag filter as JSON: a list of `{mode: include|exclude, tags: [...]}` groups (tags OR'd within a group, groups AND'd), or a flat list of tags that must all match. Folder tags count for everything beneath the folder. `__grim:none__`/`__grim:any__` match items with no tags / any tag. */
                tags?: string | null;
                /** @description Only the caller's favorites. */
                favorites?: boolean;
                /** @description Only items added at or after this time (undated items never match). */
                added_since?: string | null;
                /** @description Only items directly in this folder (collection-relative, `""` for the root). Omit for the whole collection. */
                folder?: string | null;
                /** @description One of: added_at, duration, name, path, size, title, track. `path` is folder order. */
                sort?: string;
                order?: "asc" | "desc";
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_update_tokens_api_tokens_bulk_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TokenBulkUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bulk_add_token_tags_api_tokens_bulk_tags_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkAddTags"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkTagResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_token_groups_api_tokens_groups_get: {
        parameters: {
            query?: {
                /** @description Search text. Matches the name, folder path, and tags; accepts the search page's `field:value` prefixes (`tag:`, `title:`, `filename:`, `artist:`, `album:`). */
                q?: string;
                /** @description Tag filter as JSON: a list of `{mode: include|exclude, tags: [...]}` groups (tags OR'd within a group, groups AND'd), or a flat list of tags that must all match. Folder tags count for everything beneath the folder. `__grim:none__`/`__grim:any__` match items with no tags / any tag. */
                tags?: string | null;
                /** @description Only the caller's favorites. */
                favorites?: boolean;
                /** @description Only items added at or after this time (undated items never match). */
                added_since?: string | null;
                /** @description Only items directly in this folder (collection-relative, `""` for the root). Omit for the whole collection. */
                folder?: string | null;
                /** @description One of: added_at, duration, name, path, size, title, track. `path` is folder order. */
                sort?: string;
                order?: "asc" | "desc";
            };
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FolderGroupsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_token_api_tokens__token_id__get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                token_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenDetailResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_token_api_tokens__token_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                token_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TokenUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__tokens___schemas__StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_token_file_api_tokens__token_id__file_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                token_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_token_thumbnail_api_tokens__token_id__thumbnail_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                token_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_users_api_users_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_user_api_users_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_guests_api_users_guests_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["backend__routers__users___schemas__GuestOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_own_account_api_users_me_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_opds_status_api_users_me_opds_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OpdsStatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    revoke_opds_token_api_users_me_opds_delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OpdsStatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    generate_opds_token_api_users_me_opds_generate_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OpdsStatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    change_own_password_api_users_me_password_patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PasswordChange"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PasswordChangeResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_own_preferences_api_users_me_preferences_patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreferencesUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreferencesResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_user_api_users__user_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                user_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_user_api_users__user_id__patch: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                user_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserUpdateResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_access_grants_api_users__user_id__access_grants_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                user_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccessGrantOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_access_grant_api_users__user_id__access_grants_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                user_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccessGrantCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccessGrantOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_access_grant_api_users__user_id__access_grants__grant_id__delete: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                user_id: string;
                grant_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    convert_guest_api_users__user_id__convert_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                user_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GuestConvert"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    merge_guests_api_users__user_id__merge_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description An API key, for external integrations (instead of a session). */
                "X-API-Key"?: string | null;
            };
            path: {
                user_id: string;
            };
            cookie?: {
                grimoire_session?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GuestMerge"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GuestMergeResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    serve_frontend__full_path__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                full_path: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
