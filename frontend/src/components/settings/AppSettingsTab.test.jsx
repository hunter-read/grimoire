import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AppSettingsTab from './AppSettingsTab'

vi.mock('../../api', () => ({
  settings: {
    get: vi.fn(),
    patch: vi.fn(),
    generateApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
  },
}))

import { settings as settingsApi } from '../../api'

const defaultSettings = {
  hide_maps: false,
  hide_tokens: false,
  hide_campaigns: false,
  show_stat_systems: true,
  show_stat_books: false,
  show_stat_pages: true,
  show_stat_maps: false,
  show_stat_tokens: false,
  show_stat_size: true,
  stats_api_key: '',
}

beforeEach(() => {
  vi.resetAllMocks()
  settingsApi.get.mockResolvedValue(defaultSettings)
  settingsApi.patch.mockResolvedValue({})
})

// ---------------------------------------------------------------------------
// Stats Display section — toggle list
// ---------------------------------------------------------------------------

describe('AppSettingsTab — StatsDisplaySection', () => {
  it('renders all six stat toggle labels', async () => {
    render(<AppSettingsTab />)
    await waitFor(() => {
      expect(screen.getByLabelText('Systems')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Books')).toBeInTheDocument()
    expect(screen.getByLabelText('Pages')).toBeInTheDocument()
    expect(screen.getByLabelText('Maps')).toBeInTheDocument()
    expect(screen.getByLabelText('Tokens')).toBeInTheDocument()
    expect(screen.getByLabelText('Size')).toBeInTheDocument()
  })

  it('does not render a Version toggle', async () => {
    render(<AppSettingsTab />)
    await waitFor(() => {
      expect(screen.getByLabelText('Systems')).toBeInTheDocument()
    })
    // Version is no longer a configurable stat; it is always shown in the sidebar
    expect(screen.queryByLabelText('Version')).toBeNull()
  })

  it('reflects checked state from settings', async () => {
    render(<AppSettingsTab />)
    await waitFor(() => {
      expect(screen.getByLabelText('Systems')).toBeChecked()
    })
    expect(screen.getByLabelText('Books')).not.toBeChecked()
    expect(screen.getByLabelText('Pages')).toBeChecked()
  })

  it('calls settingsApi.patch with toggled value when checkbox is clicked', async () => {
    render(<AppSettingsTab />)
    await waitFor(() => {
      expect(screen.getByLabelText('Books')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Books'))
    await waitFor(() => {
      expect(settingsApi.patch).toHaveBeenCalledWith({ show_stat_books: true })
    })
  })

  it('dispatches grimoire:settings-changed after a successful patch', async () => {
    const handler = vi.fn()
    window.addEventListener('grimoire:settings-changed', handler)

    render(<AppSettingsTab />)
    await waitFor(() => {
      expect(screen.getByLabelText('Systems')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Systems'))
    await waitFor(() => {
      expect(handler).toHaveBeenCalledOnce()
    })

    window.removeEventListener('grimoire:settings-changed', handler)
  })
})

// ---------------------------------------------------------------------------
// Sidebar Visibility section
// ---------------------------------------------------------------------------

describe('AppSettingsTab — SidebarVisibilitySection', () => {
  it('renders Hide Maps, Hide Tokens, and Hide Campaigns checkboxes', async () => {
    render(<AppSettingsTab />)
    await waitFor(() => {
      expect(screen.getByLabelText('Hide Maps')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Hide Tokens')).toBeInTheDocument()
    expect(screen.getByLabelText('Hide Campaigns')).toBeInTheDocument()
  })

  it('reflects unchecked state when hide_maps is false', async () => {
    render(<AppSettingsTab />)
    await waitFor(() => {
      expect(screen.getByLabelText('Hide Maps')).not.toBeChecked()
    })
  })

  it('reflects checked state when hide_campaigns is true', async () => {
    settingsApi.get.mockResolvedValue({ ...defaultSettings, hide_campaigns: true })
    render(<AppSettingsTab />)
    await waitFor(() => {
      expect(screen.getByLabelText('Hide Campaigns')).toBeChecked()
    })
  })

  it('calls patch with hide_maps: true when Hide Maps is toggled on', async () => {
    render(<AppSettingsTab />)
    await waitFor(() => {
      expect(screen.getByLabelText('Hide Maps')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Hide Maps'))
    await waitFor(() => {
      expect(settingsApi.patch).toHaveBeenCalledWith({ hide_maps: true })
    })
  })
})

// ---------------------------------------------------------------------------
// API Key section
// ---------------------------------------------------------------------------

describe('AppSettingsTab — ApiKeySection', () => {
  it('renders a Generate API Key button when no key exists', async () => {
    render(<AppSettingsTab />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /generate api key/i })).toBeInTheDocument()
    })
  })

  it('shows the API key when one is present', async () => {
    settingsApi.get.mockResolvedValue({ ...defaultSettings, stats_api_key: 'my-secret-key' })
    render(<AppSettingsTab />)
    await waitFor(() => {
      expect(screen.getByText('my-secret-key')).toBeInTheDocument()
    })
  })

  it('shows Regenerate and Revoke buttons when a key exists', async () => {
    settingsApi.get.mockResolvedValue({ ...defaultSettings, stats_api_key: 'my-secret-key' })
    render(<AppSettingsTab />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument()
    })
  })

  it('calls generateApiKey and shows the new key', async () => {
    settingsApi.generateApiKey.mockResolvedValue({ stats_api_key: 'new-generated-key' })
    render(<AppSettingsTab />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /generate api key/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /generate api key/i }))
    await waitFor(() => {
      expect(screen.getByText('new-generated-key')).toBeInTheDocument()
    })
  })

  it('calls revokeApiKey and hides the key', async () => {
    settingsApi.get.mockResolvedValue({ ...defaultSettings, stats_api_key: 'my-secret-key' })
    settingsApi.revokeApiKey.mockResolvedValue({})
    render(<AppSettingsTab />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /revoke/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /generate api key/i })).toBeInTheDocument()
    })
    expect(screen.queryByText('my-secret-key')).toBeNull()
  })
})
