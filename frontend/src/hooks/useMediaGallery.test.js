import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useMediaGallery from './useMediaGallery'
import api from '../api'
import { MEDIA_CONFIGS } from '../components/media/mediaConfig'

vi.mock('../api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
}))

const mockIsFavorite = vi.fn(() => false)
vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: mockIsFavorite }),
}))

// Deterministic session state (start expanded / grouped true).
vi.mock('./useSessionState', () => ({
  default: (key, init) => {
    const val = key.endsWith(':grouped') ? true : init
    return [val, vi.fn()]
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

function setup(items, savedFilters = []) {
  api.get.mockImplementation((url) => {
    if (url === '/maps') return Promise.resolve({ maps: items, total: items.length })
    if (url === '/map-folders') return Promise.resolve({ folders: [] })
    if (url.startsWith('/saved-filters')) return Promise.resolve({ filters: savedFilters })
    return Promise.resolve({})
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsFavorite.mockReturnValue(false)
})

describe('useMediaGallery', () => {
  it('loads items and exposes them grouped and flat', async () => {
    setup([item({ id: 'a', filename: 'beta.png' }), item({ id: 'b', filename: 'alpha.png' })])
    const { result } = renderHook(() => useMediaGallery(config))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    // Flat list sorted by filename ascending (default sort).
    expect(result.current.flatItems.map((i) => i.filename)).toEqual(['alpha.png', 'beta.png'])
  })

  it('sorts by size descending when set', async () => {
    setup([
      item({ id: 'a', filename: 'small.png', file_size: 10 }),
      item({ id: 'b', filename: 'big.png', file_size: 500 }),
    ])
    const { result } = renderHook(() => useMediaGallery(config))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => result.current.setSortFilter({ sort: 'size', order: 'desc', filters: {} }))
    expect(result.current.flatItems.map((i) => i.filename)).toEqual(['big.png', 'small.png'])
  })

  it('filters by the search text (via setFilter)', async () => {
    setup([item({ id: 'a', filename: 'dragon.png' }), item({ id: 'b', filename: 'goblin.png' })])
    const { result } = renderHook(() => useMediaGallery(config))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => result.current.setFilter('dragon'))
    expect(result.current.flatItems.map((i) => i.filename)).toEqual(['dragon.png'])
  })

  it('filters by favorites', async () => {
    mockIsFavorite.mockImplementation((type, id) => id === 'a')
    setup([item({ id: 'a', filename: 'fav.png' }), item({ id: 'b', filename: 'other.png' })])
    const { result } = renderHook(() => useMediaGallery(config))
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
    const { result } = renderHook(() => useMediaGallery(config))
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
    const { result } = renderHook(() => useMediaGallery(config))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    await waitFor(() => expect(result.current.sortFilter.sort).toBe('size'))
  })

  it('clears tags and toggles grouping helpers', async () => {
    setup([item({ id: 'a', filename: 'a.png', tags: ['forest'] })])
    const { result } = renderHook(() => useMediaGallery(config))
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
    const { result } = renderHook(() => useMediaGallery(config))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(result.current.allTags).toEqual(['cave', 'forest'])
  })

  it('applies bulk tags to selected items via PATCH', async () => {
    setup([item({ id: 'a', filename: 'a.png' }), item({ id: 'b', filename: 'b.png' })])
    const { result } = renderHook(() => useMediaGallery(config))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => result.current.toggleSelect('a'))
    await act(async () => {
      await result.current.applyBulkTags(['new'])
    })
    expect(api.patch).toHaveBeenCalledWith('/maps/a', { tags: ['new'] })
  })

  it('saves a folder tag list via PATCH', async () => {
    setup([item({ id: 'a', filename: 'a.png' })])
    const { result } = renderHook(() => useMediaGallery(config))
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
    const { result } = renderHook(() => useMediaGallery(config))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => result.current.applyEdits({ a: { filename: 'renamed.png' } }))
    expect(result.current.flatItems[0].filename).toBe('renamed.png')
    act(() => result.current.toggleSelect('a'))
    expect(result.current.selectedObjects().map((i) => i.id)).toEqual(['a'])
  })
})
