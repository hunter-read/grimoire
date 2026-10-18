/**
 * The signed-in user's account: auth sessions, OPDS, settings, API keys and
 * share links.
 */
import api, { client, postUrl, type Id, type BodyOf, type QueryOf } from './client'

export const auth = {
  config: () => client.get('/auth/config'),
  guestLogin: (code: string) => client.post('/auth/guest-login', { body: { code } }),
  // Revokes the current session server-side and clears both auth cookies.
  // Best-effort — the client drops its stored token regardless.
  logout: () => client.post('/auth/logout'),

  // Active login sessions for the current user (issue #157).
  sessions: () => client.get('/auth/sessions'),
  revokeSession: (id: Id) =>
    client.delete('/auth/sessions/{session_id}', { path: { session_id: id } }),
  // Ends every session except the one making this call.
  revokeOtherSessions: () => client.delete('/auth/sessions/others'),
}

export const opds = {
  getStatus: () => client.get('/users/me/opds'),
  generateToken: () => client.post('/users/me/opds/generate'),
  revokeToken: () => client.delete('/users/me/opds'),
}

export const settings = {
  get: () => client.get('/settings'),
  getUi: () => client.get('/settings/ui'),
  patch: (data: BodyOf<'/settings', 'patch'>) => client.patch('/settings', { body: data }),
  // OIDC login-button icon (issue #377). Both return the full settings.
  uploadOidcButtonIcon: (file: Blob) => api.upload(postUrl('/settings/oidc-button-icon'), file),
  deleteOidcButtonIcon: () => client.delete('/settings/oidc-button-icon'),
}

// Personal API keys (issue #489). A key acts as its owner. The full key is
// returned once, by create and regenerate; everything else only sees its prefix.
// `list(true)` is the admin view of every user's keys.
export const apiKeys = {
  list: (all = false) => client.get('/api-keys', { query: { all: all ? true : undefined } }),
  permissions: () => client.get('/api-keys/permissions'),
  create: (data: BodyOf<'/api-keys', 'post'>) => client.post('/api-keys', { body: data }),
  update: (id: Id, data: BodyOf<'/api-keys/{key_id}', 'patch'>) =>
    client.patch('/api-keys/{key_id}', { path: { key_id: id }, body: data }),
  regenerate: (id: Id) => client.post('/api-keys/{key_id}/regenerate', { path: { key_id: id } }),
  revoke: (id: Id) => client.delete('/api-keys/{key_id}', { path: { key_id: id } }),
}

// Share links (issue #541): public, revocable URLs for one library item.
export const shareLinks = {
  list: (params: QueryOf<'/share-links', 'get'> = {}) =>
    client.get('/share-links', { query: params }),
  listForUser: (userId: Id) =>
    client.get('/share-links/users/{user_id}', { path: { user_id: userId } }),
  permission: () => client.get('/share-links/permission'),
  create: (data: BodyOf<'/share-links', 'post'>) => client.post('/share-links', { body: data }),
  update: (id: Id, data: BodyOf<'/share-links/{link_id}', 'patch'>) =>
    client.patch('/share-links/{link_id}', { path: { link_id: id }, body: data }),
  revoke: (id: Id) => client.post('/share-links/{link_id}/revoke', { path: { link_id: id } }),
  remove: (id: Id) => client.delete('/share-links/{link_id}', { path: { link_id: id } }),
}
