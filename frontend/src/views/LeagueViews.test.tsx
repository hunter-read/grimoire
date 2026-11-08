import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LeaguesView from './LeaguesView'
import LeagueDetailView from './LeagueDetailView'
import { army, game, league, systems } from '../test/armyFixtures'

const mockLeagues = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  eligible: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  setArmy: vi.fn(),
  logGame: vi.fn(),
  updateGame: vi.fn(),
  removeGame: vi.fn(),
}

vi.mock('../api', () => ({
  leagues: {
    list: () => mockLeagues.list(),
    get: (id: string) => mockLeagues.get(id),
    create: (body: unknown) => mockLeagues.create(body),
    update: (id: string, body: unknown) => mockLeagues.update(id, body),
    remove: (id: string) => mockLeagues.remove(id),
    eligible: (id: string) => mockLeagues.eligible(id),
    addMember: (id: string, user: string) => mockLeagues.addMember(id, user),
    removeMember: (id: string, user: string) => mockLeagues.removeMember(id, user),
    setArmy: (id: string, user: string, a: string) => mockLeagues.setArmy(id, user, a),
    logGame: (id: string, body: unknown) => mockLeagues.logGame(id, body),
    updateGame: (id: string, g: string, body: unknown) => mockLeagues.updateGame(id, g, body),
    removeGame: (id: string, g: string) => mockLeagues.removeGame(id, g),
  },
  armies: {
    list: () => Promise.resolve([army]),
    systems: () => Promise.resolve(systems),
    factions: () => Promise.resolve({ factions: [] }),
  },
}))

let role = 'gm'
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role } }) }))

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/leagues" element={<LeaguesView />} />
        <Route path="/leagues/:leagueId" element={<LeagueDetailView />} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(() => {
  vi.clearAllMocks()
  role = 'gm'
  mockLeagues.list.mockResolvedValue([league])
  mockLeagues.get.mockResolvedValue(league)
  mockLeagues.eligible.mockResolvedValue([])
})

describe('LeaguesView', () => {
  it('lists leagues and lets an organiser start one', async () => {
    mockLeagues.create.mockResolvedValue(league)
    at('/leagues')
    expect(await screen.findByText('Winter League')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New league' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Spring' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create league' }))
    await waitFor(() => expect(mockLeagues.create).toHaveBeenCalled())
    expect(await screen.findByText('Cold battles')).toBeInTheDocument() // the league's page
  })

  it('shows each empty state, and players cannot start one', async () => {
    mockLeagues.list.mockResolvedValue([])
    const { unmount } = at('/leagues')
    expect(await screen.findByText(/No leagues yet/)).toBeInTheDocument()
    unmount()
    role = 'player'
    at('/leagues')
    expect(await screen.findByText(/not in any leagues yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New league' })).not.toBeInTheDocument()
  })

  it('shows a load failure', async () => {
    mockLeagues.list.mockRejectedValue(new Error('offline'))
    at('/leagues')
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
  })
})

describe('LeagueDetailView', () => {
  it('shows standings, games and members, and logs a game', async () => {
    mockLeagues.logGame.mockResolvedValue({ ...league, games: [game, { ...game, id: 'g2' }] })
    at('/leagues/l1')
    expect(await screen.findByRole('heading', { name: /Winter League/ })).toBeInTheDocument()
    expect(screen.getByText(/Organized by Gus/)).toBeInTheDocument()
    expect(screen.getByText('Standings')).toBeInTheDocument()
    expect(screen.getByText('Members and armies')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Log a game/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: /Log a game/ }))
    fireEvent.change(screen.getByLabelText('Opponent'), { target: { value: 'u2' } })
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log a game' }))
    await waitFor(() =>
      expect(mockLeagues.logGame).toHaveBeenCalledWith(
        'l1',
        expect.objectContaining({ player_a_id: 'u1', player_b_id: 'u2', result: 'a' })
      )
    )
    expect(await screen.findAllByText('Ana 20 - 10 Ben')).toHaveLength(2)
  })

  it('edits and deletes a game', async () => {
    mockLeagues.updateGame.mockResolvedValue({ ...league, games: [{ ...game, mission: 'Purge' }] })
    mockLeagues.removeGame.mockResolvedValue(undefined)
    at('/leagues/l1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit game' }))
    // The game's form comes before the league settings, which have a Save too.
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    expect(await screen.findByText(/Purge/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete game' }))
    await waitFor(() => expect(mockLeagues.removeGame).toHaveBeenCalledWith('l1', 'g1'))
    expect(mockLeagues.get).toHaveBeenCalledTimes(2)
  })

  it('saves settings and deletes the league', async () => {
    mockLeagues.update.mockResolvedValue({ ...league, status: 'finished' })
    mockLeagues.remove.mockResolvedValue(undefined)
    mockLeagues.list.mockResolvedValue([])
    at('/leagues/l1')
    fireEvent.click(await screen.findByRole('button', { name: 'Mark finished' }))
    expect(await screen.findByRole('button', { name: 'Reopen league' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete league' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete this league and its games' }))
    await waitFor(() => expect(mockLeagues.remove).toHaveBeenCalledWith('l1'))
    expect(await screen.findByText(/No leagues yet/)).toBeInTheDocument()
  })

  it('sends a member who leaves back to the list', async () => {
    role = 'player'
    mockLeagues.get.mockResolvedValue({ ...league, can_manage: false, points_limit: null })
    mockLeagues.removeMember.mockResolvedValue(undefined)
    mockLeagues.list.mockResolvedValue([])
    at('/leagues/l1')
    expect(await screen.findByRole('heading', { name: /Winter League/ })).toBeInTheDocument()
    expect(screen.queryByText('League settings')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Leave league' }))
    expect(await screen.findByText(/not in any leagues yet/)).toBeInTheDocument()
  })

  it('shows a load failure', async () => {
    mockLeagues.get.mockRejectedValue(new Error('League not found'))
    at('/leagues/zz')
    expect(await screen.findByText('League not found')).toBeInTheDocument()
  })
})
