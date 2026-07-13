import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import useImagePrefetch from './useImagePrefetch'

// Capture every URL assigned to a prefetch Image, in order.
let requested
let OriginalImage

beforeEach(() => {
  requested = []
  OriginalImage = global.Image
  global.Image = class {
    set src(v) {
      requested.push(v)
    }
  }
})

afterEach(() => {
  global.Image = OriginalImage
})

const siblings = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}` }))
const urlFor = (item) => `/api/x/${item.id}/file`

describe('useImagePrefetch', () => {
  it('prefetches next, prev, 2nd-next, 2nd-prev in that order', () => {
    renderHook(() => useImagePrefetch(siblings, 3, urlFor))
    expect(requested).toEqual([
      '/api/x/s4/file', // next
      '/api/x/s2/file', // prev
      '/api/x/s5/file', // 2nd next
      '/api/x/s1/file', // 2nd prev
    ])
  })

  it('skips neighbours that fall outside the list bounds', () => {
    // At index 0 there is no prev; 2nd-prev is also out of range.
    renderHook(() => useImagePrefetch(siblings, 0, urlFor))
    expect(requested).toEqual(['/api/x/s1/file', '/api/x/s2/file'])
  })

  it('does nothing when the index is unknown', () => {
    renderHook(() => useImagePrefetch(siblings, -1, urlFor))
    expect(requested).toEqual([])
  })

  it('does nothing with an empty sibling list', () => {
    renderHook(() => useImagePrefetch([], 0, urlFor))
    expect(requested).toEqual([])
  })

  it('never prefetches the same URL twice across re-renders', () => {
    const { rerender } = renderHook(({ idx }) => useImagePrefetch(siblings, idx, urlFor), {
      initialProps: { idx: 3 },
    })
    // Index 3 already fetched s4, s2, s5, s1.
    requested = []
    rerender({ idx: 4 })
    // From index 4: next=s5 (already), prev=s3 (NEW), 2nd-next=s6 (out of range),
    // 2nd-prev=s2 (already) → only s3 is fetched.
    expect(requested).toEqual(['/api/x/s3/file'])
  })
})
