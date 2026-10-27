import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PackCatalogue from './PackCatalogue'

const mockBrowse = vi.fn()
const mockInstall = vi.fn()
const mockUninstall = vi.fn()

vi.mock('../../api', () => ({
  rulesets: {
    browsePacks: (...a) => mockBrowse(...a),
    installPack: (...a) => mockInstall(...a),
    uninstallPack: (...a) => mockUninstall(...a),
  },
}))

const PACK = {
  id: 'dnd-5e-srd-abc12345',
  pack_id: 'dnd-5e-srd',
  schema_id: 'dnd-5e-2024',
  name: 'D&D 5e SRD 5.2',
  version: '1.0.0',
  description: 'Classes, species, backgrounds and spells.',
  license: 'CC-BY-4.0',
  license_url: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: 'Includes material from the SRD 5.2, CC BY 4.0.',
  entry_count: 109,
  content_types: ['class', 'spell'],
  installed: false,
}

const renderCatalogue = (props = {}) =>
  render(<PackCatalogue onInstalled={vi.fn()} onClose={vi.fn()} {...props} />)

beforeEach(() => {
  vi.clearAllMocks()
  mockBrowse.mockResolvedValue({
    packs: [PACK],
    sources: ['https://example.test/content-packs/index.json'],
    errors: [],
    can_install: true,
  })
  mockInstall.mockResolvedValue({ pack_id: 'dnd-5e-srd', entry_count: 109 })
})

describe('PackCatalogue', () => {
  it('lists a pack with what is in it', async () => {
    renderCatalogue()
    expect(await screen.findByText('D&D 5e SRD 5.2')).toBeInTheDocument()
    expect(screen.getByText(/109 entries/i)).toBeInTheDocument()
    // What kinds of content, so the entry count is not the only signal.
    expect(screen.getByText('class · spell')).toBeInTheDocument()
  })

  it('shows the licence and its credit before installing', async () => {
    renderCatalogue()
    await screen.findByText('D&D 5e SRD 5.2')
    // Rendered verbatim - several open licences mandate the exact wording.
    expect(screen.getByText('Includes material from the SRD 5.2, CC BY 4.0.')).toBeInTheDocument()
    expect(screen.getByText('CC-BY-4.0').closest('a')).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/'
    )
  })

  it('installs a pack by its namespaced id', async () => {
    const onInstalled = vi.fn()
    renderCatalogue({ onInstalled })
    await screen.findByText('D&D 5e SRD 5.2')
    await userEvent.click(screen.getByText('Install'))

    // The namespaced id, so two catalogues offering the same pack stay distinct.
    await waitFor(() => expect(mockInstall).toHaveBeenCalledWith('dnd-5e-srd-abc12345'))
    expect(onInstalled).toHaveBeenCalled()
    expect(await screen.findByText('Installed v1.0.0')).toBeInTheDocument()
  })

  it('marks a pack that is already installed', async () => {
    mockBrowse.mockResolvedValue({ packs: [{ ...PACK, installed: true }], can_install: true })
    renderCatalogue()
    expect(await screen.findByText('Installed')).toBeInTheDocument()
    expect(screen.queryByText('Install')).not.toBeInTheDocument()
  })

  it('withholds the install button from a non-admin and says why', async () => {
    // A GM should still see what the pack offers, so the dialog opens either way.
    mockBrowse.mockResolvedValue({ packs: [PACK], can_install: false })
    renderCatalogue()
    expect(await screen.findByText('D&D 5e SRD 5.2')).toBeInTheDocument()
    expect(screen.queryByText('Install')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/Only an admin/i)
  })

  it('filters by name, system and description', async () => {
    mockBrowse.mockResolvedValue({
      packs: [PACK, { ...PACK, id: 'other', pack_id: 'other', name: 'Cairn Content' }],
      can_install: true,
    })
    renderCatalogue()
    await screen.findByText('Cairn Content')
    await userEvent.type(screen.getByLabelText(/Search content packs/i), 'cairn')
    expect(screen.queryByText('D&D 5e SRD 5.2')).not.toBeInTheDocument()
    expect(screen.getByText('Cairn Content')).toBeInTheDocument()
  })

  it('reports a source it could not read rather than showing a short list', async () => {
    mockBrowse.mockResolvedValue({
      packs: [],
      can_install: true,
      errors: [{ url: 'https://down.test/content-packs/index.json', error: '404' }],
    })
    renderCatalogue()
    expect(await screen.findByLabelText(/Catalog(ue)? problems/i)).toBeInTheDocument()
  })

  it('surfaces an install failure', async () => {
    mockInstall.mockRejectedValue(new Error('That pack failed its integrity check'))
    renderCatalogue()
    await screen.findByText('D&D 5e SRD 5.2')
    await userEvent.click(screen.getByText('Install'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/integrity check/i)
  })

  it('shows an empty state when nothing is offered', async () => {
    mockBrowse.mockResolvedValue({ packs: [], can_install: true, errors: [] })
    renderCatalogue()
    expect(await screen.findByText(/No content packs found/i)).toBeInTheDocument()
  })

  it('closes on Escape and on the close button', async () => {
    const onClose = vi.fn()
    const { unmount } = renderCatalogue({ onClose })
    await screen.findByText('D&D 5e SRD 5.2')
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    unmount()

    const onClose2 = vi.fn()
    renderCatalogue({ onClose: onClose2 })
    await screen.findByText('D&D 5e SRD 5.2')
    await userEvent.click(screen.getByLabelText('Close'))
    expect(onClose2).toHaveBeenCalled()
  })
})

