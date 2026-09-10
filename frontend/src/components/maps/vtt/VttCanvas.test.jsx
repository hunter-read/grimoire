import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import VttCanvas from './VttCanvas'

const wall = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
]

const doc = {
  line_of_sight: [wall],
  objects_line_of_sight: [
    [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
    ],
  ],
  portals: [{ bounds: wall, closed: true, freestanding: false }],
  lights: [{ position: { x: 2, y: 2 }, range: 4, intensity: 1, color: 'ffeccd8b', shadows: true }],
  environment: { baked_lighting: false, ambient_light: '00000000' },
}

const props = {
  imageUrl: '/img.png',
  pixelWidth: 1400,
  pixelHeight: 1400,
  cellPx: 140,
  offset: { x: 0, y: 0 },
  doc,
  tool: 'wall',
  snap: 'grid',
  showGrid: true,
  draft: { points: [], cursor: null },
  selection: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    left: 0,
    top: 0,
    width: 1000,
    height: 1000,
    right: 1000,
    bottom: 1000,
    x: 0,
    y: 0,
  }))
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { value: 1000, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { value: 1000, configurable: true })
})

describe('VttCanvas', () => {
  it('renders every feature layer', () => {
    render(<VttCanvas {...props} />)
    expect(screen.getAllByTestId('wall-path')).toHaveLength(1)
    expect(screen.getAllByTestId('object-path')).toHaveLength(1)
    expect(screen.getAllByTestId('portal-line')).toHaveLength(1)
    expect(screen.getAllByTestId('light-marker')).toHaveLength(1)
  })

  it('converts grid units to image pixels when drawing', () => {
    // Geometry is stored in grid squares; a wall from 0,0 to 3,0 at 140px/cell
    // must land at x=420 on the raster.
    render(<VttCanvas {...props} />)
    expect(screen.getByTestId('wall-path')).toHaveAttribute('d', 'M0 0 L420 0')
  })

  it('honours the calibrated grid offset when drawing', () => {
    render(<VttCanvas {...props} offset={{ x: 20, y: 10 }} />)
    expect(screen.getByTestId('wall-path')).toHaveAttribute('d', 'M20 10 L440 10')
  })

  it('dashes a window so it is distinguishable without colour', () => {
    render(
      <VttCanvas
        {...props}
        doc={{ ...doc, portals: [{ bounds: wall, closed: false, freestanding: false }] }}
      />
    )
    expect(screen.getByTestId('portal-line')).toHaveAttribute('stroke-dasharray')
  })

  it('leaves a door solid', () => {
    render(<VttCanvas {...props} />)
    expect(screen.getByTestId('portal-line')).not.toHaveAttribute('stroke-dasharray')
  })

  it("sizes a light's glow by its range in cells", () => {
    // range is in grid squares, so a range of 4 at 140px/cell is 560px.
    render(<VttCanvas {...props} />)
    const glow = screen.getByTestId('light-marker').querySelector('circle')
    expect(glow).toHaveAttribute('r', '560')
  })

  it('draws its grid with a zoom-scaled, non-repeating gradient', () => {
    render(<VttCanvas {...props} />)
    const style = screen.getByTestId('canvas-grid').style
    expect(style.backgroundImage).not.toMatch(/repeating-linear-gradient/)
    expect(style.backgroundSize).toBe('140px 140px, 140px 140px')
  })

  it('hides the grid overlay on request', () => {
    render(<VttCanvas {...props} showGrid={false} />)
    expect(screen.queryByTestId('canvas-grid')).toBeNull()
  })

  it('draws the grid overlay at the calibrated size and offset', () => {
    render(<VttCanvas {...props} offset={{ x: 7, y: 9 }} />)
    expect(screen.getByTestId('canvas-grid')).toHaveStyle({ backgroundPosition: '7px 9px' })
  })

  it('shows the in-progress shape with a rubber band to the cursor', () => {
    render(<VttCanvas {...props} draft={{ points: [{ x: 0, y: 0 }], cursor: { x: 2, y: 0 } }} />)
    expect(screen.getByTestId('draft-path')).toHaveAttribute('d', 'M0 0 L280 0')
  })

  it('shows where a snapped click will land', () => {
    // Without this, snapping is invisible until after the click is committed.
    render(<VttCanvas {...props} draft={{ points: [], cursor: { x: 3, y: 3 } }} />)
    expect(screen.getByTestId('snap-indicator')).toBeInTheDocument()
  })

  it('highlights the selected feature', () => {
    render(<VttCanvas {...props} selection={{ key: 'line_of_sight', index: 0 }} />)
    expect(screen.getByTestId('wall-path')).toHaveAttribute('stroke', '#ffffff')
  })

  it('reports clicks snapped to grid intersections', () => {
    const onCanvasClick = vi.fn()
    render(<VttCanvas {...props} onCanvasClick={onCanvasClick} />)
    fireEvent.mouseDown(screen.getByTestId('vtt-canvas'), {
      button: 0,
      clientX: 480,
      clientY: 520,
    })
    const [pt] = onCanvasClick.mock.calls[0]
    expect(Number.isInteger(pt.x)).toBe(true)
    expect(Number.isInteger(pt.y)).toBe(true)
  })

  it('reports half-cell positions in half-snap mode', () => {
    const onCanvasClick = vi.fn()
    render(<VttCanvas {...props} snap="half" onCanvasClick={onCanvasClick} />)
    fireEvent.mouseDown(screen.getByTestId('vtt-canvas'), {
      button: 0,
      clientX: 455,
      clientY: 500,
    })
    const [pt] = onCanvasClick.mock.calls[0]
    expect((pt.x * 2) % 1).toBe(0)
  })

  it('reports unsnapped positions in free mode', () => {
    const onCanvasClick = vi.fn()
    render(<VttCanvas {...props} snap="free" onCanvasClick={onCanvasClick} />)
    fireEvent.mouseDown(screen.getByTestId('vtt-canvas'), {
      button: 0,
      clientX: 437,
      clientY: 511,
    })
    expect(onCanvasClick).toHaveBeenCalled()
  })

  it('does not place a point when panning with a non-left button', () => {
    const onCanvasClick = vi.fn()
    render(<VttCanvas {...props} onCanvasClick={onCanvasClick} />)
    fireEvent.mouseDown(screen.getByTestId('vtt-canvas'), {
      button: 2,
      clientX: 500,
      clientY: 500,
    })
    expect(onCanvasClick).not.toHaveBeenCalled()
  })

  it('reports a double-click, which ends a polyline', () => {
    const onCanvasDoubleClick = vi.fn()
    render(<VttCanvas {...props} onCanvasDoubleClick={onCanvasDoubleClick} />)
    fireEvent.doubleClick(screen.getByTestId('vtt-canvas'), { clientX: 500, clientY: 500 })
    expect(onCanvasDoubleClick).toHaveBeenCalled()
  })

  it('tracks the pointer so the rubber band can follow it', () => {
    const onPointerMove = vi.fn()
    render(<VttCanvas {...props} onPointerMove={onPointerMove} />)
    fireEvent.mouseMove(screen.getByTestId('vtt-canvas'), { clientX: 520, clientY: 480 })
    expect(onPointerMove).toHaveBeenCalled()
  })

  it('hands its viewport up so the toolbar can drive zoom', () => {
    const viewportRef = { current: null }
    render(<VttCanvas {...props} viewportRef={viewportRef} />)
    expect(typeof viewportRef.current.fit).toBe('function')
    expect(typeof viewportRef.current.zoomBy).toBe('function')
  })
})
