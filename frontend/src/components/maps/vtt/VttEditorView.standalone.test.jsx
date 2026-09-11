import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import VttEditorView from './VttEditorView'
import api, { campaigns as campaignsApi } from '../../../api'

/**
 * Standalone mode: a map dragged in from the desktop, with no library row.
 *
 * The point of the mode is that nothing is written to the library, so what
 * these assert is mostly about what does *not* happen — no authoring PUT, no
 * map row — alongside the two exits that replace saving.
 */

const navigate = vi.fn()
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigate,
}))
vi.mock('../../../api', () => ({
  default: { get: vi.fn(), put: vi.fn() },
  campaigns: { list: vi.fn(), listCategories: vi.fn(), uploadFile: vi.fn() },
  mediaUrl: (p) => p,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'gm' } }),
}))
// jsdom never actually loads an image, so the real loader's `onload` would
// never fire. Only the loader is stubbed — the parsing and envelope-building
// around it are the code under test and stay real.
vi.mock('../../../lib/uvtt', async () => ({
  ...(await vi.importActual('../../../lib/uvtt')),
  loadImageElement: vi.fn(() => Promise.resolve({ naturalWidth: 600, naturalHeight: 400 })),
  encodeImageToBase64: vi.fn(() => 'ZW5jb2RlZA=='),
}))

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const uvttText = (over = {}) =>
  JSON.stringify({
    format: 0.3,
    resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 6, y: 4 }, pixels_per_grid: 100 },
    line_of_sight: [
      [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    ],
    portals: [],
    lights: [{ position: { x: 2, y: 2 }, range: 3 }],
    environment: { baked_lighting: false, ambient_light: '00000000' },
    image: PNG_B64,
    ...over,
  })

/** A File stand-in: jsdom's File has no usable `text()` in this environment. */
const fakeFile = (name, text = '') => {
  const f = new File(['x'], name, { type: name.endsWith('.png') ? 'image/png' : '' })
  Object.defineProperty(f, 'text', { value: () => Promise.resolve(text) })
  return f
}

