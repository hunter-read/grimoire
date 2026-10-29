import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddonsSection from './AddonsSection'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { name?: string; names?: string }) =>
      opts?.name ? `${k}:${opts.name}` : opts?.names ? `${k}:${opts.names}` : k,
  }),
}))

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const api = (await import('../../api')).default

const YAML_ADDON = {
  id: 'ttrpg-wiki',
  name: 'TTRPG Wiki',
  version: '1.0.0',
  description: 'System metadata.',
  requires_script: false,
  installed: false,
  update_available: false,
}

const SCRIPT_ADDON = {
  id: 'drivethru',
  name: 'DriveThruRPG',
  version: '0.2.0',
  description: 'Product data.',
  requires_script: true,
  script_sha256: 'a'.repeat(64),
  installed: false,
  update_available: false,
}

const INSTALLED = {
  id: 'ttrpg-wiki',
  name: 'TTRPG Wiki',
  version: '1.0.0',
  description: 'System metadata.',
  requires_script: false,
  script_approved: false,
  enabled: true,
  runnable: true,
  blocked_reason: '',
  available_version: '',
  update_available: false,
}
const OUTDATED = { ...INSTALLED, available_version: '2.0.0', update_available: true }

// Test fixtures carry only the fields each case needs.
type Fixture = Record<string, unknown>

