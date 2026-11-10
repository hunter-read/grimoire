import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setAccessToken } from './accessToken'
import { gmScreen } from '../api'

type FetchInit = { method?: string; body?: unknown }

const calls = () => vi.mocked(fetch).mock.calls as unknown as [string, FetchInit][]
const last = () => calls()[calls().length - 1]
const sent = () => [
  last()[0],
  last()[1].method ?? 'GET',
  last()[1].body && JSON.parse(String(last()[1].body)),
]

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

const BASE = '/api/campaigns/c1/gm-screen'

describe('gmScreen', () => {
  it('reads the board, its party and its sources', async () => {
    await gmScreen.get('c1')
    expect(sent()).toEqual([BASE, 'GET', undefined])
    await gmScreen.party('c1')
    expect(sent()).toEqual([`${BASE}/party`, 'GET', undefined])
    await gmScreen.sources('c1')
    expect(sent()).toEqual([`${BASE}/sources`, 'GET', undefined])
    await gmScreen.exportBoard('c1')
    expect(sent()).toEqual([`${BASE}/export`, 'GET', undefined])
    await gmScreen.presets('c1')
    expect(sent()).toEqual([`${BASE}/presets`, 'GET', undefined])
  })

  it('writes panels one at a time and moves them together', async () => {
    await gmScreen.addPanel('c1', { kind: 'counter', title: 'Fear' })
    expect(sent()).toEqual([`${BASE}/panels`, 'POST', { kind: 'counter', title: 'Fear' }])
    await gmScreen.updatePanel('c1', 'p1', { state: { value: 3 } })
    expect(sent()).toEqual([`${BASE}/panels/p1`, 'PATCH', { state: { value: 3 } }])
    await gmScreen.removePanel('c1', 'p1')
    expect(sent()).toEqual([`${BASE}/panels/p1`, 'DELETE', undefined])
    await gmScreen.saveLayout('c1', [{ id: 'p1', x: 0, y: 1, w: 3, h: 3 }])
    expect(sent()).toEqual([
      `${BASE}/layout`,
      'PUT',
      { panels: [{ id: 'p1', x: 0, y: 1, w: 3, h: 3 }] },
    ])
  })

  it('resets, copies, imports and applies presets', async () => {
    await gmScreen.reset('c1', 'scene')
    expect(sent()).toEqual([`${BASE}/reset`, 'POST', { scope: 'scene' }])
    await gmScreen.copy('c1', 'c2', false)
    expect(sent()).toEqual([`${BASE}/copy`, 'POST', { source_campaign_id: 'c2', replace: false }])
    await gmScreen.importBoard('c1', { panels: [] }, true)
    expect(sent()).toEqual([`${BASE}/import`, 'POST', { document: { panels: [] }, replace: true }])
    await gmScreen.applyPreset('c1', 'demo', null, true)
    expect(sent()).toEqual([
      `${BASE}/presets/apply`,
      'POST',
      { preset_id: 'demo', index_url: null, replace: true },
    ])
  })
})
