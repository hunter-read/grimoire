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
  const body = await res.json()
  if (!res.ok)
    throw Object.assign(new Error(body.detail || 'Request failed'), { status: res.status, body })
  return body
}

export const mediaUrl = (path, params = {}) => {
  const token = getToken()
  const qs = new URLSearchParams({ ...params, ...(token ? { token } : {}) }).toString()
  return `/api${path}${qs ? `?${qs}` : ''}`
}

// Campaign Manager helpers
export const campaigns = {
  list: () => api.get('/campaigns'),
  invites: () => api.get('/campaigns/invites'),
  get: (id) => api.get(`/campaigns/${id}`),
  create: (data) => api.post('/campaigns', data),
  update: (id, data) => api.patch(`/campaigns/${id}`, data),
  delete: (id) => api.delete(`/campaigns/${id}`),

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
  bannerUrl: (id) => mediaUrl(`/campaigns/${id}/banner`),

  // Character art & sheet (keyed by CampaignMember id)
  uploadMemberArt: (id, memberId, file) =>
    api.upload(`/campaigns/${id}/members/${memberId}/art`, file),
  deleteMemberArt: (id, memberId) => api.delete(`/campaigns/${id}/members/${memberId}/art`),
  memberArtUrl: (id, memberId) => mediaUrl(`/campaigns/${id}/members/${memberId}/art`),
  uploadMemberSheet: (id, memberId, file) =>
    api.upload(`/campaigns/${id}/members/${memberId}/sheet`, file),
  deleteMemberSheet: (id, memberId) => api.delete(`/campaigns/${id}/members/${memberId}/sheet`),
  memberSheetUrl: (id, memberId) => mediaUrl(`/campaigns/${id}/members/${memberId}/sheet`),
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
  searchResources: (q = '', resourceType = '', systemId = '', limit = 40) => {
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
}

export const opds = {
  getStatus: () => api.get('/users/me/opds'),
  generateToken: () => api.post('/users/me/opds/generate'),
  revokeToken: () => api.delete('/users/me/opds'),
}

export const settings = {
  get: () => api.get('/settings'),
  getUi: () => api.get('/settings/ui'),
  patch: (data) => api.patch('/settings', data),
  generateApiKey: () => api.post('/settings/api-key/generate'),
  revokeApiKey: () => api.delete('/settings/api-key'),
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
