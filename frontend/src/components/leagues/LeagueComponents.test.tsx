import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GameForm from './GameForm'
import GameList from './GameList'
import LeagueCard from './LeagueCard'
import LeagueMembers from './LeagueMembers'
import LeagueSettings from './LeagueSettings'
import NewLeagueForm from './NewLeagueForm'
import StandingsTable from './StandingsTable'
import { army, game, league, members, systems } from '../../test/armyFixtures'

const mockArmiesList = vi.fn()
const mockSystems = vi.fn()
const mockEligible = vi.fn()
const mockAddMember = vi.fn()
const mockRemoveMember = vi.fn()
const mockSetArmy = vi.fn()
const mockGet = vi.fn()

vi.mock('../../api', () => ({
  armies: {
    list: (...a: unknown[]) => mockArmiesList(...a),
    systems: (...a: unknown[]) => mockSystems(...a),
    factions: () => Promise.resolve({ factions: [] }),
  },
  leagues: {
    eligible: (...a: unknown[]) => mockEligible(...a),
    addMember: (...a: unknown[]) => mockAddMember(...a),
    removeMember: (...a: unknown[]) => mockRemoveMember(...a),
    setArmy: (...a: unknown[]) => mockSetArmy(...a),
    get: (...a: unknown[]) => mockGet(...a),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockArmiesList.mockResolvedValue([army])
  mockSystems.mockResolvedValue(systems)
  mockEligible.mockResolvedValue([{ id: 'u3', name: 'Cal' }])
  mockAddMember.mockResolvedValue(league)
  mockRemoveMember.mockResolvedValue(undefined)
  mockSetArmy.mockResolvedValue(league)
  mockGet.mockResolvedValue(league)
})

describe('StandingsTable', () => {
  it('ranks members with abbreviated columns', () => {
    render(<StandingsTable rows={league.standings ?? []} />)
    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('Ana')).toBeInTheDocument()
    expect(screen.getByTitle('League points')).toHaveTextContent('Pts')
  })

  it('says when there is nobody yet', () => {
    render(<StandingsTable rows={[]} />)
    expect(screen.getByText('No members yet.')).toBeInTheDocument()
  })
})

describe('LeagueCard', () => {
  it('shows the game, members and limit, and a finished league', () => {
    render(
      <MemoryRouter>
        <LeagueCard league={{ ...league, status: 'finished' }} />
      </MemoryRouter>
    )
    expect(screen.getByRole('link')).toHaveAttribute('href', '/leagues/l1')
    expect(
      screen.getByText('Warhammer 40,000 10th Edition · 2 members · 1000 points')
    ).toBeInTheDocument()
    expect(screen.getByText('Finished')).toBeInTheDocument()
  })
})

describe('GameForm', () => {
  it('logs a game from the scores, the logger as player A', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<GameForm members={members} userId="u1" onSubmit={onSubmit} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Player')).toHaveValue('u1')
    fireEvent.change(screen.getByLabelText('Opponent'), { target: { value: 'u2' } })
    fireEvent.change(screen.getByLabelText("Player's score"), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText("Opponent's score"), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Mission'), { target: { value: 'Take and Hold' } })
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log a game' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        player_a_id: 'u1',
        player_b_id: 'u2',
        score_a: 20,
        score_b: 12,
        result: null,
        mission: 'Take and Hold',
        played_on: '2026-11-01',
        notes: '',
      })
    )
  })

  it('edits a game logged without scores, and shows a refusal', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Give both scores, or say who won'))
    const onCancel = vi.fn()
    render(
      <GameForm
        members={members}
        game={{ ...game, score_a: null, score_b: null, result: 'b', played_on: null }}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )
    expect(screen.getByLabelText('Result')).toHaveValue('b')
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'draw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Give both scores')
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ result: 'draw', played_on: null })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('takes the result from the scores when both were given', () => {
    render(<GameForm members={members} game={game} onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Result')).toHaveValue('')
    expect(screen.getByLabelText("Player's score")).toHaveValue(20)
  })
})

