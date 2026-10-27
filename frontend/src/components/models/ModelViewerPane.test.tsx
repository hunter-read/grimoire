import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModelViewerPane from './ModelViewerPane'

// jsdom has no WebGL, so the graphics module is mocked wholesale and what is
// tested here is the component's state machine — which is exactly why the
// untestable parts live in src/lib/three.js.
const createViewer = vi.fn()
const dispose = vi.fn()
const resetView = vi.fn()
const setWireframe = vi.fn()

vi.mock('../../lib/three', () => ({
  createViewer: (...args) => createViewer(...args),
}))

vi.mock('../../api', () => ({
  mediaUrl: (path) => `http://localhost${path}`,
  default: { get: vi.fn() },
}))

const aModel = (over = {}) => ({
  id: 'm1',
  filename: 'goblin.stl',
  viewer_loader: 'stl',
  viewer_available: true,
  ...over,
})

describe('ModelViewerPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createViewer.mockResolvedValue({ dispose, resetView, setWireframe, triangles: 800 })
  })

  it('shows a spinner while the mesh loads', () => {
    createViewer.mockReturnValue(new Promise(() => {}))
    render(<ModelViewerPane model={aModel()} />)
    expect(screen.getByText('Loading model…')).toBeInTheDocument()
  })

  it('builds the viewer against the model file URL', async () => {
    render(<ModelViewerPane model={aModel()} />)
    await waitFor(() => expect(createViewer).toHaveBeenCalled())
    const [, url, kind] = createViewer.mock.calls[0]
    expect(url).toBe('http://localhost/models/m1/file')
    expect(kind).toBe('stl')
  })

  it('shows the controls once loaded', async () => {
    render(<ModelViewerPane model={aModel()} />)
    expect(await screen.findByTitle('Reset view')).toBeInTheDocument()
    expect(screen.getByTitle('Wireframe')).toBeInTheDocument()
  })

  it('resets the view when the reset button is clicked', async () => {
    render(<ModelViewerPane model={aModel()} />)
    await userEvent.click(await screen.findByTitle('Reset view'))
    expect(resetView).toHaveBeenCalled()
  })

  it('toggles wireframe on and back off', async () => {
    render(<ModelViewerPane model={aModel()} />)
    const btn = await screen.findByTitle('Wireframe')
    await userEvent.click(btn)
    expect(setWireframe).toHaveBeenLastCalledWith(true)
    await userEvent.click(btn)
    expect(setWireframe).toHaveBeenLastCalledWith(false)
  })

  it('shows an error state when the mesh cannot be read', async () => {
    createViewer.mockRejectedValue(new Error('bad mesh'))
    render(<ModelViewerPane model={aModel()} />)
    expect(await screen.findByText('This model could not be displayed.')).toBeInTheDocument()
  })

  it('offers a download instead of a viewer for an unsupported format', () => {
    render(<ModelViewerPane model={aModel({ viewer_loader: '', viewer_available: false })} />)
    expect(screen.getByText('No preview for this format.')).toBeInTheDocument()
    expect(createViewer).not.toHaveBeenCalled()
  })

  it('warns rather than refusing outright for an oversized mesh', () => {
    // A format the viewer *could* read, held back on size — the distinct message
    // matters, since "no preview for this format" would be simply untrue.
    render(<ModelViewerPane model={aModel({ viewer_available: false, viewer_oversized: true })} />)
    expect(screen.getByText("This model is larger than the viewer's limit.")).toBeInTheDocument()
    expect(screen.getByText(/may be slow/)).toBeInTheDocument()
    expect(createViewer).not.toHaveBeenCalled()
  })

  it('loads an oversized mesh once the user opts in', async () => {
    render(<ModelViewerPane model={aModel({ viewer_available: false, viewer_oversized: true })} />)
    await userEvent.click(screen.getByText('Load anyway'))
    await waitFor(() => expect(createViewer).toHaveBeenCalled())
    expect(await screen.findByTitle('Reset view')).toBeInTheDocument()
  })

  it('re-asks when a different oversized model is shown', async () => {
    // The opt-in is per file: carrying it over would load a mesh the user never
    // agreed to, which for a heavier file is exactly the hang being avoided.
    const over = { viewer_available: false, viewer_oversized: true }
    const { rerender } = render(<ModelViewerPane model={aModel(over)} />)
    await userEvent.click(screen.getByText('Load anyway'))
    await waitFor(() => expect(createViewer).toHaveBeenCalled())

    rerender(<ModelViewerPane model={aModel({ ...over, id: 'm2' })} />)
    expect(await screen.findByText('Load anyway')).toBeInTheDocument()
    expect(createViewer).toHaveBeenCalledTimes(1)
  })

  it('offers only a download for an unloadable format, however small', () => {
    render(
      <ModelViewerPane
        model={aModel({ viewer_loader: '', viewer_available: false, viewer_oversized: false })}
      />
    )
    expect(screen.getByText('No preview for this format.')).toBeInTheDocument()
    expect(screen.queryByText('Load anyway')).not.toBeInTheDocument()
  })

  it('disposes the WebGL context on unmount', async () => {
    // The single most consequential behaviour here: browsers cap concurrent
    // contexts, so leaking one per visit blanks the viewer after a dozen models.
    const { unmount } = render(<ModelViewerPane model={aModel()} />)
    await screen.findByTitle('Reset view')
    unmount()
    expect(dispose).toHaveBeenCalled()
  })

  it('disposes a viewer that resolves after unmount', async () => {
    let resolve
    createViewer.mockReturnValue(new Promise((r) => (resolve = r)))
    const { unmount } = render(<ModelViewerPane model={aModel()} />)
    unmount()
    resolve({ dispose, resetView, setWireframe, triangles: 1 })
    await waitFor(() => expect(dispose).toHaveBeenCalled())
  })

  it('rebuilds when the model changes', async () => {
    const { rerender } = render(<ModelViewerPane model={aModel()} />)
    await screen.findByTitle('Reset view')
    rerender(<ModelViewerPane model={aModel({ id: 'm2' })} />)
    await waitFor(() => expect(createViewer).toHaveBeenCalledTimes(2))
    expect(dispose).toHaveBeenCalled()
  })
})
