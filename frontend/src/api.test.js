import { describe, it, expect, vi, beforeEach } from 'vitest'
import api, { mediaUrl, campaigns, auth, opds, settings } from './api'

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

    // Exercise every campaigns.* helper so the (large) helper block is covered.
    // Upload/download/mediaUrl helpers are stubbed to no-ops via fetch/URL mocks.
    it('invokes every campaigns helper without throwing', async () => {
      global.URL.createObjectURL = vi.fn(() => 'blob:x')
      global.URL.revokeObjectURL = vi.fn()
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: { get: () => 'attachment; filename="f"' },
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
      expect(campaigns.bannerUrl('c1')).toContain('/api/campaigns/c1/banner')
      expect(campaigns.memberArtUrl('c1', 'm1')).toContain('/art')
      expect(campaigns.memberSheetUrl('c1', 'm1')).toContain('/sheet')
      expect(campaigns.fileUrl('c1', 'f1')).toContain('/files/f1')
    })

    it('covers auth, opds, and settings helpers', async () => {
      await Promise.all([
        auth.config(),
        auth.guestLogin('CODE'),
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
})
