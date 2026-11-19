import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MySidebarStatsSection from './MySidebarStatsSection'

const patch = vi.fn()
const getUi = vi.fn()
const refreshUser = vi.fn()
let user: { sidebar_stats?: string[] | null } = { sidebar_stats: null }

vi.mock('../../api', () => ({
  default: { patch: (...args: unknown[]) => patch(...args) },
  settings: { getUi: () => getUi() },
}))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user, refreshUser }),
}))

// The default arrives after the first paint, which shows the older flags'
// defaults; wait for it rather than for the checkbox merely existing.
const defaultLoaded = () => waitFor(() => expect(screen.getByLabelText('Maps')).toBeChecked())

const chosen = () =>
  within(screen.getByRole('list', { name: 'Stats in the sidebar' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent?.replace(/^\d+\./, ''))

beforeEach(() => {
  user = { sidebar_stats: null }
  patch.mockReset().mockResolvedValue({})
  getUi.mockReset().mockResolvedValue({ sidebar_stats: ['maps', 'books'] })
  refreshUser.mockReset().mockResolvedValue(undefined)
})

describe('MySidebarStatsSection', () => {
  it("starts from the admin's default until you choose your own", async () => {
    render(<MySidebarStatsSection />)
    await defaultLoaded()
    expect(chosen()).toEqual(['Maps', 'Books'])
    expect(screen.getByText(/default stats your admin chose/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use the default' })).toBeNull()
  })

  it('saves your choice as your own and refreshes you', async () => {
    render(<MySidebarStatsSection />)
    await defaultLoaded()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.click(screen.getByLabelText('Wargame Books'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(patch).toHaveBeenCalledWith('/users/me/preferences', {
      sidebar_stats: ['maps', 'books', 'wargame_books'],
    })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(refreshUser).toHaveBeenCalled()
  })

  it('shows your own layout, and goes back to the default', async () => {
    user = { sidebar_stats: ['audio'] }
    render(<MySidebarStatsSection />)
    expect(chosen()).toEqual(['Audio'])
    expect(screen.getByText(/You chose these stats/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use the default' }))
    expect(patch).toHaveBeenCalledWith('/users/me/preferences', { sidebar_stats: null })
  })

  it('says why saving failed', async () => {
    patch.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<MySidebarStatsSection />)
    await defaultLoaded()
    await userEvent.click(screen.getByLabelText('Maps'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Not saved - the server couldn't be reached. Check your connection and try again."
    )
  })

  it('still works when the default cannot be read', async () => {
    getUi.mockRejectedValue(new Error('down'))
    render(<MySidebarStatsSection />)
    expect(await screen.findByLabelText('Systems')).toBeChecked()
  })
})
