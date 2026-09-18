import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import CharacterDetailView from './CharacterDetailView'

const mockGet = vi.fn()
const mockGetSchema = vi.fn()
const mockUpdate = vi.fn()
const mockNavigate = vi.fn()

vi.mock('../api', () => ({
  characters: {
    get: (...a) => mockGet(...a),
    getSchema: (...a) => mockGetSchema(...a),
    update: (...a) => mockUpdate(...a),
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate, useParams: () => ({ characterId: 'c1' }) }
})

const DOCUMENT = {
  id: 'dnd-5e',
  name: 'D&D 5e',
  fields: {
    strength: { type: 'number', label: 'Strength', default: 10 },
    notes: { type: 'textarea', label: 'Notes' },
  },
  computed: { str_mod: { formula: 'floor((strength - 10) / 2)', label: 'STR Mod' } },
  layout: [{ title: 'Basics', fields: ['strength', 'notes'] }],
}

const CHARACTER = {
  id: 'c1',
  name: 'Vex',
  schema_ref: 'dnd-5e',
  schema_missing: false,
  data: { strength: 16 },
  computed: { str_mod: 3 },
}

const renderView = () =>
  render(
    <MemoryRouter>
      <CharacterDetailView />
    </MemoryRouter>
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockGet.mockResolvedValue(CHARACTER)
  mockGetSchema.mockResolvedValue({ document: DOCUMENT })
  mockUpdate.mockImplementation((id, body) =>
    Promise.resolve({ ...CHARACTER, ...body, data: { ...CHARACTER.data, ...(body.data || {}) } })
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CharacterDetailView', () => {
  it('renders the sheet from its schema', async () => {
    renderView()
    expect(await screen.findByLabelText('Strength')).toHaveValue(16)
    expect(screen.getByRole('heading', { name: 'Basics' })).toBeInTheDocument()
  })

  it('shows the character name', async () => {
    renderView()
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Vex'))
  })

  it('saves an edit after the debounce', async () => {
    const user = userEvent.setup()
    renderView()
    const input = await screen.findByLabelText('Strength')

    await user.clear(input)
    await user.type(input, '18')

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled(), { timeout: 3000 })
    const [, body] = mockUpdate.mock.calls.at(-1)
    expect(body.data.strength).toBe(18)
  })

  it('recomputes derived values locally as you type', async () => {
    const user = userEvent.setup()
    renderView()
    const input = await screen.findByLabelText('Strength')
    expect(screen.getByText('3')).toBeInTheDocument()

    await user.clear(input)
    await user.type(input, '20')
    // Local recompute, before any round trip.
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument())
  })

  it('renames on blur', async () => {
    const user = userEvent.setup()
    renderView()
    const nameInput = await screen.findByLabelText('Name')

    await user.clear(nameInput)
    await user.type(nameInput, 'Kael')
    await user.tab()

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('c1', { name: 'Kael' }))
  })

  it('navigates back to the list', async () => {
    renderView()
    await screen.findByLabelText('Strength')
    await userEvent.click(screen.getByLabelText('Back'))
    expect(mockNavigate).toHaveBeenCalledWith('/characters')
  })

  describe('when the schema is not installed', () => {
    beforeEach(() => {
      mockGet.mockResolvedValue({ ...CHARACTER, schema_missing: true, computed: {} })
    })

    it('does not fetch a schema', async () => {
      renderView()
      await screen.findByText(/is not installed/i)
      expect(mockGetSchema).not.toHaveBeenCalled()
    })

    it('shows the stored values as raw data rather than failing', async () => {
      renderView()
      expect(await screen.findByText('strength')).toBeInTheDocument()
      expect(screen.getByText('16')).toBeInTheDocument()
    })
  })

  it('surfaces a load failure', async () => {
    mockGet.mockRejectedValue(new Error('nope'))
    renderView()
    expect(await screen.findByText(/nope/)).toBeInTheDocument()
  })
})
