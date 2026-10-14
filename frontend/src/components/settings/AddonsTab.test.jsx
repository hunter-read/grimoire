import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import AddonsTab from './AddonsTab'
import { clearCodexStatusCache } from '../codex/useCodexStatus'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const api = (await import('../../api')).default

const ADDONS = {
  installed: [],
  available: [],
  index_urls: ['https://example.com/index.json'],
  default_index_url: 'https://example.com/index.json',
  allow_scripts: false,
}

function mockApi(codex) {
  api.get.mockImplementation((path) => {
    if (path === '/codex/status') return Promise.resolve(codex)
    if (path === '/codex/settings')
      return Promise.resolve({ ...codex, send_hashes: false, locked: [] })
    return Promise.resolve(ADDONS)
  })
}

describe('AddonsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCodexStatusCache()
    mockApi({ enabled: false, url: 'https://db.grimoirecodex.org' })
  })

  it('renders the add-ons manager', async () => {
    render(<AddonsTab />)
    expect((await screen.findAllByText('addons.installedHeading')).length).toBeGreaterThan(0)
  })

  it('groups add-ons under their category heading', async () => {
    render(<AddonsTab />)
    expect(await screen.findByText('addons.categories.metadata')).toBeInTheDocument()
    expect(await screen.findByText('addons.categories.metadataDesc')).toBeInTheDocument()
    expect(screen.queryByText('addons.title')).not.toBeInTheDocument()
  })

  it('hides Grimoire Codex DB when the server has no GRIMOIRE_CODEX_DB_API_TOKEN', async () => {
    render(<AddonsTab />)
    await screen.findByText('addons.categories.metadata')
    expect(api.get).toHaveBeenCalledWith('/codex/status')
    expect(screen.queryByText('codex.settings.title')).not.toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalledWith('/codex/settings')
  })

  it('shows Grimoire Codex DB settings once it is configured', async () => {
    mockApi({ enabled: true, url: 'https://db.grimoirecodex.org' })
    render(<AddonsTab />)
    expect(await screen.findByText('codex.settings.title')).toBeInTheDocument()
  })
})
