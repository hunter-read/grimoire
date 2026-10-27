import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ResultThumb from './ResultThumb'

// Mirrors the real api.imageSources.thumbUrl: audio serves artwork, not a
// thumbnail, and each type has its own path rather than a pluralised guess.
vi.mock('../../api', () => ({
  imageSources: {
    thumbUrl: (type, id) =>
      ({
        book: `/api/books/${id}/thumbnail`,
        map: `/api/maps/${id}/thumbnail`,
        token: `/api/tokens/${id}/thumbnail`,
        audio: `/api/audio/${id}/artwork`,
      })[type] ?? null,
  },
}))

describe('ResultThumb', () => {
  it('renders the thumbnail image when the item has one', () => {
    render(<ResultThumb type="book" id="b1" hasThumbnail alt="Cover" />)
    const img = screen.getByRole('img', { name: 'Cover' })
    expect(img.getAttribute('src')).toBe('/api/books/b1/thumbnail')
  })

  it('renders a fallback glyph instead of a broken image when there is no thumbnail', () => {
    const { container } = render(<ResultThumb type="map" id="m1" hasThumbnail={false} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('uses the audio artwork endpoint for audio rows', () => {
    render(<ResultThumb type="audio" id="a1" hasThumbnail alt="Art" />)
    expect(screen.getByRole('img', { name: 'Art' }).getAttribute('src')).toBe(
      '/api/audio/a1/artwork'
    )
  })

  it('renders the fallback glyph when the type has no thumbnail endpoint', () => {
    const { container } = render(<ResultThumb type="nonsense" id="x1" hasThumbnail />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('gives books a portrait box and other types a square one', () => {
    const { container: book } = render(<ResultThumb type="book" id="b1" size={50} />)
    const { container: map } = render(<ResultThumb type="map" id="m1" size={50} />)
    expect(book.firstChild.style.height).toBe('65px')
    expect(map.firstChild.style.height).toBe('50px')
  })

  it('falls back to a book glyph for an unrecognised type', () => {
    const { container } = render(<ResultThumb type="nonsense" id="x1" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
