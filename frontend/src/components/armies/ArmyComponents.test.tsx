import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ArmyCard from './ArmyCard'
import ArmyUnit from './ArmyUnit'
import ArmyDetailsForm from './ArmyDetailsForm'
import GameFactionFields from './GameFactionFields'
import ManualUnitsEditor from './ManualUnitsEditor'
import NewArmyForm from './NewArmyForm'
import ProfileTables from './ProfileTables'
import SourceRef from './SourceRef'
import UnitProgress from './UnitProgress'
import { errorMessage, flattenForces, numberOrNull, overLimit, unitTotal } from './armyText'
import { army, factions, manualArmy, systems, unit } from '../../test/armyFixtures'

const mockSystems = vi.fn()
const mockFactions = vi.fn()
const mockGames = vi.fn()
const mockGameFactions = vi.fn()

vi.mock('../../api', () => ({
  armies: {
    systems: (...a: unknown[]) => mockSystems(...a),
    factions: (...a: unknown[]) => mockFactions(...a),
    games: (...a: unknown[]) => mockGames(...a),
    gameFactions: (...a: unknown[]) => mockGameFactions(...a),
  },
}))

let role = 'player'
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }))

const withRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)
const links = army.publication_links ?? {}

beforeEach(() => {
  vi.clearAllMocks()
  role = 'player'
  mockSystems.mockResolvedValue(systems)
  mockFactions.mockResolvedValue({ factions })
  mockGames.mockResolvedValue([{ id: 's40k', name: 'League Game' }])
  mockGameFactions.mockResolvedValue({ factions })
})

describe('armyText', () => {
  it('totals units, flattens forces and reads number inputs', () => {
    expect(unitTotal(unit, 'pts')).toBe(95)
    expect(unitTotal({}, 'pts')).toBe(0)
    expect(flattenForces(army.data?.forces).map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(flattenForces(undefined)).toEqual([])
    expect(overLimit({ points: 10, points_limit: 5 })).toBe(true)
    expect(overLimit({ points: 10, points_limit: null })).toBe(false)
    expect(numberOrNull(' ')).toBeNull()
    expect(numberOrNull('12')).toBe(12)
    expect(numberOrNull('abc')).toBeNull()
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage('nope', 'fallback')).toBe('fallback')
  })
})

