const getToken = () => localStorage.getItem('grimoire_token')

function authHeaders(includeContentType = false) {
  const token = getToken()
  return {
    ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

// --- Access-token refresh (issue #157) -------------------------------------
// Access tokens are short-lived, so any request can come back 401 simply
// because the token aged out. When that happens we exchange the HttpOnly
// refresh cookie for a new token and replay the request once.
//
// Concurrent 401s must not each fire their own refresh: refresh tokens rotate
// on use, so parallel exchanges would invalidate each other and log the user
// out. A single in-flight promise is shared by every caller instead.
let refreshPromise = null

// Requests that must never trigger a refresh: the refresh call itself (whose
// 401 is terminal) and the login-ish endpoints, where a 401 means bad
// credentials rather than a stale token.
const NO_REFRESH_PATHS = ['/auth/refresh', '/auth/login', '/auth/guest-login', '/auth/setup']

export function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', {
      method: 'POST',
      // The refresh cookie is HttpOnly and path-scoped; it rides along here.
      credentials: 'same-origin',
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!body?.token) return null
        localStorage.setItem('grimoire_token', body.token)
        return body.token
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

// Perform a request, transparently refreshing and retrying once on a 401.
// `build` is called fresh for each attempt so the retry picks up the new token.
async function authedFetch(url, build) {
  const res = await fetch(url, build())
  if (res.status !== 401) return res
  if (NO_REFRESH_PATHS.some((p) => url.startsWith(`/api${p}`))) return res
  // No stored token means we were never logged in — nothing to refresh.
  if (!getToken()) return res

  const token = await refreshAccessToken()
  if (!token) return res
  return fetch(url, build())
}

async function handleResponse(res) {
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('grimoire:unauthorized'))
    throw Object.assign(new Error('Unauthorized'), { status: 401 })
  }
  if (res.status === 204) return null
  // Not every error body is JSON: an unhandled server exception returns the
  // plain text "Internal Server Error", and parsing that threw a misleading
  // SyntaxError that masked the real failure (issue #270). Parse defensively and
  // fall back to the status text.
  const raw = await res.text()
  let body = null
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    body = null
  }
  if (!res.ok) {
    const detail = body?.detail || raw?.trim() || res.statusText || 'Request failed'
    throw Object.assign(new Error(detail), { status: res.status, body })
  }
  return body
}

// Build a URL for an <img>/download/media endpoint. These requests can't send
// an Authorization header, so they authenticate via the HttpOnly session cookie
// set at login — the JWT is deliberately NOT put in the URL (query params leak
// into proxy logs, Referer headers, and browser history; see issue #156).
export const mediaUrl = (path, params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return `/api${path}${qs ? `?${qs}` : ''}`
}

// URL for a rendered book page. `contentToken` identifies the source file's
// *contents* (from BookDetail.content_token), so replacing the PDF on disk
// changes the URL. Page responses are cached `immutable` for a year, which means
// a browser holding the old render would otherwise never re-request it — the
// token is what makes a replaced book actually show its new pages.
//
// There is no equivalent helper for thumbnails: the grid/list views that render
// covers only have BookListItem payloads, which carry no hash. They rely on the
// ETag the thumbnail endpoint sends, so the browser revalidates and picks up a
// replaced cover on its next request.
export const bookPageUrl = (bookId, page, width, contentToken) =>
  mediaUrl(`/books/${bookId}/page/${page}`, contentToken ? { width, v: contentToken } : { width })

