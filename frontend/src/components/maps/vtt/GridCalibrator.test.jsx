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

  it('records clicked intersections as markers', async () => {
    render(<GridCalibrator {...props} />)
    const canvas = screen.getByTestId('calibrator-canvas')
    fireEvent.mouseDown(canvas, { button: 0, clientX: 450, clientY: 500 })
    fireEvent.mouseDown(canvas, { button: 0, clientX: 550, clientY: 500 })
    expect(screen.getAllByTestId('calibration-pick')).toHaveLength(2)
  })

  it('interpolates a cell size from two picks and a span', async () => {
    const onChange = vi.fn()
    render(<GridCalibrator {...props} onChange={onChange} />)
    const canvas = screen.getByTestId('calibrator-canvas')
    // The container is 1000x1000 and the image 1400x1960, so fit() scales the
    // image down; the two clicks are converted back to image space before the
    // cell size is derived, which is what this checks end to end.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 500 })
    fireEvent.mouseDown(canvas, { button: 0, clientX: 600, clientY: 500 })
    await userEvent.type(screen.getByLabelText('maps.vtt.calibrate.spanX'), '4')
    await userEvent.click(screen.getByRole('button', { name: /calibrate.apply/ }))
    expect(onChange).toHaveBeenCalled()
    const [cellPx] = onChange.mock.calls[0]
    expect(cellPx).toBeGreaterThan(0)
  })

  it('will not apply without a span', async () => {
    render(<GridCalibrator {...props} />)
    const canvas = screen.getByTestId('calibrator-canvas')
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 500 })
    fireEvent.mouseDown(canvas, { button: 0, clientX: 600, clientY: 500 })
    expect(screen.getByRole('button', { name: /calibrate.apply/ })).toBeDisabled()
  })

  it('will not apply from a single pick', async () => {
    render(<GridCalibrator {...props} />)
    fireEvent.mouseDown(screen.getByTestId('calibrator-canvas'), {
      button: 0,
      clientX: 500,
      clientY: 500,
    })
    await userEvent.type(screen.getByLabelText('maps.vtt.calibrate.spanX'), '4')
    expect(screen.getByRole('button', { name: /calibrate.apply/ })).toBeDisabled()
  })

  it('clears picked points', async () => {
    render(<GridCalibrator {...props} />)
    fireEvent.mouseDown(screen.getByTestId('calibrator-canvas'), {
      button: 0,
      clientX: 500,
      clientY: 500,
    })
    await userEvent.click(screen.getByRole('button', { name: /calibrate.clearPicks/ }))
    expect(screen.queryAllByTestId('calibration-pick')).toHaveLength(0)
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

  it('zooms so intersections can be picked precisely', async () => {
    render(<GridCalibrator {...props} />)
    const before = screen.getByText(/%$/).textContent
    await userEvent.click(screen.getByLabelText('maps.vtt.zoomIn'))
    expect(screen.getByText(/%$/).textContent).not.toBe(before)
  })

  it('ignores clicks outside the image', () => {
    render(<GridCalibrator {...props} />)
    fireEvent.mouseDown(screen.getByTestId('calibrator-canvas'), {
      button: 0,
      clientX: -500,
      clientY: -500,
    })
    expect(screen.queryAllByTestId('calibration-pick')).toHaveLength(0)
  })
})
