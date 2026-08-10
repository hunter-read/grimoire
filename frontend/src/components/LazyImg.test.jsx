import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import LazyImg from './LazyImg'

describe('LazyImg', () => {
  it('defaults to lazy loading and async decoding', () => {
    const { container } = render(<LazyImg src="/x.webp" alt="cover" />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('decoding', 'async')
    expect(img).toHaveAttribute('src', '/x.webp')
    expect(img).toHaveAttribute('alt', 'cover')
  })

  it('loads eagerly when eager is set', () => {
    const { container } = render(<LazyImg src="/hero.webp" alt="" eager />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('loading', 'eager')
    expect(img).toHaveAttribute('decoding', 'auto')
  })

  it('lets an explicit loading/decoding override the default', () => {
    const { container } = render(<LazyImg src="/x.webp" alt="" loading="eager" decoding="sync" />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('loading', 'eager')
    expect(img).toHaveAttribute('decoding', 'sync')
  })

  it('passes through other props like style and className', () => {
    const { container } = render(
      <LazyImg src="/x.webp" alt="" className="cover" style={{ width: '100%' }} />
    )
    const img = container.querySelector('img')
    expect(img).toHaveClass('cover')
    expect(img).toHaveStyle({ width: '100%' })
  })

  // A grid of covers that collapses to nothing until the images land shoves
  // whatever sits below it around — reserving the box is the fix.
  describe('placeholder', () => {
    it('reserves a sized box until the image loads', () => {
      const { container } = render(
        <LazyImg src="/x.webp" alt="" placeholder style={{ width: 60, height: 80 }} />
      )
      const box = container.querySelector('span')
      expect(box).toHaveStyle({ width: '60px', height: '80px' })
      expect(box).toHaveStyle({ background: 'var(--bg-deep)' })
    })

    it('drops the tint once the image has loaded', () => {
      const { container } = render(
        <LazyImg src="/x.webp" alt="" placeholder style={{ width: 60, height: 80 }} />
      )
      fireEvent.load(container.querySelector('img'))
      expect(container.querySelector('span')).toHaveStyle({ background: 'none' })
    })

    // Otherwise a broken image leaves the tint sitting there forever.
    it('drops the tint when the image fails', () => {
      const { container } = render(
        <LazyImg src="/gone.webp" alt="" placeholder style={{ width: 60, height: 80 }} />
      )
      fireEvent.error(container.querySelector('img'))
      expect(container.querySelector('span')).toHaveStyle({ background: 'none' })
    })

    it('accepts the size from width/height props', () => {
      const { container } = render(
        <LazyImg src="/x.webp" alt="" placeholder width={60} height={80} />
      )
      expect(container.querySelector('span')).toHaveStyle({ width: '60px', height: '80px' })
    })

    // Nothing to reserve without a size, so it must not add a wrapper.
    it('is ignored when the size is unknown', () => {
      const { container } = render(<LazyImg src="/x.webp" alt="" placeholder />)
      expect(container.querySelector('span')).toBeNull()
      expect(container.querySelector('img')).toBeInTheDocument()
    })

    it('is ignored when only one dimension is known', () => {
      const { container } = render(
        <LazyImg src="/x.webp" alt="" placeholder style={{ width: 60 }} />
      )
      expect(container.querySelector('span')).toBeNull()
    })

    it('adds no wrapper when not asked for', () => {
      const { container } = render(
        <LazyImg src="/x.webp" alt="" style={{ width: 60, height: 80 }} />
      )
      expect(container.querySelector('span')).toBeNull()
    })

    it('still calls a caller onLoad', () => {
      const onLoad = vi.fn()
      const { container } = render(
        <LazyImg
          src="/x.webp"
          alt=""
          placeholder
          style={{ width: 60, height: 80 }}
          onLoad={onLoad}
        />
      )
      fireEvent.load(container.querySelector('img'))
      expect(onLoad).toHaveBeenCalled()
    })

    it('still calls a caller onError', () => {
      const onError = vi.fn()
      const { container } = render(<LazyImg src="/gone.webp" alt="" onError={onError} />)
      fireEvent.error(container.querySelector('img'))
      expect(onError).toHaveBeenCalled()
    })
  })
})
