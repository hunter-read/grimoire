import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setAccessToken } from './accessToken'
import { bookLinks } from '../api'

type FetchInit = { method?: string; body?: unknown }

const calls = () => vi.mocked(fetch).mock.calls as unknown as [string, FetchInit][]
const last = () => calls()[calls().length - 1]

beforeEach(() => {
  localStorage.clear()
  setAccessToken(null)
  vi.restoreAllMocks()
  globalThis.fetch = vi.fn().mockResolvedValue({
    status: 200,
    ok: true,
    headers: { get: () => null },
    text: () => Promise.resolve('[]'),
    json: () => Promise.resolve([]),
  })
})

describe('bookLinks', () => {
  it('lists, adds and removes a book’s links', async () => {
    await bookLinks.list('b1')
    expect([last()[0], last()[1].method ?? 'GET']).toEqual(['/api/books/b1/systems', 'GET'])
    await bookLinks.add('b1', 's2')
    expect([last()[0], last()[1].method, JSON.parse(String(last()[1].body))]).toEqual([
      '/api/books/b1/systems',
      'POST',
      { system_id: 's2' },
    ])
    await bookLinks.remove('b1', 's2')
    expect([last()[0], last()[1].method]).toEqual(['/api/books/b1/systems/s2', 'DELETE'])
  })
})
