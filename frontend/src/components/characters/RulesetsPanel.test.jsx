import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RulesetsPanel from './RulesetsPanel'

const mockList = vi.fn()
const mockCreate = vi.fn()
const mockRemove = vi.fn()
const mockEntries = vi.fn()
const mockRemoveEntry = vi.fn()
const mockInstallable = vi.fn()
const mockBrowsePacks = vi.fn()
const mockImport = vi.fn()
const mockSchemas = vi.fn()
const mockTypes = vi.fn()
const mockCampaigns = vi.fn()
vi.mock('../../api', () => ({
  rulesets: {
    list: (...a) => mockList(...a),
    create: (...a) => mockCreate(...a),
    remove: (...a) => mockRemove(...a),
    entries: (...a) => mockEntries(...a),
    removeEntry: (...a) => mockRemoveEntry(...a),
    installable: (...a) => mockInstallable(...a),
    browsePacks: (...a) => mockBrowsePacks(...a),
    installPack: vi.fn(),
    import: (...a) => mockImport(...a),
  },
  characters: { listSchemas: (...a) => mockSchemas(...a) },
  content: { types: (...a) => mockTypes(...a) },
  campaigns: { list: (...a) => mockCampaigns(...a) },
}))

const MINE = {
  id: 'r1',
  schema_id: 'dnd-5e-2024',
  name: 'Strahd house rules',
  campaign_id: 'c1',
  campaign_name: 'Curse of Strahd',
  editable: true,
  entry_count: 2,
  attribution: '',
}

const SERVER = {
  id: 'r2',
  schema_id: 'dnd-5e-2024',
  name: 'D&D 5e SRD',
  campaign_id: null,
  campaign_name: '',
  editable: false,
  entry_count: 109,
  attribution: 'Includes material from the SRD 5.2, CC BY 4.0.',
}

const renderView = () => render(<RulesetsPanel />)

beforeEach(() => {
  vi.clearAllMocks()
  mockList.mockResolvedValue({ rulesets: [MINE, SERVER] })
  mockSchemas.mockResolvedValue({ schemas: [{ schema_id: 'dnd-5e-2024', name: 'D&D 5e' }] })
  mockCampaigns.mockResolvedValue([{ id: 'c1', name: 'Curse of Strahd' }])
  mockEntries.mockResolvedValue({
    entries: [
      { id: 'e1', content_type: 'spell', entry_id: 'hellfire', name: 'Hellfire', editable: true },
    ],
  })
  mockTypes.mockResolvedValue({ content_types: [{ name: 'spell', label_plural: 'Spells' }] })
  mockInstallable.mockResolvedValue({ packs: [] })
  mockBrowsePacks.mockResolvedValue({ packs: [], sources: [], errors: [], can_install: true })
})

