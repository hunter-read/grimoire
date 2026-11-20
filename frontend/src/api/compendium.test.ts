import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setAccessToken } from './accessToken'
import { characters, compendium } from '../api'

type FetchInit = { method?: string; body?: unknown }

const calls = () => vi.mocked(fetch).mock.calls as unknown as [string, FetchInit][]
const last = () => calls()[calls().length - 1]
const sent = () => [decodeURIComponent(last()[0]), last()[1].method ?? 'GET']

beforeEach(() => {
  localStorage.clear()
  setAccessToken(null)
  vi.restoreAllMocks()
  globalThis.fetch = vi.fn().mockResolvedValue({
    status: 200,
    ok: true,
    headers: { get: () => null },
    text: () => Promise.resolve('{}'),
    json: () => Promise.resolve({}),
  })
})

describe('compendium', () => {
  it('reads a system’s compendium and sets its links', async () => {
    await compendium.get('s1')
    expect(sent()).toEqual(['/api/systems/s1/compendium', 'GET'])
    await compendium.setLinks('s1', { pack_ids: ['srd'] })
    expect([...sent(), JSON.parse(String(last()[1].body))]).toEqual([
      '/api/systems/s1/compendium/links',
      'PUT',
      { pack_ids: ['srd'] },
    ])
  })

  it('browses a type with its filters as filter[field]', async () => {
    await compendium.browse('s1', 'spell', {
      search: 'fire',
      page: 2,
      filters: { level: '3', school: '' },
    })
    const [url] = sent()
    expect(url).toContain('/api/systems/s1/compendium/spell?')
    expect(url).toContain('search=fire')
    expect(url).toContain('page=2')
    expect(url).toContain('filter[level]=3')
    expect(url).not.toContain('filter[school]')
  })

  it('reads one entry, with its origin when given', async () => {
    await compendium.entry('s1', 'spell', 'fireball')
    expect(sent()).toEqual(['/api/systems/s1/compendium/spell/fireball', 'GET'])
    await compendium.entry('s1', 'spell', 'fireball', 'ruleset:r1')
    expect(sent()[0]).toBe('/api/systems/s1/compendium/spell/fireball?origin=ruleset:r1')
  })

  it('searches one system or every system', async () => {
    await compendium.searchSystem('s1', 'prone')
    expect(sent()).toEqual(['/api/systems/s1/compendium/search?q=prone', 'GET'])
    await compendium.search('prone')
    expect(sent()).toEqual(['/api/compendium/search?q=prone', 'GET'])
    await compendium.search('prone', 's2')
    expect(sent()[0]).toBe('/api/compendium/search?q=prone&system_id=s2')
  })
})

describe('server-wide sheets', () => {
  it('asks for server_wide only when installing for everyone', async () => {
    await characters.installSheet('cairn')
    expect(sent()).toEqual(['/api/characters/schemas/install/cairn', 'POST'])
    await characters.installSheet('cairn', true)
    expect(sent()).toEqual(['/api/characters/schemas/install/cairn?server_wide=true', 'POST'])
    await characters.importSchema({ text: 'id: x' }, true)
    expect(sent()).toEqual(['/api/characters/schemas?server_wide=true', 'POST'])
    await characters.deleteSchema('cairn', true)
    expect(sent()).toEqual(['/api/characters/schemas/cairn?server_wide=true', 'DELETE'])
    await characters.deleteSchema('cairn')
    expect(sent()).toEqual(['/api/characters/schemas/cairn', 'DELETE'])
  })
})
