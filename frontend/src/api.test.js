import { describe, it, expect, vi, beforeEach } from 'vitest'
import api, { mediaUrl, campaigns, auth, opds, settings, bulk } from './api'

// Mirrors a real Response: handleResponse reads the body as text and parses it
// itself, so an error body that isn't JSON can't throw a misleading SyntaxError
// (issue #270).
function mockFetch(status, body) {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
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

    // Issue #270: FastAPI returns the plain text "Internal Server Error" for an
    // unhandled exception. Parsing that as JSON threw a SyntaxError that escaped
    // the caller's catch and masked the real failure.
    it('surfaces a non-JSON error body instead of a JSON parse error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 500,
        ok: false,
        text: () => Promise.resolve('Internal Server Error'),
      })

      await expect(api.patch('/tokens/x', { tags: ['a'] })).rejects.toThrow('Internal Server Error')
    })

    it('falls back to statusText when the error body is empty', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 502,
        ok: false,
        statusText: 'Bad Gateway',
        text: () => Promise.resolve(''),
      })

      await expect(api.get('/x')).rejects.toThrow('Bad Gateway')
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
    // Media auth now rides the HttpOnly session cookie, so the JWT must never
    // appear in the URL — even when one is stored (issue #156).
    it('never puts the token in the URL, even when logged in', () => {
      localStorage.setItem('grimoire_token', 'my-token')
      const url = mediaUrl('/books/1/thumbnail')
      expect(url).toBe('/api/books/1/thumbnail')
      expect(url).not.toContain('my-token')
      expect(url).not.toContain('token=')
    })

    it('returns path without query string when not logged in', () => {
      expect(mediaUrl('/books/1/thumbnail')).toBe('/api/books/1/thumbnail')
    })

    it('includes extra params but no token', () => {
      localStorage.setItem('grimoire_token', 'tok')
      const url = mediaUrl('/books/1/page/3', { scale: '2' })
      const params = new URLSearchParams(url.split('?')[1])
      expect(params.get('scale')).toBe('2')
      expect(params.get('token')).toBeNull()
      expect(url).not.toContain('tok')
    })
  })

  // ---------------------------------------------------------------------------
  // api.put / api.upload / api.download core methods
  // ---------------------------------------------------------------------------

  describe('api.put', () => {
    it('sends PUT with a JSON body when data is provided', async () => {
      global.fetch = mockFetch(200, {})
      await api.put('/campaigns/c1/schedule', { frequency: 'weekly' })
      const [url, options] = fetch.mock.calls[0]
      expect(url).toBe('/api/campaigns/c1/schedule')
      expect(options.method).toBe('PUT')
      expect(JSON.parse(options.body)).toEqual({ frequency: 'weekly' })
    })

    it('sends PUT without a body when data is omitted', async () => {
      global.fetch = mockFetch(200, {})
      await api.put('/campaigns/c1/availability/2026-01-01/cancel')
      const [, options] = fetch.mock.calls[0]
      expect(options.body).toBeUndefined()
    })
  })

  describe('api.upload', () => {
    it('posts multipart FormData without a Content-Type header', async () => {
      global.fetch = mockFetch(201, { id: '1' })
      await api.upload('/campaigns/c1/banner', new Blob(['x']), { category_id: 'cat1' })
      const [url, options] = fetch.mock.calls[0]
      expect(url).toBe('/api/campaigns/c1/banner')
      expect(options.method).toBe('POST')
      expect(options.headers).not.toHaveProperty('Content-Type')
      expect(options.body).toBeInstanceOf(FormData)
    })
  })

  describe('api.download', () => {
    beforeEach(() => {
      global.URL.createObjectURL = vi.fn(() => 'blob:x')
      global.URL.revokeObjectURL = vi.fn()
    })

    it('uses the Content-Disposition filename and triggers a download', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: { get: () => 'attachment; filename="wiki.zip"' },
        blob: () => Promise.resolve(new Blob(['data'])),
      })
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      await api.download('/campaigns/c1/wiki/export?format=zip', 'fallback.zip')
      expect(click).toHaveBeenCalled()
      expect(URL.revokeObjectURL).toHaveBeenCalled()
    })

    it('throws the detail message on a non-OK download', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 404,
        ok: false,
        json: () => Promise.resolve({ detail: 'gone' }),
      })
      await expect(api.download('/x', 'f')).rejects.toThrow('gone')
    })
  })

  // ---------------------------------------------------------------------------
  // Resource helper objects — assert each builds the expected request.
  // ---------------------------------------------------------------------------

  describe('resource helpers', () => {
    beforeEach(() => {
      global.fetch = mockFetch(200, {})
    })

    const lastCall = () => fetch.mock.calls[fetch.mock.calls.length - 1]

    it('campaigns.invites GETs the invites endpoint', async () => {
      await campaigns.invites()
      const [url, options] = lastCall()
      expect(url).toBe('/api/campaigns/invites')
      expect(options.headers).toBeDefined()
      // GET has no method key (defaults to GET) and no body.
      expect(options.method).toBeUndefined()
    })

    it('campaigns.list omits the archived flag by default', async () => {
      await campaigns.list()
      expect(lastCall()[0]).toBe('/api/campaigns')
    })

    it('campaigns.list asks for archived campaigns when requested', async () => {
      await campaigns.list(true)
      expect(lastCall()[0]).toBe('/api/campaigns?include_archived=true')
    })

    it('campaigns.setArchived PUTs the archived flag', async () => {
      await campaigns.setArchived('c1', true)
      const [url, options] = lastCall()
      expect(url).toBe('/api/campaigns/c1/archive')
      expect(options.method).toBe('PUT')
      expect(JSON.parse(options.body)).toEqual({ archived: true })
    })

    it('campaigns.convertToGroup POSTs an empty body without a title', async () => {
      await campaigns.convertToGroup('c1')
      const [url, options] = lastCall()
      expect(url).toBe('/api/campaigns/c1/convert-to-group')
      expect(options.method).toBe('POST')
      expect(JSON.parse(options.body)).toEqual({})
    })

    it('campaigns.convertToGroup sends the gm title when given', async () => {
      await campaigns.convertToGroup('c1', 'Keeper')
      expect(JSON.parse(lastCall()[1].body)).toEqual({ gm_title: 'Keeper' })
    })

    // Exercise every campaigns.* helper so the (large) helper block is covered.
    // Upload/download/mediaUrl helpers are stubbed to no-ops via fetch/URL mocks.
    it('invokes every campaigns helper without throwing', async () => {
      global.URL.createObjectURL = vi.fn(() => 'blob:x')
      global.URL.revokeObjectURL = vi.fn()
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: { get: () => 'attachment; filename="f"' },
        text: () => Promise.resolve('{}'),
        json: () => Promise.resolve({}),
        blob: () => Promise.resolve(new Blob(['x'])),
      })
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

      const file = new Blob(['x'])
      const calls = [
        campaigns.list(),
        campaigns.invites(),
        campaigns.get('c1'),
        campaigns.create({ name: 'x' }),
        campaigns.update('c1', { name: 'y' }),
        campaigns.delete('c1'),
        campaigns.convertToGroup('c1'),
        campaigns.convertToGroup('c1', 'Keeper'),
        campaigns.setArchived('c1', true),
        campaigns.invite('c1', 'u1'),
        campaigns.updateMember('c1', 'u1', 'accepted'),
        campaigns.setCharacterName('c1', 'u1', 'Aragorn'),
        campaigns.setCharacterSheetUrl('c1', 'u1', 'http://x'),
        campaigns.removeMember('c1', 'u1'),
        campaigns.eligibleMembers('c1'),
        campaigns.listGuests('c1'),
        campaigns.createGuest('c1', 'nick'),
        campaigns.regenerateGuestCode('c1', 'm1'),
        campaigns.removeGuest('c1', 'm1'),
        campaigns.guestShareTemplate('c1', 'm1'),
        campaigns.uploadBanner('c1', file),
        campaigns.deleteBanner('c1'),
        campaigns.uploadMemberArt('c1', 'm1', file),
        campaigns.deleteMemberArt('c1', 'm1'),
        campaigns.uploadMemberSheet('c1', 'm1', file),
        campaigns.deleteMemberSheet('c1', 'm1'),
        campaigns.duplicateMemberSheet('c1', 'm1', {}),
        campaigns.listSheetSources('c1'),
        campaigns.listResources('c1'),
        campaigns.addResource('c1', {}),
        campaigns.bulkAddResources('c1', []),
        campaigns.updateResource('c1', 'r1', {}),
        campaigns.reorderResources('c1', ['r1']),
        campaigns.removeResource('c1', 'r1'),
        campaigns.suggestedResources('s1'),
        campaigns.uploadFile('c1', file),
        campaigns.uploadImage('c1', file, { categoryId: 'cat', newCategoryName: 'n' }),
        campaigns.searchResources('q', 'book', 's1', 10),
        campaigns.listSessions('c1'),
        campaigns.createSession('c1', {}),
        campaigns.getSession('c1', 's1'),
        campaigns.updateSession('c1', 's1', {}),
        campaigns.deleteSession('c1', 's1'),
        campaigns.savePlayerNote('c1', 's1', 'note'),
        campaigns.saveGMNote('c1', 's1', {}),
        campaigns.searchSessions('c1', 'q'),
        campaigns.listWikiPages('c1'),
        campaigns.getWikiPage('c1', 'p1'),
        campaigns.createWikiPage('c1', {}),
        campaigns.updateWikiPage('c1', 'p1', {}),
        campaigns.deleteWikiPage('c1', 'p1'),
        campaigns.searchWiki('c1', 'q'),
        campaigns.wikiTitles('c1'),
        campaigns.reorderWikiPages('c1', ['p1']),
        campaigns.exportWiki('c1', 'zip'),
        campaigns.importWiki('c1', file),
        campaigns.listCategories('c1', 'note'),
        campaigns.listCategories('c1'),
        campaigns.createCategory('c1', 'n', 'note', 'icon'),
        campaigns.updateCategory('c1', 'cat1', {}),
        campaigns.renameCategory('c1', 'cat1', 'n'),
        campaigns.reorderCategories('c1', ['cat1']),
        campaigns.setResourceGroupOrder('c1', ['type:book']),
        campaigns.deleteCategory('c1', 'cat1', 'uncategorize'),
        campaigns.getSchedule('c1'),
        campaigns.setSchedule('c1', {}),
        campaigns.deleteSchedule('c1'),
        campaigns.getAvailability('c1'),
        campaigns.setAvailability('c1', '2026-01-01', {}),
        campaigns.cancelDate('c1', '2026-01-01'),
        campaigns.adminListByUser('u1'),
      ]
      await Promise.all(calls)
      expect(fetch).toHaveBeenCalled()

      // Sync URL builders don't hit fetch.
      expect(campaigns.bannerUrl('c1')).toBe('/api/campaigns/c1/banner')
      // A cache-buster attaches as a real query param, not a bare '&v='.
      expect(campaigns.bannerUrl('c1', '2026-01-01T00:00:00')).toBe(
        '/api/campaigns/c1/banner?v=2026-01-01T00%3A00%3A00'
      )
      expect(campaigns.memberArtUrl('c1', 'm1')).toContain('/art')
      expect(campaigns.memberSheetUrl('c1', 'm1')).toContain('/sheet')
      expect(campaigns.fileUrl('c1', 'f1')).toContain('/files/f1')
    })

    it('covers auth, opds, and settings helpers', async () => {
      await Promise.all([
        auth.config(),
        auth.guestLogin('CODE'),
        auth.logout(),
        opds.getStatus(),
        opds.generateToken(),
        opds.revokeToken(),
        settings.get(),
        settings.getUi(),
        settings.patch({}),
        settings.generateApiKey(),
        settings.revokeApiKey(),
      ])
      expect(fetch).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Bulk helpers (issue #270) — one request per selection, not one per item.
  // ---------------------------------------------------------------------------

  describe('bulk helpers', () => {
    beforeEach(() => {
      global.fetch = mockFetch(200, { updated: [], errors: [] })
    })

    const lastCall = () => fetch.mock.calls[fetch.mock.calls.length - 1]

    it('POSTs one request to the collection tag endpoint', async () => {
      await bulk.addTags('token', ['a', 'b'], ['goblin'])
      const [url, options] = lastCall()
      expect(url).toBe('/api/tokens/bulk/tags')
      expect(options.method).toBe('POST')
      expect(JSON.parse(options.body)).toEqual({ ids: ['a', 'b'], tags: ['goblin'] })
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('POSTs per-item edits as a single batch', async () => {
      await bulk.update('book', [{ id: 'b1', title: 'T' }])
      const [url, options] = lastCall()
      expect(url).toBe('/api/books/bulk')
      expect(JSON.parse(options.body)).toEqual({ items: [{ id: 'b1', title: 'T' }] })
    })

    it('POSTs folder tags to the matching folder collection', async () => {
      await bulk.setFolderTags('map', [{ path: 'Caves', tags: ['dark'] }])
      const [url, options] = lastCall()
      expect(url).toBe('/api/map-folders/bulk')
      expect(JSON.parse(options.body)).toEqual({ folders: [{ path: 'Caves', tags: ['dark'] }] })
    })

    it('routes every supported resource type', async () => {
      await Promise.all([
        bulk.addTags('map', ['1'], ['t']),
        bulk.addTags('audio', ['1'], ['t']),
        bulk.addTags('system', ['1'], ['t']),
        bulk.update('system', [{ id: '1' }]),
        bulk.setFolderTags('audio', [{ path: 'p', tags: [] }]),
        bulk.setFolderTags('token', [{ path: 'p', tags: [] }]),
      ])
      const urls = fetch.mock.calls.map(([u]) => u)
      expect(urls).toEqual([
        '/api/maps/bulk/tags',
        '/api/audio/bulk/tags',
        '/api/systems/bulk/tags',
        '/api/systems/bulk',
        '/api/audio-folders/bulk',
        '/api/token-folders/bulk',
      ])
    })
  })
})
