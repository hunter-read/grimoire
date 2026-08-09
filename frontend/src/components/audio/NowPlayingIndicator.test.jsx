import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import NowPlayingIndicator from './NowPlayingIndicator'

describe('NowPlayingIndicator', () => {
  it('announces the playing state', () => {
    render(<NowPlayingIndicator playing />)
    expect(screen.getByRole('img', { name: 'Now playing' })).toBeInTheDocument()
  })

  it('announces a distinct paused state for the current track', () => {
    render(<NowPlayingIndicator playing={false} />)
    expect(screen.getByRole('img', { name: 'Current track, paused' })).toBeInTheDocument()
  })

  it('animates the bars only while playing', () => {
    const { container, rerender } = render(<NowPlayingIndicator playing />)
    expect(container.querySelectorAll('.grimoire-eq-bar')).toHaveLength(3)

    // Paused keeps the bars mounted (the row stays findable) but drops the
    // animation class so they freeze at their staggered rest heights.
    rerender(<NowPlayingIndicator playing={false} />)
    expect(container.querySelectorAll('.grimoire-eq-bar')).toHaveLength(0)
    expect(screen.getByRole('img').querySelectorAll('span')).toHaveLength(3)
  })

  it('suppresses the animation under prefers-reduced-motion', () => {
    const { container } = render(<NowPlayingIndicator playing />)
    const css = container.querySelector('style').textContent
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css.split('@media (prefers-reduced-motion: reduce)')[1]).toMatch(/animation:\s*none/)
  })

  it('scales the bars with the size prop', () => {
    const { container } = render(<NowPlayingIndicator size={30} />)
    expect(screen.getByRole('img')).toHaveStyle({ width: '30px', height: '30px' })
    expect(container.querySelector('.grimoire-eq-bar')).toHaveStyle({ width: '6px' })
  })

  it('accepts a custom colour', () => {
    const { container } = render(<NowPlayingIndicator color="red" />)
    expect(container.querySelector('.grimoire-eq-bar')).toHaveStyle({ background: 'red' })
  })
})