describe('PackCatalogue — an installed pack', () => {
  const installed = (extra = {}) =>
    mockBrowse.mockResolvedValue({
      packs: [{ ...PACK, installed: true, installed_version: '1.0.0', ...extra }],
      can_install: true,
    })

  it('can be reinstalled', async () => {
    // Why this exists: an installed pack used to have no button at all, so
    // there was no way to replace it short of deleting it from disk.
    installed()
    renderCatalogue()
    await userEvent.click(await screen.findByText('Reinstall'))
    await waitFor(() => expect(mockInstall).toHaveBeenCalledWith('dnd-5e-srd-abc12345'))
  })

  it('offers a newer version as an update', async () => {
    installed({ version: '1.1.0', update_available: true })
    renderCatalogue()
    await userEvent.click(await screen.findByText('Update to v1.1.0'))
    await waitFor(() => expect(mockInstall).toHaveBeenCalled())
    expect(await screen.findByText('Installed v1.1.0')).toBeInTheDocument()
  })

  it('can be uninstalled after confirming, and is then offered again', async () => {
    installed()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockUninstall.mockResolvedValue({ deleted: true })
    renderCatalogue()
    await userEvent.click(await screen.findByLabelText('Uninstall D&D 5e SRD 5.2'))
    await waitFor(() => expect(mockUninstall).toHaveBeenCalledWith('dnd-5e-srd'))
    expect(await screen.findByText('Install')).toBeInTheDocument()
  })

  it('stays installed when the confirmation is declined', async () => {
    installed()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderCatalogue()
    await userEvent.click(await screen.findByLabelText('Uninstall D&D 5e SRD 5.2'))
    expect(mockUninstall).not.toHaveBeenCalled()
  })

  it('surfaces an uninstall failure', async () => {
    installed()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockUninstall.mockRejectedValue(new Error('Only an admin can uninstall a content pack'))
    renderCatalogue()
    await userEvent.click(await screen.findByLabelText('Uninstall D&D 5e SRD 5.2'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Only an admin/)
  })

  it('offers a non-admin neither', async () => {
    mockBrowse.mockResolvedValue({
      packs: [{ ...PACK, installed: true, installed_version: '1.0.0' }],
      can_install: false,
    })
    renderCatalogue()
    await screen.findByText('Installed v1.0.0')
    expect(screen.queryByText('Reinstall')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Uninstall/)).not.toBeInTheDocument()
  })
})
