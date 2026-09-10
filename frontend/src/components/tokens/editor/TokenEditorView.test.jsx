import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const navigate = vi.fn()
let routeParams = {}
let routeState = {}

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => routeParams,
  useLocation: () => ({ state: routeState }),
}))

vi.mock('../../../lib/tokenCompositor', () => ({
  OUTPUT_SIZES: [140, 256, 512, 1024],
  DEFAULT_TRANSFORM: {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
  loadImage: vi.fn(),
  composeToBlob: vi.fn(),
  renderPreview: vi.fn(),
}))

vi.mock('../../../api', () => ({
  campaigns: { uploadMemberArt: vi.fn(), list: vi.fn(), get: vi.fn() },
  imageSources: { thumbUrl: (type, id) => `/api/${type}/${id}/thumb` },
  mediaUrl: (path) => `/api${path}`,
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-me' } }),
}))

vi.mock('./frames', () => ({
  fetchFrames: vi.fn().mockResolvedValue([]),
  frameUrl: (id) => `/frames/${id}.svg`,
  groupFrames: () => [],
  frameLabel: (frame) => frame?.name || '',
  frameIsRecolourable: (id) => String(id).startsWith('generic:'),
  BUILTIN_FRAMES: [],
  GENERIC_FRAMES: [],
  isBuiltinFrame: (id) => String(id).startsWith('builtin:'),
}))

vi.mock('../../../lib/frameMask', () => ({
  frameApertureMask: vi.fn(() => null),
}))

import { campaigns, mediaUrl } from '../../../api'
import { composeToBlob, loadImage } from '../../../lib/tokenCompositor'
import TokenEditorView from './TokenEditorView'

const loaded = { image: {}, width: 800, height: 600, intrinsic: true }

beforeEach(() => {
  vi.clearAllMocks()
  routeParams = {}
  routeState = {}
  loadImage.mockResolvedValue(loaded)
  composeToBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
})

/** Render with a source already loaded, which is where both exits live. */
async function renderWithSource(state = {}) {
  routeParams = { tokenId: 'tok1' }
  routeState = state
  render(<TokenEditorView />)
  await screen.findByTestId('token-editor-canvas')
}

describe('loading the source', () => {
  it('preloads the token named in the route', async () => {
    await renderWithSource()
    expect(loadImage).toHaveBeenCalledWith('/api/tokens/tok1/file')
  })

  it('shows the source picker when opened with no token', async () => {
    render(<TokenEditorView />)
    expect(await screen.findByTestId('token-source-dropzone')).toBeInTheDocument()
    expect(loadImage).not.toHaveBeenCalled()
  })

  it('reports a source that will not decode', async () => {
    loadImage.mockRejectedValue(new Error('bad image'))
    routeParams = { tokenId: 'tok1' }
    render(<TokenEditorView />)
    expect(await screen.findByRole('alert')).toHaveTextContent('That image could not be loaded.')
  })
})

describe('the download exit', () => {
  it('composes a PNG and saves it under a sensible name', async () => {
    const click = vi.fn()
    const create = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = create(tag)
      if (tag === 'a') el.click = click
      return el
    })
    global.URL.createObjectURL = vi.fn(() => 'blob:token')
    global.URL.revokeObjectURL = vi.fn()

    await renderWithSource({ memberName: 'Ireena Kolyana' })
    await userEvent.click(screen.getByRole('button', { name: /Download/ }))

    await waitFor(() => expect(composeToBlob).toHaveBeenCalled())
    expect(click).toHaveBeenCalled()
    // The anchor's download name is derived from the character.
    const anchor = document.createElement.mock.results
      .map((r) => r.value)
      .find((el) => el.tagName === 'A')
    expect(anchor.download).toBe('ireena-kolyana-token.png')
    expect(global.URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('surfaces an encoding failure', async () => {
    composeToBlob.mockRejectedValue(new Error('encode failed'))
    await renderWithSource()
    await userEvent.click(screen.getByRole('button', { name: /Download/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('encode failed')
  })
})

describe('the character-art exit', () => {
  it('uploads straight to the member the editor was opened for', async () => {
    campaigns.uploadMemberArt.mockResolvedValue({})
    await renderWithSource({ campaignId: 'c1', memberId: 'm1', memberName: 'Ireena' })

    await userEvent.click(screen.getByRole('button', { name: /Set\ as\ character\ art/ }))

    await waitFor(() => expect(campaigns.uploadMemberArt).toHaveBeenCalled())
    const [campaignId, memberId, file] = campaigns.uploadMemberArt.mock.calls[0]
    expect(campaignId).toBe('c1')
    expect(memberId).toBe('m1')
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/png')
    expect(file.name).toBe('ireena-token.png')
  })

  it('returns to the campaign with a cache-busting stamp once saved', async () => {
    campaigns.uploadMemberArt.mockResolvedValue({})
    await renderWithSource({ campaignId: 'c1', memberId: 'm1' })

    await userEvent.click(screen.getByRole('button', { name: /Set\ as\ character\ art/ }))

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    const [path, options] = navigate.mock.calls.at(-1)
    expect(path).toBe('/campaigns/c1')
    expect(options.state.artUpdated).toEqual(expect.any(Number))
  })

  it('asks which character when opened standalone', async () => {
    campaigns.list.mockResolvedValue({ campaigns: [] })
    await renderWithSource()

    await userEvent.click(screen.getByRole('button', { name: /Set\ as\ character\ art/ }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(campaigns.uploadMemberArt).not.toHaveBeenCalled()
  })

  it('surfaces an upload rejection', async () => {
    campaigns.uploadMemberArt.mockRejectedValue(new Error('File is too large'))
    await renderWithSource({ campaignId: 'c1', memberId: 'm1' })

    await userEvent.click(screen.getByRole('button', { name: /Set\ as\ character\ art/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('File is too large')
    expect(navigate).not.toHaveBeenCalledWith(
      expect.stringContaining('/campaigns'),
      expect.anything()
    )
  })
})

describe('the editing surface', () => {
  it('warns when the art is smaller than the chosen output', async () => {
    loadImage.mockResolvedValue({ image: {}, width: 120, height: 120, intrinsic: true })
    await renderWithSource()
    expect(screen.getByText(/smaller than the 256px output/)).toBeInTheDocument()
  })

  it('stays quiet when the art is large enough', async () => {
    await renderWithSource()
    expect(screen.queryByText(/smaller than the/)).not.toBeInTheDocument()
  })

  it('lets the user swap the image out again', async () => {
    await renderWithSource()
    await userEvent.click(screen.getByRole('button', { name: 'Change image' }))
    expect(screen.getByTestId('token-source-dropzone')).toBeInTheDocument()
  })

  it('loads a file chosen from the device', async () => {
    render(<TokenEditorView />)
    const input = await screen.findByTestId('token-source-input')
    await userEvent.upload(input, new File(['x'], 'art.png', { type: 'image/png' }))
    await waitFor(() => expect(loadImage).toHaveBeenCalledWith(expect.any(File)))
  })

  it('goes back when the back button is used', async () => {
    await renderWithSource()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(navigate).toHaveBeenCalledWith(-1)
  })

  it('names the character the token is being made for', async () => {
    await renderWithSource({ memberName: 'Ireena' })
    expect(screen.getByText('for Ireena')).toBeInTheDocument()
  })
})
