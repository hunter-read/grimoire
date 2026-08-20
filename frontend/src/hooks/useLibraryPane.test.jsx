import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useLibraryPane from './useLibraryPane'
import { files as filesApi } from '../api'

vi.mock('../api', () => ({ files: { browse: vi.fn() } }))

const dir = (name, parent) => ({ name, path: `${parent}/${name}`, is_dir: true, child_count: 2 })
const file = (name, parent) => ({ name, path: `${parent}/${name}`, is_dir: false, size: 1 })

const listing = (path, entries = [], extra = {}) => ({
  path,
  parent: '',
  writable: true,
  entries,
  total: entries.length,
  truncated: false,
  ...extra,
})

// A two-level library: books/ holds a folder and a file; the folder holds one file.
function stubTree() {
  filesApi.browse.mockImplementation((p) => {
    if (p === 'books') {
      return Promise.resolve(listing('books', [dir('core', 'books'), file('loose.pdf', 'books')]))
    }
    if (p === 'books/core') {
      return Promise.resolve(listing('books/core', [file('phb.pdf', 'books/core')]))
    }
    return Promise.resolve(listing(p, []))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  stubTree()
})

describe('useLibraryPane', () => {
  it('loads the initial path into rows', async () => {
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(filesApi.browse).toHaveBeenCalledWith('books')
    expect(result.current.rows.map((r) => r.entry.name)).toEqual(['core', 'loose.pdf'])
    expect(result.current.rows.every((r) => r.depth === 0)).toBe(true)
  })

  it('expands a folder in place, nesting its children below it', async () => {
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.toggleExpand('books/core'))
    await waitFor(() => expect(filesApi.browse).toHaveBeenCalledWith('books/core'))
    await waitFor(() => expect(result.current.rows).toHaveLength(3))

    const [folder, child, sibling] = result.current.rows
    expect(folder.entry.name).toBe('core')
    expect(folder.isOpen).toBe(true)
    // The child is nested under its parent, not appended to the end.
    expect(child.entry.name).toBe('phb.pdf')
    expect(child.depth).toBe(1)
    expect(sibling.entry.name).toBe('loose.pdf')
  })

  it('collapsing hides children but keeps them cached', async () => {
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.toggleExpand('books/core'))
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    filesApi.browse.mockClear()

    act(() => result.current.toggleExpand('books/core'))
    await waitFor(() => expect(result.current.rows).toHaveLength(2))

    // Re-expanding is instant: no second fetch for an already-loaded folder.
    act(() => result.current.toggleExpand('books/core'))
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    expect(filesApi.browse).not.toHaveBeenCalled()
  })

  it('shows a loading placeholder while a subfolder is being fetched', async () => {
    let release
    filesApi.browse.mockImplementation((p) => {
      if (p === 'books') {
        return Promise.resolve(listing('books', [dir('core', 'books')]))
      }
      return new Promise((resolve) => {
        release = () => resolve(listing('books/core', [file('phb.pdf', 'books/core')]))
      })
    })
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.rows).toHaveLength(1))

    act(() => result.current.toggleExpand('books/core'))
    await waitFor(() =>
      expect(result.current.rows.some((r) => r.placeholder === 'loading')).toBe(true)
    )

    await act(async () => {
      release()
    })
    await waitFor(() => expect(result.current.rows.some((r) => r.placeholder)).toBe(false))
  })

  it('marks an expanded empty folder rather than showing nothing', async () => {
    filesApi.browse.mockImplementation((p) =>
      Promise.resolve(
        p === 'books' ? listing('books', [dir('empty', 'books')]) : listing('books/empty', [])
      )
    )
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.rows).toHaveLength(1))

    act(() => result.current.toggleExpand('books/empty'))
    await waitFor(() =>
      expect(result.current.rows.some((r) => r.placeholder === 'empty')).toBe(true)
    )
  })

  it('reports a truncated folder so a partial listing is never passed off as whole', async () => {
    filesApi.browse.mockImplementation(() =>
      Promise.resolve(listing('books', [file('a.pdf', 'books')], { total: 48213, truncated: true }))
    )
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const note = result.current.rows.find((r) => r.placeholder === 'truncated')
    expect(note).toBeTruthy()
    expect(note.total).toBe(48213)
    expect(note.shown).toBe(1)
  })

  it('expand() opens without toggling an already-open folder shut', async () => {
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.expand('books/core'))
    await waitFor(() => expect(result.current.rows).toHaveLength(3))

    // Spring-loaded drag hover calls this repeatedly; it must stay open.
    act(() => result.current.expand('books/core'))
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
  })

  it('records an error instead of throwing when the folder cannot be read', async () => {
    filesApi.browse.mockRejectedValue(new Error('Path escapes the library root'))
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.error).toBe('Path escapes the library root'))
    expect(result.current.rows).toEqual([])
  })

  it('surfaces a failed subfolder load inline, without losing the tree', async () => {
    filesApi.browse.mockImplementation((p) =>
      p === 'books'
        ? Promise.resolve(listing('books', [dir('core', 'books')]))
        : Promise.reject(new Error('Permission denied'))
    )
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.rows).toHaveLength(1))

    act(() => result.current.toggleExpand('books/core'))
    await waitFor(() => {
      const err = result.current.rows.find((r) => r.placeholder === 'error')
      expect(err?.text).toBe('Permission denied')
    })
  })

  it('clears expansion and selection when navigating elsewhere', async () => {
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.toggleExpand('books/core'))
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    act(() => result.current.selectOnly('books/loose.pdf'))

    act(() => result.current.navigate('maps'))
    await waitFor(() => expect(result.current.path).toBe('maps'))
    expect(result.current.selected.size).toBe(0)
    expect(result.current.expanded.size).toBe(0)
  })

  it('keeps the selection when a folder is expanded', async () => {
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.selectOnly('books/loose.pdf'))
    act(() => result.current.toggleExpand('books/core'))
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    // Expanding does not remove anything from view, so the selection stands.
    expect(result.current.selected.has('books/loose.pdf')).toBe(true)
  })

  it('toggles items in and out of the selection', async () => {
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.toggle('books/loose.pdf'))
    act(() => result.current.toggle('books/core'))
    expect(result.current.selected.size).toBe(2)

    act(() => result.current.toggle('books/loose.pdf'))
    expect(result.current.selected.has('books/loose.pdf')).toBe(false)
  })

  it('selects every visible row, including expanded children', async () => {
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.toggleExpand('books/core'))
    await waitFor(() => expect(result.current.rows).toHaveLength(3))

    act(() => result.current.selectAll())
    expect(result.current.selected.size).toBe(3)

    act(() => result.current.clearSelection())
    expect(result.current.selected.size).toBe(0)
  })

  it('refreshes every folder on screen, not just the root', async () => {
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.toggleExpand('books/core'))
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    filesApi.browse.mockClear()

    await act(async () => {
      result.current.refresh()
    })
    // A move changes both ends, and either may be an expanded subfolder.
    expect(filesApi.browse).toHaveBeenCalledWith('books')
    expect(filesApi.browse).toHaveBeenCalledWith('books/core')
  })

  it('refreshPath reloads a collapsed folder and opens it', async () => {
    // A folder created inside a collapsed parent is in a folder `refresh` has
    // never loaded, so only re-reading what is on screen left it invisible.
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.expanded.has('books/core')).toBe(false)
    filesApi.browse.mockClear()

    await act(async () => {
      result.current.refreshPath('books/core')
    })

    expect(filesApi.browse).toHaveBeenCalledWith('books/core')
    // Opening it is what actually puts the new row on screen.
    await waitFor(() => expect(result.current.expanded.has('books/core')).toBe(true))
  })

  it('refreshPath re-reads an already-open folder without closing it', async () => {
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.toggleExpand('books/core'))
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    filesApi.browse.mockClear()

    await act(async () => {
      result.current.refreshPath('books/core')
    })

    expect(filesApi.browse).toHaveBeenCalledWith('books/core')
    expect(result.current.expanded.has('books/core')).toBe(true)
  })

  it('refreshPath reloads the pane root without expanding it', async () => {
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    filesApi.browse.mockClear()

    await act(async () => {
      result.current.refreshPath('books')
    })

    expect(filesApi.browse).toHaveBeenCalledWith('books')
    // The root is already what the pane shows; it has no disclosure of its own.
    expect(result.current.expanded.has('books')).toBe(false)
  })

  it('refreshPath re-fetches even while a load for that folder is in flight', async () => {
    // The listing already being fetched was requested before the folder existed,
    // so reusing it would show a stale folder and look like the create failed.
    let resolveFirst
    filesApi.browse.mockImplementation((p) => {
      if (p === 'books/core') {
        return new Promise((res) => {
          resolveFirst = () => res(listing('books/core', []))
        })
      }
      return Promise.resolve(listing('books', [dir('core', 'books')]))
    })

    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.toggleExpand('books/core'))
    await waitFor(() => expect(filesApi.browse).toHaveBeenCalledWith('books/core'))
    const before = filesApi.browse.mock.calls.filter((c) => c[0] === 'books/core').length

    await act(async () => {
      result.current.refreshPath('books/core')
      resolveFirst?.()
    })

    const after = filesApi.browse.mock.calls.filter((c) => c[0] === 'books/core').length
    expect(after).toBeGreaterThan(before)
  })

  it('treats a null navigation target as the library root', async () => {
    const { result } = renderHook(() => useLibraryPane('books'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.navigate(null))
    await waitFor(() => expect(result.current.path).toBe(''))
  })
})
