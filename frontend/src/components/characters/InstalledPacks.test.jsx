import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InstalledPacks from './InstalledPacks'

const mockPacks = vi.fn()
const mockUninstall = vi.fn()
const mockBrowsePacks = vi.fn()
let mockUser = { role: 'admin' }
vi.mock('../../api', () => ({
  content: { packs: (...a) => mockPacks(...a) },
  rulesets: {
    uninstallPack: (...a) => mockUninstall(...a),
    browsePacks: (...a) => mockBrowsePacks(...a),
    installPack: vi.fn(),
  },
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }))

const SRD = {
  pack_id: 'dnd-5e-srd',
  schema_id: 'dnd-5e-2024',
  name: 'D&D 5e SRD 5.2',
  version: '1.0.0',
  license: 'CC-BY-4.0',
  entry_count: 1200,
}

const SCHEMAS = [{ schema_id: 'dnd-5e-2024', name: 'D&D 5th Edition (2024)' }]

const renderPacks = (props = {}) =>
  render(<InstalledPacks schemas={SCHEMAS} onChanged={vi.fn()} {...props} />)

beforeEach(() => {
  vi.clearAllMocks()
  mockUser = { role: 'admin' }
  mockPacks.mockResolvedValue({ packs: [SRD] })
  mockUninstall.mockResolvedValue({})
  mockBrowsePacks.mockResolvedValue({ packs: [], sources: [], errors: [], can_install: true })
})

describe('InstalledPacks', () => {
  it('lists each installed pack with the sheet it is for', async () => {
    renderPacks()
    expect(await screen.findByText('D&D 5e SRD 5.2')).toBeInTheDocument()
    expect(
      screen.getByText(/For D&D 5th Edition \(2024\) · v1\.0\.0 · 1200 entries · CC-BY-4\.0/)
    ).toBeInTheDocument()
  })

  it('falls back to the sheet id when that sheet is not installed', async () => {
    renderPacks({ schemas: [] })
    expect(await screen.findByText(/For dnd-5e-2024/)).toBeInTheDocument()
  })

  it('says so plainly when nothing is installed', async () => {
    mockPacks.mockResolvedValue({ packs: [] })
    renderPacks()
    expect(await screen.findByText(/No content packs installed yet/)).toBeInTheDocument()
    // Getting started must not be circular: browsing is there with nothing installed.
    expect(screen.getByRole('button', { name: /Browse content packs/ })).toBeEnabled()
  })

  it('lets an admin uninstall a pack after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onChanged = vi.fn()
    renderPacks({ onChanged })
    await userEvent.click(await screen.findByRole('button', { name: 'Uninstall D&D 5e SRD 5.2' }))
    expect(mockUninstall).toHaveBeenCalledWith('dnd-5e-srd')
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('keeps a pack when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPacks()
    await userEvent.click(await screen.findByRole('button', { name: 'Uninstall D&D 5e SRD 5.2' }))
    expect(mockUninstall).not.toHaveBeenCalled()
  })

  it('offers no uninstall to someone who is not an admin', async () => {
    mockUser = { role: 'gm' }
    renderPacks()
    await screen.findByText('D&D 5e SRD 5.2')
    expect(screen.queryByRole('button', { name: /Uninstall/ })).not.toBeInTheDocument()
  })

  it('surfaces a failure to list the packs', async () => {
    mockPacks.mockRejectedValue(new Error('server down'))
    renderPacks()
    expect(await screen.findByRole('alert')).toHaveTextContent('server down')
  })

  it('surfaces a failure to uninstall', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockUninstall.mockRejectedValue(new Error('not allowed'))
    renderPacks()
    await userEvent.click(await screen.findByRole('button', { name: 'Uninstall D&D 5e SRD 5.2' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not allowed')
  })

  it('opens the pack catalogue', async () => {
    mockBrowsePacks.mockResolvedValue({
      packs: [
        {
          id: 'pf2-abc',
          pack_id: 'pf2e-player-core',
          name: 'Pathfinder Player Core',
          entry_count: 900,
          content_types: ['feat'],
          installed: false,
        },
      ],
      sources: [],
      errors: [],
      can_install: true,
    })
    renderPacks()
    await screen.findByText('D&D 5e SRD 5.2')
    await userEvent.click(screen.getByRole('button', { name: /Browse content packs/ }))
    expect(await screen.findByText('Pathfinder Player Core')).toBeInTheDocument()
    expect(mockPacks).toHaveBeenCalledTimes(1)
  })
})