// Campaign Manager helpers
export const campaigns = {
  // includeArchived widens the list to archived campaigns as well as active
  // ones; the default list is the active games only.
  list: (includeArchived = false) =>
    api.get(`/campaigns${includeArchived ? '?include_archived=true' : ''}`),
  invites: () => api.get('/campaigns/invites'),
  get: (id) => api.get(`/campaigns/${id}`),
  create: (data) => api.post('/campaigns', data),
  update: (id, data) => api.patch(`/campaigns/${id}`, data),
  delete: (id) => api.delete(`/campaigns/${id}`),
  // One-way: a group campaign cannot be turned back into a personal one.
  convertToGroup: (id, gmTitle) =>
    api.post(`/campaigns/${id}/convert-to-group`, gmTitle ? { gm_title: gmTitle } : {}),
  setArchived: (id, archived) => api.put(`/campaigns/${id}/archive`, { archived }),

  // Members
  invite: (id, userId) => api.post(`/campaigns/${id}/invite`, { user_id: userId }),
  updateMember: (id, userId, status) => api.patch(`/campaigns/${id}/members/${userId}`, { status }),
  setCharacterName: (id, userId, character_name) =>
    api.patch(`/campaigns/${id}/members/${userId}`, { character_name }),
  setCharacterSheetUrl: (id, userId, character_sheet_url) =>
    api.patch(`/campaigns/${id}/members/${userId}`, { character_sheet_url }),
  removeMember: (id, userId) => api.delete(`/campaigns/${id}/members/${userId}`),
  eligibleMembers: (id) => api.get(`/campaigns/${id}/eligible-members`),

  // Guests (code-based, GM-managed)
  listGuests: (id) => api.get(`/campaigns/${id}/guests`),
  createGuest: (id, nickname) => api.post(`/campaigns/${id}/guests`, { nickname }),
  regenerateGuestCode: (id, memberId) => api.post(`/campaigns/${id}/guests/${memberId}/regenerate`),
  removeGuest: (id, memberId) => api.delete(`/campaigns/${id}/guests/${memberId}`),
  guestShareTemplate: (id, memberId) =>
    api.get(`/campaigns/${id}/guests/${memberId}/share-template`),

  // Banner (keyed by campaign id)
  uploadBanner: (id, file) => api.upload(`/campaigns/${id}/banner`, file),
  deleteBanner: (id) => api.delete(`/campaigns/${id}/banner`),
  // Set the banner from an image the server already holds, instead of
  // re-uploading a copy of something Grimoire has (issue #286).
  setBannerFromSource: (id, sourceType, sourceId) =>
    api.post(`/campaigns/${id}/banner/from-source`, {
      source_type: sourceType,
      source_id: sourceId,
    }),
  // Vertical focal point of the banner in the 2:1 hero, 0-100 (50 = centred).
  setBannerFocus: (id, focusY) => api.put(`/campaigns/${id}/banner/focus`, { focus_y: focusY }),
  // `v` cache-busts the upload cache after a re-upload so the fresh banner is
  // fetched instead of the stale copy the browser is still holding. It must go
  // through mediaUrl as a real query param — media URLs no longer carry a
  // ?token= (auth moved to the HttpOnly cookie in #218), so appending "&v=..."
  // to the bare path produced a malformed, unroutable URL.
  bannerUrl: (id, v) => mediaUrl(`/campaigns/${id}/banner`, v ? { v } : {}),

  // Character art & sheet (keyed by CampaignMember id)
  uploadMemberArt: (id, memberId, file) =>
    api.upload(`/campaigns/${id}/members/${memberId}/art`, file),
  deleteMemberArt: (id, memberId) => api.delete(`/campaigns/${id}/members/${memberId}/art`),
  memberArtUrl: (id, memberId) => mediaUrl(`/campaigns/${id}/members/${memberId}/art`),
  uploadMemberSheet: (id, memberId, file) =>
    api.upload(`/campaigns/${id}/members/${memberId}/sheet`, file),
  deleteMemberSheet: (id, memberId) => api.delete(`/campaigns/${id}/members/${memberId}/sheet`),
  // `v` cache-busts the 5-minute upload cache after an in-app edit so the fresh
  // PDF is fetched instead of the stale copy the browser is still holding.
  memberSheetUrl: (id, memberId, v) =>
    mediaUrl(`/campaigns/${id}/members/${memberId}/sheet`, v ? { v } : {}),
  duplicateMemberSheet: (id, memberId, body) =>
    api.post(`/campaigns/${id}/members/${memberId}/sheet/duplicate`, body),
  listSheetSources: (id) => api.get(`/campaigns/${id}/sheet-sources`),

  // Resources
  listResources: (id) => api.get(`/campaigns/${id}/resources`),
  addResource: (id, data) => api.post(`/campaigns/${id}/resources`, data),
  bulkAddResources: (id, resources) => api.post(`/campaigns/${id}/resources/bulk`, { resources }),
  updateResource: (id, resourceId, patch) =>
    api.patch(`/campaigns/${id}/resources/${resourceId}`, patch),
  reorderResources: (id, orderedIds) =>
    api.put(`/campaigns/${id}/resources/reorder`, { ordered_ids: orderedIds }),
  removeResource: (id, resourceId) => api.delete(`/campaigns/${id}/resources/${resourceId}`),
  suggestedResources: (systemId) => api.get(`/campaigns/resources/suggested/${systemId}`),

  // GM-uploaded campaign files (linked as resource_type='file')
  uploadFile: (id, file) => api.upload(`/campaigns/${id}/files`, file),
  fileUrl: (id, fileId) => mediaUrl(`/campaigns/${id}/files/${fileId}`),
  // Image upload for note embedding. opts: { categoryId, newCategoryName }.
  uploadImage: (id, file, opts = {}) => {
    const fields = {}
    if (opts.categoryId) fields.category_id = opts.categoryId
    if (opts.newCategoryName) fields.new_category_name = opts.newCategoryName
    return api.upload(`/campaigns/${id}/images`, file, fields)
  },
  // `limit` is applied per resource type server-side. It defaults high because
  // the picker browses a whole collection as a folder tree rather than showing a
  // preview slice; the server clamps it to its own ceiling.
  searchResources: (q = '', resourceType = '', systemId = '', limit = 5000) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (resourceType) params.set('resource_type', resourceType)
    if (systemId) params.set('system_id', systemId)
    params.set('limit', String(limit))
    return api.get(`/campaigns/resources/search?${params.toString()}`)
  },

  // Sessions
  listSessions: (id) => api.get(`/campaigns/${id}/sessions`),
  createSession: (id, data) => api.post(`/campaigns/${id}/sessions`, data),
  getSession: (id, sessionId) => api.get(`/campaigns/${id}/sessions/${sessionId}`),
  updateSession: (id, sessionId, data) => api.patch(`/campaigns/${id}/sessions/${sessionId}`, data),
  deleteSession: (id, sessionId) => api.delete(`/campaigns/${id}/sessions/${sessionId}`),
  savePlayerNote: (id, sessionId, content) =>
    api.put(`/campaigns/${id}/sessions/${sessionId}/notes/player`, { content }),
  saveGMNote: (id, sessionId, data) =>
    api.put(`/campaigns/${id}/sessions/${sessionId}/notes/gm`, data),
  searchSessions: (id, q) => api.get(`/campaigns/${id}/sessions/search?q=${encodeURIComponent(q)}`),

  // Wiki pages. `opts` carries the sidebar filters: `mine` restricts to pages
  // the user authored, `includeHidden` brings back the ones they hid.
  listWikiPages: (id, opts = {}) => {
    const params = new URLSearchParams()
    if (opts.mine) params.set('mine', 'true')
    if (opts.includeHidden) params.set('include_hidden', 'true')
    const qs = params.toString()
    return api.get(`/campaigns/${id}/wiki${qs ? `?${qs}` : ''}`)
  },
  getWikiPage: (id, pageId) => api.get(`/campaigns/${id}/wiki/${pageId}`),
  createWikiPage: (id, data) => api.post(`/campaigns/${id}/wiki`, data),
  updateWikiPage: (id, pageId, data) => api.patch(`/campaigns/${id}/wiki/${pageId}`, data),
  deleteWikiPage: (id, pageId) => api.delete(`/campaigns/${id}/wiki/${pageId}`),
  hideWikiPage: (id, pageId) => api.post(`/campaigns/${id}/wiki/${pageId}/hide`),
  unhideWikiPage: (id, pageId) => api.delete(`/campaigns/${id}/wiki/${pageId}/hide`),
  searchWiki: (id, q) => api.get(`/campaigns/${id}/wiki/search?q=${encodeURIComponent(q)}`),
  wikiTitles: (id) => api.get(`/campaigns/${id}/wiki/titles`),
  reorderWikiPages: (id, orderedIds) =>
    api.put(`/campaigns/${id}/wiki/reorder`, { ordered_ids: orderedIds }),
  // `format` is the API's name for the shape (md = zip of files, mdfile = one
  // combined file, json = bundle); the fallback filename maps it to the actual
  // extension, for the rare response with no Content-Disposition.
  exportWiki: (id, format) =>
    api.download(
      `/campaigns/${id}/wiki/export?format=${format}`,
      `wiki.${{ md: 'zip', mdfile: 'md' }[format] || format}`
    ),
  importWiki: (id, file) => api.upload(`/campaigns/${id}/wiki/import`, file),
  // Wiki note templates — per-campaign starting points for pages.
  wikiTemplates: (id) => api.get(`/campaigns/${id}/wiki/templates`),
  getWikiTemplate: (id, templateId) =>
    api.get(`/campaigns/${id}/wiki/templates/${encodeURIComponent(templateId)}`),
  createWikiTemplate: (id, data) => api.post(`/campaigns/${id}/wiki/templates`, data),
  updateWikiTemplate: (id, templateId, data) =>
    api.patch(`/campaigns/${id}/wiki/templates/${encodeURIComponent(templateId)}`, data),
  deleteWikiTemplate: (id, templateId) =>
    api.delete(`/campaigns/${id}/wiki/templates/${encodeURIComponent(templateId)}`),
  uploadWikiTemplate: (id, file) => api.upload(`/campaigns/${id}/wiki/templates/upload`, file),
  exportWikiTemplate: (id, templateId, name) =>
    api.download(
      `/campaigns/${id}/wiki/templates/${encodeURIComponent(templateId)}/export`,
      `${name || 'template'}.zip`
    ),
  useWikiTemplate: (id, templateId) =>
    api.post(`/campaigns/${id}/wiki/templates/${encodeURIComponent(templateId)}/use`),
  // The community catalogue.
  browseWikiTemplates: (id, refresh) =>
    api.get(`/campaigns/${id}/wiki/templates/browse${refresh ? '?refresh=true' : ''}`),
  downloadWikiTemplate: (id, templateId) =>
    api.post(`/campaigns/${id}/wiki/templates/download/${encodeURIComponent(templateId)}`),
  setWikiTemplateSource: (id, indexUrl) =>
    api.put(`/campaigns/${id}/wiki/templates/source`, { index_url: indexUrl }),

  // Categories (kind: 'note' | 'resource')
  listCategories: (id, kind) =>
    api.get(`/campaigns/${id}/categories${kind ? `?kind=${kind}` : ''}`),
  createCategory: (id, name, kind, icon) =>
    api.post(`/campaigns/${id}/categories`, { name, kind, icon }),
  updateCategory: (id, categoryId, patch) =>
    api.patch(`/campaigns/${id}/categories/${categoryId}`, patch),
  renameCategory: (id, categoryId, name) =>
    api.patch(`/campaigns/${id}/categories/${categoryId}`, { name }),
  reorderCategories: (id, orderedIds) =>
    api.put(`/campaigns/${id}/categories/reorder`, { ordered_ids: orderedIds }),
  // Persist the resource panel's group display order (category + type-group keys).
  setResourceGroupOrder: (id, orderedKeys) =>
    api.put(`/campaigns/${id}/resource-group-order`, { ordered_keys: orderedKeys }),
  // mode: 'uncategorize' | 'delete_items'
  deleteCategory: (id, categoryId, mode) =>
    api.delete(`/campaigns/${id}/categories/${categoryId}?mode=${mode}`),

  // Schedule
  getSchedule: (id) => api.get(`/campaigns/${id}/schedule`),
  setSchedule: (id, data) => api.put(`/campaigns/${id}/schedule`, data),
  deleteSchedule: (id) => api.delete(`/campaigns/${id}/schedule`),

  // Availability
  getAvailability: (id) => api.get(`/campaigns/${id}/availability`),
  setAvailability: (id, date, data) => api.put(`/campaigns/${id}/availability/${date}`, data),
  cancelDate: (id, date) => api.put(`/campaigns/${id}/availability/${date}/cancel`),

  // Calendar export / subscription
  downloadCalendar: (id, name) =>
    api.download(`/campaigns/${id}/calendar.ics`, `${name || 'campaign'}.ics`),
  getCalendarSubscription: (id) =>
    api.get(`/campaigns/calendar/subscription${id ? `?campaign_id=${id}` : ''}`),
  generateCalendarToken: (id) =>
    api.post(`/campaigns/calendar/subscription${id ? `?campaign_id=${id}` : ''}`),
  revokeCalendarToken: () => api.delete('/campaigns/calendar/subscription'),

  // Admin: read-only view of a user's campaigns (user page)
  adminListByUser: (userId) => api.get(`/campaigns/admin/by-user/${userId}`),
}