const renderEditor = () =>
  render(
    <MemoryRouter initialEntries={['/maps/editor']}>
      <Routes>
        <Route path="/maps/editor" element={<VttEditorView />} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(() => {
  vi.clearAllMocks()
  global.URL.createObjectURL = vi.fn(() => 'blob:map')
  global.URL.revokeObjectURL = vi.fn()
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

describe('VttEditorView (standalone)', () => {
  it('opens on the source picker with no map to load', async () => {
    renderEditor()
    expect(await screen.findByTestId('vtt-source-dropzone')).toBeInTheDocument()
    // There is no map row, so nothing should be fetched for one.
    expect(api.get).not.toHaveBeenCalled()
  })

  it('an uploaded image goes to calibration first', async () => {
    renderEditor()
    const input = await screen.findByTestId('vtt-source-input')
    await userEvent.upload(input, fakeFile('keep.png'))
    // Every coordinate stored afterwards is in grid units, so a bare picture
    // has to have its grid confirmed before anything can be drawn.
    expect(await screen.findByTestId('calibrator-canvas')).toBeInTheDocument()
  })

  it('an uploaded .uvtt skips calibration and opens on its own geometry', async () => {
    renderEditor()
    const input = await screen.findByTestId('vtt-source-input')
    await userEvent.upload(input, fakeFile('tavern.uvtt', uvttText()))
    // The file states its own cell size, so re-confirming a grid it is certain
    // about would be busywork before the user could touch a wall.
    expect(await screen.findByTestId('vtt-canvas')).toBeInTheDocument()
    expect(screen.queryByTestId('calibrator-canvas')).toBeNull()
  })

  it('reports a file that is not a Universal VTT', async () => {
    renderEditor()
    const input = await screen.findByTestId('vtt-source-input')
    await userEvent.upload(input, fakeFile('notes.uvtt', '<html>'))
    expect(await screen.findByRole('alert')).toHaveTextContent('maps.vtt.source.error.not-json')
    expect(screen.getByTestId('vtt-source-dropzone')).toBeInTheDocument()
  })

  it('reports a Universal VTT carrying no picture', async () => {
    renderEditor()
    const input = await screen.findByTestId('vtt-source-input')
    await userEvent.upload(input, fakeFile('bare.uvtt', JSON.stringify({ format: 0.3 })))
    // There is nothing to draw walls over, so this cannot be edited.
    expect(await screen.findByRole('alert')).toHaveTextContent('maps.vtt.source.error.no-image')
  })

  it('never saves to the library', async () => {
    renderEditor()
    const input = await screen.findByTestId('vtt-source-input')
    await userEvent.upload(input, fakeFile('tavern.uvtt', uvttText()))
    await screen.findByTestId('vtt-canvas')
    // The whole point of the mode: a read-only library must not be a reason
    // this cannot be used, so there is no Save and no authoring write.
    expect(screen.queryByText('common.save')).toBeNull()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('offers download and send-to-campaign instead of save', async () => {
    renderEditor()
    const input = await screen.findByTestId('vtt-source-input')
    await userEvent.upload(input, fakeFile('tavern.uvtt', uvttText()))
    await screen.findByTestId('vtt-canvas')
    expect(screen.getByText('maps.vtt.export')).toBeInTheDocument()
    expect(screen.getByText('maps.vtt.send.button')).toBeInTheDocument()
  })

  it('downloads a .uvtt named after the source file', async () => {
    // Spy on the anchor's own click rather than document.createElement: React
    // creates elements constantly while mounted, and intercepting that for the
    // whole document is enough to wedge the renderer.
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderEditor()
    const input = await screen.findByTestId('vtt-source-input')
    await userEvent.upload(input, fakeFile('tavern.uvtt', uvttText()))
    await screen.findByTestId('vtt-canvas')

    await userEvent.click(screen.getByText('maps.vtt.export'))
    expect(click).toHaveBeenCalled()
    const anchor = click.mock.instances[0]
    expect(anchor.download).toBe('tavern.uvtt')
    expect(anchor.href).toBe('blob:map')
    click.mockRestore()
  })

  it('uploads to the chosen campaign and category', async () => {
    campaignsApi.list.mockResolvedValue([
      { id: 'c1', name: 'Dragons', owner_id: 'u1', is_archived: false },
    ])
    campaignsApi.listCategories.mockResolvedValue([{ id: 'cat1', name: 'Maps' }])
    campaignsApi.uploadFile.mockResolvedValue({ id: 'r1' })

    renderEditor()
    const input = await screen.findByTestId('vtt-source-input')
    await userEvent.upload(input, fakeFile('tavern.uvtt', uvttText()))
    await screen.findByTestId('vtt-canvas')

    await userEvent.click(screen.getByText('maps.vtt.send.button'))
    await userEvent.click(await screen.findByText('Dragons'))
    await userEvent.click(await screen.findByText('Maps'))

    await waitFor(() => expect(campaignsApi.uploadFile).toHaveBeenCalled())
    const [campaignId, file, opts] = campaignsApi.uploadFile.mock.calls[0]
    expect(campaignId).toBe('c1')
    expect(file.name).toBe('tavern.uvtt')
    expect(opts).toEqual({ categoryId: 'cat1' })
    // The GM is taken to where the map now lives.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/campaigns/c1'))
  })

  it('uploads with no category when the default group is chosen', async () => {
    campaignsApi.list.mockResolvedValue([
      { id: 'c1', name: 'Dragons', owner_id: 'u1', is_archived: false },
    ])
    campaignsApi.listCategories.mockResolvedValue([])
    campaignsApi.uploadFile.mockResolvedValue({ id: 'r1' })

    renderEditor()
    const input = await screen.findByTestId('vtt-source-input')
    await userEvent.upload(input, fakeFile('tavern.uvtt', uvttText()))
    await screen.findByTestId('vtt-canvas')

    await userEvent.click(screen.getByText('maps.vtt.send.button'))
    await userEvent.click(await screen.findByText('Dragons'))
    await userEvent.click(await screen.findByText('maps.vtt.send.defaultCategory'))

    await waitFor(() => expect(campaignsApi.uploadFile).toHaveBeenCalled())
    expect(campaignsApi.uploadFile.mock.calls[0][2]).toEqual({})
  })

  it('reports a failed upload without losing the drawing', async () => {
    campaignsApi.list.mockResolvedValue([
      { id: 'c1', name: 'Dragons', owner_id: 'u1', is_archived: false },
    ])
    campaignsApi.listCategories.mockResolvedValue([])
    campaignsApi.uploadFile.mockRejectedValue(new Error('nope'))

    renderEditor()
    const input = await screen.findByTestId('vtt-source-input')
    await userEvent.upload(input, fakeFile('tavern.uvtt', uvttText()))
    await screen.findByTestId('vtt-canvas')

    await userEvent.click(screen.getByText('maps.vtt.send.button'))
    await userEvent.click(await screen.findByText('Dragons'))
    await userEvent.click(await screen.findByText('maps.vtt.send.defaultCategory'))

    // Minutes of wall-tracing must survive a failed upload.
    expect(await screen.findByRole('alert')).toHaveTextContent('maps.vtt.saveFailed')
    expect(screen.getByTestId('vtt-canvas')).toBeInTheDocument()
  })

  it('goes back to the gallery rather than a map that does not exist', async () => {
    renderEditor()
    await screen.findByTestId('vtt-source-dropzone')
    await userEvent.click(screen.getByRole('button', { name: /detail.back/ }))
    expect(navigate).toHaveBeenCalledWith('/maps')
  })
})
