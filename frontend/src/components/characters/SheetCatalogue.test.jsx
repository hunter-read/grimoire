import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SheetCatalogue from './SheetCatalogue'

const mockBrowse = vi.fn()
const mockInstall = vi.fn()
vi.mock('../../api', () => ({
  characters: {
    browseSheets: (...a) => mockBrowse(...a),
    installSheet: (...a) => mockInstall(...a),
  },
}))

const CAIRN = {
  id: 'cairn',
  name: 'Cairn',
  version: '1.0.0',
  system: 'Cairn',
  description: 'A rules-light dark-fantasy sheet.',
  author: 'hunter-read',
  author_url: 'https://github.com/hunter-read',
  license: 'CC-BY-SA-4.0',
  license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  attribution: 'Cairn is © Yochai Gal, licensed under CC BY-SA 4.0.',
  custom_layout: false,
  field_count: 12,
  index_url: 'https://example.test/main/character-sheets/index.json',
  installed: false,
}
CAIRN.raw_id = 'cairn'

const DND = {
  ...CAIRN,
  id: 'dnd-5e-2024',
  name: 'D&D 5e (2024)',
  system: 'Dungeons & Dragons',
  description: 'The 2024 revision.',
  attribution: 'Includes material from the SRD 5.2, CC BY 4.0.',
  custom_layout: true,
  installed: true,
}

const renderCatalogue = (props = {}) => render(<SheetCatalogue onClose={vi.fn()} {...props} />)

beforeEach(() => {
  vi.clearAllMocks()
  mockBrowse.mockResolvedValue({
    sheets: [CAIRN, DND],
    index_url: 'https://example.test/main/character-sheets/index.json',
    sources: ['https://example.test/main/character-sheets/index.json'],
    errors: [],
    downloads_enabled: true,
  })
})

