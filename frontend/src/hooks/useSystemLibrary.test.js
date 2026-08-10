import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useSystemLibrary from './useSystemLibrary'
import { bulk } from '../api'

vi.mock('../api', () => ({
  default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
  bulk: {
    addTags: vi.fn(() => Promise.resolve({ updated: [], errors: [], tags: {} })),
    update: vi.fn(() => Promise.resolve({ updated: [], errors: [] })),
    setFolderTags: vi.fn(() => Promise.resolve({ folders: [] })),
  },
}))

const systems = [
  { id: 's1', name: 'Alpha', tags: ['OSR', 'fantasy'] },
  { id: 's2', name: 'Beta', tags: ['scifi'] },
  { id: 's3', name: 'Gamma' },
]

// Render the hook with a `setSystems` that applies updater functions against a
// mutable copy, so applyEdits/applyTags results are observable.
function setup(initial = systems) {
  let current = initial
  const setSystems = vi.fn((updater) => {
    current = typeof updater === 'function' ? updater(current) : updater
  })
  const view = renderHook(({ list }) => useSystemLibrary(list, setSystems), {
    initialProps: { list: initial },
  })
  return {
    ...view,
    setSystems,
    get latest() {
      return current
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useSystemLibrary', () => {
  describe('tag filtering', () => {
    it('collects every tag lowercased, de-duplicated and sorted', () => {
      const { result } = setup()
      expect(result.current.allTags).toEqual(['fantasy', 'osr', 'scifi'])
    })

    it('returns no tags while the systems list is still loading', () => {
      const { result } = setup(null)
      expect(result.current.allTags).toEqual([])
    })

    it('matches every system when no tag filter is active', () => {
      const { result } = setup()
      expect(systems.every(result.current.matchesTags)).toBe(true)
    })

    it('matches a system carrying any selected tag (OR)', () => {
      const { result } = setup()
      act(() => result.current.toggleTag('osr'))
      expect(result.current.matchesTags(systems[0])).toBe(true)
      expect(result.current.matchesTags(systems[1])).toBe(false)
      // A system with no tags at all never matches an active filter.
      expect(result.current.matchesTags(systems[2])).toBe(false)
    })

    it('toggles a tag off again and clears all tags', () => {
      const { result } = setup()
      act(() => result.current.toggleTag('osr'))
      expect(result.current.selectedTags.has('osr')).toBe(true)
      act(() => result.current.toggleTag('osr'))
      expect(result.current.selectedTags.has('osr')).toBe(false)

      act(() => result.current.toggleTag('scifi'))
      act(() => result.current.clearTags())
      expect(result.current.selectedTags.size).toBe(0)
    })
  })

  describe('selection', () => {
    it('resolves the selected ids to system objects', () => {
      const { result } = setup()
      act(() => result.current.bulk.toggleItem('s2'))
      expect(result.current.selectedSystems.map((s) => s.id)).toEqual(['s2'])
    })

    it('resolves to an empty list while systems are loading', () => {
      const { result } = setup(null)
      expect(result.current.selectedSystems).toEqual([])
    })
  })

  describe('applyTags', () => {
    // Issue #270: the whole selection goes in ONE request. The old fan-out of a
    // PATCH per system raced on tag creation server-side and returned 500s.
    it('sends one bulk request for the entire selection', async () => {
      bulk.addTags.mockResolvedValueOnce({
        updated: ['s1', 's2'],
        errors: [],
        tags: { s1: ['OSR', 'fantasy', 'new'], s2: ['scifi', 'new'] },
      })
      const { result } = setup()
      act(() => result.current.bulk.toggleItem('s1'))
      act(() => result.current.bulk.toggleItem('s2'))

      await act(async () => {
        await result.current.applyTags(['new'])
      })

      expect(bulk.addTags).toHaveBeenCalledTimes(1)
      expect(bulk.addTags).toHaveBeenCalledWith('system', ['s1', 's2'], ['new'])
    })

    it('patches local copies from the tag lists the server returned', async () => {
      bulk.addTags.mockResolvedValueOnce({
        updated: ['s1'],
        errors: [],
        tags: { s1: ['OSR', 'fantasy', 'new'] },
      })
      const view = setup()
      act(() => view.result.current.bulk.toggleItem('s1'))

      await act(async () => {
        await view.result.current.applyTags(['new'])
      })

      expect(view.latest.find((s) => s.id === 's1').tags).toEqual(['OSR', 'fantasy', 'new'])
      // Untouched systems keep their original tags.
      expect(view.latest.find((s) => s.id === 's2').tags).toEqual(['scifi'])
    })

    // Issue #256: applying tags keeps the selection so the same batch can be
    // tagged again — one tag at a time, or to correct a typo.
    it('keeps the selection after a successful apply', async () => {
      const { result } = setup()
      act(() => result.current.bulk.toggleItem('s1'))

      await act(async () => {
        await result.current.applyTags(['new'])
      })

      expect(result.current.bulk.count).toBe(1)
      expect(result.current.bulk.selectedIds.has('s1')).toBe(true)
    })

    it('does nothing while the systems list is still loading', async () => {
      const { result } = setup(null)
      await act(async () => {
        await result.current.applyTags(['new'])
      })
      expect(bulk.addTags).not.toHaveBeenCalled()
    })

    it('skips the request when nothing in the selection resolves', async () => {
      const { result } = setup()
      act(() => result.current.bulk.toggleItem('ghost'))
      await act(async () => {
        await result.current.applyTags(['new'])
      })
      expect(bulk.addTags).not.toHaveBeenCalled()
      expect(result.current.applying).toBe(false)
    })

    it('releases the applying flag when the request fails', async () => {
      bulk.addTags.mockRejectedValueOnce(new Error('Internal Server Error'))
      const { result } = setup()
      act(() => result.current.bulk.toggleItem('s1'))

      await act(async () => {
        await result.current.applyTags(['new']).catch(() => {})
      })

      // Without the finally the bar stayed stuck on "Applying" forever (#270).
      expect(result.current.applying).toBe(false)
    })

    it('falls back to an empty tag list when the server omits an id', async () => {
      bulk.addTags.mockResolvedValueOnce({ updated: ['s1'], errors: [] })
      const view = setup()
      act(() => view.result.current.bulk.toggleItem('s1'))

      await act(async () => {
        await view.result.current.applyTags(['new'])
      })

      expect(view.latest.find((s) => s.id === 's1').tags).toEqual([])
    })
  })

  describe('applyEdits', () => {
    it('merges edited fields into the matching systems', () => {
      const view = setup()
      act(() => view.result.current.applyEdits({ s2: { name: 'Beta Renamed' } }))
      expect(view.latest.find((s) => s.id === 's2').name).toBe('Beta Renamed')
      expect(view.latest.find((s) => s.id === 's1').name).toBe('Alpha')
    })

    it('is a no-op when the systems list has not loaded', () => {
      const view = setup(null)
      act(() => view.result.current.applyEdits({ s1: { name: 'x' } }))
      expect(view.latest).toBeNull()
    })
  })
})
