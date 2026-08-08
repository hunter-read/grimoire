const getToken = () => localStorage.getItem('grimoire_token')

function authHeaders(includeContentType = false) {
  const token = getToken()
  return {
    ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
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

  // Wiki pages
  listWikiPages: (id) => api.get(`/campaigns/${id}/wiki`),
  getWikiPage: (id, pageId) => api.get(`/campaigns/${id}/wiki/${pageId}`),
  createWikiPage: (id, data) => api.post(`/campaigns/${id}/wiki`, data),
  updateWikiPage: (id, pageId, data) => api.patch(`/campaigns/${id}/wiki/${pageId}`, data),
  deleteWikiPage: (id, pageId) => api.delete(`/campaigns/${id}/wiki/${pageId}`),
  searchWiki: (id, q) => api.get(`/campaigns/${id}/wiki/search?q=${encodeURIComponent(q)}`),
  wikiTitles: (id) => api.get(`/campaigns/${id}/wiki/titles`),
  reorderWikiPages: (id, orderedIds) =>
    api.put(`/campaigns/${id}/wiki/reorder`, { ordered_ids: orderedIds }),
  exportWiki: (id, format) =>
    api.download(`/campaigns/${id}/wiki/export?format=${format}`, `wiki.${format}`),
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

  // Admin: read-only view of a user's campaigns (user page)
  adminListByUser: (userId) => api.get(`/campaigns/admin/by-user/${userId}`),
}

export const auth = {
  config: () => api.get('/auth/config'),
  guestLogin: (code) => api.post('/auth/guest-login', { code }),
  // Clears the server-side session cookie. Best-effort — the client also drops
  // its stored token regardless of whether this succeeds.
  logout: () => api.post('/auth/logout'),
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

export const settings = {
  get: () => api.get('/settings'),
  getUi: () => api.get('/settings/ui'),
  patch: (data) => api.patch('/settings', data),
  generateApiKey: () => api.post('/settings/api-key/generate'),
  revokeApiKey: () => api.delete('/settings/api-key'),
}

// The collection path each bulk-editable resource type lives under. Keyed by the
// `type` the bulk UI already uses, so callers pass the same string throughout.
const BULK_PATHS = {
  book: '/books',
  system: '/systems',
  map: '/maps',
  token: '/tokens',
  audio: '/audio',
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
  get: (url) => fetch(`/api${url}`, { headers: authHeaders() }).then(handleResponse),

  post: (url, data) =>
    fetch(`/api${url}`, {
      method: 'POST',
      headers: authHeaders(!!data),
      body: data ? JSON.stringify(data) : undefined,
    }).then(handleResponse),

  patch: (url, data) =>
    fetch(`/api${url}`, {
      method: 'PATCH',
      headers: authHeaders(true),
      body: JSON.stringify(data),
    }).then(handleResponse),

  put: (url, data) =>
    fetch(`/api${url}`, {
      method: 'PUT',
      headers: authHeaders(!!data),
      body: data ? JSON.stringify(data) : undefined,
    }).then(handleResponse),

  delete: (url) =>
    fetch(`/api${url}`, { method: 'DELETE', headers: authHeaders() }).then(handleResponse),

  // Fetch a file response and trigger a browser download. The server's
  // Content-Disposition filename wins; `fallback` is used only if it's absent.
  download: async (url, fallback) => {
    const res = await fetch(`/api${url}`, { headers: authHeaders() })
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
    const form = new FormData()
    form.append('file', file)
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    return fetch(`/api${url}`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    }).then(handleResponse)
  },
}

export default api
