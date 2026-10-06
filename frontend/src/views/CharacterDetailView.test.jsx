import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import CharacterDetailView from './CharacterDetailView'

const mockGet = vi.fn()
const mockGetSchema = vi.fn()
const mockUpdate = vi.fn()
const mockNavigate = vi.fn()

const mockExport = vi.fn()
const mockUploadPortrait = vi.fn()

vi.mock('../api', () => ({
  characters: {
    get: (...a) => mockGet(...a),
    getSchema: (...a) => mockGetSchema(...a),
    update: (...a) => mockUpdate(...a),
    export: (...a) => mockExport(...a),
    uploadPortrait: (...a) => mockUploadPortrait(...a),
    portraitUrl: (id, v) => `/api/characters/${id}/portrait${v ? `?v=${v}` : ''}`,
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
    await userEvent.click(screen.getByLabelText('Back to characters'))
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

  describe('portraits and export', () => {
    it('adds art in the header, without pushing the sheet down', async () => {
      mockUploadPortrait.mockResolvedValue({ portrait_path: 'c1.png', portrait_version: 7 })
      renderView()
      await screen.findByLabelText('Strength')
      const header = screen.getByRole('banner')
      const file = new File(['x'], 'p.png', { type: 'image/png' })
      await userEvent.upload(within(header).getByLabelText('Add art', { selector: 'input' }), file)
      await waitFor(() => expect(mockUploadPortrait).toHaveBeenCalledWith('c1', file))
      const image = await within(header).findByAltText('Portrait of Vex')
      expect(image).toHaveAttribute('src', '/api/characters/c1/portrait?v=7')
    })

    it('surfaces a portrait failure', async () => {
      mockUploadPortrait.mockRejectedValue(new Error('too big'))
      renderView()
      await screen.findByLabelText('Strength')
      await userEvent.upload(
        screen.getByLabelText('Add art', { selector: 'input' }),
        new File(['x'], 'p.png', { type: 'image/png' })
      )
      expect(await screen.findByRole('alert')).toHaveTextContent('too big')
    })

    it('shows a party member\u2019s character read-only', async () => {
      mockGet.mockResolvedValue({ ...CHARACTER, owned: false })
      renderView()
      expect(await screen.findByRole('heading', { name: 'Vex' })).toBeInTheDocument()
      expect(screen.getByText(/read only/i)).toBeInTheDocument()
      expect(screen.queryByLabelText('Add art', { selector: 'input' })).not.toBeInTheDocument()
    })

    it('says the sheet the character is built on', async () => {
      renderView()
      await screen.findByLabelText('Strength')
      expect(within(screen.getByRole('banner')).getByText('D&D 5e')).toBeInTheDocument()
    })

    it('exports the character as a file', async () => {
      mockExport.mockResolvedValue({ name: 'Vex', schema_id: 'dnd-5e' })
      global.URL.createObjectURL = vi.fn(() => 'blob:x')
      global.URL.revokeObjectURL = vi.fn()
      renderView()
      await screen.findByLabelText('Strength')

      const click = vi.fn()
      const realCreate = window.document.createElement.bind(window.document)
      const spy = vi
        .spyOn(window.document, 'createElement')
        .mockImplementation((tag) =>
          tag === 'a' ? { click, set href(v) {}, set download(v) {} } : realCreate(tag)
        )
      await userEvent.click(screen.getByLabelText(/Export character/i))
      // The download is built after the fetch resolves, so both are awaited.
      await waitFor(() => expect(mockExport).toHaveBeenCalledWith('c1'))
      await waitFor(() => expect(click).toHaveBeenCalled())
      spy.mockRestore()
    })

    it('surfaces an export failure', async () => {
      mockExport.mockRejectedValue(new Error('export broke'))
      renderView()
      await screen.findByLabelText('Strength')
      await userEvent.click(screen.getByLabelText(/Export character/i))
      expect(await screen.findByRole('alert')).toHaveTextContent('export broke')
    })
  })

  it('surfaces a load failure', async () => {
    mockGet.mockRejectedValue(new Error('nope'))
    renderView()
    expect(await screen.findByText(/nope/)).toBeInTheDocument()
  })
})
