import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StatsDisplaySection from './StatsDisplaySection'
import { settings as settingsApi } from '../../api'
import type { SettingsData } from './useInstantSettings'

vi.mock('../../api', () => ({
  settings: { get: vi.fn(), patch: vi.fn() },
}))

const asSettings = (value: object) => value as unknown as SettingsData

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(settingsApi.get).mockResolvedValue(
    asSettings({ sidebar_stats: ['game_systems', 'total_pages'] })
  )
  vi.mocked(settingsApi.patch).mockImplementation(async (body) =>
    asSettings({ sidebar_stats: body.sidebar_stats })
  )
})

const chosen = () =>
  within(screen.getByRole('list', { name: 'Stats in the sidebar' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent?.replace(/^\d+\./, ''))

describe('StatsDisplaySection', () => {
  it('shows the default layout in order', async () => {
    render(<StatsDisplaySection />)
    await screen.findByRole('list', { name: 'Stats in the sidebar' })
    expect(chosen()).toEqual(['Systems', 'Pages'])
  })

  it('builds the layout from the older flags when none is saved', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(
      asSettings({
        show_stat_books: true,
        show_stat_systems: false,
        show_stat_pages: false,
        show_stat_size: false,
      })
    )
    render(<StatsDisplaySection />)
    await screen.findByRole('list', { name: 'Stats in the sidebar' })
    expect(chosen()).toEqual(['Books'])
  })

  it('saves a reordered layout and tells the sidebar', async () => {
    const handler = vi.fn()
    window.addEventListener('grimoire:settings-changed', handler)
    render(<StatsDisplaySection />)
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Reorder Pages' }), {
      key: 'ArrowUp',
    })
    await userEvent.click(screen.getByLabelText('Wargame Books'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(settingsApi.patch).toHaveBeenCalledWith({
      sidebar_stats: ['total_pages', 'game_systems', 'wargame_books'],
    })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    await waitFor(() => expect(handler).toHaveBeenCalledOnce())
    window.removeEventListener('grimoire:settings-changed', handler)
  })

  it('says why saving failed and keeps the change', async () => {
    vi.mocked(settingsApi.patch).mockRejectedValue(new TypeError('Failed to fetch'))
    render(<StatsDisplaySection />)
    await userEvent.click(await screen.findByLabelText('Systems'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Not saved - the server couldn't be reached. Check your connection and try again."
    )
    expect(chosen()).toEqual(['Pages'])
  })

  it('offers a retry when the settings fail to load', async () => {
    vi.mocked(settingsApi.get).mockRejectedValueOnce(new Error('boom'))
    render(<StatsDisplaySection />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load these settings - the server couldn't be reached. Check your connection and try again."
    )
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }))
    expect(await screen.findByRole('list', { name: 'Stats in the sidebar' })).toBeInTheDocument()
  })
})
