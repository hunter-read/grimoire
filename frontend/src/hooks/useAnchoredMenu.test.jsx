import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRef, useState } from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'
import useAnchoredMenu, { pointFromEvent } from './useAnchoredMenu'

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

  // A right-click (issue #487): the panel opens at the cursor rather than beside
  // a trigger, under the same keep-it-on-screen rules. The "trigger" box here is
  // the row that was right-clicked.
  describe('at a point', () => {
    function PointHarness() {
      const [at, setAt] = useState(null)
      const { panelRef, style } = useAnchoredMenu(at != null, { width: 220, at })
      return (
        <>
          <div
            data-role="trigger"
            data-testid="row"
            onContextMenu={(e) => setAt(pointFromEvent(e))}
          />
          {at && (
            <div ref={panelRef} data-role="panel" data-testid="panel" style={style}>
              menu
            </div>
          )}
        </>
      )
    }

    const row = { top: 100, left: 100, width: 800, height: 60 }
    const rightClick = (clientX, clientY) =>
      fireEvent.contextMenu(screen.getByTestId('row'), { clientX, clientY })

    it('opens below and to the right of the cursor', () => {
      mockGeometry({ trigger: row, panel: { width: 220, height: 300 } })
      render(<PointHarness />)
      rightClick(300, 130)
      // No gap: the cursor sits on the menu's corner, like a native menu.
      expect(panel()).toHaveStyle({ top: '130px', left: '300px' })
    })

    it('flips above the cursor near the bottom of the window', () => {
      mockGeometry({
        trigger: { ...row, top: 700 },
        panel: { width: 220, height: 300 },
      })
      render(<PointHarness />)
      rightClick(300, 730)
      // 730 - 300: the menu's bottom edge meets the cursor.
      expect(panel()).toHaveStyle({ top: '430px' })
    })

    it('clamps to the bottom edge when it fits neither below nor above the cursor', () => {
      mockGeometry({ trigger: row, panel: { width: 220, height: 700 } })
      render(<PointHarness />)
      rightClick(300, 150)
      // Below would run off the bottom and above off the top: clamp to the
      // bottom edge, 800 - 700 - 8.
      expect(panel()).toHaveStyle({ top: '92px' })
    })

    it('scrolls internally when taller than the whole viewport', () => {
      mockGeometry({ trigger: row, panel: { width: 220, height: 900 } })
      render(<PointHarness />)
      rightClick(300, 130)
      expect(panel()).toHaveStyle({ top: '8px', overflowY: 'auto', maxHeight: '784px' })
    })

    it('flips left of the cursor near the right-hand edge', () => {
      mockGeometry({ trigger: row, panel: { width: 220, height: 300 } })
      render(<PointHarness />)
      rightClick(850, 130)
      // 850 + 220 would pass the 1000px window, so the menu ends at the cursor.
      expect(panel()).toHaveStyle({ left: '630px' })
    })

    it('clamps to the left margin when it fits neither side', () => {
      window.innerWidth = 300
      mockGeometry({ trigger: { ...row, left: 0, width: 300 }, panel: { width: 220, height: 300 } })
      render(<PointHarness />)
      rightClick(150, 130)
      // Right overflows (150 + 220), left would be -70: pin to the margin.
      expect(panel()).toHaveStyle({ left: '8px' })
    })

    it('follows the row when the page scrolls', () => {
      mockGeometry({ trigger: row, panel: { width: 220, height: 300 } })
      render(<PointHarness />)
      rightClick(300, 130)
      expect(panel()).toHaveStyle({ top: '130px' })

      // The row scrolls up 50px; the menu keeps its spot on the row.
      mockGeometry({ trigger: { ...row, top: 50 }, panel: { width: 220, height: 300 } })
      act(() => {
        window.dispatchEvent(new Event('scroll'))
      })
      expect(panel()).toHaveStyle({ top: '80px' })
    })

    it('moves to a second right-click while already open', () => {
      mockGeometry({ trigger: row, panel: { width: 220, height: 300 } })
      render(<PointHarness />)
      rightClick(300, 130)
      rightClick(500, 140)
      expect(panel()).toHaveStyle({ top: '140px', left: '500px' })
    })
  })

  describe('pointFromEvent', () => {
    const eventAt = (clientX, clientY) => {
      const element = document.createElement('div')
      element.dataset.role = 'trigger'
      return { currentTarget: element, clientX, clientY }
    }

    it('records the point as an offset into the element', () => {
      mockGeometry({ trigger: { top: 100, left: 100, width: 800, height: 60 }, panel: {} })
      const e = eventAt(300, 130)
      expect(pointFromEvent(e)).toEqual({ element: e.currentTarget, dx: 200, dy: 30 })
    })

    it('is null for a point off the element, as a keyboard context menu can report', () => {
      mockGeometry({ trigger: { top: 100, left: 100, width: 800, height: 60 }, panel: {} })
      expect(pointFromEvent(eventAt(0, 0))).toBeNull()
    })
  })
})
