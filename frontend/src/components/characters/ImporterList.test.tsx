import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImporterList from './ImporterList'
import type { ImporterListProps } from './ImporterList'

const mockInstall = vi.fn()
const mockRemove = vi.fn()
const mockInstallForEveryone = vi.fn()

vi.mock('../../api', () => ({
  characters: {
    installImporter: (...a: unknown[]) => mockInstall(...a),
    removeImporter: (...a: unknown[]) => mockRemove(...a),
    installImporterForEveryone: (...a: unknown[]) => mockInstallForEveryone(...a),
  },
}))

const MINE = {
  id: 'pathbuilder-2e',
  name: 'Pathbuilder 2e',
  description: '',
  homepage: '',
  attribution: '',
  sheet: 'pathfinder-2e',
  sheet_name: 'Pathfinder 2e',
  sheet_installed: true,
  extensions: [],
  accepts_files: true,
  accepts_url: false,
  inputs: [],
  scope: 'user',
  available_version: '',
}
const SERVERS = { ...MINE, id: 'forge-steel', name: 'Forge Steel', scope: 'server' }
const offer = (id: string, installAs: string, extra = {}) => ({
  id,
  name: `${id} importer`,
  description: `Reads ${id}.`,
  homepage: '',
  version: '1.0.0',
  sheet: 'dnd-5e-2024',
  sheet_name: '',
  install_as: installAs,
  index_url: 'https://i.test/index.json',
  ...extra,
})

const openList = (count: number) =>
  userEvent.click(screen.getByRole('button', { name: `Installed importers (${count})` }))

function renderList(listing: object | null) {
  const onChanged = vi.fn(() => Promise.resolve())
  render(<ImporterList listing={listing as ImporterListProps['listing']} onChanged={onChanged} />)
  return { onChanged }
}

describe('ImporterList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockInstall.mockResolvedValue({})
    mockRemove.mockResolvedValue({})
    mockInstallForEveryone.mockResolvedValue({})
  })

  it('waits for the listing', () => {
    const { container } = render(<ImporterList listing={null} onChanged={vi.fn()} />)
    expect(container.querySelector('svg, div')).toBeTruthy()
    expect(screen.queryByText('Installed importers')).toBeNull()
  })

  it('marks your own importers and lets you remove them, not the server ones', async () => {
    const { onChanged } = renderList({ importers: [SERVERS, MINE], available: [] })
    await openList(2)
    expect(screen.getByText(/builds on Pathfinder 2e · installed for you/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Forge Steel' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Pathbuilder 2e' }))
    expect(mockRemove).toHaveBeenCalledWith('pathbuilder-2e')
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('starts closed, counts what is installed, and remembers being opened', async () => {
    renderList({ importers: [SERVERS, MINE], available: [] })
    expect(screen.queryByText('Forge Steel')).toBeNull()
    await openList(2)
    expect(screen.getByText('Forge Steel')).toBeInTheDocument()
    expect(localStorage.getItem('grimoire:characters:importers-open')).toBe('1')
  })

  it('opens itself when one of your importers has an update', () => {
    renderList({ importers: [{ ...MINE, available_version: '1.2.0' }], available: [] })
    expect(screen.getByRole('button', { name: 'Installed importers (1)' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('never hides that nothing is installed', () => {
    renderList({ importers: [], available: [] })
    expect(screen.getByText(/None installed yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Installed importers/ })).toBeNull()
  })

  it("expands an importer's details, with its links as working links", async () => {
    const linked = {
      ...SERVERS,
      id: 'dndbeyond',
      name: 'D&D Beyond',
      description: 'D&D 5e characters from D&D Beyond.',
      attribution: 'D&D Beyond (dndbeyond.com).',
      homepage: 'https://www.dndbeyond.com',
      accepts_url: true,
      url_hint: 'https://www.dndbeyond.com/characters/93643159',
    }
    renderList({ importers: [linked], available: [] })
    await openList(1)
    const row = screen.getByRole('button', { name: /^D&D Beyond/ })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('D&D 5e characters from D&D Beyond.')).toBeNull()

    await userEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('D&D 5e characters from D&D Beyond.')).toBeInTheDocument()
    expect(screen.getByText('D&D Beyond (dndbeyond.com).')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'https://www.dndbeyond.com/characters/93643159' })
    ).toHaveAttribute('href', 'https://www.dndbeyond.com/characters/93643159')
    expect(screen.getByRole('link', { name: 'https://www.dndbeyond.com' })).toHaveAttribute(
      'href',
      'https://www.dndbeyond.com'
    )
  })

  it("never turns a manifest's non-web address into a link", async () => {
    const shady = {
      ...SERVERS,
      homepage: 'javascript:alert(1)',
      accepts_url: true,
      url_hint: 'ftp://example.com/c/1',
    }
    renderList({
      importers: [shady],
      available: [{ ...offer('other', 'user'), homepage: 'javascript:alert(2)' }],
    })
    await openList(1)
    await userEvent.click(screen.getByRole('button', { name: /^Forge Steel/ }))
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByText('other importer')).toBeInTheDocument()
  })

  it('offers an update to your own copy', async () => {
    renderList({ importers: [{ ...MINE, available_version: '1.2.0' }], available: [] })
    await userEvent.click(screen.getByRole('button', { name: 'Update to v1.2.0' }))
    expect(mockInstall).toHaveBeenCalledWith('pathbuilder-2e')
  })

  it('offers each missing importer the way the caller can get it', async () => {
    const { onChanged } = renderList({
      importers: [],
      available: [
        offer('mine', 'user'),
        offer('everyone', 'server'),
        offer('scripted', 'settings'),
        offer('locked', 'admin'),
      ],
    })
    expect(screen.getByText(/None installed yet/)).toBeInTheDocument()
    expect(screen.getByText('More importers')).toBeInTheDocument()
    expect(screen.getAllByText(/v1.0.0 · builds on dnd-5e-2024/)).toHaveLength(4)

    await userEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(mockInstall).toHaveBeenCalledWith('mine')
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('button', { name: 'Install for everyone' }))
    expect(mockInstallForEveryone).toHaveBeenCalledWith('everyone', 'https://i.test/index.json')

    expect(screen.getByRole('link', { name: 'Install in Settings → Add-ons' })).toHaveAttribute(
      'href',
      '/settings/addons'
    )
    expect(screen.getByText('Ask an admin to install this')).toBeInTheDocument()
  })

  it('shows why an install failed', async () => {
    mockInstall.mockRejectedValue(new Error("'mine' fetches links or runs a script"))
    renderList({ importers: [], available: [offer('mine', 'user')] })
    await userEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('runs a script')
  })

  it('offers nothing to install when installs are switched off', () => {
    renderList({
      importers: [{ ...MINE, available_version: '1.2.0' }],
      available: [offer('mine-too', 'user')],
      downloads_enabled: false,
    })
    expect(screen.getByText(/turned off on this server/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Update to/ })).toBeNull()
  })
})
