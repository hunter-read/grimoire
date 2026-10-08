import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import useMediaGallery, { FLAT, ROOT_FOLDER, splitFolder } from './useMediaGallery'
import api, { bulk, tags as tagsApi } from '../api'
import { MEDIA_CONFIGS } from '../components/media/mediaConfig'
import { fakeMediaGet } from '../test/fakeBrowseApi'

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
  tags: { list: vi.fn(() => Promise.resolve({ tags: [] })) },
}))

vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: () => false }),
}))

// Deterministic session state with real useState underneath (the sort/filter
// state lives here too, and a no-op setter would swallow every change).
// `groupedDefault` lets a test start ungrouped.
let groupedDefault = true
vi.mock('./useSessionState', () => ({
  default: (key, init) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [val, setVal] = useState(key.endsWith(':grouped') ? groupedDefault : init)
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

// The server filters, groups and pages (issue #221); the fake answers those
// endpoints over `items`. Saved filters come from their own endpoint.
function setup(items, { savedFilters = [], folders = [], isFavorite } = {}) {
  const fake = fakeMediaGet({
    listUrl: '/maps',
    collection: 'maps',
    foldersUrl: '/map-folders',
    items,
    folders,
    isFavorite,
    fallback: (url) =>
      Promise.resolve(url.startsWith('/saved-filters') ? { filters: savedFilters } : {}),
  })
  api.get.mockImplementation(fake)
}

const renderGallery = () =>
  renderHook(() => useMediaGallery(config), {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
  })

// Every URL the hook asked for, with the given path.
const calls = (path) =>
  api.get.mock.calls.map(([url]) => url).filter((url) => url.split('?')[0] === path)

const params = (url) => Object.fromEntries(new URLSearchParams(url.split('?')[1] || ''))

beforeEach(() => {
  vi.clearAllMocks()
  groupedDefault = true
})

describe('splitFolder', () => {
  it('splits a folder path into the top folder and the rest', () => {
    expect(splitFolder('Pack/Sub/Deep')).toEqual(['Pack', 'Sub/Deep'])
    expect(splitFolder('Pack')).toEqual(['Pack', ''])
    expect(splitFolder('')).toEqual([ROOT_FOLDER, ''])
  })
})

describe('useMediaGallery (grouped)', () => {
  const library = [
    item({ id: 'a', filename: 'a.png', relative_path: 'maps/Caves/a.png' }),
    item({ id: 'b', filename: 'b.png', relative_path: 'maps/Caves/Deep/b.png' }),
    item({ id: 'c', filename: 'c.png', relative_path: 'maps/c.png' }),
  ]

  it('draws folders from the server groups, with counts', async () => {
    setup(library)
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    const entries = Object.fromEntries(result.current.folderEntries)
    expect(Object.keys(entries)).toEqual(['(Root)', 'Caves'])
    expect(entries.Caves[''].count).toBe(1)
    expect(entries.Caves.Deep.count).toBe(1)
    expect(result.current.filteredCount).toBe(3)
  })

  it('starts every folder collapsed and loads nothing until one opens', async () => {
    setup(library)
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    await waitFor(() => expect(result.current.collapsed.has('Caves')).toBe(true))
    expect(result.current.collapsed.has('Caves::Deep')).toBe(true)
    expect(calls('/maps').filter((u) => 'folder' in params(u))).toEqual([])
  })

  it('never draws a folder open before collapsing it', async () => {
    // Drawing every folder open for even one render mounts each one's loader -
    // a request per folder on a large library.
    setup(library)
    const openFolders = []
    const { result } = renderHook(
      () => {
        const g = useMediaGallery(config)
        for (const [folder] of g.folderEntries)
          if (!g.collapsed.has(folder)) openFolders.push(folder)
        return g
      },
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> }
    )
    await waitFor(() => expect(result.current.folderEntries.length).toBe(2))
    expect(openFolders).toEqual([])
  })

  it('loads a folder a page at a time when asked', async () => {
    setup(library)
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => result.current.loadFolder('Caves/Deep'))
    await waitFor(() => {
      const entry = Object.fromEntries(result.current.folderEntries).Caves.Deep
      expect(entry.items.map((i) => i.id)).toEqual(['b'])
      expect(entry.hasMore).toBe(false)
    })
    const request = calls('/maps').find((u) => params(u).folder === 'Caves/Deep')
    expect(params(request)).toMatchObject({ sort: 'name', order: 'asc', offset: '0' })
  })

  it('keeps a folder the user opened open when the filters change', async () => {
    setup(library)
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.collapsed.has('Caves')).toBe(true))
    act(() => result.current.toggleCollapse('Caves'))
    expect(result.current.collapsed.has('Caves')).toBe(false)
    act(() => result.current.setFilter('a'))
    await waitFor(() => expect(calls('/maps/groups').some((u) => params(u).q === 'a')).toBe(true))
    expect(result.current.collapsed.has('Caves')).toBe(false)
    act(() => result.current.toggleCollapse('Caves'))
    expect(result.current.collapsed.has('Caves')).toBe(true)
  })

  it('sends the filters to the server', async () => {
    setup(library)
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() =>
      result.current.setSortFilter((s) => ({
        ...s,
        filters: { search: 'cave', tags: ['forest'], favorites: true, recent: true },
      }))
    )
    await waitFor(() => expect(calls('/maps/groups').length).toBeGreaterThan(1))
    const last = params(calls('/maps/groups').at(-1))
    expect(last.q).toBe('cave')
    expect(JSON.parse(last.tags)).toEqual([{ mode: 'include', tags: ['forest'] }])
    expect(last.favorites).toBe('true')
    expect(Date.parse(last.added_since)).toBeLessThan(Date.now())
  })

  it('reports the whole collection as the total and the matches as filtered', async () => {
    setup(library)
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.totalCount).toBe(3))
    act(() => result.current.setFilter('c.png'))
    await waitFor(() => expect(result.current.filteredCount).toBe(1))
    expect(result.current.totalCount).toBe(3)
  })

  it('fetches every page of a folder for a whole-folder action', async () => {
    const many = Array.from({ length: 3 }, (_, i) =>
      item({ id: `t${i}`, filename: `t${i}.png`, relative_path: `maps/Big/t${i}.png` })
    )
    setup(many)
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    let rows
    await act(async () => {
      rows = await result.current.fetchFolderItems(['Big'])
    })
    expect(rows.map((r) => r.id)).toEqual(['t0', 't1', 't2'])
  })

  it('offers every tag used on the collection as a filter option', async () => {
    tagsApi.list.mockResolvedValueOnce({
      tags: [
        { internal: 'forest', display: 'Forest' },
        { internal: 'cave', display: 'Cave' },
      ],
    })
    setup(library)
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.allTags).toEqual(['cave', 'forest']))
    expect(tagsApi.list).toHaveBeenCalledWith('map')
    expect(result.current.tagLabels.forest).toBe('Forest')
  })

  it('selects a range across loaded folders in display order', async () => {
    setup(library)
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => result.current.loadFolder('Caves'))
    act(() => result.current.loadFolder('Caves/Deep'))
    await waitFor(() =>
      expect(Object.fromEntries(result.current.folderEntries).Caves.Deep.items).toHaveLength(1)
    )
    act(() => result.current.bulk.enter())
    act(() => result.current.toggleSelect('a'))
    act(() => result.current.toggleSelect('b', { shift: true }))
    expect([...result.current.selectedIds].sort()).toEqual(['a', 'b'])
  })
})

