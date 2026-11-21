import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Stored tokens keep the editor's recipe, and the editor reopens them (#948).

const navigate = vi.fn()
let routeParams: Record<string, string> = {}
let routeState: Record<string, unknown> = {}

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
  campaigns: {
    uploadMemberArt: vi.fn(),
    uploadMemberToken: vi.fn(),
    uploadOwnerToken: vi.fn(),
    uploadImage: vi.fn(),
    updateTokenFile: vi.fn(),
    getTokenRecipe: vi.fn(),
    tokenRecipeSource: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    listCategories: vi.fn(),
  },
  imageSources: { thumbUrl: (type: string, id: string) => `/api/${type}/${id}/thumb` },
  mediaUrl: (path: string) => `/api${path}`,
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-me' } }),
}))

vi.mock('./frames', () => ({
  fetchFrames: vi.fn().mockResolvedValue([]),
  frameUrl: (id: string) => `/frames/${id}.svg`,
  groupFrames: () => [],
  frameLabel: (frame: { name?: string } | null) => frame?.name || '',
  frameIsRecolourable: (id: unknown) => String(id).startsWith('generic:'),
  BUILTIN_FRAMES: [],
  GENERIC_FRAMES: [],
  isBuiltinFrame: (id: unknown) => String(id).startsWith('builtin:'),
  frameFamily: () => null,
}))

vi.mock('../../../lib/frameMask', () => ({
  frameApertureMask: vi.fn(() => null),
}))

import { campaigns as campaignsApi } from '../../../api'
import { composeToBlob, loadImage } from '../../../lib/tokenCompositor'
import type { LoadedImage } from '../../../lib/tokenCompositor'
import TokenEditorView from './TokenEditorView'

const campaigns = campaignsApi as unknown as Record<string, Mock>

const loaded = { image: {}, width: 2000, height: 2000, intrinsic: true } as LoadedImage

const RECIPE = {
  size: 512,
  frame_id: 'generic:circle',
  frame_color: 'gold',
  background: '#112233',
  transform: { scale: 1.5, offsetX: 12, offsetY: -8, rotation: 90, flipX: true, flipY: false },
  source: { type: 'token', id: 'tok-9' },
}

beforeEach(() => {
  vi.clearAllMocks()
  routeParams = {}
  routeState = {}
  vi.mocked(loadImage).mockResolvedValue(loaded)
  vi.mocked(composeToBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
  campaigns.listCategories.mockResolvedValue([])
  campaigns.uploadMemberToken.mockResolvedValue({})
  campaigns.uploadOwnerToken.mockResolvedValue({})
  campaigns.updateTokenFile.mockResolvedValue({})
  campaigns.uploadImage.mockResolvedValue({})
})

const lastArg = (mock: Mock) => mock.mock.calls[0][mock.mock.calls[0].length - 1]

describe('saving a recipe with the token', () => {
  it('records a library token as the source', async () => {
    routeParams = { tokenId: 'tok1' }
    routeState = { campaignId: 'c1', memberId: 'm1', saveAs: 'token' }
    render(<TokenEditorView />)
    await screen.findByTestId('token-editor-canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Set as a character token' }))

    await waitFor(() => expect(campaigns.uploadMemberToken).toHaveBeenCalled())
    const sent = lastArg(campaigns.uploadMemberToken)
    expect(sent.recipe.source).toEqual({ type: 'token', id: 'tok1' })
    expect(sent.recipe.size).toBe(256)
    expect(sent.recipe.transform).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      flipX: false,
      flipY: false,
    })
    // A library source is referenced, never re-uploaded.
    expect(sent.source).toBeNull()
  })

  it('sends device art along with the recipe', async () => {
    routeState = { campaignId: 'c1', saveAs: 'token' }
    render(<TokenEditorView />)
    const art = new File(['art'], 'art.png', { type: 'image/png' })
    await userEvent.upload(await screen.findByTestId('token-source-input'), art)
    await screen.findByTestId('token-editor-canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Set as a character token' }))

    await waitFor(() => expect(campaigns.uploadOwnerToken).toHaveBeenCalled())
    const sent = lastArg(campaigns.uploadOwnerToken)
    expect(sent.recipe.source).toEqual({ type: 'upload', id: null })
    expect(sent.source).toBe(art)
  })

  it('records the new art when the image is changed', async () => {
    routeParams = { tokenId: 'tok1' }
    routeState = { campaignId: 'c1', memberId: 'm1', saveAs: 'token' }
    render(<TokenEditorView />)
    await screen.findByTestId('token-editor-canvas')
    await userEvent.click(screen.getByRole('button', { name: 'Change image' }))
    const art = new File(['new'], 'new.png', { type: 'image/png' })
    await userEvent.upload(await screen.findByTestId('token-source-input'), art)
    await screen.findByTestId('token-editor-canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Set as a character token' }))

    await waitFor(() => expect(campaigns.uploadMemberToken).toHaveBeenCalled())
    const sent = lastArg(campaigns.uploadMemberToken)
    expect(sent.recipe.source).toEqual({ type: 'upload', id: null })
    expect(sent.source).toBe(art)
  })
})