describe('RulesetsPanel', () => {
  it('lists rulesets with the campaign each is for', async () => {
    renderView()
    expect(await screen.findByText('Strahd house rules')).toBeInTheDocument()
    // Which table a ruleset is for is the thing that matters most here.
    expect(screen.getByText(/Curse of Strahd/)).toBeInTheDocument()
    expect(screen.getByText(/Everyone on this server/)).toBeInTheDocument()
  })

  it('creates a ruleset for a campaign', async () => {
    mockCreate.mockResolvedValue({ ...MINE, id: 'new' })
    renderView()
    await screen.findByText('Strahd house rules')

    await userEvent.click(screen.getByText('New ruleset'))
    await userEvent.type(screen.getByLabelText('Name'), 'Saturday extras')
    await userEvent.selectOptions(screen.getByLabelText('System'), 'dnd-5e-2024')
    await userEvent.selectOptions(screen.getByLabelText(/For campaign/i), 'c1')
    await userEvent.click(screen.getAllByText('New ruleset')[1])

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        schema_id: 'dnd-5e-2024',
        name: 'Saturday extras',
        campaign_id: 'c1',
      })
    )
  })

  it('creating without a campaign asks for a server ruleset', async () => {
    mockCreate.mockResolvedValue({ ...SERVER, id: 'new' })
    renderView()
    await screen.findByText('Strahd house rules')
    await userEvent.click(screen.getByText('New ruleset'))
    await userEvent.type(screen.getByLabelText('Name'), 'Core')
    await userEvent.selectOptions(screen.getByLabelText('System'), 'dnd-5e-2024')
    await userEvent.click(screen.getAllByText('New ruleset')[1])
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ campaign_id: null }))
    )
  })

  it('needs a sheet installed before a ruleset can be made', async () => {
    mockSchemas.mockResolvedValue({ schemas: [] })
    renderView()
    await waitFor(() => expect(screen.getByText('New ruleset').closest('button')).toBeDisabled())
  })

  it('opens a ruleset and lists its entries', async () => {
    renderView()
    await userEvent.click(await screen.findByText('Strahd house rules'))
    expect(await screen.findByText('Hellfire')).toBeInTheDocument()
  })

  it('shows a read-only ruleset without editing controls', async () => {
    mockEntries.mockResolvedValue({
      entries: [
        {
          id: 'e2',
          content_type: 'spell',
          entry_id: 'fireball',
          name: 'Fireball',
          editable: false,
        },
      ],
    })
    renderView()
    await userEvent.click(await screen.findByText('D&D 5e SRD'))
    expect(await screen.findByText(/Read only/i)).toBeInTheDocument()
    expect(screen.queryByText('New entry')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Edit')).not.toBeInTheDocument()
  })

  it('renders a ruleset’s attribution verbatim', async () => {
    renderView()
    await userEvent.click(await screen.findByText('D&D 5e SRD'))
    expect(
      await screen.findByText(/Includes material from the SRD 5\.2, CC BY 4\.0\./)
    ).toBeInTheDocument()
  })

  it('offers an installed content pack for import', async () => {
    mockInstallable.mockResolvedValue({
      packs: [{ pack_id: 'dnd-5e-srd', name: 'D&D 5e SRD 5.2', entry_count: 109 }],
    })
    mockImport.mockResolvedValue({ imported: 109, skipped: 0, renamed: 0, overwritten: 0 })
    vi.spyOn(window, 'alert').mockImplementation(() => {})

    renderView()
    await userEvent.click(await screen.findByText('Strahd house rules'))
    await userEvent.click(await screen.findByText(/Import D&D 5e SRD 5\.2/))
    await waitFor(() => expect(mockImport).toHaveBeenCalledWith('r1', { pack_id: 'dnd-5e-srd' }))
  })

  it('deletes an entry after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockRemoveEntry.mockResolvedValue({})
    renderView()
    await userEvent.click(await screen.findByText('Strahd house rules'))
    await userEvent.click(await screen.findByLabelText('Delete entry'))
    await waitFor(() => expect(mockRemoveEntry).toHaveBeenCalledWith('r1', 'e1'))
  })

  it('deletes a ruleset after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockRemove.mockResolvedValue({})
    renderView()
    await userEvent.click(await screen.findByText('Strahd house rules'))
    await userEvent.click(await screen.findByText('Delete ruleset'))
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('r1'))
  })

  it('backs out of an opened ruleset to the list', async () => {
    renderView()
    await userEvent.click(await screen.findByText('Strahd house rules'))
    await screen.findByText('Hellfire')
    await userEvent.click(screen.getByLabelText('Back'))
    // The list, not the page: the panel is embedded and draws no page chrome.
    expect(await screen.findByText('New ruleset')).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    mockList.mockResolvedValue({ rulesets: [] })
    renderView()
    expect(await screen.findByText(/No rulesets yet/i)).toBeInTheDocument()
  })

  it('surfaces a load failure', async () => {
    mockList.mockRejectedValue(new Error('boom'))
    renderView()
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })
})

