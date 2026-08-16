import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import useVirtualRows from './useVirtualRows'

// jsdom reports clientHeight 0 and has no layout, so the viewport is stubbed to
// a fixed height for these tests.
const VIEWPORT = 300
const ROW = 30

function Probe({ count }) {
  const { scrollRef, onScroll, first, last, padTop, padBottom } = useVirtualRows({
    count,
    rowHeight: ROW,
    overscan: 2,
  })
  return (
    <div ref={scrollRef} onScroll={onScroll} data-testid="scroller">
      <span data-testid="range">{`${first}-${last}`}</span>
      <span data-testid="pads">{`${padTop}/${padBottom}`}</span>
      <span data-testid="rendered">{last - first}</span>
    </div>
  )
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT)
})

describe('useVirtualRows', () => {
  it('renders only a window of a huge list', () => {
    render(<Probe count={100000} />)
    const rendered = Number(screen.getByTestId('rendered').textContent)
    // The whole point: a six-figure tree must not mount six figures of nodes.
    expect(rendered).toBeLessThan(60)
    expect(screen.getByTestId('range').textContent).toBe('0-14')
  })

  it('reserves the full scroll height so the scrollbar stays honest', () => {
    render(<Probe count={1000} />)
    const [padTop, padBottom] = screen.getByTestId('pads').textContent.split('/').map(Number)
    expect(padTop).toBe(0)
    // Everything not rendered is still accounted for in the spacers.
    const rendered = Number(screen.getByTestId('rendered').textContent)
    expect(padTop + padBottom + rendered * ROW).toBe(1000 * ROW)
  })

  it('moves the window as the list scrolls', () => {
    render(<Probe count={100000} />)
    const scroller = screen.getByTestId('scroller')

    fireEvent.scroll(scroller, { target: { scrollTop: 30000 } })

    const [first, last] = screen.getByTestId('range').textContent.split('-').map(Number)
    expect(first).toBeGreaterThan(900)
    expect(last - first).toBeLessThan(60)
    const [padTop] = screen.getByTestId('pads').textContent.split('/').map(Number)
    expect(padTop).toBe(first * ROW)
  })

  it('renders everything when the list is shorter than the viewport', () => {
    render(<Probe count={4} />)
    expect(screen.getByTestId('range').textContent).toBe('0-4')
    expect(screen.getByTestId('pads').textContent).toBe('0/0')
  })

  it('handles an empty list without producing a negative window', () => {
    render(<Probe count={0} />)
    expect(screen.getByTestId('range').textContent).toBe('0-0')
    expect(screen.getByTestId('pads').textContent).toBe('0/0')
  })
})
