import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import useMediaGallery from './useMediaGallery'
import api, { bulk } from '../api'
import { MEDIA_CONFIGS } from '../components/media/mediaConfig'
import { FILTER_NONE } from '../components/library/specialFilters'

vi.mock('../api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
  bulk: {
    addTags: vi.fn(() => Promise.resolve({ updated: [], errors: [], tags: {} })),
    update: vi.fn(() => Promise.resolve({ updated: [], errors: [] })),
    setFolderTags: vi.fn(() => Promise.resolve({ folders: [] })),
  },
}))

const mockIsFavorite = vi.fn(() => false)
vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: mockIsFavorite }),
}))

// Deterministic session state (start expanded / grouped true). Real useState
// underneath, because the sort/filter state now lives here too and a no-op
// setter would silently swallow every filter change under test.
vi.mock('./useSessionState', () => ({
  default: (key, init) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [val, setVal] = useState(key.endsWith(':grouped') ? true : init)
    return [val, setVal]
  },
}))

const config = MEDIA_CONFIGS.map

const item = (over) => ({
  id: over.id,
  filename: over.filename,
  relative_path: over.relative_path || `maps/${over.filename}`,
  file_size: over.file_size ?? 0,
  tags: over.tags || [],
  ...over,
})

function setup(items, savedFilters = [], folders = []) {
  api.get.mockImplementation((url) => {
    if (url.split('?')[0] === '/maps') return Promise.resolve({ maps: items, total: items.length })
    if (url === '/map-folders') return Promise.resolve({ folders })
    if (url.startsWith('/saved-filters')) return Promise.resolve({ filters: savedFilters })
    return Promise.resolve({})
  })
}

// The hook distinguishes arriving fresh from returning via the back button, so
// it needs a router. These render as a fresh arrival (no restoreView flag),
// which is when the saved default preset applies.
const renderGallery = () =>
  renderHook(() => useMediaGallery(config), {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
  })

beforeEach(() => {
  vi.clearAllMocks()
  mockIsFavorite.mockReturnValue(false)
})

