import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GmScreenView from './GmScreenView'

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useParams: () => ({ campaignId: 'camp' }) }
})

vi.mock('../api', () => ({
  campaigns: { get: vi.fn(), wikiTitles: vi.fn(), getWikiPage: vi.fn() },
  characters: { update: vi.fn(), portraitUrl: () => '' },
  gmScreen: {
    get: vi.fn(),
    party: vi.fn(),
    addPanel: vi.fn(),
    updatePanel: vi.fn(),
    removePanel: vi.fn(),
    saveLayout: vi.fn(),
    reset: vi.fn(),
    sources: vi.fn(),
    copy: vi.fn(),
    exportBoard: vi.fn(),
    importBoard: vi.fn(),
    presets: vi.fn(),
    applyPreset: vi.fn(),
  },
}))

let mockUser = { id: 'gm1' }
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }))

import { campaigns, gmScreen } from '../api'
const api = gmScreen as unknown as Record<keyof typeof gmScreen, Mock>
const campaignApi = campaigns as unknown as Record<'get' | 'wikiTitles', Mock>

const counter = {
  id: 'p1',
  kind: 'counter',
  title: 'Fear',
  x: 0,
  y: 0,
  w: 3,
  h: 3,
  config: { max: 12 },
  state: { value: 4 },
}

const renderView = () =>
  render(
    <MemoryRouter>
      <GmScreenView />
    </MemoryRouter>
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockUser = { id: 'gm1' }
  campaignApi.get.mockResolvedValue({
    id: 'camp',
    name: 'The Tithe',
    owner_id: 'gm1',
    locked: false,
  })
  campaignApi.wikiTitles.mockResolvedValue([])
  api.get.mockResolvedValue({ panels: [counter] })
  api.party.mockResolvedValue({ characters: [], fields: [] })
})

