import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import api from '../../../api'
import CutoutStage from './CutoutStage'
import usePageExport from './usePageExport'

vi.mock('../../../api', () => ({ default: { get: vi.fn() } }))

// The stage measures the frame to turn pointer positions into fractions; give
// it a fixed 400 x 600 box at the origin.
const RECT = { left: 0, top: 0, width: 400, height: 600, right: 400, bottom: 600, x: 0, y: 0 }

let latest
function Harness({ visible = [1], tool = 'rect', seed = [] }) {
  const exporter = usePageExport({ basePath: '/books/b1', title: 'Book', visiblePages: visible })
  latest = exporter
  return (
    <>
      <button onClick={() => exporter.setTool(tool)}>use tool</button>
      <button onClick={() => exporter.addCutouts(seed)}>seed</button>
      <CutoutStage
        exporter={exporter}
        pageUrl={(p, w) => `/p/${p}?w=${w}`}
        getAlt={(p) => `Page ${p}`}
      />
    </>
  )
}

const frame = () => screen.getByTestId('cutout-stage').querySelector('[tabindex="-1"]')
const drag = (el, from, to, opts = {}) => {
  fireEvent.pointerDown(el, {
    clientX: from[0],
    clientY: from[1],
    button: 0,
    pointerId: 1,
    ...opts,
  })
  fireEvent.pointerMove(frame(), { clientX: to[0], clientY: to[1], pointerId: 1, ...opts })
  fireEvent.pointerUp(frame(), { clientX: to[0], clientY: to[1], pointerId: 1 })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ width: 200, height: 300 })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(RECT)
})
afterEach(() => vi.restoreAllMocks())

describe('CutoutStage', () => {
  it('waits for page sizes, then shows the page with a hint', async () => {
    let resolve
    api.get.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    render(<Harness />)
    expect(screen.queryByAltText('Page 1')).not.toBeInTheDocument()
    await act(async () => resolve({ width: 200, height: 300 }))
    expect(screen.getByAltText('Page 1')).toHaveAttribute('src', '/p/1?w=1600')
    expect(screen.getByRole('note')).toHaveTextContent('Drag to cut out an area')
  })

  it('draws a rectangle and selects it', async () => {
    render(<Harness />)
    await screen.findByAltText('Page 1')
    drag(frame(), [40, 60], [240, 360])
    expect(latest.cutouts).toHaveLength(1)
    const c = latest.cutouts[0]
    expect(c).toMatchObject({ pages: [1], shape: 'rect', locked: false })
    expect(c.x).toBeCloseTo(0.1)
    expect(c.y).toBeCloseTo(0.1)
    expect(c.w).toBeCloseTo(0.5)
    expect(c.h).toBeCloseTo(0.5)
    expect(latest.activeId).toBe(c.id)
    expect(screen.getByRole('button', { name: 'Cut-out 1, Rectangle' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('draws circles square on the page', async () => {
    render(<Harness tool="circle" />)
    await screen.findByAltText('Page 1')
    fireEvent.click(screen.getByText('use tool'))
    drag(frame(), [0, 0], [200, 100])
    const c = latest.cutouts[0]
    expect(c).toMatchObject({ shape: 'ellipse', locked: true })
    // Equal lengths on a 200 x 300 pt page.
    expect(c.w * 200).toBeCloseTo(c.h * 300)
  })

  it('treats a click as deselecting, not drawing', async () => {
    render(<Harness />)
    await screen.findByAltText('Page 1')
    drag(frame(), [10, 10], [11, 11])
    expect(latest.cutouts).toHaveLength(0)
    expect(latest.activeId).toBeNull()
  })

  it('moves and resizes a cut-out', async () => {
    render(
      <Harness
        seed={[{ pages: [1], shape: 'rect', locked: false, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }]}
      />
    )
    await screen.findByAltText('Page 1')
    fireEvent.click(screen.getByText('seed'))
    const box = screen.getByRole('button', { name: 'Cut-out 1, Rectangle' })

    drag(box, [80, 120], [120, 180])
    expect(latest.cutouts[0].x).toBeCloseTo(0.2)
    expect(latest.cutouts[0].y).toBeCloseTo(0.2)

    const handle = box.querySelector('[data-handle="se"]')
    drag(handle, [0, 0], [40, 60])
    expect(latest.cutouts[0].w).toBeCloseTo(0.3)
    expect(latest.cutouts[0].h).toBeCloseTo(0.3)
  })

  it('nudges, resizes and deletes from the keyboard without turning the page', async () => {
    const pageTurn = vi.fn()
    window.addEventListener('keydown', pageTurn)
    render(
      <Harness
        seed={[{ pages: [1], shape: 'ellipse', locked: true, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }]}
      />
    )
    await screen.findByAltText('Page 1')
    fireEvent.click(screen.getByText('seed'))
    const box = screen.getByRole('button', { name: 'Cut-out 1, Circle' })
    box.focus()

    fireEvent.keyDown(box, { key: 'ArrowRight' })
    expect(latest.cutouts[0].x).toBeCloseTo(0.104)
    fireEvent.keyDown(box, { key: 'ArrowDown', shiftKey: true })
    expect(latest.cutouts[0].y).toBeCloseTo(0.12)
    fireEvent.keyDown(box, { key: 'ArrowRight', altKey: true })
    expect(latest.cutouts[0].w).toBeGreaterThan(0.2)
    expect(pageTurn).not.toHaveBeenCalled()

    fireEvent.keyDown(box, { key: 'Escape' })
    expect(latest.activeId).toBeNull()
    fireEvent.keyDown(box, { key: 'Delete' })
    expect(latest.cutouts).toHaveLength(0)
    window.removeEventListener('keydown', pageTurn)
  })

  it('shows single-page cut-outs on their half of a spread, and stores spanning ones on both', async () => {
    render(
      <Harness
        visible={[2, 3]}
        seed={[{ pages: [3], shape: 'rect', locked: false, x: 0, y: 0, w: 0.5, h: 0.5 }]}
      />
    )
    await screen.findByAltText('Page 3')
    fireEvent.click(screen.getByText('seed'))
    const box = screen.getByRole('button', { name: 'Cut-out 1, Rectangle' })
    expect(box.style.left).toBe('50%')
    expect(box.style.width).toBe('25%')

    drag(frame(), [100, 0], [300, 300])
    expect(latest.cutouts.map((c) => c.pages)).toContainEqual([2, 3])
  })
})
