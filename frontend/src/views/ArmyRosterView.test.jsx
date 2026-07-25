import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ArmyRosterView from './ArmyRosterView'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

function renderView() {
  return render(
    <MemoryRouter>
      <ArmyRosterView />
    </MemoryRouter>
  )
}

describe('ArmyRosterView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the header, sample rosters, and requests systems', async () => {
    api.get.mockResolvedValue([])
    renderView()
    expect(screen.getByText('Army Rosters')).toBeInTheDocument()
    expect(screen.getByText('Strike Force Ultima')).toBeInTheDocument()
    expect(screen.getByText('Siege Company')).toBeInTheDocument()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/systems'))
  })

  it('renders factions from the library systems', async () => {
    api.get.mockResolvedValue([
      { id: 1, name: 'Warhammer 40k' },
      { id: 2, name: 'Kill Team' },
    ])
    renderView()
    await waitFor(() => expect(screen.getByText('Warhammer 40k')).toBeInTheDocument())
    expect(screen.getByText('Kill Team')).toBeInTheDocument()
  })

  it('shows the empty-factions message when there are no systems', async () => {
    api.get.mockResolvedValue([])
    renderView()
    await waitFor(() =>
      expect(screen.getByText(/No game systems found/i)).toBeInTheDocument()
    )
  })

  it('handles a failed systems request gracefully', async () => {
    api.get.mockRejectedValue(new Error('boom'))
    renderView()
    await waitFor(() =>
      expect(screen.getByText(/No game systems found/i)).toBeInTheDocument()
    )
  })

  it('ignores a non-array systems payload', async () => {
    api.get.mockResolvedValue({ nope: true })
    renderView()
    await waitFor(() =>
      expect(screen.getByText(/No game systems found/i)).toBeInTheDocument()
    )
  })
})
