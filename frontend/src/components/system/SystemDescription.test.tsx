import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SystemDescription from './SystemDescription'

// jsdom has no layout, so stub the heights the overflow check reads.
function stubHeights(scrollHeight, clientHeight) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight)
}

describe('SystemDescription', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the paragraph breaks from the editor', () => {
    render(<SystemDescription text={'First paragraph.\n\nSecond paragraph.\n'} />)
    const p = screen.getByTestId('system-description')
    expect(p.textContent).toBe('First paragraph.\n\nSecond paragraph.')
    expect(p.style.whiteSpace).toBe('pre-wrap')
  })

  it('shows no toggle when the text fits', () => {
    stubHeights(100, 100)
    render(<SystemDescription text="Short." />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByTestId('system-description').style.maskImage).toBe('')
  })

  it('clamps long text and toggles it open and closed', () => {
    stubHeights(600, 150)
    render(<SystemDescription text="A very long description." />)
    const p = screen.getByTestId('system-description')
    expect(p.style.maxHeight).toBe('9.6em')
    expect(p.style.overflow).toBe('hidden')

    const toggle = screen.getByRole('button', { name: 'Read more' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(p.style.maxHeight).toBe('')
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(p.style.maxHeight).toBe('9.6em')
    expect(screen.getByRole('button', { name: 'Read more' })).toBeInTheDocument()
  })

  it('re-measures on resize', () => {
    stubHeights(100, 100)
    render(<SystemDescription text="Text." />)
    expect(screen.queryByRole('button')).toBeNull()
    stubHeights(600, 150)
    fireEvent(window, new Event('resize'))
    expect(screen.getByRole('button', { name: 'Read more' })).toBeInTheDocument()
  })
})