describe('GameList', () => {
  it('lists games with their outcome, and edits or deletes them', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockRejectedValueOnce(new Error('nope')).mockResolvedValue(undefined)
    render(
      <GameList
        games={[game, { ...game, id: 'g2', result: 'draw', can_edit: false, notes: '' }]}
        members={members}
        userId="u1"
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    )
    expect(screen.getAllByText('Ana 20 - 10 Ben')).toHaveLength(2)
    expect(screen.getByText('2026-10-01 · Take and Hold · Ana won')).toBeInTheDocument()
    expect(screen.getByText('2026-10-01 · Take and Hold · Draw')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit game' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Delete game' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('nope')

    fireEvent.click(screen.getByRole('button', { name: 'Edit game' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('g1', expect.any(Object)))
    expect(await screen.findByRole('button', { name: 'Edit game' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit game' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('says when no games were logged, and shows a game with no scores', () => {
    const { rerender } = render(
      <GameList games={[]} members={members} onUpdate={vi.fn()} onDelete={vi.fn()} />
    )
    expect(screen.getByText('No games logged yet.')).toBeInTheDocument()
    rerender(
      <GameList
        games={[{ ...game, score_a: null, score_b: null, result: 'b', played_on: null }]}
        members={members}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.getByText('Ana - - - Ben')).toBeInTheDocument()
    expect(screen.getByText('Take and Hold · Ben won')).toBeInTheDocument()
  })
})

describe('LeagueMembers', () => {
  const renderMembers = (overrides = {}, userId = 'u1') => {
    const onChange = vi.fn()
    render(
      <MemoryRouter>
        <LeagueMembers league={{ ...league, ...overrides }} userId={userId} onChange={onChange} />
      </MemoryRouter>
    )
    return onChange
  }

  it('registers your army, and links to the others’', async () => {
    const onChange = renderMembers({
      members: [
        { user_id: 'u1', name: 'Ana', army: null },
        { user_id: 'u2', name: 'Ben', army: members[0].army },
      ],
    })
    expect(screen.getByRole('link', { name: 'Bones (195 pts)' })).toHaveAttribute(
      'href',
      '/armies/a1'
    )
    const select = screen.getByLabelText('Your army')
    await screen.findByRole('option', { name: 'Bones (195 pts)' })
    fireEvent.change(select, { target: { value: 'a1' } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(league))
    expect(mockSetArmy).toHaveBeenCalledWith('l1', 'u1', 'a1')
  })

  it('lets the organiser add and remove players', async () => {
    const onChange = renderMembers({}, 'u9')
    const add = screen.getByRole('button', { name: 'Add player' })
    expect(add).toBeDisabled()
    fireEvent.change(await screen.findByLabelText('Choose a player'), { target: { value: 'u3' } })
    await screen.findByRole('option', { name: 'Cal' })
    fireEvent.change(screen.getByLabelText('Choose a player'), { target: { value: 'u3' } })
    fireEvent.click(add)
    await waitFor(() => expect(mockAddMember).toHaveBeenCalledWith('l1', 'u3'))
    expect(screen.getByText('No army chosen')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ben' }))
    await waitFor(() => expect(mockRemoveMember).toHaveBeenCalledWith('l1', 'u2'))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(league))
  })

  it('lets a member leave, and shows a refusal', async () => {
    const onChange = renderMembers({ can_manage: false })
    expect(screen.queryByRole('button', { name: 'Remove Ben' })).not.toBeInTheDocument()
    mockRemoveMember.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Leave league' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    fireEvent.click(screen.getByRole('button', { name: 'Leave league' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null))
    expect(mockEligible).not.toHaveBeenCalled()
  })

  it('copes when the side lookups fail', async () => {
    mockArmiesList.mockRejectedValue(new Error('x'))
    mockEligible.mockRejectedValue(new Error('x'))
    renderMembers()
    await waitFor(() => expect(mockEligible).toHaveBeenCalled())
    expect(screen.getByLabelText('Your army')).toBeInTheDocument()
  })
})

describe('LeagueSettings', () => {
  it('saves the details and scoring, and finishes the league', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<LeagueSettings league={league} onSave={onSave} onDelete={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Points for a win'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Points limit'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' ' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        name: 'Winter League',
        description: 'New',
        points_limit: null,
        points_win: 4,
        points_draw: 1,
        points_loss: 0,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Mark finished' }))
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith({ status: 'finished' }))
  })

  it('reopens a finished league, and deletes after confirming', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('no'))
    const onDelete = vi.fn().mockResolvedValue(undefined)
    render(
      <LeagueSettings
        league={{ ...league, status: 'finished', points_limit: null, description: '' }}
        onSave={onSave}
        onDelete={onDelete}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reopen league' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no')
    expect(onSave).toHaveBeenCalledWith({ status: 'active' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete league' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete league' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete this league and its games' }))
    await waitFor(() => expect(onDelete).toHaveBeenCalled())
  })
})

describe('NewLeagueForm', () => {
  it('creates a league for a game', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<NewLeagueForm onCreate={onCreate} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Spring ' } })
    fireEvent.change(screen.getByLabelText('Points limit'), { target: { value: '1500' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Fresh' } })
    await screen.findByRole('option', { name: 'Age of Sigmar' })
    fireEvent.change(screen.getByLabelText('Game'), { target: { value: 'saos' } })
    expect(screen.queryByLabelText('Faction')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create league' }))
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: 'Spring',
        game_system_id: 'saos',
        points_limit: 1500,
        description: 'Fresh',
      })
    )
  })

  it('needs a name, and shows a refusal', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('GM only'))
    const onCancel = vi.fn()
    render(<NewLeagueForm onCreate={onCreate} onCancel={onCancel} />)
    fireEvent.submit(screen.getByRole('button', { name: 'Create league' }))
    expect(onCreate).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create league' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('GM only')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
