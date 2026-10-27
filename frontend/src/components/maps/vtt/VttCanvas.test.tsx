import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import VttCanvas from './VttCanvas'
import type { VttCanvasProps } from './VttCanvas'
import type { Viewport } from './useViewport'
import type { PreviewState, VttDoc } from './types'

const wall = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
]

const doc: VttDoc = {
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

const props: VttCanvasProps = {
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
  Element.prototype.getBoundingClientRect = vi.fn(
    () =>
      ({
        left: 0,
        top: 0,
        width: 1000,
        height: 1000,
        right: 1000,
        bottom: 1000,
        x: 0,
        y: 0,
      }) as DOMRect
  )
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
    expect(screen.getByTestId('canvas-grid').style.backgroundPosition).toBe('7px 9px')
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
    const viewportRef: { current: Viewport | null } = { current: null }
    render(<VttCanvas {...props} viewportRef={viewportRef} />)
    expect(typeof viewportRef.current!.fit).toBe('function')
    expect(typeof viewportRef.current!.zoomBy).toBe('function')
  })
})

describe('VttCanvas selection precision', () => {
  it('does not snap the click used for selecting', async () => {
    // The root cause of "features too close together cannot be picked apart":
    // with grid snap on, every click inside a cell was rounded to the nearest
    // intersection before hit-testing, so two features a fraction of a cell
    // apart collapsed to one identical point. Zooming could never separate
    // them, because the coordinate reaching the hit test never changed.
    const onCanvasClick = vi.fn()
    render(<VttCanvas {...props} tool="select" snap="grid" onCanvasClick={onCanvasClick} />)
    fireEvent.mouseDown(screen.getByTestId('vtt-canvas'), {
      button: 0,
      clientX: 310,
      clientY: 250,
    })
    const pt = onCanvasClick.mock.calls[0][0]
    // A snapped point would be whole numbers; the real position is not.
    expect(Number.isInteger(pt.x) && Number.isInteger(pt.y)).toBe(false)
  })

  it('still snaps the click used for drawing', () => {
    // Snapping is right for placing geometry — a wall belongs on a grid line.
    const onCanvasClick = vi.fn()
    render(<VttCanvas {...props} tool="wall" snap="grid" onCanvasClick={onCanvasClick} />)
    fireEvent.mouseDown(screen.getByTestId('vtt-canvas'), {
      button: 0,
      clientX: 310,
      clientY: 250,
    })
    const pt = onCanvasClick.mock.calls[0][0]
    expect(Number.isInteger(pt.x) && Number.isInteger(pt.y)).toBe(true)
  })
})

describe('VttCanvas player view', () => {
  const preview = (over: Partial<PreviewState> = {}): PreviewState => ({
    enabled: true,
    token: { x: 2, y: 6 },
    vision: true,
    nightVision: false,
    nightVisionRange: 12,
    lightRange: 4,
    ...over,
  })

  it('draws no shroud while the preview is off', () => {
    render(<VttCanvas {...props} preview={{ enabled: false }} />)
    expect(screen.queryByTestId('preview-shroud')).toBeNull()
  })

  it('draws the shroud and hides the authoring light circles once on', () => {
    render(<VttCanvas {...props} preview={preview()} />)
    expect(screen.getByTestId('preview-shroud')).toBeInTheDocument()
    // The authoring circles would contradict the computed lighting.
    expect(screen.queryAllByTestId('light-marker')).toHaveLength(0)
  })

  it('reveals the ground a distant placed light falls on', () => {
    // The whole point of the change: the lamp is four squares from the token,
    // well outside anything the token carries, and it still lights the map.
    render(<VttCanvas {...props} preview={preview({ lightRange: 0 })} />)
    const kinds = screen.getAllByTestId('preview-reveal').map((el) => el.getAttribute('data-kind'))
    expect(kinds).toContain('light')
  })

  it('reveals nothing at all when the token has vision switched off', () => {
    render(<VttCanvas {...props} preview={preview({ vision: false })} />)
    // Still shrouded, but with no reveal punched through it.
    expect(screen.getByTestId('preview-shroud')).toBeInTheDocument()
    expect(screen.queryAllByTestId('preview-reveal')).toHaveLength(0)
  })

  it('adds a night vision region only when night vision is on', () => {
    const { rerender } = render(<VttCanvas {...props} preview={preview()} />)
    expect(screen.queryByTestId('preview-night-vision')).toBeNull()
    rerender(<VttCanvas {...props} preview={preview({ nightVision: true })} />)
    expect(screen.getByTestId('preview-night-vision')).toBeInTheDocument()
  })

  it('draws the carried torch when the token has one', () => {
    render(<VttCanvas {...props} preview={preview({ lightRange: 4 })} />)
    expect(screen.getByTestId('preview-token-light')).toBeInTheDocument()
  })

  it('points every mask reference at a mask that exists', () => {
    // A dangling mask="url(#...)" does not error in SVG — it renders the
    // element completely unmasked, which here means light spilling straight
    // through walls. Exactly the bug this preview exists to catch, and
    // invisible in any test that only counts elements.
    const { container } = render(<VttCanvas {...props} preview={preview({ nightVision: true })} />)
    const defined = new Set([...container.querySelectorAll('mask[id]')].map((m) => m.id))
    const referenced = [...container.querySelectorAll('*')]
      .map((el) => el.getAttribute?.('mask'))
      .filter((v): v is string => !!v && v.startsWith('url(#'))
      .map((v) => v.slice(5, -1))
    expect(referenced.length).toBeGreaterThan(0)
    for (const id of referenced) expect(defined).toContain(id)
  })

  it('lightens the shroud as authored ambient light rises', () => {
    const alphaOf = (el: Element) => Number(el.getAttribute('fill')!.match(/([\d.]+)\)$/)![1])

    const dark = { ...doc, environment: { ...doc.environment, ambient_light: '00000000' } }
    const { rerender } = render(<VttCanvas {...props} doc={dark} preview={preview()} />)
    const darkAlpha = alphaOf(screen.getByTestId('preview-shroud'))

    // Half-strength moonlight ambient: unlit ground must read lighter than in
    // a pitch-black dungeon, because that is the choice the setting exists to
    // make and the preview has to show the map that will be exported.
    const lit = { ...doc, environment: { ...doc.environment, ambient_light: '80334466' } }
    rerender(<VttCanvas {...props} doc={lit} preview={preview()} />)
    expect(alphaOf(screen.getByTestId('preview-shroud'))).toBeLessThan(darkAlpha)
  })

  it('never lets ambient light erase the shroud entirely', () => {
    // At full strength the preview would otherwise be indistinguishable from
    // the preview being off, and would read as broken.
    const bright = { ...doc, environment: { ...doc.environment, ambient_light: 'ffffffff' } }
    render(<VttCanvas {...props} doc={bright} preview={preview()} />)
    const fill = screen.getByTestId('preview-shroud').getAttribute('fill')
    expect(Number(fill!.match(/([\d.]+)\)$/)![1])).toBeGreaterThan(0.2)
  })
})