export const auth = {
  config: () => api.get('/auth/config'),
  guestLogin: (code) => api.post('/auth/guest-login', { code }),
  // Revokes the current session server-side and clears both auth cookies.
  // Best-effort — the client drops its stored token regardless.
  logout: () => api.post('/auth/logout'),

  // Active login sessions for the current user (issue #157).
  sessions: () => api.get('/auth/sessions'),
  revokeSession: (id) => api.delete(`/auth/sessions/${id}`),
  // Ends every session except the one making this call.
  revokeOtherSessions: () => api.delete('/auth/sessions/others'),
}

export const opds = {
  getStatus: () => api.get('/users/me/opds'),
  generateToken: () => api.post('/users/me/opds/generate'),
  revokeToken: () => api.delete('/users/me/opds'),
}

export const tags = {
  // in_use_by scopes the list to tags used on a resource type (with counts).
  list: (inUseBy) => api.get(`/tags${inUseBy ? `?in_use_by=${encodeURIComponent(inUseBy)}` : ''}`),
  items: (internal, resourceType) =>
    api.get(
      `/tags/${encodeURIComponent(internal)}/items${
        resourceType ? `?resource_type=${encodeURIComponent(resourceType)}` : ''
      }`
    ),
  create: (value, display) => api.post('/tags', { value, display }),
  rename: (internal, display) => api.patch(`/tags/${encodeURIComponent(internal)}`, { display }),
  merge: (internal, into) => api.post(`/tags/${encodeURIComponent(internal)}/merge`, { into }),
  remove: (internal) => api.delete(`/tags/${encodeURIComponent(internal)}`),
}

