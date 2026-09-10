import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useVttDocument, { normalizeDoc } from './useVttDocument'

const wall = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
]

describe('normalizeDoc', () => {
  it('fills in every array for a null document', () => {
    const doc = normalizeDoc(null)
    expect(doc.line_of_sight).toEqual([])
    expect(doc.environment).toEqual({ baked_lighting: false, ambient_light: '00000000' })
  })

  it('preserves stored content', () => {
    const doc = normalizeDoc({ line_of_sight: [wall], environment: { baked_lighting: true } })
    expect(doc.line_of_sight).toHaveLength(1)
    expect(doc.environment.baked_lighting).toBe(true)
  })
})

describe('useVttDocument', () => {
  it('starts clean and empty', () => {
    const { result } = renderHook(() => useVttDocument(null))
    expect(result.current.isEmpty).toBe(true)
    expect(result.current.dirty).toBe(false)
    expect(result.current.canUndo).toBe(false)
  })

  it('marks dirty and counts on update', () => {
    const { result } = renderHook(() => useVttDocument(null))
    act(() => result.current.update((d) => ({ ...d, line_of_sight: [wall] })))
    expect(result.current.counts.line_of_sight).toBe(1)
    expect(result.current.dirty).toBe(true)
    expect(result.current.canUndo).toBe(true)
  })

  it('undoes and redoes across feature types', () => {
    // Undo has to cross feature boundaries — drawing a wall then a light and
    // pressing undo twice must unwind both.
    const { result } = renderHook(() => useVttDocument(null))
    act(() => result.current.update((d) => ({ ...d, line_of_sight: [wall] })))
    act(() =>
      result.current.update((d) => ({ ...d, lights: [{ position: { x: 1, y: 1 }, range: 3 }] }))
    )
    act(() => result.current.undo())
    expect(result.current.counts.lights).toBe(0)
    expect(result.current.counts.line_of_sight).toBe(1)

    act(() => result.current.undo())
    expect(result.current.counts.line_of_sight).toBe(0)

    act(() => result.current.redo())
    expect(result.current.counts.line_of_sight).toBe(1)
  })

  it('a new edit clears the redo branch', () => {
    const { result } = renderHook(() => useVttDocument(null))
    act(() => result.current.update((d) => ({ ...d, line_of_sight: [wall] })))
    act(() => result.current.undo())
    expect(result.current.canRedo).toBe(true)
    act(() => result.current.update((d) => ({ ...d, portals: [{ bounds: wall, closed: true }] })))
    expect(result.current.canRedo).toBe(false)
  })

  it('undo and redo are no-ops at the ends of history', () => {
    const { result } = renderHook(() => useVttDocument(null))
    act(() => result.current.undo())
    act(() => result.current.redo())
    expect(result.current.isEmpty).toBe(true)
  })

  it('markSaved clears the dirty flag without touching the document', () => {
    const { result } = renderHook(() => useVttDocument(null))
    act(() => result.current.update((d) => ({ ...d, line_of_sight: [wall] })))
    act(() => result.current.markSaved())
    expect(result.current.dirty).toBe(false)
    expect(result.current.counts.line_of_sight).toBe(1)
  })

  it('reset replaces the document and drops history', () => {
    const { result } = renderHook(() => useVttDocument(null))
    act(() => result.current.update((d) => ({ ...d, line_of_sight: [wall] })))
    act(() => result.current.reset({ lights: [{ position: { x: 0, y: 0 }, range: 1 }] }))
    expect(result.current.counts.line_of_sight).toBe(0)
    expect(result.current.counts.lights).toBe(1)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.dirty).toBe(false)
  })

  it('seeds from an initial document', () => {
    const { result } = renderHook(() => useVttDocument({ line_of_sight: [wall] }))
    expect(result.current.counts.line_of_sight).toBe(1)
  })

  it('treats environment-only changes as real content', () => {
    // A GM who only marks a map as baked-lit has authored something.
    const { result } = renderHook(() => useVttDocument(null))
    act(() =>
      result.current.update((d) => ({
        ...d,
        environment: { ...d.environment, baked_lighting: true },
      }))
    )
    expect(result.current.isEmpty).toBe(false)
  })

  it('ignores an update that returns the same object', () => {
    const { result } = renderHook(() => useVttDocument(null))
    act(() => result.current.update((d) => d))
    expect(result.current.dirty).toBe(false)
  })
})
