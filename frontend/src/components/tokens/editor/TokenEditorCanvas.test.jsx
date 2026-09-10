import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../lib/tokenCompositor', () => ({
  renderPreview: vi.fn(),
  DEFAULT_TRANSFORM: {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
}))

import { renderPreview } from '../../../lib/tokenCompositor'
import TokenEditorCanvas from './TokenEditorCanvas'

const spec = (overrides = {}) => ({
  source: null,
  frame: null,
  size: 256,
  mask: 'circle',
  background: 'transparent',
  transform: { scale: 1, offsetX: 0, offsetY: 0, rotation: 0, flipX: false, flipY: false },
  ...overrides,
})

const actions = () => ({
  size: 256,
  scale: 1,
  rotation: 0,
  pan: vi.fn(),
  zoomAt: vi.fn(),
  zoomBy: vi.fn(),
  rotate: vi.fn(),
  setRotation: vi.fn(),
  reset: vi.fn(),
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  window.devicePixelRatio = 1
})

describe('TokenEditorCanvas', () => {
  it('draws the current spec on mount', () => {
    const s = spec()
    render(<TokenEditorCanvas spec={s} actions={actions()} />)
    expect(renderPreview).toHaveBeenCalledWith(expect.anything(), s, expect.any(Number))
  })

  it('renders at the displayed size, not the export size', () => {
    // A 256px token shown across a 420px box is a visible upscale; the preview
    // should be drawn at the pixels it actually occupies.
    const el = { getBoundingClientRect: () => ({ width: 420, height: 420 }) }
    vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 420,
      height: 420,
    })
    window.devicePixelRatio = 2

    render(<TokenEditorCanvas spec={spec({ size: 256 })} actions={actions()} />)

    const displaySize = renderPreview.mock.calls.at(-1)[2]
    expect(displaySize).toBe(840) // 420 CSS px x 2 device pixels
    expect(el).toBeTruthy()
  })

  it('caps the device-pixel multiplier so a 3x screen cannot explode the canvas', () => {
    vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 400,
    })
    window.devicePixelRatio = 8

    render(<TokenEditorCanvas spec={spec()} actions={actions()} />)

    expect(renderPreview.mock.calls.at(-1)[2]).toBe(1200) // 400 x 3, not x 8
  })

  it('redraws when the spec changes', () => {
    const { rerender } = render(<TokenEditorCanvas spec={spec()} actions={actions()} />)
    expect(renderPreview).toHaveBeenCalledTimes(1)

    rerender(<TokenEditorCanvas spec={spec({ size: 512 })} actions={actions()} />)
    expect(renderPreview).toHaveBeenCalledTimes(2)
    expect(renderPreview.mock.calls[1][1].size).toBe(512)
  })

  it('never asks jsdom for a 2D context itself', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    render(<TokenEditorCanvas spec={spec()} actions={actions()} />)
    expect(getContext).not.toHaveBeenCalled()
  })

  it('registers the wheel listener as non-passive so it can block page scroll', () => {
    const spy = vi.spyOn(EventTarget.prototype, 'addEventListener')
    render(<TokenEditorCanvas spec={spec()} actions={actions()} />)
    // React registers its own passive wheel listener at the root, so assert that
    // *ours* is among them: a passive listener cannot preventDefault, which is
    // what stops the page scrolling behind the canvas while the user zooms.
    const wheelCalls = spy.mock.calls.filter(([type]) => type === 'wheel')
    expect(wheelCalls.length).toBeGreaterThan(0)
    expect(wheelCalls.some(([, , options]) => options && options.passive === false)).toBe(true)
  })

  it('registers touch listeners as non-passive too', () => {
    const spy = vi.spyOn(EventTarget.prototype, 'addEventListener')
    render(<TokenEditorCanvas spec={spec()} actions={actions()} />)
    const move = spy.mock.calls.filter(([type]) => type === 'touchmove')
    expect(move.some(([, , options]) => options && options.passive === false)).toBe(true)
  })

  it('disables browser gesture handling on the surface', () => {
    render(<TokenEditorCanvas spec={spec()} actions={actions()} />)
    expect(screen.getByTestId('token-editor-canvas')).toHaveStyle({ touchAction: 'none' })
  })

  it('is focusable so the keyboard controls are reachable', () => {
    render(<TokenEditorCanvas spec={spec()} actions={actions()} />)
    expect(screen.getByTestId('token-editor-canvas')).toHaveAttribute('tabindex', '0')
  })

  it('drops out of the tab order when disabled', () => {
    render(<TokenEditorCanvas spec={spec()} actions={actions()} disabled />)
    expect(screen.getByTestId('token-editor-canvas')).toHaveAttribute('tabindex', '-1')
  })

  it('shows a crop outline for a circular mask and hides it for none', () => {
    const { container, rerender } = render(
      <TokenEditorCanvas spec={spec({ mask: 'circle' })} actions={actions()} />
    )
    expect(container.querySelector('circle')).toBeTruthy()

    rerender(<TokenEditorCanvas spec={spec({ mask: 'square' })} actions={actions()} />)
    expect(container.querySelector('rect')).toBeTruthy()

    rerender(<TokenEditorCanvas spec={spec({ mask: 'none' })} actions={actions()} />)
    expect(container.querySelector('svg')).toBeFalsy()
  })

  it('resets the transform on a double click', () => {
    const a = actions()
    render(<TokenEditorCanvas spec={spec()} actions={a} />)
    fireEvent.doubleClick(screen.getByTestId('token-editor-canvas'))
    expect(a.reset).toHaveBeenCalled()
  })

  it('pans on an arrow key', () => {
    const a = actions()
    render(<TokenEditorCanvas spec={spec()} actions={a} />)
    fireEvent.keyDown(screen.getByTestId('token-editor-canvas'), { key: 'ArrowRight' })
    expect(a.pan).toHaveBeenCalledWith(1, 0)
  })
})
