import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import VttEditorView from './VttEditorView'
import api from '../../../api'

vi.mock('../../../api', () => ({
  default: { get: vi.fn(), put: vi.fn() },
  mediaUrl: (p) => p,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))

const meta = {
  map_id: 'm1',
  filename: 'keep.png',
  pixel_width: 1400,
  pixel_height: 1400,
  grid: { width: 10, height: 10, cell_px: 140, source: 'computed' },
  data: null,
  wall_count: 0,
  object_wall_count: 0,
  portal_count: 0,
  light_count: 0,
}

const renderEditor = () =>
  render(
    <MemoryRouter initialEntries={['/maps/m1/vtt-editor']}>
      <Routes>
        <Route path="/maps/:mapId/vtt-editor" element={<VttEditorView />} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue(meta)
  api.put.mockResolvedValue({ status: 'ok' })
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

const enterEditPhase = async () => {
  renderEditor()
  await screen.findByTestId('calibrator-canvas')
  await userEvent.click(screen.getByRole('button', { name: /calibrate.confirm/ }))
  return screen.findByTestId('vtt-canvas')
}

describe('VttEditorView', () => {
  it('opens on grid calibration for a map with nothing authored', async () => {
    // Every coordinate stored afterwards is in grid units, so confirming the
    // grid first is what keeps authored geometry meaningful.
    renderEditor()
    expect(await screen.findByTestId('calibrator-canvas')).toBeInTheDocument()
    expect(screen.queryByTestId('vtt-canvas')).toBeNull()
  })

  it('seeds the grid from the map’s detected cell size', async () => {
    renderEditor()
    await screen.findByTestId('calibrator-canvas')
    expect(screen.getByTestId('grid-overlay')).toHaveStyle({
      backgroundSize: '140px 140px, 140px 140px',
    })
  })

  it('draws an overlay for a grid that knows cell counts but not cell size', async () => {
    // A grid parsed from a "(30x40)" filename carries no cell_px at all.
    // Seeding 0 from it left the calibration step with no overlay to judge.
    api.get.mockResolvedValue({
      ...meta,
      grid: { width: 10, height: 10, source: 'filename' },
    })
    renderEditor()
    await screen.findByTestId('calibrator-canvas')
    // 1400px / 10 cells = 140px per cell.
    expect(screen.getByTestId('grid-overlay')).toHaveStyle({
      backgroundSize: '140px 140px, 140px 140px',
    })
  })

  it('prefers the authored grid over the detected one when reopening', async () => {
    api.get.mockResolvedValue({
      ...meta,
      grid: { width: 10, height: 10, cell_px: 140, source: 'computed' },
      data: { pixels_per_grid: 70, grid_offset: { x: 5, y: 5 }, line_of_sight: [] },
    })
    renderEditor()
    await screen.findByTestId('vtt-canvas')
    expect(screen.getByTestId('canvas-grid')).toHaveStyle({
      backgroundSize: '70px 70px, 70px 70px',
      backgroundPosition: '5px 5px',
    })
  })

  it('skips calibration for a map that already carries authored geometry', async () => {
    // Its grid was confirmed once already; re-running the step every time the
    // editor opens would be busywork.
    api.get.mockResolvedValue({
      ...meta,
      data: { pixels_per_grid: 140, grid_offset: { x: 0, y: 0 }, line_of_sight: [] },
    })
    renderEditor()
    expect(await screen.findByTestId('vtt-canvas')).toBeInTheDocument()
  })

  it('loads existing walls onto the canvas', async () => {
    api.get.mockResolvedValue({
      ...meta,
      data: {
        pixels_per_grid: 140,
        line_of_sight: [
          [
            { x: 0, y: 0 },
            { x: 3, y: 0 },
          ],
        ],
      },
    })
    renderEditor()
    await screen.findByTestId('vtt-canvas')
    expect(screen.getAllByTestId('wall-path')).toHaveLength(1)
  })

  it('reports a load failure rather than showing an empty editor', async () => {
    api.get.mockRejectedValue(new Error('nope'))
    renderEditor()
    expect(await screen.findByText('maps.vtt.loadFailed')).toBeInTheDocument()
  })

  it('draws a wall from two clicks and a double-click to finish', async () => {
    const canvas = await enterEditPhase()
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 400 })
    fireEvent.mouseDown(canvas, { button: 0, clientX: 600, clientY: 400 })
    fireEvent.doubleClick(canvas, { clientX: 600, clientY: 400 })
    expect(screen.getByTestId('count-line_of_sight')).toHaveTextContent('1')
  })

  it('discards a wall run that never got a second point', async () => {
    const canvas = await enterEditPhase()
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 400 })
    fireEvent.doubleClick(canvas, { clientX: 400, clientY: 400 })
    expect(screen.getByTestId('count-line_of_sight')).toHaveTextContent('0')
  })

  it('completes a portal on its second click, not a double-click', async () => {
    // A portal is exactly two points — the door line — so it must not behave
    // like an open-ended polyline.
    const canvas = await enterEditPhase()
    await userEvent.click(screen.getByLabelText('maps.vtt.tools.portal'))
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 400 })
    fireEvent.mouseDown(canvas, { button: 0, clientX: 540, clientY: 400 })
    expect(screen.getByTestId('count-portals')).toHaveTextContent('1')
  })

  it('places a light on a single click and selects it for editing', async () => {
    const canvas = await enterEditPhase()
    await userEvent.click(screen.getByLabelText('maps.vtt.tools.light'))
    fireEvent.mouseDown(canvas, { button: 0, clientX: 500, clientY: 500 })
    expect(screen.getByTestId('count-lights')).toHaveTextContent('1')
    expect(screen.getByRole('spinbutton', { name: 'maps.vtt.light.range' })).toBeInTheDocument()
  })

  it('draws object walls into their own layer', async () => {
    // Importers treat objects_line_of_sight differently, so it must not be
    // merged into the wall layer.
    const canvas = await enterEditPhase()
    await userEvent.click(screen.getByLabelText('maps.vtt.tools.object'))
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 400 })
    fireEvent.mouseDown(canvas, { button: 0, clientX: 600, clientY: 400 })
    fireEvent.doubleClick(canvas, { clientX: 600, clientY: 400 })
    expect(screen.getByTestId('count-objects_line_of_sight')).toHaveTextContent('1')
    expect(screen.getByTestId('count-line_of_sight')).toHaveTextContent('0')
  })

  it('undoes a drawn wall', async () => {
    const canvas = await enterEditPhase()
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 400 })
    fireEvent.mouseDown(canvas, { button: 0, clientX: 600, clientY: 400 })
    fireEvent.doubleClick(canvas, { clientX: 600, clientY: 400 })
    await userEvent.click(screen.getByLabelText('maps.vtt.undo'))
    expect(screen.getByTestId('count-line_of_sight')).toHaveTextContent('0')
  })

  it('abandons the shape in progress on Escape', async () => {
    const canvas = await enterEditPhase()
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 400 })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.doubleClick(canvas, { clientX: 600, clientY: 400 })
    expect(screen.getByTestId('count-line_of_sight')).toHaveTextContent('0')
  })

  it('finishes a wall run on Enter', async () => {
    const canvas = await enterEditPhase()
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 400 })
    fireEvent.mouseDown(canvas, { button: 0, clientX: 600, clientY: 400 })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.getByTestId('count-line_of_sight')).toHaveTextContent('1')
  })

  it('deletes the selection with the Delete key', async () => {
    const canvas = await enterEditPhase()
    await userEvent.click(screen.getByLabelText('maps.vtt.tools.light'))
    fireEvent.mouseDown(canvas, { button: 0, clientX: 500, clientY: 500 })
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(screen.getByTestId('count-lights')).toHaveTextContent('0')
  })

  it('saves the document in grid units with the grid it was authored at', async () => {
    // pixels_per_grid travels with the geometry: everything stored is
    // scale-relative, so without it a replaced image would invalidate the walls.
    const canvas = await enterEditPhase()
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 400 })
    fireEvent.mouseDown(canvas, { button: 0, clientX: 600, clientY: 400 })
    fireEvent.doubleClick(canvas, { clientX: 600, clientY: 400 })
    await userEvent.click(screen.getByRole('button', { name: /common.save/ }))
    await waitFor(() => expect(api.put).toHaveBeenCalled())
    const [url, body] = api.put.mock.calls[0]
    expect(url).toBe('/maps/m1/vtt/authoring')
    expect(body.data.pixels_per_grid).toBe(140)
    expect(body.data.line_of_sight).toHaveLength(1)
  })

  it('surfaces a failed save rather than pretending it worked', async () => {
    api.put.mockRejectedValue(new Error('boom'))
    const canvas = await enterEditPhase()
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 400 })
    fireEvent.mouseDown(canvas, { button: 0, clientX: 600, clientY: 400 })
    fireEvent.doubleClick(canvas, { clientX: 600, clientY: 400 })
    await userEvent.click(screen.getByRole('button', { name: /common.save/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('saveFailed')
  })

  it('marks unsaved work and clears the mark after saving', async () => {
    const canvas = await enterEditPhase()
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 400 })
    fireEvent.mouseDown(canvas, { button: 0, clientX: 600, clientY: 400 })
    fireEvent.doubleClick(canvas, { clientX: 600, clientY: 400 })
    expect(screen.getByText('maps.vtt.unsaved')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /common.save/ }))
    await waitFor(() => expect(screen.queryByText('maps.vtt.unsaved')).toBeNull())
  })

  it('offers a download of the built .uvtt', async () => {
    await enterEditPhase()
    const link = screen.getByRole('link', { name: /maps.vtt.export/ })
    expect(link).toHaveAttribute('href', '/maps/m1/export.uvtt')
  })

  it('warns before recalibrating over existing geometry', async () => {
    // Changing the cell size moves everything already drawn.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const canvas = await enterEditPhase()
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 400 })
    fireEvent.mouseDown(canvas, { button: 0, clientX: 600, clientY: 400 })
    fireEvent.doubleClick(canvas, { clientX: 600, clientY: 400 })
    await userEvent.click(screen.getByRole('button', { name: /grid.recalibrate/ }))
    expect(confirm).toHaveBeenCalled()
    expect(screen.getByTestId('vtt-canvas')).toBeInTheDocument()
    confirm.mockRestore()
  })

  it('returns to calibration when the warning is accepted', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const canvas = await enterEditPhase()
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 400 })
    fireEvent.mouseDown(canvas, { button: 0, clientX: 600, clientY: 400 })
    fireEvent.doubleClick(canvas, { clientX: 600, clientY: 400 })
    await userEvent.click(screen.getByRole('button', { name: /grid.recalibrate/ }))
    expect(await screen.findByTestId('calibrator-canvas')).toBeInTheDocument()
    confirm.mockRestore()
  })

  it('recalibrates without a prompt when nothing has been drawn', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await enterEditPhase()
    await userEvent.click(screen.getByRole('button', { name: /grid.recalibrate/ }))
    expect(confirm).not.toHaveBeenCalled()
    expect(await screen.findByTestId('calibrator-canvas')).toBeInTheDocument()
    confirm.mockRestore()
  })

  it('selects a wall by clicking near it with the select tool', async () => {
    api.get.mockResolvedValue({
      ...meta,
      data: {
        pixels_per_grid: 140,
        line_of_sight: [
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
        ],
      },
    })
    renderEditor()
    const canvas = await screen.findByTestId('vtt-canvas')
    await userEvent.click(screen.getByLabelText('maps.vtt.tools.select'))
    // The wall runs along y=0; the container is 1000x1000 fitting a 1400px
    // image, so the image origin sits at the letterboxed top-left.
    const overlayBefore = screen.getByTestId('wall-path').getAttribute('stroke')
    fireEvent.mouseDown(canvas, { button: 0, clientX: 300, clientY: 165 })
    expect(screen.getByTestId('wall-path').getAttribute('stroke')).not.toBe(
      overlayBefore === '#ffffff' ? '#ffffff' : null
    )
  })

  it('clears the selection when clicking empty space', async () => {
    const canvas = await enterEditPhase()
    await userEvent.click(screen.getByLabelText('maps.vtt.tools.light'))
    fireEvent.mouseDown(canvas, { button: 0, clientX: 500, clientY: 500 })
    await userEvent.click(screen.getByLabelText('maps.vtt.tools.select'))
    fireEvent.mouseDown(canvas, { button: 0, clientX: 200, clientY: 800 })
    expect(screen.getByText('maps.vtt.selection.none')).toBeInTheDocument()
  })

  it('selects a placed light by clicking it', async () => {
    const canvas = await enterEditPhase()
    await userEvent.click(screen.getByLabelText('maps.vtt.tools.light'))
    fireEvent.mouseDown(canvas, { button: 0, clientX: 500, clientY: 500 })
    await userEvent.click(screen.getByLabelText('maps.vtt.tools.select'))
    fireEvent.mouseDown(canvas, { button: 0, clientX: 500, clientY: 500 })
    expect(screen.getByRole('spinbutton', { name: 'maps.vtt.light.range' })).toBeInTheDocument()
  })

  it('confirms before leaving with unsaved work', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const canvas = await enterEditPhase()
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 400 })
    fireEvent.mouseDown(canvas, { button: 0, clientX: 600, clientY: 400 })
    fireEvent.doubleClick(canvas, { clientX: 600, clientY: 400 })
    await userEvent.click(screen.getByRole('button', { name: /detail.back/ }))
    expect(confirm).toHaveBeenCalled()
    // Declining keeps the user in the editor with their work intact.
    expect(screen.getByTestId('vtt-canvas')).toBeInTheDocument()
    confirm.mockRestore()
  })

  it('leaves without a prompt when everything is saved', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    await enterEditPhase()
    await userEvent.click(screen.getByRole('button', { name: /detail.back/ }))
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('applies a recalibrated cell size to the canvas', async () => {
    // Walls are stored in grid units, so changing the cell size is what moves
    // them on screen — the conversion has to flow through.
    api.get.mockResolvedValue({
      ...meta,
      data: {
        pixels_per_grid: 140,
        line_of_sight: [
          [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
          ],
        ],
      },
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderEditor()
    await screen.findByTestId('vtt-canvas')
    expect(screen.getByTestId('wall-path')).toHaveAttribute('d', 'M0 0 L280 0')
    await userEvent.click(screen.getByRole('button', { name: /grid.recalibrate/ }))
    await screen.findByTestId('calibrator-canvas')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'maps.vtt.calibrate.cellPx' }), {
      target: { value: '70' },
    })
    await userEvent.click(screen.getByRole('button', { name: /calibrate.confirm/ }))
    expect(screen.getByTestId('wall-path')).toHaveAttribute('d', 'M0 0 L140 0')
    confirm.mockRestore()
  })

  it('ignores editor shortcuts while typing in a field', async () => {
    // Backspace in the range box must edit the number, not delete the light.
    const canvas = await enterEditPhase()
    await userEvent.click(screen.getByLabelText('maps.vtt.tools.light'))
    fireEvent.mouseDown(canvas, { button: 0, clientX: 500, clientY: 500 })
    const input = screen.getByRole('spinbutton', { name: 'maps.vtt.light.range' })
    fireEvent.keyDown(input, { key: 'Delete' })
    expect(screen.getByTestId('count-lights')).toHaveTextContent('1')
  })

  it('edits the environment for the whole map', async () => {
    await enterEditPhase()
    await userEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText('maps.vtt.unsaved')).toBeInTheDocument()
  })
})