/**
 * Library file management (issue #302) — admin only.
 *
 * Every `path` here is relative to the library root and forward-slashed; the
 * backend rejects anything that escapes it. Paths are sent in the JSON body
 * rather than the URL so that names containing `#`, `?`, or `%` survive the
 * round trip intact.
 */
// The collection path each bulk-editable resource type lives under. Keyed by the
// `type` the bulk UI already uses, so callers pass the same string throughout.
const BULK_PATHS = {
  book: '/books',
  system: '/systems',
  map: '/maps',
  token: '/tokens',
  audio: '/audio',
}

// Setting an image from one Grimoire already holds (issue #286). Banner, system
// cover, and audio cover all copy the chosen bytes server-side, so each target
// keeps its own storage and its GET route is unchanged — only the source of the
// bytes differs from a device upload.
export const imageSources = {
  // Library assets the picker can browse, reusing the campaign resource search
  // (books/maps/tokens/audio) that already searches the whole library.
  search: (q = '', resourceType = '', limit = 2000) =>
    campaigns.searchResources(q, resourceType, '', limit),
  setSystemCover: (systemId, sourceType, sourceId) =>
    api.post(`/systems/${systemId}/cover/from-source`, {
      source_type: sourceType,
      source_id: sourceId,
    }),
  setAudioCover: (audioId, sourceType, sourceId) =>
    api.post(`/audio/${audioId}/cover/from-source`, {
      source_type: sourceType,
      source_id: sourceId,
    }),
  uploadAudioCover: (audioId, file) => api.upload(`/audio/${audioId}/cover`, file),
  deleteAudioCover: (audioId) => api.delete(`/audio/${audioId}/cover`),
  // Thumbnail for a picker row. Books/maps/tokens each have their own endpoint;
  // audio shows its artwork.
  thumbUrl: (resourceType, id) => {
    const paths = {
      book: `/books/${id}/thumbnail`,
      map: `/maps/${id}/thumbnail`,
      token: `/tokens/${id}/thumbnail`,
      audio: `/audio/${id}/artwork`,
    }
    return paths[resourceType] ? mediaUrl(paths[resourceType]) : null
  },
}

