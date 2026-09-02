import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MapImagePane from './MapImagePane'

vi.mock('../../api', () => ({
  default: { get: vi.fn() },
  mediaUrl: (p, params) => `http://localhost${p}${params ? `?${new URLSearchParams(params)}` : ''}`,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

const setup = (props = {}) =>
  render(<MapImagePane mapId="m1" filename="cave.png" hasThumbnail imageStyle={{}} {...props} />)

describe('MapImagePane', () => {
  it('requests the downscaled preview, not the original file', () => {
    setup()
    const img = screen.getByAltText('cave.png')
    // The whole point of the perf fix: never hit /file for viewing.
    expect(img.getAttribute('src')).toContain('/maps/m1/page/1')
    expect(img.getAttribute('src')).not.toContain('/file')
  })

  it('shows a spinner and hides the image until it loads', () => {
    setup()
    expect(screen.getByRole('status')).toBeTruthy()
    const img = screen.getByAltText('cave.png')
    expect(img.style.opacity).toBe('0')

    fireEvent.load(img)

    expect(screen.queryByRole('status')).toBeNull()
    expect(img.style.opacity).toBe('1')
  })

  it('shows a blurred thumbnail placeholder while loading, then drops it', () => {
    setup()
    const thumb = document.querySelector('img[aria-hidden="true"]')
    expect(thumb.getAttribute('src')).toContain('/maps/m1/thumbnail')

    fireEvent.load(screen.getByAltText('cave.png'))

    expect(document.querySelector('img[aria-hidden="true"]')).toBeNull()
  })

  it('omits the placeholder when the map has no thumbnail', () => {
    setup({ hasThumbnail: false })
    expect(document.querySelector('img[aria-hidden="true"]')).toBeNull()
  })

  it('reports failure instead of spinning forever', () => {
    setup()
    fireEvent.error(screen.getByAltText('cave.png'))
    expect(screen.getByText('maps.detail.loadFailed')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('returns to the loading state when navigating to another map', () => {
    const { rerender } = setup()
    fireEvent.load(screen.getByAltText('cave.png'))
    expect(screen.queryByRole('status')).toBeNull()

    rerender(<MapImagePane mapId="m2" filename="keep.png" hasThumbnail imageStyle={{}} />)

    // Spinner is back for the new map rather than showing the old one silently.
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByAltText('keep.png').style.opacity).toBe('0')
  })
})
