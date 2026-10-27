import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import useSiblingNavigation, { folderPathOf } from './useSiblingNavigation'

const ITEMS = [
  { id: 'b', filename: 'b.png', relative_path: 'tokens/Goblins/b.png' },
  { id: 'a', filename: 'a.png', relative_path: 'tokens/Goblins/a.png' },
  { id: 'c', filename: 'c.png', relative_path: 'tokens/Goblins/c.png' },
  { id: 'z', filename: 'z.png', relative_path: 'tokens/Orcs/z.png' },
]

describe('folderPathOf', () => {
  it('drops the collection root and the filename', () => {
    expect(folderPathOf({ relative_path: 'tokens/Goblins/a.png' })).toBe('Goblins')
  })

  it('keeps nested folders', () => {
    expect(folderPathOf({ relative_path: 'tokens/A/B/c.png' })).toBe('A/B')
  })

  it('normalises Windows separators', () => {
    expect(folderPathOf({ relative_path: 'tokens\\Goblins\\a.png' })).toBe('Goblins')
  })

  it('treats a file at the root as having no folder', () => {
    expect(folderPathOf({ relative_path: 'tokens/a.png' })).toBe('')
  })

  it('survives a missing path', () => {
    expect(folderPathOf({})).toBe('')
    expect(folderPathOf(null)).toBe('')
  })
})

describe('useSiblingNavigation', () => {
  let navigate, get

  const setup = (over = {}) =>
    renderHook((props) => useSiblingNavigation({ ...baseProps, ...over, ...props }))

  let baseProps
  beforeEach(() => {
    navigate = vi.fn()
    get = vi.fn().mockResolvedValue({ tokens: ITEMS })
    baseProps = {
      item: ITEMS[0],
      id: 'b',
      listUrl: '/tokens',
      listKey: 'tokens',
      detailPath: (id) => `/tokens/${id}`,
      navigate,
      get,
    }
  })

  it('lists only the same-folder items, sorted by filename', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.siblings).toHaveLength(3))
    expect(result.current.siblings.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('reports where the current item sits in the run', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.index).toBe(1))
    expect(result.current.hasPrev).toBe(true)
    expect(result.current.hasNext).toBe(true)
  })

  it('navigates to the previous and next siblings', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.index).toBe(1))
    act(() => result.current.onPrev())
    expect(navigate).toHaveBeenCalledWith('/tokens/a')
    act(() => result.current.onNext())
    expect(navigate).toHaveBeenCalledWith('/tokens/c')
  })

  it('has no previous at the start of the folder', async () => {
    const { result } = setup({ item: ITEMS[1], id: 'a' })
    await waitFor(() => expect(result.current.index).toBe(0))
    expect(result.current.hasPrev).toBe(false)
    expect(result.current.hasNext).toBe(true)
    act(() => result.current.onPrev())
    expect(navigate).not.toHaveBeenCalled()
  })

  it('has no next at the end of the folder', async () => {
    const { result } = setup({ item: ITEMS[2], id: 'c' })
    await waitFor(() => expect(result.current.index).toBe(2))
    expect(result.current.hasNext).toBe(false)
    act(() => result.current.onNext())
    expect(navigate).not.toHaveBeenCalled()
  })

  it('offers no navigation for a folder of one', async () => {
    const { result } = setup({ item: ITEMS[3], id: 'z' })
    await waitFor(() => expect(result.current.siblings).toHaveLength(1))
    expect(result.current.hasPrev).toBe(false)
    expect(result.current.hasNext).toBe(false)
  })

  it('waits for the item before fetching', () => {
    setup({ item: null, id: 'b' })
    expect(get).not.toHaveBeenCalled()
  })

  // Stepping through a folder should cost one request, not one per item.
  it('reuses the loaded list while navigating inside a folder', async () => {
    const { result, rerender } = renderHook((props) =>
      useSiblingNavigation({ ...baseProps, ...props })
    )
    await waitFor(() => expect(result.current.siblings).toHaveLength(3))
    rerender({ item: ITEMS[2], id: 'c' })
    await waitFor(() => expect(result.current.index).toBe(2))
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('refetches when the folder changes', async () => {
    const { result, rerender } = renderHook((props) =>
      useSiblingNavigation({ ...baseProps, ...props })
    )
    await waitFor(() => expect(result.current.siblings).toHaveLength(3))
    rerender({ item: ITEMS[3], id: 'z' })
    await waitFor(() => expect(result.current.siblings).toHaveLength(1))
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('passes the folder as a query param when the endpoint filters server-side', async () => {
    const { result } = setup({ serverFiltered: true })
    await waitFor(() => expect(result.current.siblings).toHaveLength(3))
    expect(get).toHaveBeenCalledWith('/tokens?folder=Goblins')
  })

  it('still checks membership exactly when the server filter is used', async () => {
    // The backend prefix filter admits deeper descendants, so a subfolder item
    // can come back in the response and must not be treated as a sibling.
    get.mockResolvedValue({
      tokens: [
        ...ITEMS,
        { id: 'deep', filename: 'd.png', relative_path: 'tokens/Goblins/Sub/d.png' },
      ],
    })
    const { result } = setup({ serverFiltered: true })
    await waitFor(() => expect(result.current.siblings).toHaveLength(3))
    expect(result.current.siblings.map((s) => s.id)).not.toContain('deep')
  })

  it('leaves navigation absent when the list cannot be loaded', async () => {
    get.mockRejectedValue(new Error('nope'))
    const { result } = setup()
    await waitFor(() => expect(get).toHaveBeenCalled())
    expect(result.current.siblings).toEqual([])
    expect(result.current.hasPrev).toBe(false)
    expect(result.current.hasNext).toBe(false)
  })

  it('tolerates a response missing the collection key', async () => {
    get.mockResolvedValue({})
    const { result } = setup()
    await waitFor(() => expect(get).toHaveBeenCalled())
    expect(result.current.siblings).toEqual([])
  })
})
