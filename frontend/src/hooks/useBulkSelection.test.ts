import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useBulkSelection from './useBulkSelection'

const ordered = ['a', 'b', 'c', 'd', 'e']

describe('useBulkSelection', () => {
  it('toggles a single item and tracks the count', () => {
    const { result } = renderHook(() => useBulkSelection())
    act(() => result.current.toggleItem('a', { orderedIds: ordered }))
    expect(result.current.selectedIds.has('a')).toBe(true)
    expect(result.current.count).toBe(1)
    act(() => result.current.toggleItem('a', { orderedIds: ordered }))
    expect(result.current.selectedIds.has('a')).toBe(false)
    expect(result.current.count).toBe(0)
  })

  it('shift-click selects a contiguous range from the anchor', () => {
    const { result } = renderHook(() => useBulkSelection())
    act(() => result.current.toggleItem('b', { orderedIds: ordered }))
    act(() => result.current.toggleItem('d', { shift: true, orderedIds: ordered }))
    expect([...result.current.selectedIds].sort()).toEqual(['b', 'c', 'd'])
  })

  it('shift-range works in reverse order too', () => {
    const { result } = renderHook(() => useBulkSelection())
    act(() => result.current.toggleItem('d', { orderedIds: ordered }))
    act(() => result.current.toggleItem('a', { shift: true, orderedIds: ordered }))
    expect([...result.current.selectedIds].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('toggles every item under a folder, and deselects when all selected', () => {
    const { result } = renderHook(() => useBulkSelection())
    const items = [{ id: 'a' }, { id: 'b' }]
    act(() => result.current.toggleFolder('folder1', items))
    expect(result.current.selectedFolderPaths.has('folder1')).toBe(true)
    expect(result.current.count).toBe(3) // 2 items + 1 folder

    act(() => result.current.toggleFolder('folder1', items))
    expect(result.current.selectedFolderPaths.has('folder1')).toBe(false)
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('exit clears all selection and bulk mode', () => {
    const { result } = renderHook(() => useBulkSelection())
    act(() => result.current.enter())
    act(() => result.current.toggleItem('a', { orderedIds: ordered }))
    expect(result.current.bulkMode).toBe(true)
    act(() => result.current.exit())
    expect(result.current.bulkMode).toBe(false)
    expect(result.current.count).toBe(0)
  })

  const pressEscape = () =>
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))

  it('Escape exits bulk mode and clears selection', () => {
    const { result } = renderHook(() => useBulkSelection())
    act(() => result.current.enter())
    act(() => result.current.toggleItem('a', { orderedIds: ordered }))
    pressEscape()
    expect(result.current.bulkMode).toBe(false)
    expect(result.current.count).toBe(0)
  })

  it('Escape is ignored when bulk mode is off', () => {
    const { result } = renderHook(() => useBulkSelection())
    pressEscape()
    expect(result.current.bulkMode).toBe(false)
  })

  it('Escape does not exit while a dialog is open', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    const { result } = renderHook(() => useBulkSelection())
    act(() => result.current.enter())
    pressEscape()
    expect(result.current.bulkMode).toBe(true)
    document.body.removeChild(dialog)
  })
})
