import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AppSettingsTab from './AppSettingsTab'
import { UISettingsProvider } from '../../context/UISettingsContext'

vi.mock('../../api', () => ({
  settings: {
    get: vi.fn(),
    patch: vi.fn(),
  },
  apiKeys: {
    list: vi.fn(),
    permissions: vi.fn(),
  },
}))

import { settings as settingsApi, apiKeys as apiKeysApi } from '../../api'

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
  show_stat_library_size: false,
}

beforeEach(() => {
  vi.resetAllMocks()
  settingsApi.get.mockResolvedValue(defaultSettings)
  settingsApi.patch.mockResolvedValue({})
  apiKeysApi.list.mockResolvedValue([])
  apiKeysApi.permissions.mockResolvedValue([])
})

// ---------------------------------------------------------------------------
// Stats Display section — toggle list
// ---------------------------------------------------------------------------

describe('AppSettingsTab — StatsDisplaySection', () => {
  it('renders every stat toggle label', async () => {
    render(<AppSettingsTab />)
    await waitFor(() => {
      expect(screen.getByLabelText('Systems')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Books')).toBeInTheDocument()
    expect(screen.getByLabelText('Pages')).toBeInTheDocument()
    expect(screen.getByLabelText('Maps')).toBeInTheDocument()
    expect(screen.getByLabelText('Tokens')).toBeInTheDocument()
    expect(screen.getByLabelText('Books Size')).toBeInTheDocument()
    expect(screen.getByLabelText('Library Size')).toBeInTheDocument()
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
// API keys section (details covered in ApiKeySection.test.jsx)
// ---------------------------------------------------------------------------

describe('AppSettingsTab — ApiKeySection', () => {
  it('hides the keys view when keys are off for the instance', async () => {
    render(
      <UISettingsProvider value={{ api_keys_enabled: false }}>
        <AppSettingsTab />
      </UISettingsProvider>
    )
    await waitFor(() => expect(screen.getByLabelText('Systems')).toBeInTheDocument())
    expect(screen.queryByText('All API Keys')).toBeNull()
    expect(apiKeysApi.list).not.toHaveBeenCalled()
  })

  it("shows every user's keys, with no create button", async () => {
    render(<AppSettingsTab />)
    expect(await screen.findByText('All API Keys')).toBeInTheDocument()
    expect(apiKeysApi.list).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('button', { name: /create api key/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// FolderCategorySection
// ---------------------------------------------------------------------------
// Moved here from the Maintenance tab: it is a persistent setting for how
// Grimoire interprets the library, not a one-off housekeeping task.

describe('AppSettingsTab — FolderCategorySection', () => {
  it('renders the folder category inference toggle', async () => {
    render(<AppSettingsTab />)

    const box = await screen.findByRole('checkbox', {
      name: (_, el) => el.id === 'disable_folder_category_inference',
    })
    expect(box).toBeInTheDocument()
    expect(box).not.toBeChecked()
  })

  it('reflects the stored setting and saves a change', async () => {
    settingsApi.get.mockResolvedValue({
      ...defaultSettings,
      disable_folder_category_inference: true,
    })
    render(<AppSettingsTab />)

    const box = await screen.findByRole('checkbox', {
      name: (_, el) => el.id === 'disable_folder_category_inference',
    })
    expect(box).toBeChecked()

    fireEvent.click(box)
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith(
        expect.objectContaining({ disable_folder_category_inference: false })
      )
    )
  })
})