describe('reopening a stored token', () => {
  it('restores its settings over the library art it was made from', async () => {
    campaigns.getTokenRecipe.mockResolvedValue(RECIPE)
    routeState = {
      campaignId: 'c1',
      memberId: 'm1',
      saveAs: 'token',
      recipe: { kind: 'member', targetId: 'm1' },
    }
    render(<TokenEditorView />)
    await screen.findByTestId('token-editor-canvas')

    expect(campaigns.getTokenRecipe).toHaveBeenCalledWith('c1', 'member', 'm1')
    expect(loadImage).toHaveBeenCalledWith('/api/tokens/tok-9/file')
    // Saving straight back writes the same recipe it opened with.
    await userEvent.click(screen.getByRole('button', { name: 'Set as a character token' }))
    await waitFor(() => expect(campaigns.uploadMemberToken).toHaveBeenCalled())
    const sent = lastArg(campaigns.uploadMemberToken)
    expect(sent.recipe).toEqual(RECIPE)
  })

  it('reloads device art the server kept, and sends it again', async () => {
    const kept = new Blob(['kept'], { type: 'image/png' })
    campaigns.getTokenRecipe.mockResolvedValue({ ...RECIPE, source: { type: 'upload', id: null } })
    campaigns.tokenRecipeSource.mockResolvedValue(kept)
    routeState = { campaignId: 'c1', saveAs: 'token', recipe: { kind: 'owner', targetId: 'c1' } }
    render(<TokenEditorView />)
    await screen.findByTestId('token-editor-canvas')

    expect(campaigns.tokenRecipeSource).toHaveBeenCalledWith('c1', 'owner', 'c1')
    expect(loadImage).toHaveBeenCalledWith(kept)
    await userEvent.click(screen.getByRole('button', { name: 'Set as a character token' }))
    await waitFor(() => expect(campaigns.uploadOwnerToken).toHaveBeenCalled())
    expect(lastArg(campaigns.uploadOwnerToken).source).toBe(kept)
  })

  it('says so when the art has left the library, keeping the settings', async () => {
    campaigns.getTokenRecipe.mockResolvedValue(RECIPE)
    vi.mocked(loadImage).mockImplementation((src) =>
      src === '/api/tokens/tok-9/file' ? Promise.reject(new Error('404')) : Promise.resolve(loaded)
    )
    routeState = { campaignId: 'c1', saveAs: 'token', recipe: { kind: 'owner', targetId: 'c1' } }
    render(<TokenEditorView />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The art this token was made from is no longer available.'
    )
    // The picker is back, to choose new art.
    expect(screen.getByTestId('token-source-input')).toBeInTheDocument()
  })

  it('says so when the recipe cannot be read', async () => {
    campaigns.getTokenRecipe.mockRejectedValue(new Error('nope'))
    routeState = { campaignId: 'c1', saveAs: 'token', recipe: { kind: 'owner', targetId: 'c1' } }
    render(<TokenEditorView />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This token's settings could not be loaded."
    )
    expect(screen.getByTestId('token-source-input')).toBeInTheDocument()
  })
})

describe('a token filed as a campaign resource', () => {
  const fileState = {
    campaignId: 'c1',
    fileId: 'f1',
    memberName: 'strahd-token.png',
    saveAs: 'file',
    recipe: { kind: 'file', targetId: 'f1' },
  }

  it('updates the file in place, with its recipe', async () => {
    campaigns.getTokenRecipe.mockResolvedValue(RECIPE)
    routeState = fileState
    render(<TokenEditorView />)
    await screen.findByTestId('token-editor-canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Update token' }))

    await waitFor(() => expect(campaigns.updateTokenFile).toHaveBeenCalled())
    const [campaignId, fileId, file, sent] = campaigns.updateTokenFile.mock.calls[0]
    expect([campaignId, fileId]).toEqual(['c1', 'f1'])
    // Named for the file, without doubling its extension.
    expect((file as File).name).toBe('strahd-token-token.png')
    expect(sent.recipe).toEqual(RECIPE)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/campaigns/c1', expect.anything()))
  })

  it('can still be sent somewhere else as well', async () => {
    campaigns.getTokenRecipe.mockResolvedValue(RECIPE)
    campaigns.list.mockResolvedValue([])
    routeState = fileState
    render(<TokenEditorView />)
    await screen.findByTestId('token-editor-canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Send to a campaign' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(campaigns.updateTokenFile).not.toHaveBeenCalled()
  })

  it('files a new token in a campaign with its recipe', async () => {
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue({ id: 'c1', name: 'Curse', owner_id: 'user-me', members: [] })
    routeParams = { tokenId: 'tok1' }
    render(<TokenEditorView />)
    await screen.findByTestId('token-editor-canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Send to a campaign' }))
    await userEvent.click(await screen.findByRole('button', { name: /Curse/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Tokens/ }))

    await waitFor(() => expect(campaigns.uploadImage).toHaveBeenCalled())
    const sent = lastArg(campaigns.uploadImage)
    expect(sent.recipe.source).toEqual({ type: 'token', id: 'tok1' })
  })
})