describe('RulesetsPanel — importing a document', () => {
  it('pastes a ruleset into a chosen ruleset', async () => {
    mockImport.mockResolvedValue({
      imported: 2,
      skipped: 0,
      renamed: 0,
      overwritten: 0,
      failed: [],
    })
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    renderView()
    await screen.findByText('Strahd house rules')

    await userEvent.click(screen.getByText('Import a document'))
    await userEvent.selectOptions(screen.getByLabelText('Import into'), 'r1')
    await userEvent.type(screen.getByLabelText(/Ruleset \(JSON or YAML\)/i), 'entries: {{}')
    await userEvent.click(screen.getByText('Import'))

    // Sent as text so the server reads JSON or YAML with one parser.
    await waitFor(() =>
      expect(mockImport).toHaveBeenCalledWith('r1', { text: 'entries: {}', conflict: 'skip' })
    )
  })

  it('only offers rulesets the user may edit', async () => {
    renderView()
    await screen.findByText('Strahd house rules')
    await userEvent.click(screen.getByText('Import a document'))

    const options = [...screen.getByLabelText('Import into').querySelectorAll('option')].map(
      (option) => option.value
    )
    // The server ruleset is read-only for this user, so importing into it would
    // only fail at the API.
    expect(options).toContain('r1')
    expect(options).not.toContain('r2')
  })

  it('passes the chosen conflict rule through', async () => {
    mockImport.mockResolvedValue({
      imported: 0,
      skipped: 0,
      renamed: 1,
      overwritten: 0,
      failed: [],
    })
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    renderView()
    await screen.findByText('Strahd house rules')

    await userEvent.click(screen.getByText('Import a document'))
    await userEvent.selectOptions(screen.getByLabelText('Import into'), 'r1')
    await userEvent.selectOptions(screen.getByLabelText(/If it already exists/i), 'rename')
    await userEvent.type(screen.getByLabelText(/Ruleset \(JSON or YAML\)/i), 'entries: {{}')
    await userEvent.click(screen.getByText('Import'))

    await waitFor(() =>
      expect(mockImport).toHaveBeenCalledWith('r1', { text: 'entries: {}', conflict: 'rename' })
    )
  })

  it('reports a parse failure from the server', async () => {
    mockImport.mockRejectedValue(new Error('That ruleset is not valid JSON or YAML'))
    renderView()
    await screen.findByText('Strahd house rules')

    await userEvent.click(screen.getByText('Import a document'))
    await userEvent.selectOptions(screen.getByLabelText('Import into'), 'r1')
    await userEvent.type(screen.getByLabelText(/Ruleset \(JSON or YAML\)/i), 'nope')
    await userEvent.click(screen.getByText('Import'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid JSON or YAML/i)
  })

  it('cannot import with nothing to import into', async () => {
    mockList.mockResolvedValue({ rulesets: [SERVER] })
    renderView()
    await screen.findByText('D&D 5e SRD')
    // Nothing editable, so the action is disabled rather than failing later.
    expect(screen.getByText('Import a document').closest('button')).toBeDisabled()
  })
})

describe('RulesetsPanel — browsing content packs', () => {
  it('opens the pack catalogue from the list', async () => {
    // The gap this closes: the SRD was published in the community repo with no
    // way to reach a server, so "browse rulesets" had nothing behind it.
    mockBrowsePacks.mockResolvedValue({
      packs: [
        {
          id: 'srd-abc',
          pack_id: 'dnd-5e-srd',
          name: 'D&D 5e SRD 5.2',
          entry_count: 109,
          content_types: ['spell'],
          installed: false,
        },
      ],
      sources: [],
      errors: [],
      can_install: true,
    })
    renderView()
    await screen.findByText('Strahd house rules')

    await userEvent.click(screen.getByText('Browse content packs'))
    expect(await screen.findByText('D&D 5e SRD 5.2')).toBeInTheDocument()
  })

  it('is reachable without any ruleset existing yet', async () => {
    // Otherwise getting started is circular: you need a pack to fill a ruleset,
    // and the only way to a pack was through a ruleset.
    mockList.mockResolvedValue({ rulesets: [] })
    renderView()
    await screen.findByText(/No rulesets yet/i)
    expect(screen.getByText('Browse content packs').closest('button')).not.toBeDisabled()
  })
})