export const files = {
  browse: (path = '') => api.get(`/files/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  // `onConflict` is 'skip' (report the collision, leave the file) or 'rename'
  // (land it under a suffixed name). Neither ever overwrites.
  move: (sources, destination, onConflict = 'skip') =>
    api.post('/files/move', { sources, destination, on_conflict: onConflict }),
  rename: (path, newName) => api.post('/files/rename', { path, new_name: newName }),
  createFolder: (parent, name, { containerKind = '', nsfw = false } = {}) =>
    api.post('/files/folder', { parent, name, container_kind: containerKind, nsfw }),
  setMarkers: (path, { containerKind, nsfw } = {}) =>
    api.put('/files/folder/markers', {
      path,
      ...(containerKind !== undefined ? { container_kind: containerKind } : {}),
      ...(nsfw !== undefined ? { nsfw } : {}),
    }),
  // A folder holding nothing but markers and empty descendants deletes on
  // request; one still holding content needs `confirmName` to match its own
  // name, or the API answers 428.
  deleteFolder: (path, confirmName) =>
    api.delete('/files/folder', { path, confirm_name: confirmName ?? null }),
  // Two deletes behind one call. Soft by default (`deleteFiles` false): the
  // record goes, the file stays, and a rescan re-adds it. For clearing an entry
  // after a .grimoireignore, or one whose file vanished outside Grimoire.
  // `deleteFiles` true is irreversible: the file goes too, with every tag,
  // favorite, bookmark, and campaign link the record carried.
  deleteEntry: (path, confirmName, deleteFiles = false) =>
    api.post('/files/delete', {
      path,
      confirm_name: confirmName ?? null,
      delete_files: deleteFiles,
    }),
  // Whether a folder holds content, so the UI knows to demand the typed name.
  // Asked of the server rather than counted from a listing: the listing hides
  // sidecars and markers, so the two definitions of "empty" would disagree.
  folderContents: (path) => api.get(`/files/folder/contents?path=${encodeURIComponent(path)}`),
  // Create the standard category folders inside a system folder.
  scaffold: (path) => api.post('/files/folder/scaffold', { path }),
  // Fetch the full record behind a listing row, so the shared metadata editor
  // has the same object the item pages give it. The listing itself carries only
  // what a row needs to render.
  record: (collection, id) => api.get(`${BULK_PATHS[collection]}/${id}`),
}

export const settings = {
  get: () => api.get('/settings'),
  getUi: () => api.get('/settings/ui'),
  patch: (data) => api.patch('/settings', data),
  generateApiKey: () => api.post('/settings/api-key/generate'),
  revokeApiKey: () => api.delete('/settings/api-key'),
}

// Backups (issue #338). Admin-only. A backup is a timestamped .zip holding the
// database plus user-authored assets — never the library itself.
export const backups = {
  list: () => api.get('/backups'),
  create: () => api.post('/backups'),
  remove: (id) => api.delete(`/backups/${id}`),
  getSettings: () => api.get('/backups/settings'),
  saveSettings: (data) => api.put('/backups/settings', data),
  // Uses the shared download helper so the request carries the Authorization
  // header (and refreshes a stale token) rather than relying on a bare URL.
  download: (id, filename) => api.download(`/backups/${id}/download`, filename),
}

// Metadata sidecar export (issue #300). Admin-only; lives under /maintenance
// because it writes into the library rather than changing app behaviour.
// Duplicate detection and variant grouping (issues #304, #306). Every one of
// these is admin-only and, apart from the scan itself, acts on exactly the group
// the user is looking at - nothing here runs on its own.
export const duplicates = {
  scanStatus: () => api.get('/duplicates/scan-status'),
  startScan: (resourceTypes = [], accuracy = 'medium') =>
    api.post('/duplicates/scan', { resource_types: resourceTypes, accuracy }),
  cancelScan: () => api.post('/duplicates/cancel-scan'),
  groups: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString()
    return api.get(`/duplicates/groups${qs ? `?${qs}` : ''}`)
  },
  compare: (resourceType, ids) => {
    const qs = new URLSearchParams({ resource_type: resourceType })
    ids.forEach((id) => qs.append('ids', id))
    return api.get(`/duplicates/compare?${qs.toString()}`)
  },
  link: (resourceType, parentId, children) =>
    api.post('/duplicates/link', {
      resource_type: resourceType,
      parent_id: parentId,
      children,
    }),
  // Hand an existing family a different main version. Distinct from `link`,
  // which refuses to put a parent under something else — see the promote
  // endpoint for why re-electing a parent needs its own call.
  promote: (resourceType, { newParentId, oldParentId, kind = 'other', label = '' }) =>
    api.post('/duplicates/promote', {
      resource_type: resourceType,
      new_parent_id: newParentId,
      old_parent_id: oldParentId,
      kind,
      label,
    }),
  unlink: (resourceType, { ids = [], parentId = null } = {}) =>
    api.post('/duplicates/unlink', {
      resource_type: resourceType,
      ids,
      parent_id: parentId,
    }),
  mergeMetadata: (payload) => api.post('/duplicates/merge-metadata', payload),
  deleteItem: (resourceType, itemId, options = {}) =>
    api.delete(`/duplicates/items/${resourceType}/${itemId}`, {
      delete_file: options.deleteFile !== false,
      reparent_to: options.reparentTo ?? null,
    }),
  dismiss: (resourceType, memberIds, note = '') =>
    api.post('/duplicates/dismiss', {
      resource_type: resourceType,
      member_ids: memberIds,
      note,
    }),
  dismissals: (resourceType) =>
    api.get(`/duplicates/dismissals${resourceType ? `?resource_type=${resourceType}` : ''}`),
  undismiss: (id) => api.delete(`/duplicates/dismissals/${id}`),
}

export const sidecars = {
  get: () => api.get('/maintenance/sidecars/settings'),
  save: (data) => api.put('/maintenance/sidecars/settings', data),
  export: () => api.post('/maintenance/sidecars/export'),
}

// Folder-tag collections that support batched writes (media folder tagging).
const BULK_FOLDER_PATHS = {
  map: '/map-folders',
  token: '/token-folders',
  audio: '/audio-folders',
}

/**
 * Bulk operations (issue #270).
 *
 * These replace the old one-request-per-item fan-out, which raced on tag
 * creation server-side and returned intermittent 500s. Each call sends the whole
 * selection in a single request that the backend applies in one transaction.
 *
 * Every response is `{updated: [id], errors: [{id, detail}]}`; `addTags` also
 * returns `tags` keyed by id so callers can patch local state without refetching.
 */
export const bulk = {
  // Additively apply `tags` to every id — never removes existing tags.
  addTags: (type, ids, tags) => api.post(`${BULK_PATHS[type]}/bulk/tags`, { ids, tags }),
  // Apply per-item field edits. `items` is [{id, ...fields}]; a per-item `tags`
  // list replaces that item's tags outright.
  update: (type, items) => api.post(`${BULK_PATHS[type]}/bulk`, { items }),
  // Set tags on many folders at once. `folders` is [{path, tags}].
  setFolderTags: (type, folders) => api.post(`${BULK_FOLDER_PATHS[type]}/bulk`, { folders }),
}

const api = {
  get: (url) => authedFetch(`/api${url}`, () => ({ headers: authHeaders() })).then(handleResponse),

  post: (url, data) =>
    authedFetch(`/api${url}`, () => ({
      method: 'POST',
      headers: authHeaders(!!data),
      body: data ? JSON.stringify(data) : undefined,
    })).then(handleResponse),

  patch: (url, data) =>
    authedFetch(`/api${url}`, () => ({
      method: 'PATCH',
      headers: authHeaders(true),
      body: JSON.stringify(data),
    })).then(handleResponse),

  put: (url, data) =>
    authedFetch(`/api${url}`, () => ({
      method: 'PUT',
      headers: authHeaders(!!data),
      body: data ? JSON.stringify(data) : undefined,
    })).then(handleResponse),

  // `data` is optional — most DELETEs identify their target in the URL, but the
  // file-management endpoints send a library path in the body so names
  // containing URL metacharacters survive intact.
  delete: (url, data) =>
    authedFetch(`/api${url}`, () => ({
      method: 'DELETE',
      headers: authHeaders(!!data),
      body: data ? JSON.stringify(data) : undefined,
    })).then(handleResponse),

  // Fetch a file response and trigger a browser download. The server's
  // Content-Disposition filename wins; `fallback` is used only if it's absent.
  download: async (url, fallback) => {
    const res = await authedFetch(`/api${url}`, () => ({ headers: authHeaders() }))
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('grimoire:unauthorized'))
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    }
    if (!res.ok) {
      let detail = 'Request failed'
      try {
        detail = (await res.json()).detail || detail
      } catch {
        // non-JSON error body
      }
      throw Object.assign(new Error(detail), { status: res.status })
    }
    const disposition = res.headers.get('Content-Disposition') || ''
    const match = disposition.match(/filename="?([^"]+)"?/)
    const filename = match ? match[1] : fallback
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objectUrl)
  },

  // Multipart upload — do NOT set Content-Type so the browser adds the boundary.
  // `fields` appends extra form values alongside the file.
  upload: (url, file, fields = {}) => {
    // Rebuilt per attempt: a FormData body is a one-shot stream, so a retry
    // after a token refresh needs its own instance.
    const buildForm = () => {
      const form = new FormData()
      form.append('file', file)
      for (const [k, v] of Object.entries(fields)) form.append(k, v)
      return form
    }
    return authedFetch(`/api${url}`, () => ({
      method: 'POST',
      headers: authHeaders(),
      body: buildForm(),
    })).then(handleResponse)
  },
}

export default api
