import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRef } from 'react'
import { render, screen, act } from '@testing-library/react'
import useAnchoredMenu from './useAnchoredMenu'

// jsdom gives every element a zero-sized box, so the measuring layout effect has
// nothing to work with unless the geometry is stubbed. The trigger and the panel
// need different boxes, so they are told apart by data attribute: the trigger
// reports the rect the test places it at, the panel reports the size it should
// believe it has.
const mockGeometry = ({ trigger, panel }) => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const box = this.dataset.role === 'trigger' ? trigger : { top: 0, left: 0, ...panel }
    const { top = 0, left = 0, width = 0, height = 0 } = box
    return {
      width,
      height,
      top,
      left,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => {},
    }
  })
  // scrollHeight is what the hook measures the panel's natural height with, and
  // jsdom always reports 0 for it.
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function () {
    return this.dataset.role === 'panel' ? panel.height : 0
  })
}

function Harness({ open = true, ...options }) {
  const { triggerRef, panelRef, style } = useAnchoredMenu(open, options)
  return (
    <>
      <button ref={triggerRef} data-role="trigger">
        open
      </button>
      {open && (
        <div ref={panelRef} data-role="panel" data-testid="panel" style={style}>
          menu
        </div>
      )}
    </>
  )
}

const panel = () => screen.getByTestId('panel')

describe('useAnchoredMenu', () => {
  beforeEach(() => {
    window.innerWidth = 1000
    window.innerHeight = 800
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens below the trigger when there is room', () => {
    mockGeometry({
      trigger: { top: 100, left: 500, width: 20, height: 20 },
      panel: { width: 220, height: 300 },
    })
    render(<Harness width={220} />)
    // 120 (trigger bottom) + 4 gap.
    expect(panel()).toHaveStyle({ top: '124px' })
  })

  it('flips above the trigger when the menu would run off the bottom', () => {
    // The regression this hook exists for (issue #465): a book row near the
    // bottom of the page opened a menu whose lower items — download, delete —
    // sat past the bottom of the window with no way to scroll to them.
    mockGeometry({
      trigger: { top: 700, left: 500, width: 20, height: 20 },
      panel: { width: 220, height: 300 },
    })
    render(<Harness width={220} />)
    // 700 (trigger top) - 4 gap - 300 tall: the menu's bottom edge meets the
    // trigger and the whole of it is on screen.
    expect(panel()).toHaveStyle({ top: '396px' })
  })

  it('clamps to the bottom edge when it fits neither below nor above', () => {
    mockGeometry({
      trigger: { top: 300, left: 500, width: 20, height: 20 },
      panel: { width: 220, height: 700 },
    })
    render(<Harness width={220} />)
    // 800 - 700 - 8 margin.
    expect(panel()).toHaveStyle({ top: '92px' })
  })

  it('scrolls internally when taller than the whole viewport', () => {
    mockGeometry({
      trigger: { top: 300, left: 500, width: 20, height: 20 },
      panel: { width: 220, height: 900 },
    })
    render(<Harness width={220} />)
    expect(panel()).toHaveStyle({ top: '8px', overflowY: 'auto', maxHeight: '784px' })
  })

  it('right-aligns to the trigger by default', () => {
    mockGeometry({
      trigger: { top: 100, left: 500, width: 20, height: 20 },
      panel: { width: 220, height: 200 },
    })
    render(<Harness width={220} />)
    // 520 (trigger right) - 220 wide.
    expect(panel()).toHaveStyle({ left: '300px' })
  })

  it('left-aligns to the trigger when asked', () => {
    mockGeometry({
      trigger: { top: 100, left: 500, width: 20, height: 20 },
      panel: { width: 220, height: 200 },
    })
    render(<Harness width={220} align="left" />)
    expect(panel()).toHaveStyle({ left: '500px' })
  })

  it('clamps horizontally so a trigger near an edge stays on screen', () => {
    mockGeometry({
      trigger: { top: 100, left: 10, width: 20, height: 20 },
      panel: { width: 220, height: 200 },
    })
    render(<Harness width={220} align="right" />)
    // 30 - 220 would be off the left edge, so it pins to the margin.
    expect(panel()).toHaveStyle({ left: '8px' })
  })

  it('is hidden until it has been measured, then visible', () => {
    mockGeometry({
      trigger: { top: 100, left: 500, width: 20, height: 20 },
      panel: { width: 220, height: 200 },
    })
    render(<Harness width={220} />)
    // The layout effect runs before paint, so by the time the test can see it
    // the panel is already placed and shown.
    expect(panel()).toHaveStyle({ visibility: 'visible' })
  })

  it('re-places on scroll, so a menu follows the trigger under it', () => {
    mockGeometry({
      trigger: { top: 100, left: 500, width: 20, height: 20 },
      panel: { width: 220, height: 300 },
    })
    render(<Harness width={220} />)
    expect(panel()).toHaveStyle({ top: '124px' })

    // The row scrolls down the page; the menu should follow and then flip once
    // there is no longer room below.
    mockGeometry({
      trigger: { top: 700, left: 500, width: 20, height: 20 },
      panel: { width: 220, height: 300 },
    })
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(panel()).toHaveStyle({ top: '396px' })
  })

  it('measures against a caller-supplied anchor when given one', () => {
    mockGeometry({
      trigger: { top: 100, left: 500, width: 20, height: 20 },
      panel: { width: 220, height: 200 },
    })
    function External() {
      const anchorRef = useRef(null)
      const { panelRef, style } = useAnchoredMenu(true, { width: 220, anchorRef })
      return (
        <>
          <button ref={anchorRef} data-role="trigger">
            open
          </button>
          <div ref={panelRef} data-role="panel" data-testid="panel" style={style}>
            menu
          </div>
        </>
      )
    }
    render(<External />)
    expect(panel()).toHaveStyle({ top: '124px', left: '300px' })
  })

  it('survives a caller that rebuilds its anchor ref every render', () => {
    // Not how the app's callers behave, but an unstable anchor used to re-create
    // `place` on every render, which re-ran the layout effect and spun until
    // React bailed out with "Maximum update depth exceeded".
    mockGeometry({
      trigger: { top: 100, left: 500, width: 20, height: 20 },
      panel: { width: 220, height: 200 },
    })
    function Unstable() {
      const anchorRef = { current: null }
      const { panelRef, style } = useAnchoredMenu(true, { width: 220, anchorRef })
      return (
        <>
          <button ref={anchorRef} data-role="trigger">
            open
          </button>
          <div ref={panelRef} data-role="panel" data-testid="panel" style={style}>
            menu
          </div>
        </>
      )
    }
    expect(() => render(<Unstable />)).not.toThrow()
    expect(panel()).toHaveStyle({ top: '124px' })
  })

  it('uses the configured gap between trigger and panel', () => {
    mockGeometry({
      trigger: { top: 100, left: 500, width: 20, height: 20 },
      panel: { width: 220, height: 200 },
    })
    render(<Harness width={220} gap={6} />)
    expect(panel()).toHaveStyle({ top: '126px' })
  })
})