describe('useMediaGallery (flat)', () => {
  beforeEach(() => {
    groupedDefault = false
  })

  it('loads the flat list and pages on', async () => {
    setup([item({ id: 'a', filename: 'beta.png' }), item({ id: 'b', filename: 'alpha.png' })])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.flatItems.map((i) => i.id)).toEqual(['b', 'a']))
    expect(result.current.flatHasMore).toBe(false)
    expect(result.current.noItems).toBe(false)
    const first = params(calls('/maps').find((u) => params(u).offset === '0'))
    expect(first.folder).toBeUndefined()
    // Nothing more to load: a further request is not sent.
    const before = calls('/maps').length
    act(() => result.current.loadMoreFlat())
    expect(calls('/maps').length).toBe(before)
  })

  it('resorts on the server when the sort changes', async () => {
    setup([
      item({ id: 'small', filename: 's.png', file_size: 1 }),
      item({ id: 'big', filename: 'b.png', file_size: 9 }),
    ])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.flatItems).toHaveLength(2))
    act(() => result.current.setSortFilter((s) => ({ ...s, sort: 'size', order: 'desc' })))
    await waitFor(() => expect(result.current.flatItems.map((i) => i.id)).toEqual(['big', 'small']))
  })

  it('reports an empty result', async () => {
    setup([])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(result.current.noItems).toBe(true)
  })

  it('patches loaded items via applyEdits and returns selectedObjects', async () => {
    setup([item({ id: 'a', filename: 'a.png' })])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.flatItems).toHaveLength(1))
    act(() => result.current.applyEdits({ a: { filename: 'renamed.png' } }))
    expect(result.current.flatItems[0].filename).toBe('renamed.png')
    act(() => result.current.toggleSelect('a'))
    expect(result.current.selectedObjects().map((i) => i.id)).toEqual(['a'])
  })

  it('applies bulk tags to items and folders in one request each', async () => {
    setup([item({ id: 'a', filename: 'a.png' }), item({ id: 'b', filename: 'b.png' })])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.flatItems).toHaveLength(2))
    act(() => result.current.toggleSelect('a'))
    act(() => result.current.toggleSelect('b'))
    act(() => result.current.bulk.toggleFolder('Caves', []))
    await act(async () => {
      await result.current.applyBulkTags(['new'])
    })
    expect(bulk.addTags).toHaveBeenCalledWith('map', ['a', 'b'], ['new'])
    expect(bulk.setFolderTags).toHaveBeenCalledWith('map', [{ path: 'Caves', tags: ['new'] }])
    expect(result.current.flatItems.every((i) => i.tags.includes('new'))).toBe(true)
    expect(result.current.folderTags.Caves).toEqual(['new'])
  })

  it('releases the applying flag when the bulk request fails', async () => {
    bulk.addTags.mockRejectedValueOnce(new Error('Internal Server Error'))
    setup([item({ id: 'a', filename: 'a.png' })])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.flatItems).toHaveLength(1))
    act(() => result.current.toggleSelect('a'))
    await act(async () => {
      await result.current.applyBulkTags(['new']).catch(() => {})
    })
    // Without the finally, the bar stayed stuck on "Applying" forever (#270).
    expect(result.current.bulkApplying).toBe(false)
  })
})

