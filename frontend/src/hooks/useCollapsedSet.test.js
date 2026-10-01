import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useCollapsedSet from './useCollapsedSet'

describe('useCollapsedSet', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('follows the default while nothing is stored, and stores nothing', () => {
    const { result, rerender } = renderHook(({ def }) => useCollapsedSet('k', def), {
      initialProps: { def: new Set() },
    })
    expect(result.current[0]).toEqual(new Set())

    // The default can change as data arrives and still applies.
    rerender({ def: new Set(['a', 'b']) })
    expect(result.current[0]).toEqual(new Set(['a', 'b']))
    expect(sessionStorage.getItem('k')).toBeNull()
  })

  it('starts an updater from the default and stores the whole result', () => {
    const { result, rerender } = renderHook(({ def }) => useCollapsedSet('k', def), {
      initialProps: { def: new Set(['a', 'b']) },
    })
    act(() =>
      result.current[1]((prev) => {
        const next = new Set(prev)
        next.delete('a')
        return next
      })
    )
    expect(result.current[0]).toEqual(new Set(['b']))
    expect(JSON.parse(sessionStorage.getItem('k'))).toEqual(['b'])

    // Once chosen, the stored value wins over a changed default.
    rerender({ def: new Set(['a', 'b', 'c']) })
    expect(result.current[0]).toEqual(new Set(['b']))
  })

  it('accepts a plain Set as well as an updater', () => {
    const { result } = renderHook(() => useCollapsedSet('k', new Set(['a'])))
    act(() => result.current[1](new Set()))
    expect(result.current[0]).toEqual(new Set())
    expect(sessionStorage.getItem('k')).toBe('[]')
  })

  it('restores a stored choice over the default', () => {
    sessionStorage.setItem('k', JSON.stringify(['x']))
    const { result } = renderHook(() => useCollapsedSet('k', new Set(['a'])))
    expect(result.current[0]).toEqual(new Set(['x']))
  })

  it('uses localStorage when asked', () => {
    localStorage.setItem('k', JSON.stringify(['x']))
    const { result } = renderHook(() => useCollapsedSet('k', undefined, { storage: 'local' }))
    expect(result.current[0]).toEqual(new Set(['x']))
    act(() => result.current[1](new Set(['y'])))
    expect(JSON.parse(localStorage.getItem('k'))).toEqual(['y'])
    expect(sessionStorage.getItem('k')).toBeNull()
  })

  it('reads the new key when the key changes', () => {
    sessionStorage.setItem('two', JSON.stringify(['z']))
    const { result, rerender } = renderHook(({ k }) => useCollapsedSet(k, new Set(['d'])), {
      initialProps: { k: 'one' },
    })
    act(() => result.current[1](new Set(['chosen'])))
    rerender({ k: 'two' })
    expect(result.current[0]).toEqual(new Set(['z']))
    rerender({ k: 'three' })
    expect(result.current[0]).toEqual(new Set(['d']))
  })

  it('falls back to the default when the stored value is unreadable', () => {
    sessionStorage.setItem('k', '{not json')
    const { result } = renderHook(() => useCollapsedSet('k', new Set(['a'])))
    expect(result.current[0]).toEqual(new Set(['a']))
  })
})
