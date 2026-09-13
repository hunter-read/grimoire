import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import AddonsTab from './AddonsTab'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

vi.mock('../../api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      installed: [],
      available: [],
      index_urls: ['https://example.com/index.json'],
      default_index_url: 'https://example.com/index.json',
      allow_scripts: false,
    }),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

describe('AddonsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the add-ons manager', async () => {
    render(<AddonsTab />)
    expect(await screen.findByText('addons.installedHeading')).toBeInTheDocument()
  })

  it('groups add-ons under their category heading', async () => {
    render(<AddonsTab />)
    expect(await screen.findByText('addons.categories.metadata')).toBeInTheDocument()
    expect(await screen.findByText('addons.categories.metadataDesc')).toBeInTheDocument()
    expect(screen.queryByText('addons.title')).not.toBeInTheDocument()
  })
})