describe('useMediaGallery', () => {
  it('loads items and exposes them grouped and flat', async () => {
    setup([item({ id: 'a', filename: 'beta.png' }), item({ id: 'b', filename: 'alpha.png' })])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    // Flat list sorted by filename ascending (default sort).
    expect(result.current.flatItems.map((i) => i.filename)).toEqual(['alpha.png', 'beta.png'])
  })

  it('sorts by size descending when set', async () => {
    setup([
      item({ id: 'a', filename: 'small.png', file_size: 10 }),
      item({ id: 'b', filename: 'big.png', file_size: 500 }),
    ])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => result.current.setSortFilter({ sort: 'size', order: 'desc', filters: {} }))
    expect(result.current.flatItems.map((i) => i.filename)).toEqual(['big.png', 'small.png'])
  })

  it('filters by the search text (via setFilter)', async () => {
    setup([item({ id: 'a', filename: 'dragon.png' }), item({ id: 'b', filename: 'goblin.png' })])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => result.current.setFilter('dragon'))
    expect(result.current.flatItems.map((i) => i.filename)).toEqual(['dragon.png'])
  })

  it('filters by favorites', async () => {
    mockIsFavorite.mockImplementation((type, id) => id === 'a')
    setup([item({ id: 'a', filename: 'fav.png' }), item({ id: 'b', filename: 'other.png' })])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() =>
      result.current.setSortFilter((s) => ({ ...s, filters: { ...s.filters, favorites: true } }))
    )
    expect(result.current.flatItems.map((i) => i.filename)).toEqual(['fav.png'])
  })

  it('toggles a tag filter and matches OR-style', async () => {
    setup([
      item({ id: 'a', filename: 'a.png', tags: ['forest'] }),
      item({ id: 'b', filename: 'b.png', tags: ['cave'] }),
    ])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => result.current.toggleTag('forest'))
    expect(result.current.flatItems.map((i) => i.id)).toEqual(['a'])
    expect(result.current.selectedTags.has('forest')).toBe(true)
  })

  it('applies the default saved preset on load', async () => {
    setup(
      [item({ id: 'a', filename: 'x.png' })],
      [
        {
          id: 'd',
          scope: 'maps',
          name: 'Def',
          is_default: true,
          state: { sort: 'size', order: 'desc', filters: {} },
        },
      ]
    )
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    await waitFor(() => expect(result.current.sortFilter.sort).toBe('size'))
  })

  it('clears tags and toggles grouping helpers', async () => {
    setup([item({ id: 'a', filename: 'a.png', tags: ['forest'] })])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => result.current.toggleTag('forest'))
    expect(result.current.selectedTags.size).toBe(1)
    act(() => result.current.clearTags())
    expect(result.current.selectedTags.size).toBe(0)
  })

  it('collects allTags (lowercased) from items', async () => {
    setup([
      item({ id: 'a', filename: 'a.png', tags: ['Forest', 'CAVE'] }),
      item({ id: 'b', filename: 'b.png', tags: ['forest'] }),
    ])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(result.current.allTags).toEqual(['cave', 'forest'])
  })

  // A folder tag applies to everything beneath the folder, however deeply
  // nested. Previously only an item whose immediate folder carried the tag
  // picked it up, so a tag on "Fall Of Blackbottom" missed the maps sitting in
  // "Fall Of Blackbottom/Alleyways".
  describe('folder tags inherited by nested items', () => {
    const nested = () =>
      item({
        id: 'n',
        filename: 'map1.png',
        relative_path: 'maps/Fall Of Blackbottom/Alleyways/map1.png',
      })
    const parentTagged = [{ path: 'Fall Of Blackbottom', tags: ['Urban'] }]

    it('includes an ancestor folder tag in allTags', async () => {
      setup([nested()], [], parentTagged)
      const { result } = renderGallery()
      await waitFor(() => expect(result.current.data).not.toBeNull())
      expect(result.current.allTags).toEqual(['urban'])
    })

    it('matches a nested item when filtering by an ancestor folder tag', async () => {
      setup([nested(), item({ id: 'o', filename: 'other.png' })], [], parentTagged)
      const { result } = renderGallery()
      await waitFor(() => expect(result.current.data).not.toBeNull())

      act(() => result.current.toggleTag('urban'))

      await waitFor(() => expect(result.current.flatItems.map((i) => i.id)).toEqual(['n']))
    })

    it('matches a nested item when searching text against an ancestor folder tag', async () => {
      setup([nested(), item({ id: 'o', filename: 'other.png' })], [], parentTagged)
      const { result } = renderGallery()
      await waitFor(() => expect(result.current.data).not.toBeNull())

      act(() => result.current.setFilter('urba'))

      await waitFor(() => expect(result.current.flatItems.map((i) => i.id)).toEqual(['n']))
    })

    // The "no tags" sentinel tests the effective set, so an item that inherits
    // a tag from an ancestor folder is not untagged.
    it('counts a nested item as tagged for the "no tags" sentinel', async () => {
      setup([nested()], [], parentTagged)
      const { result } = renderGallery()
      await waitFor(() => expect(result.current.data).not.toBeNull())

      act(() => result.current.toggleTag(FILTER_NONE))

      await waitFor(() => expect(result.current.flatItems).toEqual([]))
    })

    it('does not leak a folder tag to items outside that folder', async () => {
      setup([nested(), item({ id: 'o', filename: 'other.png' })], [], parentTagged)
      const { result } = renderGallery()
      await waitFor(() => expect(result.current.data).not.toBeNull())

      act(() => result.current.toggleTag('urban'))

      await waitFor(() => expect(result.current.flatItems.map((i) => i.id)).not.toContain('o'))
    })
  })

  // Issue #270: tagging a selection sends ONE request, not one per item — the
  // per-item fan-out raced on tag creation server-side and returned 500s.
  it('applies bulk tags to the whole selection in a single request', async () => {
    setup([item({ id: 'a', filename: 'a.png' }), item({ id: 'b', filename: 'b.png' })])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => result.current.toggleSelect('a'))
    act(() => result.current.toggleSelect('b'))
    await act(async () => {
      await result.current.applyBulkTags(['new'])
    })
    expect(bulk.addTags).toHaveBeenCalledTimes(1)
    expect(bulk.addTags).toHaveBeenCalledWith('map', ['a', 'b'], ['new'])
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('releases the applying flag when the bulk request fails', async () => {
    bulk.addTags.mockRejectedValueOnce(new Error('Internal Server Error'))
    setup([item({ id: 'a', filename: 'a.png' })])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => result.current.toggleSelect('a'))
    await act(async () => {
      await result.current.applyBulkTags(['new']).catch(() => {})
    })
    // Without the finally, the bar stayed stuck on "Applying" forever (#270).
    expect(result.current.bulkApplying).toBe(false)
  })

  it('saves a folder tag list via PATCH', async () => {
    setup([item({ id: 'a', filename: 'a.png' })])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    await act(async () => {
      await result.current.saveFolderTags('maps/dungeons', ['spooky'])
    })
    expect(api.patch).toHaveBeenCalledWith('/map-folders', {
      path: 'maps/dungeons',
      tags: ['spooky'],
    })
  })

  it('patches local copies via applyEdits and returns selectedObjects', async () => {
    setup([item({ id: 'a', filename: 'a.png' })])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => result.current.applyEdits({ a: { filename: 'renamed.png' } }))
    expect(result.current.flatItems[0].filename).toBe('renamed.png')
    act(() => result.current.toggleSelect('a'))
    expect(result.current.selectedObjects().map((i) => i.id)).toEqual(['a'])
  })

  describe('progressive loading', () => {
    // A single request for a library of thousands of items left the view on a
    // spinner until the last row arrived; pages are fetched and appended so the
    // first one paints early.
    const pagedSetup = (total, pageSize = 500) => {
      const all = Array.from({ length: total }, (_, i) =>
        item({ id: `m${i}`, filename: `m${i}.png` })
      )
      api.get.mockImplementation((url) => {
        const [path, qs] = url.split('?')
        if (path === '/maps') {
          const params = new URLSearchParams(qs)
          const offset = Number(params.get('offset') || 0)
          const limit = Number(params.get('limit') || pageSize)
          return Promise.resolve({ maps: all.slice(offset, offset + limit), total })
        }
        if (url === '/map-folders') return Promise.resolve({ folders: [] })
        if (url.startsWith('/saved-filters')) return Promise.resolve({ filters: [] })
        return Promise.resolve({})
      })
      return all
    }

    it('requests a bounded page rather than the whole library', async () => {
      pagedSetup(10)
      const { result } = renderGallery()
      await waitFor(() => expect(result.current.data).not.toBeNull())
      const listCalls = api.get.mock.calls.filter(([u]) => u.split('?')[0] === '/maps')
      expect(listCalls[0][0]).toContain('limit=')
      expect(listCalls[0][0]).toContain('offset=0')
    })

    it('accumulates every page so filtering still sees the whole library', async () => {
      // The hook keeps paging while a full page comes back, so this needs to
      // straddle the real page size — just over it, to prove the append path
      // without making the suite sort thousands of rows.
      const total = 501
      pagedSetup(total)
      const { result } = renderGallery()
      await waitFor(() => expect(result.current.loadingMore).toBe(false))
      const listCalls = api.get.mock.calls.filter(([u]) => u.split('?')[0] === '/maps')
      expect(listCalls.length).toBe(2)
      expect(listCalls[1][0]).toContain('offset=500')
      // Every row is present exactly once — an append bug would duplicate or drop.
      expect(result.current.totalCount).toBe(total)
      expect(new Set(result.current.flatItems.map((i) => i.id)).size).toBe(total)
    })

    it('stops paging when a short page arrives, even if total disagrees', async () => {
      // A rescan can shrink the library mid-load; without the short-page check
      // the loop would keep asking for pages that never come.
      api.get.mockImplementation((url) => {
        const path = url.split('?')[0]
        if (path === '/maps')
          return Promise.resolve({ maps: [item({ id: 'a', filename: 'a.png' })], total: 9999 })
        if (url === '/map-folders') return Promise.resolve({ folders: [] })
        if (url.startsWith('/saved-filters')) return Promise.resolve({ filters: [] })
        return Promise.resolve({})
      })
      const { result } = renderGallery()
      await waitFor(() => expect(result.current.loadingMore).toBe(false), { timeout: 3000 })
      expect(result.current.totalCount).toBe(1)
    })

    it('clears the loading flag when a page request fails', async () => {
      api.get.mockImplementation((url) => {
        const path = url.split('?')[0]
        if (path === '/maps') return Promise.reject(new Error('boom'))
        if (url === '/map-folders') return Promise.resolve({ folders: [] })
        if (url.startsWith('/saved-filters')) return Promise.resolve({ filters: [] })
        return Promise.resolve({})
      })
      const { result } = renderGallery()
      await waitFor(() => expect(result.current.loadingMore).toBe(false))
    })
  })
})
