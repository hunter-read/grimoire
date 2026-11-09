import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import SidebarVisibilitySection from './SidebarVisibilitySection'
import { settings as settingsApi } from '../../api'
import type { SettingsData } from './useInstantSettings'

vi.mock('../../api', () => ({
  settings: { get: vi.fn(), patch: vi.fn() },
}))

function mockSettings(overrides: Record<string, unknown> = {}) {
  vi.mocked(settingsApi.get).mockResolvedValue({
    hide_maps: false,
    hide_tokens: false,
    hide_audio: false,
    hide_models: false,
    hide_campaigns: true,
    hide_armies: false,
    hide_leagues: true,
    ...overrides,
  } as unknown as SettingsData)
  vi.mocked(settingsApi.patch).mockResolvedValue({} as SettingsData)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SidebarVisibilitySection', () => {
  it('shows each sidebar section with its stored value', async () => {
    mockSettings()
    render(<SidebarVisibilitySection />)
    expect(screen.getByText('Sidebar Visibility')).toBeInTheDocument()
    expect(await screen.findByLabelText('Hide Maps')).not.toBeChecked()
    expect(screen.getByLabelText('Hide Tokens')).toBeInTheDocument()
    expect(screen.getByLabelText('Hide Campaigns')).toBeChecked()
    expect(screen.getByLabelText('Hide Armies')).not.toBeChecked()
    expect(screen.getByLabelText('Hide Leagues')).toBeChecked()
  })

  it('saves a change, says so, and tells the sidebar', async () => {
    mockSettings()
    const handler = vi.fn()
    window.addEventListener('grimoire:settings-changed', handler)
    render(<SidebarVisibilitySection />)
    fireEvent.click(await screen.findByLabelText('Hide Maps'))
    await waitFor(() => expect(settingsApi.patch).toHaveBeenCalledWith({ hide_maps: true }))
    await waitFor(() => expect(handler).toHaveBeenCalledOnce())
    window.removeEventListener('grimoire:settings-changed', handler)

    const row = screen.getByLabelText('Hide Maps').closest('div') as HTMLElement
    expect(within(row).getByRole('status')).toHaveTextContent('Saved')
  })

  it('puts the box back and explains under that row when saving fails', async () => {
    mockSettings()
    const handler = vi.fn()
    window.addEventListener('grimoire:settings-changed', handler)
    vi.mocked(settingsApi.patch).mockRejectedValue(
      Object.assign(new Error('Read-only'), { status: 409 })
    )
    render(<SidebarVisibilitySection />)
    const box = await screen.findByLabelText('Hide Campaigns')
    fireEvent.click(box)

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Not saved - /)
    expect(box).toBeChecked()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(handler).not.toHaveBeenCalled()
    window.removeEventListener('grimoire:settings-changed', handler)
  })

  it('offers a retry when the settings fail to load', async () => {
    vi.mocked(settingsApi.get).mockRejectedValueOnce(new Error('boom'))
    render(<SidebarVisibilitySection />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    mockSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('Hide Maps')).toBeInTheDocument()
  })
})
