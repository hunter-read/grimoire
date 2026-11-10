import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setAccessToken } from './accessToken'
import { armies, leagues } from '../api'

type FetchInit = { method?: string; body?: unknown }

function mockFetch(body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    status: 200,
    ok: true,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
    blob: () => Promise.resolve(new Blob(['x'])),
  })
}

const calls = () => vi.mocked(fetch).mock.calls as unknown as [string, FetchInit][]
const last = () => calls()[calls().length - 1]
const url = () => last()[0]
const method = () => last()[1].method ?? 'GET'
const body = () => JSON.parse(String(last()[1].body))

beforeEach(() => {
  localStorage.clear()
  setAccessToken(null)
  vi.restoreAllMocks()
  globalThis.fetch = mockFetch()
})

describe('armies helpers', () => {
  it('reads, builds, changes and removes armies', async () => {
    await armies.list()
    expect(url()).toBe('/api/armies')
    await armies.get('a1')
    expect(url()).toBe('/api/armies/a1')
    await armies.create({ name: 'Bones' })
    expect([url(), method(), body()]).toEqual(['/api/armies', 'POST', { name: 'Bones' }])
    await armies.update('a1', { name: 'Renamed' })
    expect([url(), method()]).toEqual(['/api/armies/a1', 'PATCH'])
    await armies.remove('a1')
    expect([url(), method()]).toEqual(['/api/armies/a1', 'DELETE'])
    await armies.setProgress('a1', 'unit 1', { experience: 3, honours: [], notes: '' })
    expect([url(), method()]).toEqual(['/api/armies/a1/units/unit%201/progress', 'PUT'])
    await armies.publications('a1')
    expect(url()).toBe('/api/armies/a1/publications')
  })

  it('uploads a roster, with a name when one is given', async () => {
    await armies.importRoster(new Blob(['<roster/>']), 'Named')
    expect([url(), method()]).toEqual(['/api/armies/import', 'POST'])
    const form = last()[1].body as FormData
    expect(form.get('name')).toBe('Named')
    await armies.importRoster(new Blob(['<roster/>']))
    expect((last()[1].body as FormData).get('name')).toBeNull()
  })

  it('downloads an export in the asked-for format', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
    globalThis.URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await armies.download('a1', 'roster', 'Bones.rosz')
    expect(url()).toBe('/api/armies/a1/export?format=roster')
  })

  it('links, unlinks and searches for source books', async () => {
    await armies.searchBooks('codex')
    expect(url()).toBe('/api/armies/publication-links/books?q=codex')
    await armies.setLink({ system_name: 'WH', publication: 'Codex', book_id: 'b1' })
    expect([url(), method()]).toEqual(['/api/armies/publication-links', 'PUT'])
    await armies.removeLink('WH', 'Codex: Necrons')
    expect(url()).toBe('/api/armies/publication-links?system_name=WH&publication=Codex%3A+Necrons')
    expect(method()).toBe('DELETE')
  })

  it('lists the wargame systems and a system’s factions', async () => {
    await armies.systems()
    expect(url()).toBe('/api/systems?game_type=wargame&include_children=true')
    await armies.factions('s1')
    expect(url()).toBe('/api/systems/s1/factions')
  })

  it('lists a guest’s games and their factions', async () => {
    await armies.games()
    expect(url()).toBe('/api/armies/games')
    await armies.gameFactions('s1')
    expect(url()).toBe('/api/armies/games/s1/factions')
  })
})

describe('leagues helpers', () => {
  it('covers leagues, members and games', async () => {
    await leagues.list()
    expect(url()).toBe('/api/leagues')
    await leagues.get('l1')
    expect(url()).toBe('/api/leagues/l1')
    await leagues.create({ name: 'Winter' })
    expect([url(), method()]).toEqual(['/api/leagues', 'POST'])
    await leagues.update('l1', { status: 'finished' })
    expect([url(), method()]).toEqual(['/api/leagues/l1', 'PATCH'])
    await leagues.remove('l1')
    expect([url(), method()]).toEqual(['/api/leagues/l1', 'DELETE'])
    await leagues.eligible('l1')
    expect(url()).toBe('/api/leagues/l1/eligible-members')
    await leagues.addMember('l1', 'u1')
    expect([url(), body()]).toEqual(['/api/leagues/l1/members', { user_id: 'u1' }])
    await leagues.removeMember('l1', 'u1')
    expect([url(), method()]).toEqual(['/api/leagues/l1/members/u1', 'DELETE'])
    await leagues.setArmy('l1', 'u1', '')
    expect([url(), body()]).toEqual(['/api/leagues/l1/members/u1/army', { army_id: null }])
    const game = { player_a_id: 'u1', player_b_id: 'u2', result: 'a' as const }
    await leagues.logGame('l1', game)
    expect([url(), method()]).toEqual(['/api/leagues/l1/games', 'POST'])
    await leagues.updateGame('l1', 'g1', game)
    expect([url(), method()]).toEqual(['/api/leagues/l1/games/g1', 'PUT'])
    await leagues.removeGame('l1', 'g1')
    expect([url(), method()]).toEqual(['/api/leagues/l1/games/g1', 'DELETE'])
  })

  it('covers guests', async () => {
    await leagues.listGuests('l1')
    expect(url()).toBe('/api/leagues/l1/guests')
    await leagues.createGuest('l1', 'Recruit')
    expect([url(), method(), body()]).toEqual([
      '/api/leagues/l1/guests',
      'POST',
      { nickname: 'Recruit' },
    ])
    await leagues.regenerateGuestCode('l1', 'u9')
    expect([url(), method()]).toEqual(['/api/leagues/l1/guests/u9/regenerate', 'POST'])
    await leagues.guestShareTemplate('l1', 'u9')
    expect(url()).toBe('/api/leagues/l1/guests/u9/share')
    await leagues.removeGuest('l1', 'u9')
    expect([url(), method()]).toEqual(['/api/leagues/l1/guests/u9', 'DELETE'])
  })

  it('covers shared books', async () => {
    await leagues.listBooks('l1')
    expect(url()).toBe('/api/leagues/l1/books')
    await leagues.searchBooks('l1', 'codex')
    expect(url()).toBe('/api/leagues/l1/books/search?q=codex')
    await leagues.addBook('l1', { book_id: 'b1', visibility: 'public' })
    expect([url(), method(), body()]).toEqual([
      '/api/leagues/l1/books',
      'POST',
      { book_id: 'b1', visibility: 'public' },
    ])
    await leagues.updateBook('l1', 'r1', { visibility: 'organizer' })
    expect([url(), method()]).toEqual(['/api/leagues/l1/books/r1', 'PATCH'])
    await leagues.reorderBooks('l1', ['r2', 'r1'])
    expect([url(), method(), body()]).toEqual([
      '/api/leagues/l1/books/order',
      'PUT',
      { ordered_ids: ['r2', 'r1'] },
    ])
    await leagues.removeBook('l1', 'r1')
    expect([url(), method()]).toEqual(['/api/leagues/l1/books/r1', 'DELETE'])
  })
})
