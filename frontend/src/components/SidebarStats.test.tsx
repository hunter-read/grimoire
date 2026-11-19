import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SidebarStats from './SidebarStats'
import type { Schema } from '../api'

vi.mock('./StatsModal', () => ({
  default: () => <div data-testid="stats-modal" />,
}))

const STATS = {
  game_systems: 4,
  books: 10,
  maps: 3,
  total_pages: 2500,
  ttrpg_books: 8,
  library_size_mb: 3072,
} as Schema<'StatsResponse'>

describe('SidebarStats', () => {
  it('shows the layout’s stats in its order', () => {
    render(<SidebarStats stats={STATS} layout={['maps', 'ttrpg_books', 'library_size_mb']} />)
    const terms = screen.getAllByRole('term').map((term) => term.textContent)
    expect(terms).toEqual(['Maps', 'TTRPG Books', 'Library Size'])
    expect(screen.getByText('3.00 GB')).toBeInTheDocument()
  })

  it('opens every stat from the button or a click on the list', async () => {
    const { unmount } = render(<SidebarStats stats={STATS} layout={['maps']} />)
    await userEvent.click(screen.getByRole('button', { name: 'All stats' }))
    expect(screen.getByTestId('stats-modal')).toBeInTheDocument()
    unmount()

    render(<SidebarStats stats={STATS} layout={['maps']} />)
    await userEvent.click(screen.getByText('Maps'))
    expect(screen.getByTestId('stats-modal')).toBeInTheDocument()
  })

  it('still offers every stat when the layout is empty', () => {
    render(<SidebarStats stats={STATS} layout={[]} />)
    expect(screen.queryByRole('term')).toBeNull()
    expect(screen.getByRole('button', { name: 'All stats' })).toBeInTheDocument()
  })
})
