import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAccessToken, setAccessToken } from './api/accessToken'
import api, {
  dispositionFilename,
  mediaUrl,
  bookPageUrl,
  campaigns,
  imageSources,
  tokenFrames,
  files,
  naming,
  sidecars,
  backups,
  auth,
  opds,
  settings,
  apiKeys,
  bulk,
  duplicates,
  characters,
  content,
  rulesets,
  tags,
  shareLinks,
  contentAdmin,
  type BulkType,
} from './api'

// Mirrors a real Response: handleResponse reads the body as text and parses it
// itself, so an error body that isn't JSON can't throw a misleading SyntaxError
// (issue #270).
function mockFetch(status: number, body?: unknown) {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  })
}

// The (url, init) pairs the mocked fetch received. Every helper calls
// fetch(url, init) with a plain-object init, so read it as one.
type FetchInit = {
  method?: string
  headers: Record<string, string>
  // A JSON string, or the FormData of an upload.
  body?: any // eslint-disable-line @typescript-eslint/no-explicit-any
  credentials?: string
}
const fetchCalls = () => vi.mocked(fetch).mock.calls as unknown as [string, FetchInit][]

// A request body the test does not inspect; typed as whatever the helper takes.
const stub = <T>(value: object = {}): T => value as T

describe('api', () => {
  beforeEach(() => {
    localStorage.clear()
    setAccessToken(null)
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // api.get
  // ---------------------------------------------------------------------------

  describe('api.get', () => {
    it('sends a GET to /api<url> with auth header when token exists', async () => {
      setAccessToken('test-token')
      globalThis.fetch = mockFetch(200, { ok: true })

      await api.get('/systems')

      expect(fetch).toHaveBeenCalledWith('/api/systems', {
        headers: { Authorization: 'Bearer test-token' },
      })
    })

    it('omits Authorization header when no token is stored', async () => {
      globalThis.fetch = mockFetch(200, {})

      await api.get('/systems')

      const [, options] = fetchCalls()[0]
      expect(options.headers).not.toHaveProperty('Authorization')
    })

    it('returns parsed JSON on success', async () => {
      globalThis.fetch = mockFetch(200, { systems: [] })

      const result = await api.get('/systems')

      expect(result).toEqual({ systems: [] })
    })

    it('throws with the detail message on a non-OK response', async () => {
      globalThis.fetch = mockFetch(404, { detail: 'Not found' })

      await expect(api.get('/books/ghost')).rejects.toThrow('Not found')
    })

    // Issue #430: FastAPI's 422 body carries `detail` as a *list* of
    // {loc, msg, type} objects. Passing that straight to `new Error` rendered
    // "[object Object]" instead of the reason the request was refused.
    it('surfaces a 422 validation message instead of [object Object]', async () => {
      globalThis.fetch = mockFetch(422, {
        detail: [
          {
            type: 'value_error',
            loc: ['body', 'tags'],
            msg: "Value error, Tags cannot contain '/'.",
          },
        ],
      })

      await expect(api.get('/tags')).rejects.toThrow("Tags cannot contain '/'.")
    })

    it('joins several validation messages and drops duplicates', async () => {
      globalThis.fetch = mockFetch(422, {
        detail: [
          { msg: 'Value error, First problem' },
          { msg: 'Value error, Second problem' },
          { msg: 'Value error, First problem' },
        ],
      })

      await expect(api.get('/tags')).rejects.toThrow('First problem; Second problem')
    })

    it('falls back to the status text when a 422 body has no usable message', async () => {
      globalThis.fetch = mockFetch(422, { detail: [{ loc: ['body'] }] })

      await expect(api.get('/tags')).rejects.toThrow(/./)
    })

    it('reads the message out of an object detail, keeping the rest on the body', async () => {
      const detail = { message: 'Fill in API key', needs_input: ['api_key'] }
      globalThis.fetch = mockFetch(400, { detail })

      await expect(api.post('/characters/import/external', {})).rejects.toMatchObject({
        message: 'Fill in API key',
        body: { detail },
      })
    })

    it('throws an error with the correct status code', async () => {
      globalThis.fetch = mockFetch(404, { detail: 'Not found' })

      await expect(api.get('/books/ghost')).rejects.toMatchObject({ status: 404 })
    })

    // Issue #270: FastAPI returns the plain text "Internal Server Error" for an
    // unhandled exception. Parsing that as JSON threw a SyntaxError that escaped
    // the caller's catch and masked the real failure.
    it('surfaces a non-JSON error body instead of a JSON parse error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 500,
        ok: false,
        text: () => Promise.resolve('Internal Server Error'),
      })

      await expect(api.patch('/tokens/x', { tags: ['a'] })).rejects.toThrow('Internal Server Error')
    })

    it('falls back to statusText when the error body is empty', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 502,
        ok: false,
        statusText: 'Bad Gateway',
        text: () => Promise.resolve(''),
      })

      await expect(api.get('/x')).rejects.toThrow('Bad Gateway')
    })

    it('dispatches grimoire:unauthorized event on 401', async () => {
      globalThis.fetch = mockFetch(401, {})
      const dispatched: Event[] = []
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
      globalThis.fetch = mockFetch(201, { id: '1' })

      await api.post('/users', { username: 'alice', role: 'player' })

      const [url, options] = fetchCalls()[0]
      expect(url).toBe('/api/users')
      expect(options.method).toBe('POST')
      expect(options.headers['Content-Type']).toBe('application/json')
      expect(JSON.parse(options.body)).toEqual({ username: 'alice', role: 'player' })
    })

    it('sends POST without body or Content-Type when data is omitted', async () => {
      globalThis.fetch = mockFetch(200, {})

      await api.post('/rescan')

      const [, options] = fetchCalls()[0]
      expect(options.headers).not.toHaveProperty('Content-Type')
      expect(options.body).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // api.patch
  // ---------------------------------------------------------------------------

  describe('api.patch', () => {
    it('sends PATCH with Content-Type and JSON body', async () => {
      globalThis.fetch = mockFetch(200, { status: 'ok' })

      await api.patch('/systems/123', { name: 'Updated' })

      const [url, options] = fetchCalls()[0]
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
      globalThis.fetch = vi.fn().mockResolvedValue({ status: 204, ok: true })

      const result = await api.delete('/favorites/book/123')

      const [url, options] = fetchCalls()[0]
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
      setAccessToken('my-token')
      const url = mediaUrl('/books/1/thumbnail')
      expect(url).toBe('/api/books/1/thumbnail')
      expect(url).not.toContain('my-token')
      expect(url).not.toContain('token=')
    })

    it('returns path without query string when not logged in', () => {
      expect(mediaUrl('/books/1/thumbnail')).toBe('/api/books/1/thumbnail')
    })

    it('includes extra params but no token', () => {
      setAccessToken('tok')
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
      globalThis.fetch = mockFetch(200, {})
      await api.put('/campaigns/c1/schedule', { frequency: 'weekly' })
      const [url, options] = fetchCalls()[0]
      expect(url).toBe('/api/campaigns/c1/schedule')
      expect(options.method).toBe('PUT')
      expect(JSON.parse(options.body)).toEqual({ frequency: 'weekly' })
    })

    it('sends PUT without a body when data is omitted', async () => {
      globalThis.fetch = mockFetch(200, {})
      await api.put('/campaigns/c1/availability/2026-01-01/cancel')
      const [, options] = fetchCalls()[0]
      expect(options.body).toBeUndefined()
    })
  })

  describe('api.upload', () => {
    it('posts multipart FormData without a Content-Type header', async () => {
      globalThis.fetch = mockFetch(201, { id: '1' })
      await api.upload('/campaigns/c1/banner', new Blob(['x']), { category_id: 'cat1' })
      const [url, options] = fetchCalls()[0]
      expect(url).toBe('/api/campaigns/c1/banner')
      expect(options.method).toBe('POST')
      expect(options.headers).not.toHaveProperty('Content-Type')
      expect(options.body).toBeInstanceOf(FormData)
    })
  })

  describe('api.uploadFolder', () => {
    it('sends every file with a matching path part, in order', async () => {
      globalThis.fetch = mockFetch(201, { imported: 2 })
      const a = new File(['a'], 'a.md', { type: 'text/markdown' })
      const b = new File(['b'], 'b.md', { type: 'text/markdown' })
      await api.uploadFolder('/campaigns/c1/wiki/import', [
        { file: a, path: 'V/Places/a.md' },
        { file: b, path: 'V/b.md' },
      ])

      const [url, options] = fetchCalls()[0]
      expect(url).toBe('/api/campaigns/c1/wiki/import')
      expect(options.headers).not.toHaveProperty('Content-Type')
      // The server pairs files to paths by position, so both lists must align.
      expect(options.body.getAll('files')).toEqual([a, b])
      expect(options.body.getAll('paths')).toEqual(['V/Places/a.md', 'V/b.md'])
    })

    it('falls back to the file name when an entry has no path', async () => {
      globalThis.fetch = mockFetch(201, { imported: 1 })
      const a = new File(['a'], 'solo.md', { type: 'text/markdown' })
      await api.uploadFolder('/campaigns/c1/wiki/import', [{ file: a }])
      expect(fetchCalls()[0][1].body.getAll('paths')).toEqual(['solo.md'])
    })
  })

  describe('api.download', () => {
    beforeEach(() => {
      globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
      globalThis.URL.revokeObjectURL = vi.fn()
    })

    it('uses the Content-Disposition filename and triggers a download', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
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

    it('can POST a JSON body and keeps a UTF-8 filename', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: {
          get: () => `attachment; filename="M?rk.png"; filename*=UTF-8''M%C3%B6rk.png`,
        },
        blob: () => Promise.resolve(new Blob(['data'])),
      })
      let downloaded: string | undefined
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement
      ) {
        downloaded = this.download
      })
      await api.download('/books/b1/export', 'f.zip', { method: 'POST', body: { kind: 'pages' } })
      const [url, init] = fetchCalls()[0]
      expect(url).toBe('/api/books/b1/export')
      expect(init.method).toBe('POST')
      expect(init.body).toBe('{"kind":"pages"}')
      expect(init.headers['Content-Type']).toBe('application/json')
      expect(downloaded).toBe('Mörk.png')
    })

    it('throws the detail message on a non-OK download', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
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
      globalThis.fetch = mockFetch(200, {})
    })

    const lastCall = () => fetchCalls()[fetchCalls().length - 1]

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

    // Setting an image from an asset Grimoire already holds (issue #286).
    it('campaigns.setBannerFromSource POSTs the typed source reference', async () => {
      await campaigns.setBannerFromSource('c1', 'map', 'm1')
      const [url, options] = lastCall()
      expect(url).toBe('/api/campaigns/c1/banner/from-source')
      expect(options.method).toBe('POST')
      expect(JSON.parse(options.body)).toEqual({ source_type: 'map', source_id: 'm1' })
    })

    it('campaigns.setBannerFocus PUTs the focal point', async () => {
      await campaigns.setBannerFocus('c1', 20)
      const [url, options] = lastCall()
      expect(url).toBe('/api/campaigns/c1/banner/focus')
      expect(options.method).toBe('PUT')
      expect(JSON.parse(options.body)).toEqual({ focus_y: 20 })
    })

    it('imageSources.search reuses the campaign resource search', async () => {
      await imageSources.search('ruins', 'map', 50)
      expect(lastCall()[0]).toBe(
        '/api/campaigns/resources/search?q=ruins&resource_type=map&limit=50'
      )
    })

    it('imageSources.setSystemCover POSTs the source reference', async () => {
      await imageSources.setSystemCover('s1', 'token', 't1')
      const [url, options] = lastCall()
      expect(url).toBe('/api/systems/s1/cover/from-source')
      expect(options.method).toBe('POST')
      expect(JSON.parse(options.body)).toEqual({ source_type: 'token', source_id: 't1' })
    })

    it('imageSources.setAudioCover POSTs the source reference', async () => {
      await imageSources.setAudioCover('a1', 'book', 'b1')
      const [url, options] = lastCall()
      expect(url).toBe('/api/audio/a1/cover/from-source')
      expect(options.method).toBe('POST')
      expect(JSON.parse(options.body)).toEqual({ source_type: 'book', source_id: 'b1' })
    })

    it('imageSources.deleteAudioCover DELETEs the track cover', async () => {
      await imageSources.deleteAudioCover('a1')
      const [url, options] = lastCall()
      expect(url).toBe('/api/audio/a1/cover')
      expect(options.method).toBe('DELETE')
    })

    it('imageSources.thumbUrl maps each type to its own endpoint', () => {
      expect(imageSources.thumbUrl('book', 'b1')).toContain('/books/b1/thumbnail')
      expect(imageSources.thumbUrl('map', 'm1')).toContain('/maps/m1/thumbnail')
      expect(imageSources.thumbUrl('token', 't1')).toContain('/tokens/t1/thumbnail')
      // Audio has no thumbnail of its own; its artwork stands in.
      expect(imageSources.thumbUrl('audio', 'a1')).toContain('/audio/a1/artwork')
      expect(imageSources.thumbUrl('campaign_file', 'f1')).toBeNull()
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
      globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
      globalThis.URL.revokeObjectURL = vi.fn()
      globalThis.fetch = vi.fn().mockResolvedValue({
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
        campaigns.duplicateMemberSheet('c1', 'm1', stub()),
        campaigns.listSheetSources('c1'),
        campaigns.listResources('c1'),
        campaigns.addResource('c1', stub()),
        campaigns.bulkAddResources('c1', []),
        campaigns.updateResource('c1', 'r1', {}),
        campaigns.reorderResources('c1', ['r1']),
        campaigns.removeResource('c1', 'r1'),
        campaigns.suggestedResources('s1'),
        campaigns.uploadFile('c1', file),
        campaigns.uploadImage('c1', file, { categoryId: 'cat', newCategoryName: 'n' }),
        campaigns.searchResources('q', 'book', 's1', 10),
        campaigns.listSessions('c1'),
        campaigns.createSession('c1', stub()),
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
        campaigns.importWikiFolder('c1', [{ file: new File(['x'], 'a.md'), path: 'V/a.md' }]),
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
        campaigns.setAvailability('c1', '2026-01-01', stub()),
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
        apiKeys.list(),
        apiKeys.permissions(),
        apiKeys.create({ name: 'k' }),
        apiKeys.update('k1', { name: 'k' }),
        apiKeys.regenerate('k1'),
        apiKeys.revoke('k1'),
      ])
      expect(fetch).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Bulk helpers (issue #270) — one request per selection, not one per item.
  // ---------------------------------------------------------------------------

  describe('bulk helpers', () => {
    beforeEach(() => {
      globalThis.fetch = mockFetch(200, { updated: [], errors: [] })
    })

    const lastCall = () => fetchCalls()[fetchCalls().length - 1]

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
      const urls = fetchCalls().map(([u]) => u)
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

  // ---------------------------------------------------------------------------
  // Access-token refresh (issue #157)
  // ---------------------------------------------------------------------------

  describe('refresh on 401', () => {
    // A response object shaped like the ones handleResponse consumes.
    const res = (status: number, body?: unknown) => ({
      status,
      ok: status >= 200 && status < 300,
      text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
      json: () => Promise.resolve(body),
    })

    it('refreshes and retries once when a request 401s', async () => {
      setAccessToken('stale')
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(res(401))
        .mockResolvedValueOnce(res(200, { token: 'fresh' }))
        .mockResolvedValueOnce(res(200, { ok: true }))

      await expect(api.get('/systems')).resolves.toEqual({ ok: true })

      const urls = fetchCalls().map(([u]) => u)
      expect(urls).toEqual(['/api/systems', '/api/auth/refresh', '/api/systems'])
      expect(getAccessToken()).toBe('fresh')
    })

    it('sends the refreshed token on the retry', async () => {
      setAccessToken('stale')
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(res(401))
        .mockResolvedValueOnce(res(200, { token: 'fresh' }))
        .mockResolvedValueOnce(res(200, {}))

      await api.get('/systems')

      const [, retryOptions] = fetchCalls()[2]
      expect(retryOptions.headers.Authorization).toBe('Bearer fresh')
    })

    it('gives up and reports 401 when the refresh fails', async () => {
      setAccessToken('stale')
      globalThis.fetch = vi.fn().mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(401))

      await expect(api.get('/systems')).rejects.toMatchObject({ status: 401 })
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('does not attempt a refresh when no token is stored', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(res(401))

      await expect(api.get('/systems')).rejects.toMatchObject({ status: 401 })
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('does not refresh on a failed login', async () => {
      // A 401 from /auth/login means bad credentials, not a stale token.
      setAccessToken('stale')
      globalThis.fetch = vi.fn().mockResolvedValue(res(401))

      await expect(api.post('/auth/login', { username: 'a', password: 'b' })).rejects.toMatchObject(
        { status: 401 }
      )
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('shares one refresh across concurrent 401s', async () => {
      // Refresh tokens rotate on use, so parallel refreshes would invalidate
      // each other and log the user out.
      setAccessToken('stale')
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url === '/api/auth/refresh') return Promise.resolve(res(200, { token: 'fresh' }))
        return Promise.resolve(getAccessToken() === 'fresh' ? res(200, { ok: true }) : res(401))
      })

      await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')])

      const refreshCalls = fetchCalls().filter(([u]) => u === '/api/auth/refresh')
      expect(refreshCalls).toHaveLength(1)
    })

    it('rebuilds the form body when retrying an upload', async () => {
      // FormData is a one-shot stream, so the retry needs its own instance.
      setAccessToken('stale')
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(res(401))
        .mockResolvedValueOnce(res(200, { token: 'fresh' }))
        .mockResolvedValueOnce(res(200, { ok: true }))

      await api.upload('/books/1/cover', new Blob(['x']))

      const firstBody = fetchCalls()[0][1].body
      const retryBody = fetchCalls()[2][1].body
      expect(retryBody).toBeInstanceOf(FormData)
      expect(retryBody).not.toBe(firstBody)
    })

    it('rebuilds the form body when retrying a folder upload', async () => {
      setAccessToken('stale')
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(res(401))
        .mockResolvedValueOnce(res(200, { token: 'fresh' }))
        .mockResolvedValueOnce(res(200, { imported: 1 }))

      const file = new File(['a'], 'a.md', { type: 'text/markdown' })
      await api.uploadFolder('/campaigns/c1/wiki/import', [{ file, path: 'V/a.md' }])

      const firstBody = fetchCalls()[0][1].body
      const retryBody = fetchCalls()[2][1].body
      expect(retryBody).not.toBe(firstBody)
      expect(retryBody.getAll('paths')).toEqual(['V/a.md'])
    })
  })

  // ---------------------------------------------------------------------------
  // Session management (issue #157)
  // ---------------------------------------------------------------------------

  describe('auth.sessions', () => {
    it('lists sessions', async () => {
      globalThis.fetch = mockFetch(200, [])
      await auth.sessions()
      expect(fetchCalls()[0][0]).toBe('/api/auth/sessions')
    })

    it('revokes a single session', async () => {
      globalThis.fetch = mockFetch(200, { ok: true })
      await auth.revokeSession('sess-1')
      const [url, options] = fetchCalls()[0]
      expect(url).toBe('/api/auth/sessions/sess-1')
      expect(options.method).toBe('DELETE')
    })

    it('revokes all other sessions', async () => {
      globalThis.fetch = mockFetch(200, { ok: true, revoked: 2 })
      await auth.revokeOtherSessions()
      const [url, options] = fetchCalls()[0]
      expect(url).toBe('/api/auth/sessions/others')
      expect(options.method).toBe('DELETE')
    })
  })
})

// -----------------------------------------------------------------------------
// duplicates (issues #304, #306)
// -----------------------------------------------------------------------------

describe('duplicates', () => {
  beforeEach(() => {
    localStorage.clear()
    setAccessToken(null)
    vi.restoreAllMocks()
  })

  const url = () => fetchCalls()[0][0]

  it('reads scan status', async () => {
    globalThis.fetch = mockFetch(200, { running: false })
    await duplicates.scanStatus()
    expect(url()).toBe('/api/duplicates/scan-status')
  })

  it('starts and cancels a scan', async () => {
    globalThis.fetch = mockFetch(200, { status: 'scan_started' })
    await duplicates.startScan(['book'])
    expect(url()).toBe('/api/duplicates/scan')
    expect(JSON.parse(fetchCalls()[0][1].body)).toEqual({
      resource_types: ['book'],
      accuracy: 'medium',
    })

    globalThis.fetch = mockFetch(200, { status: 'stop_requested' })
    await duplicates.cancelScan()
    expect(url()).toBe('/api/duplicates/cancel-scan')
  })

  it('defaults to scanning every collection', async () => {
    globalThis.fetch = mockFetch(200, {})
    await duplicates.startScan()
    expect(JSON.parse(fetchCalls()[0][1].body)).toEqual({
      resource_types: [],
      accuracy: 'medium',
    })
  })

  it('builds a group query, dropping empty params', async () => {
    globalThis.fetch = mockFetch(200, { groups: [] })
    await duplicates.groups({ resource_type: 'book', limit: 50, min_confidence: '' })
    expect(url()).toBe('/api/duplicates/groups?resource_type=book&limit=50')
  })

  it('omits the query string entirely when there are no params', async () => {
    globalThis.fetch = mockFetch(200, { groups: [] })
    await duplicates.groups()
    expect(url()).toBe('/api/duplicates/groups')
  })

  it('repeats the ids param for compare', async () => {
    globalThis.fetch = mockFetch(200, { items: [] })
    await duplicates.compare('book', ['a', 'b'])
    expect(url()).toBe('/api/duplicates/compare?resource_type=book&ids=a&ids=b')
  })

  it('links children under a parent', async () => {
    globalThis.fetch = mockFetch(200, { linked: ['b2'] })
    await duplicates.link('book', 'b1', [{ id: 'b2', kind: 'version', label: 'v2' }])
    expect(url()).toBe('/api/duplicates/link')
    expect(JSON.parse(fetchCalls()[0][1].body)).toEqual({
      resource_type: 'book',
      parent_id: 'b1',
      children: [{ id: 'b2', kind: 'version', label: 'v2' }],
    })
  })

  it('unlinks by ids or by parent', async () => {
    globalThis.fetch = mockFetch(200, { unlinked: [] })
    await duplicates.unlink('book', { ids: ['b2'] })
    expect(JSON.parse(fetchCalls()[0][1].body)).toEqual({
      resource_type: 'book',
      ids: ['b2'],
      parent_id: null,
    })

    globalThis.fetch = mockFetch(200, { unlinked: [] })
    await duplicates.unlink('map', { parentId: 'm1' })
    expect(JSON.parse(fetchCalls()[0][1].body)).toEqual({
      resource_type: 'map',
      ids: [],
      parent_id: 'm1',
    })
  })

  it('merges metadata', async () => {
    globalThis.fetch = mockFetch(200, { updated: ['title'] })
    await duplicates.mergeMetadata({
      resource_type: 'book',
      source_id: 'a',
      target_id: 'b',
      fields: ['title'],
    })
    expect(url()).toBe('/api/duplicates/merge-metadata')
  })

  it('deletes an item, defaulting to removing the file', async () => {
    globalThis.fetch = mockFetch(200, { file_deleted: true })
    await duplicates.deleteItem('book', 'b1')
    expect(url()).toBe('/api/duplicates/items/book/b1')
    expect(JSON.parse(fetchCalls()[0][1].body)).toEqual({
      delete_file: true,
      reparent_to: null,
    })
  })

  it('can keep the file and name an heir', async () => {
    globalThis.fetch = mockFetch(200, {})
    await duplicates.deleteItem('book', 'b1', { deleteFile: false, reparentTo: 'b2' })
    expect(JSON.parse(fetchCalls()[0][1].body)).toEqual({
      delete_file: false,
      reparent_to: 'b2',
    })
  })

  it('dismisses, lists, and restores dismissals', async () => {
    globalThis.fetch = mockFetch(200, {})
    await duplicates.dismiss('book', ['a', 'b'], 'deliberate')
    expect(url()).toBe('/api/duplicates/dismiss')

    globalThis.fetch = mockFetch(200, { dismissals: [] })
    await duplicates.dismissals('book')
    expect(url()).toBe('/api/duplicates/dismissals?resource_type=book')

    globalThis.fetch = mockFetch(200, { dismissals: [] })
    await duplicates.dismissals()
    expect(url()).toBe('/api/duplicates/dismissals')

    globalThis.fetch = mockFetch(200, { status: 'removed' })
    await duplicates.undismiss('d1')
    expect(url()).toBe('/api/duplicates/dismissals/d1')
  })

  it('promotes a parent version', async () => {
    globalThis.fetch = mockFetch(200, {})
    await duplicates.promote('book', { newParentId: 'b2', oldParentId: 'b1' })
    expect(url()).toBe('/api/duplicates/promote')
    expect(JSON.parse(fetchCalls()[0][1].body)).toEqual({
      resource_type: 'book',
      new_parent_id: 'b2',
      old_parent_id: 'b1',
      kind: 'other',
      label: '',
    })
  })
})

describe('bookPageUrl and tokenFrames', () => {
  it('bookPageUrl generates correct media URLs with or without contentToken', () => {
    expect(bookPageUrl('b1', 1, 800)).toBe('/api/books/b1/page/1?width=800')
    expect(bookPageUrl('b1', 1, 800, 'tok123')).toBe('/api/books/b1/page/1?width=800&v=tok123')
  })

  it('tokenFrames helper methods', async () => {
    globalThis.fetch = mockFetch(200, [])
    await tokenFrames.list()
    expect(fetchCalls()[0][0]).toBe('/api/token-frames')
    expect(tokenFrames.fileUrl('frame-1')).toBe('/api/token-frames/frame-1/file')
  })
})

describe('files, sidecars, and backups helpers', () => {
  beforeEach(() => {
    localStorage.clear()
    setAccessToken(null)
    vi.restoreAllMocks()
    globalThis.fetch = mockFetch(200, {})
  })

  const url = () => fetchCalls()[fetchCalls().length - 1][0]

  it('covers files helper methods', async () => {
    await files.browse()
    expect(url()).toBe('/api/files/browse')
    await files.browse('folder/path')
    expect(url()).toBe('/api/files/browse?path=folder%2Fpath')
    await files.move(['a'], 'b')
    expect(url()).toBe('/api/files/move')
    await files.rename('a', 'b')
    expect(url()).toBe('/api/files/rename')
    await files.createFolder('p', 'n')
    expect(url()).toBe('/api/files/folder')
    await files.setMarkers('p', { nsfw: true })
    expect(url()).toBe('/api/files/folder/markers')
    await files.deleteFolder('p', 'n')
    expect(url()).toBe('/api/files/folder')
    await files.deleteEntry('p', 'n', true)
    expect(url()).toBe('/api/files/delete')
    await files.folderContents('p')
    expect(url()).toBe('/api/files/folder/contents?path=p')
    await files.scaffold('p')
    expect(url()).toBe('/api/files/folder/scaffold')
    await files.record('book', '123')
    expect(url()).toBe('/api/books/123')
  })

  it('covers naming helper methods', async () => {
    const sent = () => {
      const [path, init] = fetchCalls()[fetchCalls().length - 1]
      return [init.method ?? 'GET', path, init.body ? JSON.parse(init.body) : undefined]
    }
    await naming.folders()
    expect(sent()).toEqual(['GET', '/api/naming/folders', undefined])
    await naming.saveFolder('books/A', '{title}')
    expect(sent()).toEqual(['PUT', '/api/naming/folders', { path: 'books/A', pattern: '{title}' }])
    await naming.deleteFolder('books/A')
    expect(sent()).toEqual(['DELETE', '/api/naming/folders?path=books%2FA', undefined])
    await naming.preview('books/A')
    expect(sent()).toEqual(['POST', '/api/naming/preview', { path: 'books/A', pattern: null }])
    await naming.preview('books/A', '{title}')
    expect(sent()[2]).toEqual({ path: 'books/A', pattern: '{title}' })
    await naming.applyTitles('books/A', ['1'])
    expect(sent()).toEqual(['POST', '/api/naming/apply-titles', { path: 'books/A', ids: ['1'] }])
    await naming.rename('books/A', ['1'])
    expect(sent()).toEqual(['POST', '/api/naming/rename', { path: 'books/A', ids: ['1'] }])
    await naming.variantRules()
    expect(sent()).toEqual(['GET', '/api/naming/variant-rules', undefined])
    await naming.saveVariantRules([])
    expect(sent()).toEqual(['PUT', '/api/naming/variant-rules', { rules: [] }])
  })

  it('covers sidecars and backups helpers', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
    globalThis.URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await sidecars.get()
    expect(url()).toBe('/api/maintenance/sidecars/settings')
    await sidecars.save({ covers: true })
    expect(url()).toBe('/api/maintenance/sidecars/settings')
    await sidecars.export()
    expect(url()).toBe('/api/maintenance/sidecars/export')

    await backups.list()
    expect(url()).toBe('/api/backups')
    await backups.create()
    expect(url()).toBe('/api/backups')
    await backups.remove('b1')
    expect(url()).toBe('/api/backups/b1')
    await backups.getSettings()
    expect(url()).toBe('/api/backups/settings')
    await backups.saveSettings({})
    expect(url()).toBe('/api/backups/settings')

    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: () => 'attachment; filename="file.zip"' },
      blob: () => Promise.resolve(new Blob(['x'])),
    })
    await backups.download('b1', 'file.zip')
    expect(url()).toBe('/api/backups/b1/download')
  })
})