describe('GmScreenView', () => {
  it('is the GM’s alone', async () => {
    mockUser = { id: 'player1' }
    renderView()
    expect(await screen.findByText(/Only this campaign's GM/)).toBeInTheDocument()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('reports a campaign that will not load', async () => {
    campaignApi.get.mockRejectedValue(new Error('Campaign not found'))
    renderView()
    expect(await screen.findByRole('alert')).toHaveTextContent('Campaign not found')
  })

  it('shows the board under the campaign’s name, with a way back', async () => {
    renderView()
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'GM screenBetaThe Tithe'
    )
    expect(await screen.findByRole('heading', { name: 'Fear' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Campaign/ })).toHaveAttribute(
      'href',
      '/campaigns/camp/overview'
    )
    expect(document.title).toMatch(/The Tithe/)
  })

  it('says when the campaign is read-only', async () => {
    campaignApi.get.mockResolvedValue({ id: 'camp', name: 'Done', owner_id: 'gm1', locked: true })
    renderView()
    expect(await screen.findByRole('note')).toHaveTextContent(/read-only/)
  })

  it('starts an empty board from the basic layout', async () => {
    api.get.mockResolvedValue({ panels: [] })
    api.importBoard.mockResolvedValue({ panels: [counter] })
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'Start with a basic board' }))
    await screen.findByRole('heading', { name: 'Fear' })
    const [, document, replace] = api.importBoard.mock.calls[0]
    expect(document.panels.map((p: { kind: string }) => p.kind)).toEqual([
      'party',
      'initiative',
      'clocks',
      'scratch',
    ])
    expect(replace).toBe(true)
  })

  it('adds a tool from the menu, titled for its kind', async () => {
    api.addPanel.mockResolvedValue({
      ...counter,
      id: 'p2',
      kind: 'pools',
      title: 'Token pools',
      state: {},
    })
    renderView()
    await screen.findByRole('heading', { name: 'Fear' })
    fireEvent.click(screen.getByRole('button', { name: /Add tool/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Token pools' }))
    expect(await screen.findByRole('heading', { name: 'Token pools' })).toBeInTheDocument()
    expect(api.addPanel).toHaveBeenCalledWith('camp', { kind: 'pools', title: 'Token pools' })
  })

  it('ends a scene, a session and a rest', async () => {
    api.reset.mockResolvedValue({ panels: [{ ...counter, state: { value: 0 } }] })
    renderView()
    await screen.findByRole('heading', { name: 'Fear' })
    fireEvent.click(screen.getByRole('button', { name: /End scene/ }))
    expect(await screen.findByText('Scene ended.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /End session/ }))
    expect(await screen.findByText('Session ended.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Rest/ }))
    expect(await screen.findByText('Rested.')).toBeInTheDocument()
    expect(api.reset.mock.calls.map((call) => call[1])).toEqual(['scene', 'session', 'rest'])
  })

  it('copies another campaign’s board below this one', async () => {
    api.sources.mockResolvedValue({
      campaigns: [
        { id: 'old', name: 'Old Table', panel_count: 3 },
        { id: 'older', name: 'Older Table', panel_count: 1 },
      ],
    })
    api.copy.mockResolvedValue({ panels: [counter, { ...counter, id: 'p9', title: 'Copied' }] })
    renderView()
    await screen.findByRole('heading', { name: 'Fear' })
    fireEvent.click(screen.getByRole('button', { name: /Board/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy from another campaign' }))
    const dialog = await screen.findByRole('dialog', { name: 'Copy a GM screen' })
    expect(within(dialog).getByText('3 panels')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByLabelText(/Older Table/))
    fireEvent.click(within(dialog).getByLabelText('Below this board'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('heading', { name: 'Copied' })).toBeInTheDocument()
    expect(api.copy).toHaveBeenCalledWith('camp', 'older', false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says when there is no board to copy, and shows a copy that failed', async () => {
    api.get.mockResolvedValue({ panels: [] })
    api.sources.mockResolvedValueOnce({ campaigns: [] })
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'Copy from another campaign' }))
    expect(await screen.findByText(/None of your other campaigns/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    api.sources.mockResolvedValueOnce({ campaigns: [{ id: 'old', name: 'Old', panel_count: 1 }] })
    api.copy.mockRejectedValue(new Error('That campaign’s GM screen is empty'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy from another campaign' }))
    const dialog = await screen.findByRole('dialog')
    // With nothing here yet, there is nothing to choose between.
    expect(within(dialog).queryByLabelText('Below this board')).not.toBeInTheDocument()
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Copy' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('empty')
  })

  it('applies a community preset', async () => {
    api.presets.mockResolvedValue({
      presets: [
        {
          id: 'demo',
          name: 'Demo Screen',
          version: '1.0.0',
          system: 'Demo',
          description: 'Fear and countdowns',
          author: 'someone',
          author_url: '',
          license: '',
          panel_count: 2,
          index_url: 'https://example.test/gm-screens/index.json',
        },
      ],
      errors: [{ url: 'https://down.test/index.json', error: 'offline' }],
    })
    api.applyPreset.mockResolvedValue({ panels: [{ ...counter, title: 'Preset Fear' }] })
    renderView()
    await screen.findByRole('heading', { name: 'Fear' })
    fireEvent.click(screen.getByRole('button', { name: /Board/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Community presets' }))
    const dialog = await screen.findByRole('dialog', { name: 'Community presets' })
    expect(await within(dialog).findByText('Fear and countdowns')).toBeInTheDocument()
    expect(within(dialog).getByText('Demo · by someone · 2 panels')).toBeInTheDocument()
    expect(within(dialog).getByText(/Couldn't read https:\/\/down.test/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use Demo Screen' }))
    expect(await screen.findByRole('heading', { name: 'Preset Fear' })).toBeInTheDocument()
    expect(api.applyPreset).toHaveBeenCalledWith(
      'camp',
      'demo',
      'https://example.test/gm-screens/index.json',
      true
    )
  })

  it('shows a preset catalogue that will not load, or an empty one', async () => {
    api.presets.mockRejectedValueOnce(new Error('Downloading GM screen presets is disabled'))
    api.get.mockResolvedValue({ panels: [] })
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'Community presets' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('disabled')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    api.presets.mockResolvedValueOnce({ presets: [], errors: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Community presets' }))
    expect(await screen.findByText(/No presets are available/)).toBeInTheDocument()
  })

  it('reports a failed source without naming it when the server leaves it out', async () => {
    api.presets.mockResolvedValueOnce({ presets: [], errors: [{ url: '', error: '' }] })
    api.get.mockResolvedValue({ panels: [] })
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'Community presets' }))
    expect(
      await screen.findByText("One of the preset catalogues couldn't be read.")
    ).toBeInTheDocument()
    expect(screen.queryByText(/Couldn't read/)).not.toBeInTheDocument()
  })

  it('reports a preset that fails to apply', async () => {
    api.presets.mockResolvedValue({
      presets: [
        {
          id: 'x',
          name: 'X',
          version: '',
          system: '',
          description: '',
          author: '',
          author_url: '',
          license: '',
          panel_count: 1,
          index_url: '',
        },
      ],
      errors: [],
    })
    api.applyPreset.mockRejectedValue(new Error('That preset failed its integrity check'))
    renderView()
    await screen.findByRole('heading', { name: 'Fear' })
    fireEvent.click(screen.getByRole('button', { name: /Board/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Community presets' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use X' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('integrity')
  })

  it('exports the board as a file', async () => {
    api.exportBoard.mockResolvedValue({
      format: 'grimoire://gm-screen/v1',
      name: 'The Tithe',
      panels: [],
    })
    const createObjectURL = vi.fn(() => 'blob:board')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderView()
    await screen.findByRole('heading', { name: 'Fear' })
    fireEvent.click(screen.getByRole('button', { name: /Board/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:board')
  })

  it('imports a board file, asking whether to replace this one', async () => {
    api.importBoard.mockResolvedValue({ panels: [{ ...counter, title: 'Imported' }] })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderView()
    await screen.findByRole('heading', { name: 'Fear' })
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File([JSON.stringify({ panels: [{ kind: 'scratch' }] })], 'board.json', {
      type: 'application/json',
    })
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByText('Board imported.')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalled()
    expect(api.importBoard).toHaveBeenCalledWith('camp', { panels: [{ kind: 'scratch' }] }, false)

    fireEvent.change(input, { target: { files: [new File(['not json'], 'x.json')] } })
    expect(await screen.findByText('That file is not a GM screen board.')).toBeInTheDocument()
  })

  it('shows a failed save and lets it be dismissed', async () => {
    api.updatePanel.mockRejectedValue(new Error('Campaign is archived'))
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'Increase Fear' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Campaign is archived')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('removes a panel', async () => {
    api.removePanel.mockResolvedValue({ panels: [] })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Fear' }))
    expect(await screen.findByText(/Your GM screen is empty/)).toBeInTheDocument()
  })

  it('reports a basic board that could not be made', async () => {
    api.get.mockResolvedValue({ panels: [] })
    api.importBoard.mockRejectedValue(new Error('Campaign is archived'))
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'Start with a basic board' }))
    expect(await screen.findByText('Campaign is archived')).toBeInTheDocument()
  })
})