describe('SheetCatalogue', () => {
  it('lists the sheets the catalogue offers', async () => {
    renderCatalogue()
    expect(await screen.findByText('Cairn')).toBeInTheDocument()
    expect(screen.getByText('D&D 5e (2024)')).toBeInTheDocument()
  })

  it('marks a sheet already installed and offers no install button for it', async () => {
    renderCatalogue()
    await screen.findByText('Cairn')
    expect(screen.getByText('Installed')).toBeInTheDocument()
    // One installable row, not two.
    expect(screen.getAllByText('Install')).toHaveLength(1)
  })

  it('renders the attribution verbatim before installing', async () => {
    // Several open licences mandate exact wording, and it should be readable
    // before you take a copy.
    renderCatalogue()
    expect(
      await screen.findByText(/Cairn is © Yochai Gal, licensed under CC BY-SA 4\.0\./)
    ).toBeInTheDocument()
  })

  it('links the licence and credits the author', async () => {
    renderCatalogue()
    await screen.findByText('Cairn')
    const licence = screen.getAllByRole('link', { name: /CC-BY-SA-4.0/ })[0]
    expect(licence).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/')
    expect(licence).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.getAllByText(/hunter-read/).length).toBeGreaterThan(0)
  })

  it('flags a custom layout', async () => {
    renderCatalogue()
    await screen.findByText('D&D 5e (2024)')
    expect(screen.getByText(/custom layout/)).toBeInTheDocument()
  })

  it('installs a sheet and tells the caller', async () => {
    mockInstall.mockResolvedValue({ schema_id: 'cairn' })
    const onInstalled = vi.fn()
    renderCatalogue({ onInstalled })
    await screen.findByText('Cairn')

    await userEvent.click(screen.getByText('Install'))
    await waitFor(() => expect(mockInstall).toHaveBeenCalledWith('cairn'))
    expect(onInstalled).toHaveBeenCalled()
    // The row flips without a refetch.
    await waitFor(() => expect(screen.getAllByText('Installed')).toHaveLength(2))
  })

  it('surfaces an install failure', async () => {
    mockInstall.mockRejectedValue(new Error('integrity check failed'))
    renderCatalogue()
    await screen.findByText('Cairn')
    await userEvent.click(screen.getByText('Install'))
    expect(await screen.findByRole('alert')).toHaveTextContent('integrity check failed')
  })

  it('filters by name, system or description', async () => {
    renderCatalogue()
    await screen.findByText('Cairn')
    await userEvent.type(screen.getByLabelText(/Search the catalogue/i), 'dungeons')
    expect(screen.getByText('D&D 5e (2024)')).toBeInTheDocument()
    expect(screen.queryByText('Cairn')).not.toBeInTheDocument()
  })

  it('shows which catalogue the sheets came from', async () => {
    // So it is obvious when the server is pointed at a branch.
    renderCatalogue()
    expect(
      await screen.findByText(/example\.test\/main\/character-sheets\/index\.json/)
    ).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    mockBrowse.mockResolvedValue({ sheets: [], index_url: '', sources: [], errors: [] })
    renderCatalogue()
    expect(await screen.findByText(/No sheets found/i)).toBeInTheDocument()
  })

  it('surfaces an unreachable catalogue', async () => {
    mockBrowse.mockRejectedValue(new Error('catalogue is down'))
    renderCatalogue()
    expect(await screen.findByRole('alert')).toHaveTextContent('catalogue is down')
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    renderCatalogue({ onClose })
    await screen.findByText('Cairn')
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  describe('several sources at once', () => {
    const FROM_A = {
      ...CAIRN,
      id: 'cairn-aaaa1111',
      raw_id: 'cairn',
      name: 'Cairn',
      index_url: 'https://a.test/character-sheets/index.json',
    }
    const FROM_B = {
      ...CAIRN,
      id: 'cairn-bbbb2222',
      raw_id: 'cairn',
      name: 'Cairn',
      index_url: 'https://b.test/character-sheets/index.json',
    }

    it('names each sheet’s source when more than one is configured', async () => {
      mockBrowse.mockResolvedValue({
        sheets: [FROM_A, FROM_B],
        sources: [FROM_A.index_url, FROM_B.index_url],
        errors: [],
      })
      renderCatalogue()
      await screen.findAllByText('Cairn')
      // Two sheets with the same name, told apart by host.
      expect(screen.getByText(/a\.test/)).toBeInTheDocument()
      expect(screen.getByText(/b\.test/)).toBeInTheDocument()
    })

    it('installs the copy that was chosen, by its namespaced id', async () => {
      mockInstall.mockResolvedValue({})
      mockBrowse.mockResolvedValue({
        sheets: [FROM_A, FROM_B],
        sources: [FROM_A.index_url, FROM_B.index_url],
        errors: [],
      })
      renderCatalogue()
      await screen.findAllByText('Cairn')
      await userEvent.click(screen.getAllByText('Install')[1])
      await waitFor(() => expect(mockInstall).toHaveBeenCalledWith('cairn-bbbb2222'))
    })

    it('reports a source it could not read', async () => {
      mockBrowse.mockResolvedValue({
        sheets: [FROM_A],
        sources: [FROM_A.index_url, 'https://down.test/character-sheets/index.json'],
        errors: [
          { url: 'https://down.test/character-sheets/index.json', error: 'connection refused' },
        ],
      })
      renderCatalogue()
      // The sheets that loaded are still listed.
      expect(await screen.findByText('Cairn')).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent(/down\.test/)
    })

    it('summarises the footer when several catalogues were read', async () => {
      mockBrowse.mockResolvedValue({
        sheets: [FROM_A, FROM_B],
        sources: [FROM_A.index_url, FROM_B.index_url],
        errors: [],
      })
      renderCatalogue()
      await screen.findAllByText('Cairn')
      expect(screen.getByText(/From 2 catalogues/i)).toBeInTheDocument()
    })
  })
})