describe('character, content, and ruleset helpers', () => {
  beforeEach(() => {
    localStorage.clear()
    setAccessToken(null)
    vi.restoreAllMocks()
    globalThis.fetch = mockFetch(200, {})
  })

  const url = () => fetchCalls()[fetchCalls().length - 1][0]

  it('covers the characters helpers', async () => {
    await characters.listSchemas()
    expect(url()).toBe('/api/characters/schemas')
    await characters.getSchema('dnd 5e')
    expect(url()).toBe('/api/characters/schemas/dnd%205e')
    await characters.importSchema({ document: {} })
    expect(url()).toBe('/api/characters/schemas')
    await characters.deleteSchema('dnd-5e')
    expect(url()).toBe('/api/characters/schemas/dnd-5e')
    await characters.list()
    expect(url()).toBe('/api/characters')
    await characters.list('dnd-5e')
    expect(url()).toBe('/api/characters?schema_ref=dnd-5e')
    await characters.get('c1')
    expect(url()).toBe('/api/characters/c1')
    await characters.create(stub())
    expect(url()).toBe('/api/characters')
    await characters.update('c1', {})
    expect(url()).toBe('/api/characters/c1')
    await characters.remove('c1')
    expect(url()).toBe('/api/characters/c1')
    await characters.listImporters()
    expect(url()).toBe('/api/characters/importers')
    await characters.importExternal({ url: 'https://example.test/c/1' })
    expect(url()).toBe('/api/characters/import/external')
    expect(JSON.parse(fetchCalls().at(-1)![1].body)).toEqual({ url: 'https://example.test/c/1' })
    await characters.installImporter('forge steel')
    expect(url()).toBe('/api/characters/importers/forge%20steel/install')
    await characters.removeImporter('forge-steel')
    expect(url()).toBe('/api/characters/importers/forge-steel')
    expect(fetchCalls().at(-1)![1].method).toBe('DELETE')
    await characters.installImporterForEveryone('forge-steel', 'https://i.test/index.json')
    expect(url()).toBe('/api/addons/forge-steel/install')
    expect(JSON.parse(fetchCalls().at(-1)![1].body)).toEqual({
      approve_script: false,
      index_url: 'https://i.test/index.json',
    })
    await characters.installImporterForEveryone('forge-steel')
    expect(JSON.parse(fetchCalls().at(-1)![1].body)).toEqual({ approve_script: false })
  })

  it('covers the content helpers, including bracketed filters', async () => {
    await content.packs()
    expect(url()).toBe('/api/content/packs')
    await content.packs('dnd-5e')
    expect(url()).toBe('/api/content/packs?schema_id=dnd-5e')
    await content.types('dnd-5e')
    expect(url()).toBe('/api/content/dnd-5e/types')

    await content.browse('dnd-5e', 'spell', { search: 'fire', page: 2 })
    expect(url()).toBe('/api/content/dnd-5e/spell?search=fire&page=2')

    // Filters travel as filter[field]=value, which is the shape the catalog
    // endpoint reads them back out of.
    await content.browse('dnd-5e', 'spell', { filters: { level: 3, school: '' } })
    expect(url()).toBe('/api/content/dnd-5e/spell?filter%5Blevel%5D=3')

    // Empty values are dropped rather than sent as blanks.
    await content.browse('dnd-5e', 'spell', { search: '', sort: undefined })
    expect(url()).toBe('/api/content/dnd-5e/spell')

    await content.entry('dnd-5e', 'spell', 'fireball')
    expect(url()).toBe('/api/content/dnd-5e/spell/fireball')
    await content.resolve('dnd-5e', ['a', 'b'])
    expect(url()).toBe('/api/content/dnd-5e/resolve?ids=a%2Cb')
  })

  it('covers the ruleset helpers', async () => {
    await rulesets.list()
    expect(url()).toBe('/api/rulesets')
    await rulesets.list({ schema_id: 'dnd-5e', campaign_id: '' })
    expect(url()).toBe('/api/rulesets?schema_id=dnd-5e')
    await rulesets.get('r1')
    expect(url()).toBe('/api/rulesets/r1')
    await rulesets.create(stub())
    expect(url()).toBe('/api/rulesets')
    await rulesets.update('r1', {})
    expect(url()).toBe('/api/rulesets/r1')
    await rulesets.remove('r1')
    expect(url()).toBe('/api/rulesets/r1')
    await rulesets.installable('dnd-5e')
    expect(url()).toBe('/api/rulesets/installable?schema_id=dnd-5e')
    await rulesets.installable()
    expect(url()).toBe('/api/rulesets/installable')
    await rulesets.import('r1', {})
    expect(url()).toBe('/api/rulesets/r1/import')
    await rulesets.export('r1')
    expect(url()).toBe('/api/rulesets/r1/export')
    await rulesets.fork('r1', stub())
    expect(url()).toBe('/api/rulesets/r1/fork')
  })

  it('covers the ruleset entry helpers', async () => {
    await rulesets.entries('r1')
    expect(url()).toBe('/api/rulesets/r1/entries')
    await rulesets.entries('r1', 'spell')
    expect(url()).toBe('/api/rulesets/r1/entries?content_type=spell')
    await rulesets.createEntry('r1', stub())
    expect(url()).toBe('/api/rulesets/r1/entries')
    await rulesets.getEntry('r1', 'e1')
    expect(url()).toBe('/api/rulesets/r1/entries/e1')
    await rulesets.updateEntry('r1', 'e1', {})
    expect(url()).toBe('/api/rulesets/r1/entries/e1')
    await rulesets.removeEntry('r1', 'e1')
    expect(url()).toBe('/api/rulesets/r1/entries/e1')
  })
})

