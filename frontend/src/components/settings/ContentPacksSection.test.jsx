import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ContentPacksSection from './ContentPacksSection'

const mockPacks = vi.fn()
const mockReload = vi.fn()
const mockUninstall = vi.fn()
vi.mock('../../api', () => ({
  content: { packs: (...a) => mockPacks(...a) },
  contentAdmin: { reloadPacks: (...a) => mockReload(...a) },
  rulesets: { uninstallPack: (...a) => mockUninstall(...a) },
}))

const PACK = {
  pack_id: 'dnd-5e-srd',
  schema_id: 'dnd-5e',
  name: 'D&D 5e SRD',
  version: '1.0.0',
  description: 'The open content.',
  license: 'CC-BY-4.0',
  license_url: 'https://example.com/licence',
  attribution: 'SRD 5.2 © Wizards, CC BY 4.0.',
  entry_count: 320,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPacks.mockResolvedValue({ packs: [PACK] })
})

describe('ContentPacksSection', () => {
  it('lists installed packs with their versions and counts', async () => {
    render(<ContentPacksSection />)
    expect(await screen.findByText('D&D 5e SRD')).toBeInTheDocument()
    expect(screen.getByText(/320 entries/)).toBeInTheDocument()
  })

  it('renders the attribution verbatim', async () => {
    // Several open licences mandate exact wording, so this must not be
    // paraphrased or truncated.
    render(<ContentPacksSection />)
    expect(await screen.findByText(/SRD 5\.2 © Wizards, CC BY 4\.0\./)).toBeInTheDocument()
  })

  it('links to the licence', async () => {
    render(<ContentPacksSection />)
    const link = await screen.findByRole('link', { name: /CC-BY-4.0/ })
    expect(link).toHaveAttribute('href', 'https://example.com/licence')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('reloads from disk', async () => {
    mockReload.mockResolvedValue({ packs: [{ ...PACK, entry_count: 400 }] })
    render(<ContentPacksSection />)
    await screen.findByText('D&D 5e SRD')
    await userEvent.click(screen.getByText(/Reload from disk/i))
    await waitFor(() => expect(mockReload).toHaveBeenCalled())
    expect(await screen.findByText(/400 entries/)).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    mockPacks.mockResolvedValue({ packs: [] })
    render(<ContentPacksSection />)
    expect(await screen.findByText(/No content packs installed/i)).toBeInTheDocument()
  })

  it('surfaces a load failure', async () => {
    mockPacks.mockRejectedValue(new Error('packs broke'))
    render(<ContentPacksSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('packs broke')
  })

  it('surfaces a reload failure', async () => {
    mockReload.mockRejectedValue(new Error('reload broke'))
    render(<ContentPacksSection />)
    await screen.findByText('D&D 5e SRD')
    await userEvent.click(screen.getByText(/Reload from disk/i))
    expect(await screen.findByRole('alert')).toHaveTextContent('reload broke')
  })
})

describe('ContentPacksSection — uninstalling', () => {
  it('removes a pack after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockUninstall.mockResolvedValue({ deleted: true })
    render(<ContentPacksSection />)
    await userEvent.click(await screen.findByLabelText('Uninstall D&D 5e SRD'))
    await waitFor(() => expect(mockUninstall).toHaveBeenCalledWith('dnd-5e-srd'))
    expect(screen.queryByText('D&D 5e SRD')).not.toBeInTheDocument()
  })

  it('keeps it when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ContentPacksSection />)
    await userEvent.click(await screen.findByLabelText('Uninstall D&D 5e SRD'))
    expect(mockUninstall).not.toHaveBeenCalled()
    expect(screen.getByText('D&D 5e SRD')).toBeInTheDocument()
  })

  it('surfaces a failure', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockUninstall.mockRejectedValue(new Error('Only an admin can uninstall a content pack'))
    render(<ContentPacksSection />)
    await userEvent.click(await screen.findByLabelText('Uninstall D&D 5e SRD'))
    expect(await screen.findByText(/Only an admin/)).toBeInTheDocument()
  })
})
