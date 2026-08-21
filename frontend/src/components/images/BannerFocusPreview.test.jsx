import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BannerFocusPreview from './BannerFocusPreview'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

/** Report a natural size on the rendered image and fire its load event. */
const loadImageAs = (width, height) => {
  const img = document.querySelector('img')
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true })
  fireEvent.load(img)
  return img
}

describe('BannerFocusPreview', () => {
  it('renders nothing without a source', () => {
    const { container } = render(<BannerFocusPreview src={null} focusY={50} onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('applies the focal point as the image position', () => {
    render(<BannerFocusPreview src="/b.png" focusY={20} onChange={vi.fn()} />)
    expect(document.querySelector('img')).toHaveStyle({ objectPosition: '50% 20%' })
  })

  it('offers repositioning only for an image taller than the 2:1 frame', () => {
    const { rerender } = render(
      <BannerFocusPreview src="/wide.png" focusY={50} onChange={vi.fn()} />
    )
    // A 4:1 image already fits the hero — nothing to slide.
    loadImageAs(400, 100)
    expect(
      screen.queryByLabelText('campaignDetail.banner.verticalPosition')
    ).not.toBeInTheDocument()

    rerender(<BannerFocusPreview src="/tall.png" focusY={50} onChange={vi.fn()} />)
    loadImageAs(100, 400)
    expect(screen.getByLabelText('campaignDetail.banner.verticalPosition')).toBeInTheDocument()
  })

  it('reports a new focal point from the slider', () => {
    const onChange = vi.fn()
    render(<BannerFocusPreview src="/tall.png" focusY={50} onChange={onChange} />)
    loadImageAs(100, 400)

    fireEvent.change(screen.getByLabelText('campaignDetail.banner.verticalPosition'), {
      target: { value: '10' },
    })

    expect(onChange).toHaveBeenCalledWith(10)
  })

  it('reports a focal point from a drag, clamped to the box', () => {
    const onChange = vi.fn()
    render(<BannerFocusPreview src="/tall.png" focusY={50} onChange={onChange} />)
    loadImageAs(100, 400)

    const box = screen.getByTestId('banner-focus-box')
    // jsdom has no layout, so the preview's geometry has to be supplied.
    box.getBoundingClientRect = () => ({ top: 0, height: 200 })

    fireEvent.mouseDown(box, { clientY: 50 })
    expect(onChange).toHaveBeenLastCalledWith(25)

    // Dragging past the bottom edge clamps rather than overshooting.
    fireEvent.mouseMove(document, { clientY: 500 })
    expect(onChange).toHaveBeenLastCalledWith(100)

    fireEvent.mouseUp(document)
  })

  it('does not drag when disabled', () => {
    const onChange = vi.fn()
    render(<BannerFocusPreview src="/tall.png" focusY={50} onChange={onChange} disabled />)
    loadImageAs(100, 400)

    const box = screen.getByTestId('banner-focus-box')
    box.getBoundingClientRect = () => ({ top: 0, height: 200 })
    fireEvent.mouseDown(box, { clientY: 50 })

    expect(onChange).not.toHaveBeenCalled()
  })
})
