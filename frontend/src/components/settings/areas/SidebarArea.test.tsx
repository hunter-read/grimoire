import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SidebarArea from './SidebarArea'

vi.mock('../../../api', () => ({
  settings: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}))

import { settings as settingsApi } from '../../../api'

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

const get = vi.mocked(settingsApi.get)
const patch = vi.mocked(settingsApi.patch)

beforeEach(() => {
  vi.resetAllMocks()
  get.mockResolvedValue(defaultSettings as never)
  patch.mockResolvedValue({} as never)
})

describe('SidebarArea - stats', () => {
  const chosen = () =>
    within(screen.getByRole('list', { name: 'Stats in the sidebar' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent?.replace(/^\d+\./, ''))

  it('shows the default stats layout, built from the stored flags', async () => {
    render(<SidebarArea />)
    await screen.findByRole('list', { name: 'Stats in the sidebar' })
    expect(chosen()).toEqual(['Systems', 'Pages', 'Books Size'])
  })

  // Version is no longer a configurable stat; it is always shown in the sidebar.
  it('does not offer Version as a stat', async () => {
    render(<SidebarArea />)
    await screen.findByRole('list', { name: 'Stats in the sidebar' })
    expect(screen.queryByLabelText('Version')).toBeNull()
  })

  it('saves the layout and tells the sidebar', async () => {
    patch.mockImplementation(async (body) => body as never)
    const handler = vi.fn()
    window.addEventListener('grimoire:settings-changed', handler)
    render(<SidebarArea />)
    await userEvent.click(await screen.findByLabelText('Books'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith({
        sidebar_stats: ['game_systems', 'total_pages', 'total_size_mb', 'books'],
      })
    )
    await waitFor(() => expect(handler).toHaveBeenCalledOnce())
    window.removeEventListener('grimoire:settings-changed', handler)
  })
})

describe('SidebarArea - visibility', () => {
  it('renders Hide Maps, Hide Tokens, and Hide Campaigns checkboxes', async () => {
    render(<SidebarArea />)
    expect(await screen.findByLabelText('Hide Maps')).not.toBeChecked()
    expect(screen.getByLabelText('Hide Tokens')).toBeInTheDocument()
    expect(screen.getByLabelText('Hide Campaigns')).toBeInTheDocument()
  })

  it('reflects checked state when hide_campaigns is true', async () => {
    get.mockResolvedValue({ ...defaultSettings, hide_campaigns: true } as never)
    render(<SidebarArea />)
    await waitFor(() => expect(screen.getByLabelText('Hide Campaigns')).toBeChecked())
  })

  it('saves hide_maps: true when Hide Maps is turned on', async () => {
    render(<SidebarArea />)
    fireEvent.click(await screen.findByLabelText('Hide Maps'))
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ hide_maps: true }))
  })
})
