import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GridCalibrator from './GridCalibrator'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))

const props = {
  imageUrl: '/img.png',
  pixelWidth: 1400,
  pixelHeight: 1960,
  cellPx: 140,
  offset: { x: 0, y: 0 },
  onChange: vi.fn(),
  onConfirm: vi.fn(),
}

// jsdom gives every element a zero-size rect, which would make every click map
// to the same image point. A fixed 1000x1000 viewport at the origin makes the
// coordinate maths deterministic and checkable.
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

describe('GridCalibrator', () => {
  it('puts its controls in a panel beside the canvas, not below it', () => {
    // The drawing phase keeps its panel on the right, so this step does too:
    // confirming the grid and then drawing on it should not shuffle the page
    // out from under the user.
    render(<GridCalibrator {...props} />)
    const canvas = screen.getByTestId('calibrator-canvas')
    const panel = screen.getByTestId('calibrator-dims').closest('div[style*="width: 290px"]')

    expect(panel).not.toBeNull()
    // Same parent, laid out as a row: side by side rather than stacked.
    expect(panel.parentElement).toBe(canvas.parentElement)
    expect(canvas.parentElement).toHaveStyle({ display: 'flex' })
    // The panel matches the drawing phase's sidebar, so the two read as one
    // panel changing contents rather than two panels in different places.
    // Asserted on the inline style text: jsdom does not resolve a `border-left`
    // shorthand whose colour is a CSS variable.
    expect(panel.getAttribute('style')).toContain('border-left: 1px solid var(--border)')
    expect(panel).toHaveStyle({ width: '290px' })
  })

  it('overlays the expected grid on the image', () => {
    // Seeing the detected grid on the map is the whole point of the step: it
    // is how a user tells whether the guess is right at all.
    render(<GridCalibrator {...props} />)
    const overlay = screen.getByTestId('grid-overlay')
    expect(overlay).toHaveStyle({ backgroundSize: '140px 140px, 140px 140px' })
  })

  it('positions the overlay by the calibrated offset', () => {
    render(<GridCalibrator {...props} offset={{ x: 20, y: 35 }} />)
    expect(screen.getByTestId('grid-overlay')).toHaveStyle({ backgroundPosition: '20px 35px' })
  })

  it('scales the grid line with the zoom so it never drops out', () => {
    // The overlay sits inside the zoom transform. At the ~22% zoom a large
    // battlemap opens at, a fixed 1px line is sub-pixel and the browser drops
    // whole rows of it — which looked like the grid ignoring the cell count.
    render(<GridCalibrator {...props} />)
    const image = screen.getByTestId('grid-overlay').style.backgroundImage
    const width = Number(image.match(/0 ([\d.]+)px/)[1])
    expect(width).toBeGreaterThan(1)
  })

  it('draws one line per cell rather than a rogue gradient period', () => {
    render(<GridCalibrator {...props} />)
    const style = screen.getByTestId('grid-overlay').style
    // background-size is the pitch only because the gradient is not repeating.
    expect(style.backgroundImage).not.toMatch(/repeating-linear-gradient/)
    expect(style.backgroundSize).toBe('140px 140px, 140px 140px')
  })

  it('draws no overlay before a cell size is known', () => {
    render(<GridCalibrator {...props} cellPx={0} />)
    expect(screen.queryByTestId('grid-overlay')).toBeNull()
  })

  it('reports the resulting grid dimensions', () => {
    render(<GridCalibrator {...props} />)
    expect(screen.getByTestId('calibrator-dims').textContent).toContain('"width":10')
  })

  it('nudges the offset a pixel at a time', async () => {
    // Landing an almost-right grid means nudging while watching the overlay;
    // retyping a number for each step would be unusable.
    const onChange = vi.fn()
    render(<GridCalibrator {...props} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('maps.vtt.calibrate.offsetX +1'))
    expect(onChange).toHaveBeenCalledWith(140, { x: 1, y: 0 })
  })

  it('edits the cell size directly', () => {
    const onChange = vi.fn()
    render(<GridCalibrator {...props} onChange={onChange} />)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'maps.vtt.calibrate.cellPx' }), {
      target: { value: '70' },
    })
    expect(onChange).toHaveBeenCalledWith(70, { x: 0, y: 0 })
  })

  it('never accepts a zero cell size, which would divide by zero downstream', () => {
    const onChange = vi.fn()
    render(<GridCalibrator {...props} onChange={onChange} />)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'maps.vtt.calibrate.cellPx' }), {
      target: { value: '0' },
    })
    expect(onChange).toHaveBeenCalledWith(1, { x: 0, y: 0 })
  })

  it('drives the overlay from a typed cell count', async () => {
    // Typing "the map is 20 cells across" must redraw the grid, not merely feed
    // a later Apply — the count boxes are a live control on the overlay.
    const onChange = vi.fn()
    render(<GridCalibrator {...props} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('maps.vtt.calibrate.cellsAcross'), {
      target: { value: '20' },
    })
    // 1400px across / 20 cells = 70px per cell.
    expect(onChange).toHaveBeenCalledWith(70, { x: 0, y: 0 })
  })

  it('derives the cell size down the other axis too', () => {
    const onChange = vi.fn()
    render(<GridCalibrator {...props} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('maps.vtt.calibrate.cellsDown'), {
      target: { value: '28' },
    })
    // 1960px down / 28 cells = 70px per cell.
    expect(onChange).toHaveBeenCalledWith(70, { x: 0, y: 0 })
  })

  it('accounts for the offset when converting a cell count', () => {
    const onChange = vi.fn()
    render(<GridCalibrator {...props} offset={{ x: 200, y: 0 }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('maps.vtt.calibrate.cellsAcross'), {
      target: { value: '10' },
    })
    // Only the gridded part of the raster counts: (1400 - 200) / 10.
    expect(onChange).toHaveBeenCalledWith(120, { x: 200, y: 0 })
  })

  it('keeps a nudged offset when the cell count changes', () => {
    // The offset is a separate correction; resetting it here would undo work.
    const onChange = vi.fn()
    render(<GridCalibrator {...props} offset={{ x: 17, y: 4 }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('maps.vtt.calibrate.cellsDown'), {
      target: { value: '10' },
    })
    expect(onChange.mock.calls[0][1]).toEqual({ x: 17, y: 4 })
  })

  it('ignores a cleared or zero cell count rather than dividing by it', () => {
    const onChange = vi.fn()
    render(<GridCalibrator {...props} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('maps.vtt.calibrate.cellsAcross'), {
      target: { value: '' },
    })
    fireEvent.change(screen.getByLabelText('maps.vtt.calibrate.cellsAcross'), {
      target: { value: '0' },
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows the current grid in the count boxes', () => {
    render(<GridCalibrator {...props} />)
    expect(screen.getByLabelText('maps.vtt.calibrate.cellsAcross')).toHaveValue(10)
    expect(screen.getByLabelText('maps.vtt.calibrate.cellsDown')).toHaveValue(14)
  })

  it('confirms the grid', async () => {
    const onConfirm = vi.fn()
    render(<GridCalibrator {...props} onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: /calibrate.confirm/ }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('zooms so the overlay can be checked against the map closely', async () => {
    // At fit-to-window on a large map one screen pixel spans several image
    // pixels, so judging whether the grid lines up needs a closer look.
    render(<GridCalibrator {...props} />)
    const before = screen.getByText(/%$/).textContent
    await userEvent.click(screen.getByLabelText('maps.vtt.zoomIn'))
    expect(screen.getByText(/%$/).textContent).not.toBe(before)
  })

  it('pans on a left drag', () => {
    // With nothing to aim at any more, the left button pans rather than being
    // reserved for placing points.
    render(<GridCalibrator {...props} />)
    const canvas = screen.getByTestId('calibrator-canvas')
    const before = screen.getByTestId('grid-overlay').parentElement.style.transform

    fireEvent.mouseDown(canvas, { button: 0, clientX: 500, clientY: 500 })
    fireEvent.mouseMove(canvas, { clientX: 560, clientY: 540 })
    fireEvent.mouseUp(canvas)

    expect(screen.getByTestId('grid-overlay').parentElement.style.transform).not.toBe(before)
  })
})
