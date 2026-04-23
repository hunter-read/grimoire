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
  get: (id) => api.get(`/campaigns/${id}`),
  create: (data) => api.post('/campaigns', data),
  update: (id, data) => api.patch(`/campaigns/${id}`, data),
  delete: (id) => api.delete(`/campaigns/${id}`),

  // Members
  invite: (id, userId) => api.post(`/campaigns/${id}/invite`, { user_id: userId }),
  updateMember: (id, userId, status) => api.patch(`/campaigns/${id}/members/${userId}`, { status }),
  setCharacterName: (id, userId, character_name) =>
    api.patch(`/campaigns/${id}/members/${userId}`, { character_name }),
  removeMember: (id, userId) => api.delete(`/campaigns/${id}/members/${userId}`),
  eligibleMembers: (id) => api.get(`/campaigns/${id}/eligible-members`),

  // Resources
  listResources: (id) => api.get(`/campaigns/${id}/resources`),
  addResource: (id, data) => api.post(`/campaigns/${id}/resources`, data),
  updateResource: (id, resourceId, shared) =>
    api.patch(`/campaigns/${id}/resources/${resourceId}`, { shared }),
  removeResource: (id, resourceId) => api.delete(`/campaigns/${id}/resources/${resourceId}`),
  searchResources: (q = '', resourceType = '') => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (resourceType) params.set('resource_type', resourceType)
    params.set('limit', '40')
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

  // Schedule
  getSchedule: (id) => api.get(`/campaigns/${id}/schedule`),
  setSchedule: (id, data) => api.put(`/campaigns/${id}/schedule`, data),
  deleteSchedule: (id) => api.delete(`/campaigns/${id}/schedule`),

  // Availability
  getAvailability: (id) => api.get(`/campaigns/${id}/availability`),
  setAvailability: (id, date, data) => api.put(`/campaigns/${id}/availability/${date}`, data),
  cancelDate: (id, date) => api.put(`/campaigns/${id}/availability/${date}/cancel`),
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
}

export default api
