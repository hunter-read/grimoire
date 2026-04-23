import { describe, it, expect, vi, beforeEach } from 'vitest'
import api, { mediaUrl } from './api'

function mockFetch(status, body) {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  })
}

describe('api', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // api.get
  // ---------------------------------------------------------------------------

  describe('api.get', () => {
    it('sends a GET to /api<url> with auth header when token exists', async () => {
      localStorage.setItem('grimoire_token', 'test-token')
      global.fetch = mockFetch(200, { ok: true })

      await api.get('/systems')

      expect(fetch).toHaveBeenCalledWith('/api/systems', {
        headers: { Authorization: 'Bearer test-token' },
      })
    })

    it('omits Authorization header when no token is stored', async () => {
      global.fetch = mockFetch(200, {})

      await api.get('/systems')

      const [, options] = fetch.mock.calls[0]
      expect(options.headers).not.toHaveProperty('Authorization')
    })

    it('returns parsed JSON on success', async () => {
      global.fetch = mockFetch(200, { systems: [] })

      const result = await api.get('/systems')

      expect(result).toEqual({ systems: [] })
    })

    it('throws with the detail message on a non-OK response', async () => {
      global.fetch = mockFetch(404, { detail: 'Not found' })

      await expect(api.get('/books/ghost')).rejects.toThrow('Not found')
    })

    it('throws an error with the correct status code', async () => {
      global.fetch = mockFetch(404, { detail: 'Not found' })

      await expect(api.get('/books/ghost')).rejects.toMatchObject({ status: 404 })
    })

    it('dispatches grimoire:unauthorized event on 401', async () => {
      global.fetch = mockFetch(401, {})
      const dispatched = []
      window.addEventListener('grimoire:unauthorized', (e) => dispatched.push(e))

      await expect(api.get('/protected')).rejects.toMatchObject({ status: 401 })

      expect(dispatched).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // api.post
  // ---------------------------------------------------------------------------

  describe('api.post', () => {
    it('sends POST with JSON body and Content-Type header', async () => {
      global.fetch = mockFetch(201, { id: '1' })

      await api.post('/users', { username: 'alice', role: 'player' })

      const [url, options] = fetch.mock.calls[0]
      expect(url).toBe('/api/users')
      expect(options.method).toBe('POST')
      expect(options.headers['Content-Type']).toBe('application/json')
      expect(JSON.parse(options.body)).toEqual({ username: 'alice', role: 'player' })
    })

    it('sends POST without body or Content-Type when data is omitted', async () => {
      global.fetch = mockFetch(200, {})

      await api.post('/rescan')

      const [, options] = fetch.mock.calls[0]
      expect(options.headers).not.toHaveProperty('Content-Type')
      expect(options.body).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // api.patch
  // ---------------------------------------------------------------------------

  describe('api.patch', () => {
    it('sends PATCH with Content-Type and JSON body', async () => {
      global.fetch = mockFetch(200, { status: 'ok' })

      await api.patch('/systems/123', { name: 'Updated' })

      const [url, options] = fetch.mock.calls[0]
      expect(url).toBe('/api/systems/123')
      expect(options.method).toBe('PATCH')
      expect(options.headers['Content-Type']).toBe('application/json')
      expect(JSON.parse(options.body)).toEqual({ name: 'Updated' })
    })
  })

  // ---------------------------------------------------------------------------
  // api.delete
  // ---------------------------------------------------------------------------

  describe('api.delete', () => {
    it('sends DELETE and returns null on 204', async () => {
      global.fetch = vi.fn().mockResolvedValue({ status: 204, ok: true })

      const result = await api.delete('/favorites/book/123')

      const [url, options] = fetch.mock.calls[0]
      expect(url).toBe('/api/favorites/book/123')
      expect(options.method).toBe('DELETE')
      expect(result).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // mediaUrl
  // ---------------------------------------------------------------------------

  describe('mediaUrl', () => {
    it('appends token as query param when logged in', () => {
      localStorage.setItem('grimoire_token', 'my-token')
      expect(mediaUrl('/books/1/thumbnail')).toBe('/api/books/1/thumbnail?token=my-token')
    })

    it('returns path without query string when not logged in', () => {
      expect(mediaUrl('/books/1/thumbnail')).toBe('/api/books/1/thumbnail')
    })

    it('merges extra params alongside the token', () => {
      localStorage.setItem('grimoire_token', 'tok')
      const url = mediaUrl('/books/1/page/3', { scale: '2' })
      const params = new URLSearchParams(url.split('?')[1])
      expect(params.get('scale')).toBe('2')
      expect(params.get('token')).toBe('tok')
    })
  })
})