function mockState({
  installed = [],
  available = [],
  allow_scripts = false,
}: { installed?: Fixture[]; available?: Fixture[]; allow_scripts?: boolean } = {}) {
  vi.mocked(api.get).mockResolvedValue({
    installed,
    available,
    index_url: 'https://example.com/index.json',
    allow_scripts,
    index_generated: '',
  })
  vi.mocked(api.post).mockResolvedValue({ status: 'ok' })
  vi.mocked(api.patch).mockResolvedValue({ status: 'ok' })
  vi.mocked(api.delete).mockResolvedValue({ status: 'ok' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AddonsSection', () => {
  it('lists installed add-ons', async () => {
    mockState({ installed: [INSTALLED] })
    render(<AddonsSection />)
    expect(await screen.findByText('TTRPG Wiki')).toBeInTheDocument()
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
  })

  it('lists available add-ons that are not installed', async () => {
    mockState({ available: [YAML_ADDON] })
    render(<AddonsSection />)
    expect(await screen.findByText('TTRPG Wiki')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /addons.install/i })).toBeInTheDocument()
  })

  it('does not offer to install something already installed', async () => {
    mockState({ installed: [INSTALLED], available: [{ ...YAML_ADDON, installed: true }] })
    render(<AddonsSection />)
    await screen.findByText('TTRPG Wiki')
    expect(screen.queryByRole('button', { name: /addons.install/i })).not.toBeInTheDocument()
  })

  it('shows empty states', async () => {
    mockState()
    render(<AddonsSection />)
    // One per category: metadata scrapers and character importers.
    expect(await screen.findAllByText('addons.noneInstalled')).toHaveLength(2)
    expect(screen.getAllByText('addons.noneAvailable')).toHaveLength(2)
  })

  it('files character importers under their own heading', async () => {
    const importer = {
      ...YAML_ADDON,
      id: 'forge-steel',
      name: 'Forge Steel',
      kind: 'character-importer',
      target: 'character',
    }
    mockState({ available: [YAML_ADDON, importer] })
    render(<AddonsSection />)
    await screen.findByText('Forge Steel')
    expect(screen.getByText('addons.categories.importers')).toBeInTheDocument()
    const lists = screen.getAllByRole('list')
    const holding = (name: string) => lists.findIndex((list) => list.textContent.includes(name))
    expect(holding('Forge Steel')).toBeGreaterThan(holding('TTRPG Wiki'))
  })

  describe('where things are reported', () => {
    const IMPORTER = {
      ...YAML_ADDON,
      id: 'forge-steel',
      name: 'Forge Steel',
      kind: 'character-importer',
      target: 'character',
    }
    const after = (earlier: Node, later: Node) =>
      Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING)

    it('keeps refresh and the script switch above every category', async () => {
      mockState({ available: [YAML_ADDON, IMPORTER] })
      render(<AddonsSection />)
      const refresh = await screen.findByRole('button', { name: /addons.refresh/i })
      const scripts = screen.getByText('addons.allowScripts')
      const metadata = screen.getByText('addons.categories.metadata')
      expect(after(refresh, metadata)).toBe(true)
      expect(after(scripts, metadata)).toBe(true)
    })

    it("reports a character importer's failed install in the importers section", async () => {
      mockState({ available: [YAML_ADDON, IMPORTER] })
      vi.mocked(api.post).mockRejectedValue(new Error('Could not download forge-steel.yml'))
      const user = userEvent.setup()
      render(<AddonsSection />)
      await screen.findByText('Forge Steel')

      const list = screen.getAllByRole('list').find((l) => l.textContent.includes('Forge Steel'))
      await user.click(within(list!).getByRole('button', { name: /addons.install/i }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Could not download forge-steel.yml')
      expect(after(screen.getByText('addons.categories.importers'), alert)).toBe(true)
    })

    it("reports a scraper's failed install in the scrapers section", async () => {
      mockState({ available: [YAML_ADDON, IMPORTER] })
      vi.mocked(api.post).mockRejectedValue(new Error('Could not download ttrpg-wiki.yml'))
      const user = userEvent.setup()
      render(<AddonsSection />)
      await screen.findByText('TTRPG Wiki')

      const list = screen.getAllByRole('list').find((l) => l.textContent.includes('TTRPG Wiki'))
      await user.click(within(list!).getByRole('button', { name: /addons.install/i }))

      const alert = await screen.findByRole('alert')
      expect(after(screen.getByText('addons.categories.metadata'), alert)).toBe(true)
      expect(after(alert, screen.getByText('addons.categories.importers'))).toBe(true)
    })

    it('shows a partial refresh as done, with the sources it could not reach', async () => {
      mockState()
      vi.mocked(api.post).mockResolvedValue({
        errors: [{ url: 'https://x.example/index.json', error: '404' }],
      })
      const user = userEvent.setup()
      render(<AddonsSection />)
      await user.click(await screen.findByRole('button', { name: /addons.refresh/i }))

      expect(await screen.findByRole('status')).toHaveTextContent('addons.refreshed')
      expect(screen.getByRole('alert')).toHaveTextContent('https://x.example/index.json: 404')
      expect(after(screen.getByRole('alert'), screen.getByText('addons.categories.metadata'))).toBe(
        true
      )
    })
  })

  it('installs a YAML add-on directly, without a warning dialog', async () => {
    mockState({ available: [YAML_ADDON] })
    const user = userEvent.setup()
    render(<AddonsSection />)
    await screen.findByText('TTRPG Wiki')

    await user.click(screen.getByRole('button', { name: /addons.install/i }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/addons/ttrpg-wiki/install', {
        approve_script: false,
      })
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('flags add-ons that run code', async () => {
    mockState({ available: [SCRIPT_ADDON] })
    render(<AddonsSection />)
    expect(await screen.findByText('addons.runsCode')).toBeInTheDocument()
  })

  it('requires confirmation before installing a script-backed add-on', async () => {
    mockState({ available: [SCRIPT_ADDON] })
    const user = userEvent.setup()
    render(<AddonsSection />)
    await screen.findByText('DriveThruRPG')

    await user.click(screen.getByRole('button', { name: /addons.install/i }))

    // The dialog opens and nothing is installed yet.
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('records approval when a script install is confirmed', async () => {
    mockState({ available: [SCRIPT_ADDON] })
    const user = userEvent.setup()
    render(<AddonsSection />)
    await screen.findByText('DriveThruRPG')
    await user.click(screen.getByRole('button', { name: /addons.install/i }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: /^addons.install$/i }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/addons/drivethru/install', { approve_script: true })
    )
  })

  it('toggles an installed add-on', async () => {
    mockState({ installed: [INSTALLED] })
    const user = userEvent.setup()
    render(<AddonsSection />)
    await screen.findByText('TTRPG Wiki')

    await user.click(screen.getByLabelText('addons.enabled'))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/addons/ttrpg-wiki', { enabled: false })
    )
  })

  it('removes an installed add-on', async () => {
    mockState({ installed: [INSTALLED] })
    const user = userEvent.setup()
    render(<AddonsSection />)
    await screen.findByText('TTRPG Wiki')

    await user.click(screen.getByRole('button', { name: /addons.remove/i }))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/addons/ttrpg-wiki'))
  })

  it('saves the index URL and refreshes', async () => {
    mockState()
    const user = userEvent.setup()
    render(<AddonsSection />)

    await user.click(
      await screen.findByRole('button', { name: /(addons.configuredSources|addons.changeIndex)/i })
    )
    await screen.findByText('example.com')

    await user.click(screen.getByRole('button', { name: /addons.refresh/i }))
    expect(api.post).toHaveBeenCalledWith('/addons/refresh')
  })

  it('reports why a blocked add-on cannot run', async () => {
    mockState({
      installed: [
        {
          ...INSTALLED,
          runnable: false,
          blocked_reason: 'add-on script has not been approved',
        },
      ],
    })
    render(<AddonsSection />)
    expect(await screen.findByText('add-on script has not been approved')).toBeInTheDocument()
  })

  it('surfaces an error from a failed refresh', async () => {
    mockState()
    vi.mocked(api.post).mockRejectedValue(new Error('Could not fetch the add-on index'))
    const user = userEvent.setup()
    render(<AddonsSection />)

    await user.click(
      await screen.findByRole('button', { name: /(addons.configuredSources|addons.changeIndex)/i })
    )
    await screen.findByText('example.com')

    await user.click(screen.getByRole('button', { name: /addons.refresh/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not fetch the add-on index')
  })

  describe('updates', () => {
    it('badges an installed add-on that has a newer version', async () => {
      mockState({ installed: [OUTDATED] })
      render(<AddonsSection />)
      expect(await screen.findByText('addons.updateBadge')).toBeInTheDocument()
    })

    it('shows no update affordance when everything is current', async () => {
      mockState({ installed: [INSTALLED] })
      render(<AddonsSection />)
      await screen.findByText('TTRPG Wiki')
      expect(screen.queryByRole('button', { name: 'addons.update' })).toBeNull()
      expect(screen.queryByRole('button', { name: /addons.updateAll/ })).toBeNull()
    })

    it('updates a single add-on through the install endpoint', async () => {
      mockState({ installed: [OUTDATED] })
      const user = userEvent.setup()
      render(<AddonsSection />)
      await screen.findByText('TTRPG Wiki')

      await user.click(screen.getByRole('button', { name: 'addons.update' }))
      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith('/addons/ttrpg-wiki/install', {
          approve_script: false,
        })
      )
    })

    it("shows what the update's script will read, not the installed one", async () => {
      const index = 'https://example.com/index.json'
      const installed = {
        ...OUTDATED,
        id: 'drivethru',
        name: 'DriveThruRPG',
        requires_script: true,
        script_env: ['OLD_TOKEN'],
        index_url: index,
      }
      const listed = {
        ...SCRIPT_ADDON,
        installed: true,
        index_url: index,
        script_env: ['NEW_TOKEN'],
      }
      mockState({ installed: [installed], available: [listed] })
      const user = userEvent.setup()
      render(<AddonsSection />)
      expect(await screen.findByText('addons.scriptEnv:OLD_TOKEN')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'addons.update' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('addons.scriptEnv:NEW_TOKEN')).toBeInTheDocument()
    })

    it('offers Update all when something is pending', async () => {
      mockState({ installed: [OUTDATED] })
      render(<AddonsSection />)
      expect(await screen.findByRole('button', { name: /addons.updateAll/ })).toBeInTheDocument()
    })

    it('update all calls the bulk endpoint', async () => {
      mockState({ installed: [OUTDATED] })
      vi.mocked(api.post).mockResolvedValue({ updated: [{ id: 'ttrpg-wiki' }], failed: [] })
      const user = userEvent.setup()
      render(<AddonsSection />)
      await screen.findByText('TTRPG Wiki')

      await user.click(screen.getByRole('button', { name: /addons.updateAll/ }))
      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/addons/update-all'))
    })

    it('asks for consent again when an update changes a script', async () => {
      // Approval was given to specific code; changed code must be re-approved.
      mockState({ installed: [{ ...OUTDATED, requires_script: true }] })
      const user = userEvent.setup()
      render(<AddonsSection />)
      await screen.findByText('TTRPG Wiki')

      await user.click(screen.getByRole('button', { name: 'addons.update' }))
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(api.post).not.toHaveBeenCalled()
    })
  })

  it('toggles the global script switch', async () => {
    mockState()
    const user = userEvent.setup()
    render(<AddonsSection />)
    await screen.findByText('addons.allowScripts')

    await user.click(screen.getByRole('checkbox'))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/addons/settings', { allow_scripts: true })
    )
  })

  it('adds a new index URL', async () => {
    vi.mocked(api.get).mockResolvedValue({
      installed: [],
      available: [],
      index_urls: ['https://example.com/index.json'],
    })
    vi.mocked(api.patch).mockResolvedValue({ status: 'ok' })
    const user = userEvent.setup()
    render(<AddonsSection />)

    await user.click(
      await screen.findByRole('button', { name: /(addons.configuredSources|addons.changeIndex)/i })
    )
    const input = screen.getByPlaceholderText('addons.addIndexUrl')
    await user.type(input, 'https://example.com/new.json')
    const addBtn = screen.getByRole('button', { name: /addons.add$/i })
    await user.click(addBtn)

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/addons/settings', {
        index_urls: ['https://example.com/index.json', 'https://example.com/new.json'],
      })
    )
  })

  it('removes an index URL after confirmation modal', async () => {
    vi.mocked(api.get).mockResolvedValue({
      installed: [],
      available: [],
      index_urls: ['https://example.com/index.json'],
    })
    vi.mocked(api.patch).mockResolvedValue({ status: 'ok' })
    const user = userEvent.setup()
    render(<AddonsSection />)

    await user.click(
      await screen.findByRole('button', { name: /(addons.configuredSources|addons.changeIndex)/i })
    )
    const removeBtn = screen.getByTitle('addons.remove')
    await user.click(removeBtn)

    expect(await screen.findByText('addons.confirmRemoveIndexTitle')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/addons/settings', {
        index_urls: [],
      })
    )
  })

  it('resets index URLs to default after confirmation modal', async () => {
    vi.mocked(api.get).mockResolvedValue({
      installed: [],
      available: [],
      index_urls: ['https://custom.com/index.json'],
      default_index_url: 'https://default.com/index.json',
    })
    vi.mocked(api.patch).mockResolvedValue({ status: 'ok' })
    const user = userEvent.setup()
    render(<AddonsSection />)

    await user.click(
      await screen.findByRole('button', { name: /(addons.configuredSources|addons.changeIndex)/i })
    )
    const resetBtn = screen.getByRole('button', { name: /addons.indexReset/i })
    await user.click(resetBtn)

    expect(await screen.findByText('addons.confirmResetIndexTitle')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/addons/settings', {
        index_urls: ['https://default.com/index.json'],
      })
    )
  })

  it('opens context menu via right click and installs from a specific source', async () => {
    const multiSourceAddon = {
      ...YAML_ADDON,
      available_in: [
        { index_url: 'https://source1.com/index.json', version: '1.0.0', update_available: false },
        { index_url: 'https://source2.com/index.json', version: '1.1.0', update_available: false },
      ],
    }
    mockState({ available: [multiSourceAddon] })
    const user = userEvent.setup()
    render(<AddonsSection />)
    const addonTitle = await screen.findByText('TTRPG Wiki')

    fireEvent.contextMenu(addonTitle)

    const contextMenuItem = await screen.findByText('source2.com')
    await user.click(contextMenuItem)

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/addons/ttrpg-wiki/install', {
        approve_script: false,
        index_url: 'https://source2.com/index.json',
      })
    )
  })

  it('opens context menu via right click and updates an installed addon from a specific source', async () => {
    const multiSourceInstalled = {
      ...OUTDATED,
      available_in: [
        { index_url: 'https://source1.com/index.json', version: '1.0.0', update_available: false },
        { index_url: 'https://source2.com/index.json', version: '2.0.0', update_available: true },
      ],
    }
    mockState({ installed: [multiSourceInstalled] })
    const user = userEvent.setup()
    render(<AddonsSection />)
    const addonTitle = await screen.findByText('TTRPG Wiki')

    fireEvent.contextMenu(addonTitle)

    const contextMenuItem = await screen.findByText('source2.com')
    await user.click(contextMenuItem)

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/addons/ttrpg-wiki/install', {
        approve_script: false,
        index_url: 'https://source2.com/index.json',
      })
    )
  })

  it('allows canceling script approval modal', async () => {
    mockState({ available: [SCRIPT_ADDON] })
    const user = userEvent.setup()
    render(<AddonsSection />)
    await screen.findByText('DriveThruRPG')
    await user.click(screen.getByRole('button', { name: /addons.install/i }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('handles error state when saving index URLs fails', async () => {
    mockState()
    vi.mocked(api.patch).mockRejectedValue(new Error('Save Error'))
    const user = userEvent.setup()
    render(<AddonsSection />)

    await user.click(await screen.findByText('addons.allowScripts'))
    await user.click(screen.getByRole('checkbox'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Save Error')
  })
})