describe('dispositionFilename', () => {
  it('prefers the UTF-8 name, falls back to the plain one, and copes with junk', () => {
    expect(dispositionFilename(`attachment; filename="a.png"; filename*=UTF-8''%C3%A9.png`)).toBe(
      'é.png'
    )
    expect(dispositionFilename('attachment; filename="wiki.zip"')).toBe('wiki.zip')
    expect(dispositionFilename('attachment; filename=plain.txt')).toBe('plain.txt')
    expect(dispositionFilename(`attachment; filename="x.png"; filename*=UTF-8''%E0%A4`)).toBe(
      'x.png'
    )
    expect(dispositionFilename('inline')).toBeNull()
    expect(dispositionFilename(null)).toBeNull()
  })
})

// The typed helpers replaced template strings, which never threw: a value still
// undefined at runtime made a URL with "undefined" in it and a request that
// failed like any other. Callers rely on that, so the helpers keep it.
describe('typed helpers with values missing at runtime', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('builds a media URL with an undefined path parameter instead of throwing', () => {
    expect(campaigns.bannerUrl(undefined as unknown as string)).toBe(
      '/api/campaigns/undefined/banner'
    )
  })

  it('requests a route with an undefined path parameter, failing like any request', async () => {
    globalThis.fetch = mockFetch(404, { detail: 'Not found' })
    await expect(campaigns.get(undefined as unknown as string)).rejects.toMatchObject({
      status: 404,
    })
    expect(fetchCalls()[0][0]).toBe('/api/campaigns/undefined')
  })

  it('rejects rather than throws for a collection or bulk type it does not know', async () => {
    globalThis.fetch = mockFetch(200, {})
    const unknown = stub<BulkType>('scroll' as never)
    const record = files.record(unknown, 'x1')
    const update = bulk.update(unknown, [])
    await expect(record).rejects.toThrow('Unknown collection: scroll')
    await expect(update).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})

// One request per helper, pinned exactly: the helpers name routes by their
// OpenAPI template now, and these hold them to the URL, method and body the
// hand-built strings they replaced used to send.
describe('request shapes', () => {
  const last = () => fetchCalls().at(-1)!
  const sent = () => {
    const [url, init] = last()
    return { url, method: init.method ?? 'GET', body: init.body }
  }
  const json = () => JSON.parse(sent().body)

  beforeEach(() => {
    vi.restoreAllMocks()
    globalThis.fetch = mockFetch(200, {})
  })

  it('tags', async () => {
    await tags.list()
    expect(sent()).toMatchObject({ url: '/api/tags', method: 'GET' })
    await tags.list('map & token')
    expect(sent().url).toBe('/api/tags?in_use_by=map+%26+token')

    await tags.items('dark/fey')
    expect(sent().url).toBe('/api/tags/dark%2Ffey/items')
    await tags.items('fey', 'map', { limit: 0 })
    expect(sent().url).toBe('/api/tags/fey/items?resource_type=map&limit=0')
    await tags.items('fey', undefined, { limit: 50, offset: 100 })
    expect(sent().url).toBe('/api/tags/fey/items?limit=50&offset=100')

    await tags.folderItems('fey', 'map', 'Woods/Deep')
    expect(sent().url).toBe(
      '/api/tags/fey/folder-items?resource_type=map&folder=Woods%2FDeep&limit=100&offset=0'
    )

    await tags.create('fey', 'Fey')
    expect(sent()).toMatchObject({ url: '/api/tags', method: 'POST' })
    expect(json()).toEqual({ value: 'fey', display: 'Fey' })
    await tags.rename('fey', 'The Fey')
    expect(sent()).toMatchObject({ url: '/api/tags/fey', method: 'PATCH' })
    expect(json()).toEqual({ display: 'The Fey' })
    await tags.merge('fey', 'faerie')
    expect(sent()).toMatchObject({ url: '/api/tags/fey/merge', method: 'POST' })
    expect(json()).toEqual({ into: 'faerie' })
    await tags.remove('fey')
    expect(sent()).toMatchObject({ url: '/api/tags/fey', method: 'DELETE' })
  })

  it('tags.allItems pages through every item', async () => {
    const page = (items: string[], total: number) => ({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({ items: items.map((id) => ({ item_id: id })), total })),
    })
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(page(['a', 'b'], 3))
      .mockResolvedValueOnce(page(['c'], 3))
    const items = await tags.allItems('fey')
    expect(items.map((i) => i.item_id)).toEqual(['a', 'b', 'c'])
    expect(fetchCalls().map(([url]) => url)).toEqual([
      '/api/tags/fey/items?limit=500',
      '/api/tags/fey/items?limit=500&offset=500',
    ])
  })

  it('share links', async () => {
    await shareLinks.list()
    expect(sent().url).toBe('/api/share-links')
    await shareLinks.list({ resource_type: 'book' })
    expect(sent().url).toBe('/api/share-links?resource_type=book')
    await shareLinks.listForUser('u1')
    expect(sent().url).toBe('/api/share-links/users/u1')
    await shareLinks.permission()
    expect(sent().url).toBe('/api/share-links/permission')
    await shareLinks.create(stub({ resource_type: 'book', resource_id: 'b1' }))
    expect(sent()).toMatchObject({ url: '/api/share-links', method: 'POST' })
    expect(json()).toEqual({ resource_type: 'book', resource_id: 'b1' })
    await shareLinks.update('l1', stub({ label: 'Players' }))
    expect(sent()).toMatchObject({ url: '/api/share-links/l1', method: 'PATCH' })
    await shareLinks.revoke('l1')
    expect(sent()).toMatchObject({ url: '/api/share-links/l1/revoke', method: 'POST' })
    await shareLinks.remove('l1')
    expect(sent()).toMatchObject({ url: '/api/share-links/l1', method: 'DELETE' })
  })

  it('settings: the OIDC button icon', async () => {
    await settings.uploadOidcButtonIcon(new Blob(['png']))
    expect(sent()).toMatchObject({ url: '/api/settings/oidc-button-icon', method: 'POST' })
    expect(sent().body).toBeInstanceOf(FormData)
    await settings.deleteOidcButtonIcon()
    expect(sent()).toMatchObject({ url: '/api/settings/oidc-button-icon', method: 'DELETE' })
  })

  it('characters, content packs and ruleset packs', async () => {
    await characters.browseSheets()
    expect(sent().url).toBe('/api/characters/schemas/browse')
    await characters.installSheet('draw steel')
    expect(sent()).toMatchObject({
      url: '/api/characters/schemas/install/draw%20steel',
      method: 'POST',
    })
    await characters.export('c1')
    expect(sent().url).toBe('/api/characters/c1/export')
    await characters.import(stub({ format: 'grimoire' }))
    expect(sent()).toMatchObject({ url: '/api/characters/import', method: 'POST' })
    expect(json()).toEqual({ payload: { format: 'grimoire' }, import_entries: true })
    await characters.import(stub({}), false)
    expect(json().import_entries).toBe(false)
    expect(characters.portraitUrl('c1')).toBe('/api/characters/c1/portrait')
    expect(characters.portraitUrl('c1', 4)).toBe('/api/characters/c1/portrait?v=4')
    await characters.uploadPortrait('c1', new Blob(['jpg']))
    expect(sent()).toMatchObject({ url: '/api/characters/c1/portrait', method: 'POST' })
    await characters.deletePortrait('c1')
    expect(sent()).toMatchObject({ url: '/api/characters/c1/portrait', method: 'DELETE' })

    await contentAdmin.reloadPacks()
    expect(sent()).toMatchObject({ url: '/api/content/packs/reload', method: 'POST' })

    await rulesets.browsePacks()
    expect(sent().url).toBe('/api/rulesets/packs/browse')
    await rulesets.installPack('srd 5.1')
    expect(sent()).toMatchObject({ url: '/api/rulesets/packs/install/srd%205.1', method: 'POST' })
    await rulesets.uninstallPack('srd 5.1')
    expect(sent()).toMatchObject({ url: '/api/rulesets/packs/srd%205.1', method: 'DELETE' })
  })

  it('image sources: an audio cover upload', async () => {
    await imageSources.uploadAudioCover('a1', new Blob(['jpg']))
    expect(sent()).toMatchObject({ url: '/api/audio/a1/cover', method: 'POST' })
    expect(sent().body.get('file')).toBeInstanceOf(Blob)
  })

  it('campaigns: member tokens and hidden wiki pages', async () => {
    await campaigns.uploadMemberToken('c1', 'm1', new Blob(['png']))
    expect(sent()).toMatchObject({ url: '/api/campaigns/c1/members/m1/token', method: 'POST' })
    await campaigns.deleteMemberToken('c1', 'm1')
    expect(sent()).toMatchObject({ url: '/api/campaigns/c1/members/m1/token', method: 'DELETE' })
    expect(campaigns.memberTokenUrl('c1', 'm1')).toBe('/api/campaigns/c1/members/m1/token')
    expect(campaigns.memberTokenUrl('c1', 'm1', 7)).toBe('/api/campaigns/c1/members/m1/token?v=7')
    await campaigns.hideWikiPage('c1', 'p1')
    expect(sent()).toMatchObject({ url: '/api/campaigns/c1/wiki/p1/hide', method: 'POST' })
    expect(sent().body).toBeUndefined()
    await campaigns.unhideWikiPage('c1', 'p1')
    expect(sent()).toMatchObject({ url: '/api/campaigns/c1/wiki/p1/hide', method: 'DELETE' })
  })

  it('campaigns: wiki templates', async () => {
    await campaigns.wikiTemplates('c1')
    expect(sent().url).toBe('/api/campaigns/c1/wiki/templates')
    await campaigns.getWikiTemplate('c1', 'npc sheet')
    expect(sent().url).toBe('/api/campaigns/c1/wiki/templates/npc%20sheet')
    await campaigns.createWikiTemplate('c1', stub({ name: 'NPC' }))
    expect(sent()).toMatchObject({ url: '/api/campaigns/c1/wiki/templates', method: 'POST' })
    expect(json()).toEqual({ name: 'NPC' })
    await campaigns.updateWikiTemplate('c1', 't1', stub({ name: 'NPC 2' }))
    expect(sent()).toMatchObject({ url: '/api/campaigns/c1/wiki/templates/t1', method: 'PATCH' })
    await campaigns.deleteWikiTemplate('c1', 't1')
    expect(sent()).toMatchObject({ url: '/api/campaigns/c1/wiki/templates/t1', method: 'DELETE' })
    await campaigns.uploadWikiTemplate('c1', new Blob(['zip']))
    expect(sent()).toMatchObject({
      url: '/api/campaigns/c1/wiki/templates/upload',
      method: 'POST',
    })
    await campaigns.useWikiTemplate('c1', 't1')
    expect(sent()).toMatchObject({ url: '/api/campaigns/c1/wiki/templates/t1/use', method: 'POST' })

    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    await campaigns.browseWikiTemplates('c1')
    expect(sent().url).toBe('/api/campaigns/c1/wiki/templates/browse?_t=1700000000000')
    await campaigns.browseWikiTemplates('c1', true)
    expect(sent().url).toBe('/api/campaigns/c1/wiki/templates/browse?refresh=true&_t=1700000000000')

    await campaigns.downloadWikiTemplate('c1', 't1')
    expect(sent()).toMatchObject({
      url: '/api/campaigns/c1/wiki/templates/download/t1',
      method: 'POST',
    })
    await campaigns.downloadWikiTemplate('c1', 't1', 'https://example.test/index.json')
    expect(sent().url).toBe(
      '/api/campaigns/c1/wiki/templates/download/t1?index_url=https%3A%2F%2Fexample.test%2Findex.json'
    )
  })

  it('campaigns: calendar subscriptions', async () => {
    await campaigns.getCalendarSubscription()
    expect(sent().url).toBe('/api/campaigns/calendar/subscription')
    await campaigns.getCalendarSubscription('c1')
    expect(sent().url).toBe('/api/campaigns/calendar/subscription?campaign_id=c1')
    await campaigns.generateCalendarToken('c1')
    expect(sent()).toMatchObject({
      url: '/api/campaigns/calendar/subscription?campaign_id=c1',
      method: 'POST',
    })
    await campaigns.revokeCalendarToken()
    expect(sent()).toMatchObject({
      url: '/api/campaigns/calendar/subscription',
      method: 'DELETE',
    })
  })

  it('campaigns: downloads name the file when the server does not', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
    globalThis.URL.revokeObjectURL = vi.fn()
    const names: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      names.push(this.download)
    })
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: () => null },
      blob: () => Promise.resolve(new Blob(['x'])),
    })
    await campaigns.exportWikiTemplate('c1', 't1', 'NPC')
    expect(sent().url).toBe('/api/campaigns/c1/wiki/templates/t1/export')
    await campaigns.exportWikiTemplate('c1', 't1')
    await campaigns.downloadCalendar('c1', 'Strahd')
    expect(sent().url).toBe('/api/campaigns/c1/calendar.ics')
    await campaigns.downloadCalendar('c1')
    expect(names).toEqual(['NPC.zip', 'template.zip', 'Strahd.ics', 'campaign.ics'])
  })
})
