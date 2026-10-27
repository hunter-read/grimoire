import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'
import ZoomTiles from './ZoomTiles'
import type { ZoomTilesProps } from './ZoomTiles'

// jsdom has no layout, so give the page box and the view real-looking geometry:
// an 800px-wide page box zoomed 6x - past what a 3000px page image can show -
// centred in an 800 x 600 view.
const PAGE_CSS_WIDTH = 800

function setup(props: Partial<ZoomTilesProps> = {}) {
  const view = document.createElement('div')
  view.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
  const viewRef = { current: view }
  const utils = render(
    <div style={{ position: 'relative' }}>
      <ZoomTiles
        bookId="b1"
        page={3}
        contentToken="tok"
        aspect={1.25}
        zoom={6}
        pan={{ x: 0, y: 0 }}
        imageWidth={3000}
        viewRef={viewRef}
        {...props}
      />
    </div>
  )
  const box = utils.container.querySelector<HTMLElement>('[aria-hidden="true"]')!
  Object.defineProperty(box, 'offsetWidth', { configurable: true, value: PAGE_CSS_WIDTH })
  box.getBoundingClientRect = () =>
    ({ left: -2000, top: -2700, width: 4800, height: 6000 }) as DOMRect
  return { ...utils, box }
}

const tiles = (container: HTMLElement) => [...container.querySelectorAll('img')]

describe('ZoomTiles', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fetches only once zooming has settled', () => {
    const { container } = setup()
    expect(tiles(container)).toHaveLength(0)
    act(() => vi.advanceTimersByTime(200))
    expect(tiles(container).length).toBeGreaterThan(0)
  })

  it('asks for tiles of this page at a stepped width, carrying the content token', () => {
    const { container } = setup()
    act(() => vi.advanceTimersByTime(200))
    const src = tiles(container)[0].getAttribute('src')
    expect(src).toMatch(/^\/api\/books\/b1\/page\/3\/tile\?/)
    const params = new URL(src!, 'http://x').searchParams
    expect(Number(params.get('width')) % 256).toBe(0)
    expect(params.get('v')).toBe('tok')
  })

  it('requests the visible tiles first and the surrounding ring at low priority', () => {
    const { container } = setup()
    act(() => vi.advanceTimersByTime(200))
    const priorities = tiles(container).map((img) => img.getAttribute('fetchpriority'))
    expect(priorities[0]).toBe('high')
    expect(priorities).toContain('low')
    expect(priorities.indexOf('low')).toBeGreaterThan(priorities.lastIndexOf('high'))
  })

  it('fades each tile in once it has loaded', () => {
    const { container } = setup()
    act(() => vi.advanceTimersByTime(200))
    const first = tiles(container)[0]
    expect(first.style.opacity).toBe('0')
    fireEvent.load(first)
    expect(first.style.opacity).toBe('1')
  })

  it('stays empty while the whole-page image is sharp enough', () => {
    const { container } = setup({ zoom: 1.5 })
    act(() => vi.advanceTimersByTime(200))
    expect(tiles(container)).toHaveLength(0)
  })

  it('drops its tiles when zoomed back out', () => {
    const { container, rerender } = setup()
    act(() => vi.advanceTimersByTime(200))
    expect(tiles(container).length).toBeGreaterThan(0)
    rerender(
      <div style={{ position: 'relative' }}>
        <ZoomTiles
          bookId="b1"
          page={3}
          aspect={1.25}
          zoom={1}
          pan={{ x: 0, y: 0 }}
          imageWidth={1600}
          viewRef={{ current: document.createElement('div') }}
        />
      </div>
    )
    act(() => vi.advanceTimersByTime(200))
    expect(tiles(container)).toHaveLength(0)
  })

  it('works out the tiles again when the window is resized', () => {
    const { container, box } = setup()
    act(() => vi.advanceTimersByTime(200))
    const before = tiles(container).length
    box.getBoundingClientRect = () =>
      ({ left: 5000, top: 5000, width: 4800, height: 6000 }) as DOMRect
    act(() => window.dispatchEvent(new Event('resize')))
    act(() => vi.advanceTimersByTime(200))
    expect(tiles(container).length).not.toBe(before)
  })

  it('works them out again once the page box gets its size', () => {
    // A page turned while zoomed is measured before its image has loaded and
    // given the box a size; the observer catches the box growing.
    let observed: (entries: unknown[]) => void = () => {}
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: (entries: unknown[]) => void) {
          observed = cb
        }
        observe() {}
        disconnect() {}
      }
    )
    const { container, box } = setup()
    const sized = box.getBoundingClientRect
    box.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect
    act(() => vi.advanceTimersByTime(200))
    expect(tiles(container)).toHaveLength(0)

    box.getBoundingClientRect = sized
    act(() => observed([]))
    act(() => vi.advanceTimersByTime(200))
    expect(tiles(container).length).toBeGreaterThan(0)
    vi.unstubAllGlobals()
  })

  it('rounds its corners like a page, or not inside a joined spread', () => {
    const { box } = setup()
    expect(box.style.borderRadius).toBe('4px')
    const square = setup({ rounded: false }).box
    expect(square.style.borderRadius).toBe('0px')
  })

  it('does nothing without a view to measure against', () => {
    const { container } = setup({ viewRef: { current: null } })
    act(() => vi.advanceTimersByTime(200))
    expect(tiles(container)).toHaveLength(0)
  })
})
