import { act, renderHook } from '@testing-library/react'
import useMediaLoadState from './useMediaLoadState'

describe('useMediaLoadState', () => {
  it('starts neither loaded nor failed', () => {
    const { result } = renderHook(() => useMediaLoadState('a'))
    expect(result.current).toMatchObject({ loaded: false, failed: false })
  })

  it('keeps a load reported straight after mount', () => {
    // A cached image fires load as soon as it is attached; nothing may undo it.
    const { result, rerender } = renderHook(() => useMediaLoadState('a'))
    act(() => result.current.onLoad())
    rerender()
    expect(result.current.loaded).toBe(true)
  })

  it('reads as not loaded for a new key until that media reports in', () => {
    const { result, rerender } = renderHook(({ id }) => useMediaLoadState(id), {
      initialProps: { id: 'a' },
    })
    act(() => result.current.onLoad())
    rerender({ id: 'b' })
    expect(result.current.loaded).toBe(false)
    act(() => result.current.onLoad())
    expect(result.current.loaded).toBe(true)
  })

  it('ties a failure to its own key', () => {
    const { result, rerender } = renderHook(({ id }) => useMediaLoadState(id), {
      initialProps: { id: 1 },
    })
    act(() => result.current.onError())
    expect(result.current.failed).toBe(true)
    rerender({ id: 2 })
    expect(result.current.failed).toBe(false)
    // A late report for the old key does not mark the new one.
    rerender({ id: 1 })
    expect(result.current.failed).toBe(true)
  })
})