describe('ArmyCard', () => {
  it('shows the game, faction and points, and marks a roster import', () => {
    withRouter(<ArmyCard army={army} />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/armies/a1')
    expect(screen.getByText('Warhammer 40,000 10th Edition · Necrons')).toBeInTheDocument()
    expect(screen.getByText('195 / 2000 pts')).toBeInTheDocument()
    expect(screen.getByText('Roster')).toBeInTheDocument()
  })

  it('says when no game is set, and flags an army over its limit', () => {
    withRouter(
      <ArmyCard
        army={{
          ...army,
          source: 'manual',
          game_system_name: '',
          system_name: '',
          faction: null,
          points: 300,
          points_limit: 200,
        }}
      />
    )
    expect(screen.getByText('No game set')).toBeInTheDocument()
    expect(screen.queryByText('Roster')).not.toBeInTheDocument()
    expect(screen.getByText('300 / 200 pts').style.color).toBe('var(--danger)')
  })
})

describe('SourceRef', () => {
  it('links a cited page into the library book, with the offset', () => {
    withRouter(<SourceRef publication="Codex: Necrons" page="82" links={links} />)
    expect(screen.getByRole('link', { name: /Codex: Necrons, p. 82/ })).toHaveAttribute(
      'href',
      '/library/book/b1?page=84'
    )
  })

  it('is plain text when unlinked, opens the book when the page is not a number', () => {
    const { rerender } = withRouter(<SourceRef publication="Index" page="" />)
    expect(screen.getByText('Index')).toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <SourceRef publication="Codex: Necrons" page="xx" links={links} />
      </MemoryRouter>
    )
    expect(screen.getByRole('link')).toHaveAttribute('href', '/library/book/b1')
    rerender(
      <MemoryRouter>
        <SourceRef publication="" />
      </MemoryRouter>
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('ProfileTables', () => {
  it('groups stat lines into one table per profile type', () => {
    render(
      <ProfileTables
        profiles={[
          { name: 'Overlord', type: 'Unit', characteristics: [{ name: 'M', value: '5"' }] },
          { name: 'Staff', type: 'Weapon', characteristics: [{ name: 'S', value: '6' }] },
          { name: 'Lord', type: 'Unit', characteristics: [{ name: 'M', value: '6"' }] },
        ]}
      />
    )
    expect(screen.getAllByRole('table')).toHaveLength(2)
    expect(screen.getByText('6"')).toBeInTheDocument()
  })
})

describe('ArmyUnit', () => {
  it('opens onto stat lines, rules, upgrades and progress', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    withRouter(
      <ArmyUnit
        unit={unit}
        costName="pts"
        links={links}
        progress={{ experience: 2, honours: [], notes: '' }}
        canEdit
        onSaveProgress={onSave}
      />
    )
    expect(screen.getByText('95 pts')).toBeInTheDocument()
    expect(screen.getByText('Character')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Overlord/ }))
    expect(screen.getByText('Comes back.')).toBeInTheDocument()
    expect(screen.getByText('5"')).toBeInTheDocument()
    // The upgrade is a nested row with nothing more to open.
    expect(screen.getByRole('button', { name: /Resurrection Orb/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Experience'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('s1', { experience: 7, honours: [], notes: '' })
    )
    fireEvent.click(screen.getByRole('button', { name: /Overlord/ }))
    expect(screen.queryByText('Comes back.')).not.toBeInTheDocument()
  })

  it('shows a many-model unit with its count and notes', () => {
    withRouter(
      <ArmyUnit
        unit={{ id: 'w', name: 'Warriors', number: 10, notes: 'Front rank', costs: [] }}
        costName="pts"
        links={{}}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /10× Warriors/ }))
    expect(screen.getByText('Front rank')).toBeInTheDocument()
  })
})

describe('UnitProgress', () => {
  it('reads as a summary for others, and as nothing when empty', () => {
    const { rerender, container } = render(
      <UnitProgress
        progress={{ experience: 4, honours: ['Hardened', 'Veteran'], notes: 'Held' }}
        canEdit={false}
        onSave={vi.fn()}
      />
    )
    expect(screen.getByText(/4 XP · Hardened, Veteran/)).toBeInTheDocument()
    expect(screen.getByText('Held')).toBeInTheDocument()
    rerender(<UnitProgress canEdit={false} onSave={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('saves honours split on commas, and shows a failure', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('nope'))
    render(<UnitProgress canEdit onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Honours (comma-separated)'), {
      target: { value: ' Hardened, , Brave ' },
    })
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Held' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('nope')
    expect(onSave).toHaveBeenCalledWith({
      experience: 0,
      honours: ['Hardened', 'Brave'],
      notes: 'Held',
    })
  })
})

describe('ManualUnitsEditor', () => {
  const units = manualArmy.data?.forces?.[0]?.units ?? []

  it('edits, adds and removes units, keeping ids', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ManualUnitsEditor units={units} onSave={onSave} onCancel={vi.fn()} />)
    expect(screen.getByDisplayValue('Knights')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add unit' }))
    const names = screen.getAllByLabelText('Unit name')
    fireEvent.change(names[1], { target: { value: ' Lord ' } })
    fireEvent.change(screen.getAllByLabelText('Points')[1], { target: { value: '70' } })
    fireEvent.change(screen.getAllByLabelText('Models')[1], { target: { value: '0' } })
    fireEvent.change(screen.getAllByLabelText('Category')[1], { target: { value: 'HQ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add unit' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove unit' })[2])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toEqual([
      {
        id: 'm1',
        name: 'Knights',
        number: 5,
        points: 120,
        category: 'Battleline',
        categories: ['Battleline'],
        notes: 'Shields up',
      },
      { name: 'Lord', number: 1, points: 70, category: 'HQ', categories: ['HQ'], notes: null },
    ])
  })

  it('starts with one blank row, and reports a refused list', async () => {
    const onCancel = vi.fn()
    const onSave = vi.fn().mockRejectedValue(new Error('Every unit needs a name'))
    render(<ManualUnitsEditor units={[]} onSave={onSave} onCancel={onCancel} />)
    expect(screen.getAllByLabelText('Unit name')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Every unit needs a name')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('GameFactionFields', () => {
  it('lists the wargames and the chosen one’s factions, indented', async () => {
    const onChange = vi.fn()
    render(<GameFactionFields systemId="s40k" factionId="" onChange={onChange} />)
    expect(await screen.findByRole('option', { name: 'Age of Sigmar' })).toBeInTheDocument()
    const faction = await screen.findByLabelText('Faction')
    expect(screen.getByRole('option', { name: /Szarekhan/ }).textContent).toBe('  Szarekhan')
    fireEvent.change(faction, { target: { value: 'f1' } })
    expect(onChange).toHaveBeenLastCalledWith('s40k', 'f1')
    fireEvent.change(screen.getByLabelText('Game'), { target: { value: 'saos' } })
    expect(onChange).toHaveBeenLastCalledWith('saos', '')
    expect(mockFactions).toHaveBeenCalledWith('s40k')
  })

  it('leaves the faction out when asked to, and survives failed lookups', async () => {
    mockSystems.mockRejectedValue(new Error('offline'))
    mockFactions.mockRejectedValue(new Error('offline'))
    const { rerender } = render(
      <GameFactionFields systemId="s40k" onChange={vi.fn()} withFaction={false} />
    )
    await waitFor(() => expect(mockSystems).toHaveBeenCalled())
    expect(screen.queryByLabelText('Faction')).not.toBeInTheDocument()
    expect(mockFactions).not.toHaveBeenCalled()
    rerender(<GameFactionFields systemId="s40k" onChange={vi.fn()} />)
    await waitFor(() => expect(mockFactions).toHaveBeenCalled())
    expect(screen.queryByLabelText('Faction')).not.toBeInTheDocument()
  })
})

describe('GameFactionFields for a league guest', () => {
  it('offers only their leagues’ games, without the library', async () => {
    role = 'guest'
    render(<GameFactionFields systemId="s40k" onChange={vi.fn()} />)
    expect(await screen.findByRole('option', { name: 'League Game' })).toBeInTheDocument()
    await screen.findByLabelText('Faction')
    expect(mockGameFactions).toHaveBeenCalledWith('s40k')
    expect(mockSystems).not.toHaveBeenCalled()
    expect(mockFactions).not.toHaveBeenCalled()
  })
})

describe('NewArmyForm', () => {
  it('creates an army with its game, faction and limit', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<NewArmyForm onCreate={onCreate} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Mine ' } })
    fireEvent.change(screen.getByLabelText('Points limit'), { target: { value: '1000' } })
    await screen.findByRole('option', { name: 'Age of Sigmar' })
    fireEvent.change(screen.getByLabelText('Game'), { target: { value: 's40k' } })
    fireEvent.change(await screen.findByLabelText('Faction'), { target: { value: 'f1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create army' }))
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: 'Mine',
        points_limit: 1000,
        game_system_id: 's40k',
        faction_id: 'f1',
      })
    )
  })

  it('needs a name, and shows a refusal', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('bad'))
    render(<NewArmyForm onCreate={onCreate} onCancel={vi.fn()} />)
    fireEvent.submit(screen.getByRole('button', { name: 'Create army' }))
    expect(onCreate).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create army' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('bad')
  })
})

describe('ArmyDetailsForm', () => {
  it('sends the game and faction only when they changed', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ArmyDetailsForm army={army} onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Points limit'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'New notes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith({
        name: 'Bones',
        points_limit: null,
        notes: 'New notes',
      })
    )
    await screen.findByRole('option', { name: 'Age of Sigmar' })
    fireEvent.change(screen.getByLabelText('Game'), { target: { value: 'saos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ game_system_id: 'saos', faction_id: null })
      )
    )
  })

  it('shows a refusal and can be cancelled', async () => {
    const onCancel = vi.fn()
    const onSave = vi.fn().mockRejectedValue(new Error('no'))
    render(
      <ArmyDetailsForm
        army={{ ...army, points_limit: null, notes: '', faction: null, game_system_id: null }}
        onSave={onSave}
        onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
