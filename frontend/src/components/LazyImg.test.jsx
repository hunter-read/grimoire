import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
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
})
