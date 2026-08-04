import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddonsSection from './AddonsSection'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => (opts?.name ? `${k}:${opts.name}` : k),
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

function mockState({ installed = [], available = [], allow_scripts = false } = {}) {
  api.get.mockResolvedValue({
    installed,
    available,
    index_url: 'https://example.com/index.json',
    allow_scripts,
    index_generated: '',
  })
  api.post.mockResolvedValue({ status: 'ok' })
  api.patch.mockResolvedValue({ status: 'ok' })
  api.delete.mockResolvedValue({ status: 'ok' })
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
    expect(await screen.findByText('addons.noneInstalled')).toBeInTheDocument()
    expect(screen.getByText('addons.noneAvailable')).toBeInTheDocument()
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
    await screen.findByDisplayValue('https://example.com/index.json')

    await user.click(screen.getByRole('button', { name: /addons.refresh/i }))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/addons/settings', {
        index_url: 'https://example.com/index.json',
      })
    )
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
    api.patch.mockRejectedValue(new Error('Could not fetch the add-on index'))
    const user = userEvent.setup()
    render(<AddonsSection />)
    await screen.findByDisplayValue('https://example.com/index.json')

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

    it('offers Update all when something is pending', async () => {
      mockState({ installed: [OUTDATED] })
      render(<AddonsSection />)
      expect(await screen.findByRole('button', { name: /addons.updateAll/ })).toBeInTheDocument()
    })

    it('update all calls the bulk endpoint', async () => {
      mockState({ installed: [OUTDATED] })
      api.post.mockResolvedValue({ updated: [{ id: 'ttrpg-wiki' }], failed: [] })
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
})