describe('useMediaGallery (shared state)', () => {
  it('applies the default saved preset on load', async () => {
    setup([item({ id: 'a', filename: 'x.png' })], {
      savedFilters: [
        {
          id: 'd',
          scope: 'maps',
          name: 'Def',
          is_default: true,
          state: { sort: 'size', order: 'desc', filters: {} },
        },
      ],
    })
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.sortFilter.sort).toBe('size'))
  })

  it('toggles and clears tag chips', async () => {
    setup([item({ id: 'a', filename: 'a.png', tags: ['forest'] })])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => result.current.toggleTag('forest'))
    expect(result.current.selectedTags.size).toBe(1)
    act(() => result.current.toggleTag('forest'))
    expect(result.current.selectedTags.size).toBe(0)
    act(() => result.current.toggleTag('forest'))
    act(() => result.current.clearTags())
    expect(result.current.selectedTags.size).toBe(0)
  })

  it('saves a folder tag list via PATCH', async () => {
    setup([item({ id: 'a', filename: 'a.png' })])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    await act(async () => {
      await result.current.saveFolderTags('dungeons', ['spooky'])
    })
    expect(api.patch).toHaveBeenCalledWith('/map-folders', { path: 'dungeons', tags: ['spooky'] })
    expect(result.current.folderTags.dungeons).toEqual(['spooky'])
  })

  it('switches between grouped and flat lists', async () => {
    setup([item({ id: 'a', filename: 'a.png' })])
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => result.current.setGrouped(false))
    await waitFor(() => expect(result.current.flatItems).toHaveLength(1))
    expect(calls('/maps').some((u) => !('folder' in params(u)) && params(u).limit !== '1')).toBe(
      true
    )
    expect(FLAT).toBeTruthy()
  })

  it('survives a failing groups request', async () => {
    api.get.mockImplementation((url) =>
      url.startsWith('/maps/groups') ? Promise.reject(new Error('boom')) : Promise.resolve({})
    )
    const { result } = renderGallery()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(result.current.noFolders).toBe(true)
  })
})
