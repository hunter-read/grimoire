import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useShelf, { FLAT } from './useShelf'
import api from '../api'
import { fakeShelfGet } from '../test/fakeBrowseApi'
import { nodeKey } from '../components/system/shelfTree'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

const system = { id: 's1', name: 'Sys', category_depth: 2 }
const book = (id, title, path, extra = {}) => ({
  id,
  title,
  category: 'core',
  relative_path: `books/Sys/Core/${path}${title}.pdf`,
  ...extra,
})
const books = [
  book('b1', 'Alpha', ''),
  book('b2', 'Beta', 'Monsters/', { genres: ['Horror'] }),
  book('b3', 'Gamma', 'Monsters/'),
]

const calls = (part) => api.get.mock.calls.map(([u]) => u).filter((u) => u.includes(part))

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation(fakeShelfGet({ system, books }))
})

const render = (props) =>
  renderHook((p) => useShelf('s1', p), {
    initialProps: {
      grouped: true,
      bookFilter: { sort: 'title', order: 'asc', filters: {} },
      ...props,
    },
  })

describe('useShelf', () => {
  it('fetches the summary without books, the facets, and the tree', async () => {
    const { result } = render()
    await waitFor(() => expect(result.current.system?.id).toBe('s1'))
    expect(calls('/systems/s1?include_books=false')).toHaveLength(1)
    await waitFor(() => expect(result.current.shelf.core?.count).toBe(3))
    expect(result.current.shelf.core.folders.Monsters.count).toBe(2)
    await waitFor(() => expect(result.current.facets.genres).toEqual(['Horror']))
    expect(result.current.matchCount).toBe(3)
  })

  it('loads a node a page at a time', async () => {
    const { result } = render()
    await waitFor(() => expect(result.current.shelf.core).toBeDefined())
    act(() => result.current.loadNode(nodeKey('core', 'Monsters')))
    await waitFor(() =>
      expect(result.current.pages.get(nodeKey('core', 'Monsters')).items.map((b) => b.id)).toEqual([
        'b2',
        'b3',
      ])
    )
    expect(result.current.loadedBooks.map((b) => b.id).sort()).toEqual(['b2', 'b3'])
    const req = calls('/books?').find((u) => u.includes('folder=Monsters'))
    expect(req).toContain('category=core')
  })

  it('sends the filters with every request', async () => {
    const { result } = render({
      bookFilter: { sort: 'title', order: 'asc', filters: { genres: 'Horror' } },
    })
    await waitFor(() => expect(result.current.matchCount).toBe(1))
    expect(calls('/book-groups').every((u) => u.includes('genre=Horror'))).toBe(true)
  })

  it('pages the flat list when ungrouped', async () => {
    const { result } = render({ grouped: false })
    await waitFor(() => expect(result.current.flatBooks).toHaveLength(3))
    expect(result.current.flatHasMore).toBe(false)
    expect(result.current.matchCount).toBe(3)
    expect(calls('/book-groups')).toHaveLength(0)
    act(() => result.current.loadMoreFlat())
    expect(FLAT).toBeTruthy()
  })

  it('waits for ready before fetching any books', async () => {
    const { result, rerender } = render({ ready: false })
    await waitFor(() => expect(result.current.system).not.toBeNull())
    expect(calls('/book-groups')).toHaveLength(0)
    rerender({
      grouped: true,
      bookFilter: { sort: 'title', order: 'asc', filters: {} },
      ready: true,
    })
    await waitFor(() => expect(calls('/book-groups')).toHaveLength(1))
  })

  it('patches loaded books and reloads everything on request', async () => {
    const { result } = render({ grouped: false })
    await waitFor(() => expect(result.current.flatBooks).toHaveLength(3))
    act(() => result.current.updateBooks((b) => ({ ...b, title: `${b.title}!` })))
    expect(result.current.flatBooks[0].title).toBe('Alpha!')
    const before = calls('/systems/s1?include_books=false').length
    act(() => result.current.reload())
    await waitFor(() =>
      expect(calls('/systems/s1?include_books=false').length).toBeGreaterThan(before)
    )
    await waitFor(() => expect(result.current.flatBooks[0].title).toBe('Alpha'))
  })

  it('falls back to empty facets and groups when those requests fail', async () => {
    api.get.mockImplementation((url) =>
      url.includes('/book-')
        ? Promise.reject(new Error('boom'))
        : fakeShelfGet({ system, books })(url)
    )
    const { result } = render()
    await waitFor(() => expect(result.current.groups).not.toBeNull())
    expect(result.current.matchCount).toBe(0)
    expect(result.current.facets.tags).toEqual([])
  })
})
