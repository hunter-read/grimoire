import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ArmiesView from './ArmiesView'
import ArmyDetailView from './ArmyDetailView'
import { army, manualArmy, systems } from '../test/armyFixtures'

const api = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  importRoster: vi.fn(),
  download: vi.fn(),
  setProgress: vi.fn(),
  publications: vi.fn(),
  systems: vi.fn(),
  factions: vi.fn(),
}

vi.mock('../api', () => ({
  armies: {
    list: (...a: unknown[]) => api.list(...a),
    get: (...a: unknown[]) => api.get(...a),
    create: (...a: unknown[]) => api.create(...a),
    update: (...a: unknown[]) => api.update(...a),
    remove: (...a: unknown[]) => api.remove(...a),
    importRoster: (...a: unknown[]) => api.importRoster(...a),
    download: (...a: unknown[]) => api.download(...a),
    setProgress: (...a: unknown[]) => api.setProgress(...a),
    publications: (...a: unknown[]) => api.publications(...a),
    systems: (...a: unknown[]) => api.systems(...a),
    factions: (...a: unknown[]) => api.factions(...a),
  },
}))

let role = 'player'
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role } }) }))

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/armies" element={<ArmiesView />} />
        <Route path="/armies/:armyId" element={<ArmyDetailView />} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(() => {
  vi.clearAllMocks()
  role = 'player'
  api.list.mockResolvedValue([army])
  api.get.mockResolvedValue(army)
  api.publications.mockResolvedValue([])
  api.systems.mockResolvedValue(systems)
  api.factions.mockResolvedValue({ factions: [] })
  api.download.mockResolvedValue(undefined)
})

describe('ArmiesView', () => {
  it('lists armies and imports a roster', async () => {
    api.importRoster.mockResolvedValue(army)
    at('/armies')
    expect(await screen.findByText('Bones')).toBeInTheDocument()
    expect(document.title).toBe('Armies - Grimoire')
    const file = new File(['<roster/>'], 'list.ros')
    fireEvent.change(screen.getByTestId('roster-input'), { target: { files: [file] } })
    await waitFor(() => expect(api.importRoster).toHaveBeenCalledWith(file))
    expect(await screen.findByText('Tomb world')).toBeInTheDocument() // the army's page
  })

  it('reports a bad roster, and ignores an empty pick', async () => {
    api.importRoster.mockRejectedValue(new Error('not a roster'))
    at('/armies')
    await screen.findByText('Bones')
    fireEvent.change(screen.getByTestId('roster-input'), { target: { files: [] } })
    expect(api.importRoster).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId('roster-input'), {
      target: { files: [new File(['x'], 'x.ros')] },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('not a roster')
  })

  it('builds a new army by hand, and shows the empty state', async () => {
    api.list.mockResolvedValue([])
    api.create.mockResolvedValue(army)
    at('/armies')
    expect(await screen.findByText(/No armies yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New army' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'New army' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create army' }))
    await waitFor(() => expect(api.create).toHaveBeenCalled())
    expect(await screen.findByRole('link', { name: /All armies/ })).toBeInTheDocument()
  })

  it('shows a load failure', async () => {
    api.list.mockRejectedValue(new Error('offline'))
    at('/armies')
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
  })
})

describe('ArmyDetailView', () => {
  it('shows the forces and units, and exports the army', async () => {
    at('/armies/a1')
    expect(await screen.findByRole('heading', { name: /Bones/ })).toBeInTheDocument()
    expect(screen.getByText('Army Roster · Xenos - Necrons')).toBeInTheDocument()
    expect(screen.getByText('Allies')).toBeInTheDocument()
    expect(screen.getByText('No units yet.')).toBeInTheDocument()
    expect(screen.getByText('195 / 2000 pts')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Export as text/ }))
    expect(api.download).toHaveBeenCalledWith('a1', 'text', 'Bones.txt')
    fireEvent.click(screen.getByRole('button', { name: /Download roster/ }))
    expect(api.download).toHaveBeenCalledWith('a1', 'roster', 'Bones.rosz')
    // Players do not link source books.
    expect(api.publications).not.toHaveBeenCalled()
    // An imported list is not edited by hand.
    expect(screen.queryByRole('button', { name: /Edit units/ })).not.toBeInTheDocument()
  })

  it('reports a failed export', async () => {
    api.download.mockRejectedValue(new Error('gone'))
    at('/armies/a1')
    fireEvent.click(await screen.findByRole('button', { name: /Export as text/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('gone')
  })

  it('edits the details and a unit’s progress', async () => {
    api.update.mockResolvedValue({ ...army, name: 'Renamed' })
    api.setProgress.mockResolvedValue({ experience: 9, honours: ['Hardened'], notes: '' })
    at('/armies/a1')
    fireEvent.click(await screen.findByRole('button', { name: /^Edit$/ }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('heading', { name: /Renamed/ })).toBeInTheDocument()
    expect(api.update).toHaveBeenCalledWith('a1', expect.objectContaining({ name: 'Renamed' }))

    fireEvent.click(screen.getByRole('button', { name: /^Overlord/ }))
    fireEvent.change(screen.getByLabelText('Experience'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.setProgress).toHaveBeenCalledWith(
        'a1',
        's1',
        expect.objectContaining({ experience: 9 })
      )
    )
  })

  it('edits a hand-built list, and deletes the army after confirming', async () => {
    api.get.mockResolvedValue(manualArmy)
    api.update.mockResolvedValue(manualArmy)
    api.remove.mockResolvedValue(undefined)
    api.list.mockResolvedValue([])
    at('/armies/a2')
    expect(screen.queryByRole('button', { name: /Download roster/ })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /Edit units/ }))
    expect(screen.getByDisplayValue('Knights')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('a2', { units: expect.any(Array) }))
    expect(await screen.findByRole('button', { name: /Edit units/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete this army' }))
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('a2'))
    expect(await screen.findByText(/No armies yet/)).toBeInTheDocument()
  })

  it('shows a GM the source books, and someone else’s army read-only', async () => {
    role = 'gm'
    api.get.mockResolvedValue({ ...army, can_edit: false, points_limit: 100, notes: '' })
    api.publications.mockResolvedValue([
      { publication: 'Codex: Necrons', link: null, suggestions: [] },
    ])
    at('/armies/a1')
    expect(await screen.findByText('Source books')).toBeInTheDocument()
    expect(screen.getByText('Over the points limit')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit$/ })).not.toBeInTheDocument()
  })

  it('shows a load failure', async () => {
    api.get.mockRejectedValue(new Error('Army not found'))
    at('/armies/zz')
    expect(await screen.findByText('Army not found')).toBeInTheDocument()
  })
})
