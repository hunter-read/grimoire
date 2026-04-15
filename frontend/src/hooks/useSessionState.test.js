import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useSessionState from './useSessionState'

const KEY = 'grimoire:test-key'

describe('useSessionState', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('returns the initial value when nothing is stored', () => {
    const { result } = renderHook(() => useSessionState(KEY, 'default'))
    expect(result.current[0]).toBe('default')
  })

  it('rehydrates from sessionStorage on mount', () => {
    sessionStorage.setItem(KEY, JSON.stringify('stored'))
    const { result } = renderHook(() => useSessionState(KEY, 'default'))
    expect(result.current[0]).toBe('stored')
  })

  it('persists a new value to sessionStorage', () => {
    const { result } = renderHook(() => useSessionState(KEY, 'initial'))
    act(() => result.current[1]('updated'))
    expect(sessionStorage.getItem(KEY)).toBe(JSON.stringify('updated'))
  })

  it('does NOT write to sessionStorage until setValue is called', () => {
    renderHook(() => useSessionState(KEY, 'initial'))
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('handles number values', () => {
    const { result } = renderHook(() => useSessionState(KEY, 0))
    act(() => result.current[1](42))
    expect(sessionStorage.getItem(KEY)).toBe('42')
    const { result: r2 } = renderHook(() => useSessionState(KEY, 0))
    expect(r2.current[0]).toBe(42)
  })

  it('handles boolean values', () => {
    const { result } = renderHook(() => useSessionState(KEY, false))
    act(() => result.current[1](true))
    const { result: r2 } = renderHook(() => useSessionState(KEY, false))
    expect(r2.current[0]).toBe(true)
  })

  it('handles object values', () => {
    const obj = { a: 1, b: 'hello' }
    const { result } = renderHook(() => useSessionState(KEY, {}))
    act(() => result.current[1](obj))
    const { result: r2 } = renderHook(() => useSessionState(KEY, {}))
    expect(r2.current[0]).toEqual(obj)
  })

  it('returns the initial value when stored JSON is invalid', () => {
    sessionStorage.setItem(KEY, 'not-json{{{')
    const { result } = renderHook(() => useSessionState(KEY, 'fallback'))
    expect(result.current[0]).toBe('fallback')
  })

  describe('Set support', () => {
    it('returns the initial Set when nothing is stored', () => {
      const { result } = renderHook(() => useSessionState(KEY, new Set(['a', 'b'])))
      expect(result.current[0]).toBeInstanceOf(Set)
      expect([...result.current[0]]).toEqual(['a', 'b'])
    })

    it('rehydrates a Set from sessionStorage', () => {
      sessionStorage.setItem(KEY, JSON.stringify(['x', 'y']))
      const { result } = renderHook(() => useSessionState(KEY, new Set()))
      expect(result.current[0]).toBeInstanceOf(Set)
      expect(result.current[0].has('x')).toBe(true)
      expect(result.current[0].has('y')).toBe(true)
    })

    it('persists a Set as a JSON array', () => {
      const { result } = renderHook(() => useSessionState(KEY, new Set()))
      act(() => result.current[1](new Set(['foo', 'bar'])))
      const stored = JSON.parse(sessionStorage.getItem(KEY))
      expect(Array.isArray(stored)).toBe(true)
      expect(stored).toContain('foo')
      expect(stored).toContain('bar')
    })

    it('empty Set is stored and rehydrated correctly', () => {
      const { result } = renderHook(() => useSessionState(KEY, new Set(['seed'])))
      act(() => result.current[1](new Set()))
      const { result: r2 } = renderHook(() => useSessionState(KEY, new Set(['seed'])))
      expect(r2.current[0]).toBeInstanceOf(Set)
      expect(r2.current[0].size).toBe(0)
    })
  })
})
