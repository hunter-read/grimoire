import { describe, it, expect, vi } from 'vitest'
import { systemCoverUrl } from './systemCoverUrl'

vi.mock('../api', () => ({
  mediaUrl: (path) => `/api${path}`,
}))

describe('systemCoverUrl', () => {
  it('returns null for a system with no art at all', () => {
    expect(systemCoverUrl({ id: 's1' })).toBeNull()
  })

  it('returns null for a missing system', () => {
    expect(systemCoverUrl(null)).toBeNull()
  })

  it('uses the cover endpoint when the system has folder or uploaded art', () => {
    expect(systemCoverUrl({ id: 's1', has_cover: true })).toBe('/api/systems/s1/cover')
  })

  it('falls back to a book thumbnail', () => {
    expect(systemCoverUrl({ id: 's1', cover_book_id: 'b9' })).toBe('/api/books/b9/thumbnail')
  })

  it('prefers the cover endpoint over a book thumbnail', () => {
    expect(systemCoverUrl({ id: 's1', has_cover: true, cover_book_id: 'b9' })).toBe(
      '/api/systems/s1/cover'
    )
  })

  it('gives a container with uploaded art a cover even though it has no books', () => {
    const container = { id: 'c1', container_kind: 'parent', has_cover: true, cover_book_id: null }
    expect(systemCoverUrl(container)).toBe('/api/systems/c1/cover')
  })
})
