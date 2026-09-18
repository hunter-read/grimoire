import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import CharactersView from './CharactersView'

const mockList = vi.fn()
const mockListSchemas = vi.fn()
const mockCreate = vi.fn()
const mockRemove = vi.fn()
const mockImportSchema = vi.fn()
const mockDeleteSchema = vi.fn()
const mockNavigate = vi.fn()

vi.mock('../api', () => ({
  characters: {
    list: (...a) => mockList(...a),
    listSchemas: (...a) => mockListSchemas(...a),
    create: (...a) => mockCreate(...a),
    remove: (...a) => mockRemove(...a),
    importSchema: (...a) => mockImportSchema(...a),
    deleteSchema: (...a) => mockDeleteSchema(...a),
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const SCHEMA = { schema_id: 'dnd-5e', name: 'D&D 5e', version: '1.0.0', character_count: 1 }
const CHARACTER = {
  id: 'c1',
  name: 'Vex',
  schema_ref: 'dnd-5e',
  schema_name: 'D&D 5e',
  schema_missing: false,
}

const renderView = () =>
  render(
    <MemoryRouter>
      <CharactersView />
    </MemoryRouter>
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockList.mockResolvedValue({ characters: [CHARACTER] })
  mockListSchemas.mockResolvedValue({ schemas: [SCHEMA] })
})

describe('CharactersView', () => {
  it('lists characters with their system', async () => {
    renderView()
    expect(await screen.findByText('Vex')).toBeInTheDocument()
    expect(screen.getAllByText(/D&D 5e/).length).toBeGreaterThan(0)
  })

  it('shows an empty state when there are no characters', async () => {
    mockList.mockResolvedValue({ characters: [] })
    renderView()
    expect(await screen.findByText(/No characters yet/i)).toBeInTheDocument()
  })

  it('tells the user to import a sheet first when none is installed', async () => {
    mockList.mockResolvedValue({ characters: [] })
    mockListSchemas.mockResolvedValue({ schemas: [] })
    renderView()
    expect(await screen.findByText(/Import a character sheet schema/i)).toBeInTheDocument()
  })

  it('disables creation until a sheet is installed', async () => {
    mockList.mockResolvedValue({ characters: [] })
    mockListSchemas.mockResolvedValue({ schemas: [] })
    renderView()
    await waitFor(() => expect(screen.getByText(/New character/i).closest('button')).toBeDisabled())
  })

  it('creates a character and navigates to it', async () => {
    mockCreate.mockResolvedValue({ id: 'new-id' })
    renderView()
    await screen.findByText('Vex')

    await userEvent.click(screen.getByText(/New character/i))
    await userEvent.type(screen.getByLabelText('Name'), 'Kael')
    await userEvent.selectOptions(screen.getByLabelText('System'), 'dnd-5e')
    await userEvent.click(screen.getByText('Create'))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({ schema_ref: 'dnd-5e', name: 'Kael' })
    )
    expect(mockNavigate).toHaveBeenCalledWith('/characters/new-id')
  })

  it('opens a character when its row is clicked', async () => {
    renderView()
    await userEvent.click(await screen.findByText('Vex'))
    expect(mockNavigate).toHaveBeenCalledWith('/characters/c1')
  })

  it('deletes a character after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockRemove.mockResolvedValue({})
    renderView()
    await screen.findByText('Vex')

    await userEvent.click(screen.getByLabelText('Delete character'))
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('c1'))
  })

  it('does not delete when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderView()
    await screen.findByText('Vex')

    await userEvent.click(screen.getByLabelText('Delete character'))
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it('flags a character whose schema is no longer installed', async () => {
    mockList.mockResolvedValue({
      characters: [{ ...CHARACTER, schema_missing: true, schema_name: '' }],
    })
    renderView()
    expect(await screen.findByText(/is not installed/i)).toBeInTheDocument()
  })

  it('imports a pasted schema', async () => {
    mockImportSchema.mockResolvedValue({})
    renderView()
    await screen.findByText('Vex')

    await userEvent.click(screen.getByText(/Import a sheet/i))
    const textarea = screen.getByLabelText(/Paste a character sheet schema/i)
    await userEvent.type(textarea, '{{"id":"x","name":"X"}')
    await userEvent.click(screen.getByText('Install'))

    await waitFor(() => expect(mockImportSchema).toHaveBeenCalled())
  })

  it('rejects invalid JSON without calling the API', async () => {
    renderView()
    await screen.findByText('Vex')

    await userEvent.click(screen.getByText(/Import a sheet/i))
    await userEvent.type(screen.getByLabelText(/Paste a character sheet schema/i), 'not json')
    await userEvent.click(screen.getByText('Install'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid JSON/i)
    expect(mockImportSchema).not.toHaveBeenCalled()
  })

  it('surfaces a load failure', async () => {
    mockList.mockRejectedValue(new Error('boom'))
    renderView()
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })

  // The app styles buttons inline from its own tokens — there are no
  // `.btn-primary`/`.btn-secondary` classes to reach for, and a button that
  // names one renders unstyled. These pin that down.
  describe('styling', () => {
    it('styles the primary action with the app accent and no class', async () => {
      renderView()
      const button = (await screen.findByText(/New character/i)).closest('button')
      expect(button.style.background).toBe('var(--gold)')
      expect(button.className).toBe('')
    })

    it('styles the secondary action as a bordered card', async () => {
      renderView()
      await screen.findByText('Vex')
      const button = screen.getByText(/Import a sheet/i).closest('button')
      expect(button.style.background).toBe('var(--bg-card)')
      expect(button.className).toBe('')
    })

    it('keeps a disabled action legible so its tooltip can be read', async () => {
      mockList.mockResolvedValue({ characters: [] })
      mockListSchemas.mockResolvedValue({ schemas: [] })
      renderView()
      const button = (await screen.findByText(/New character/i)).closest('button')
      expect(button).toBeDisabled()
      expect(Number(button.style.opacity)).toBeGreaterThan(0.4)
    })
  })

  it('lists installed sheets and removes one after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockDeleteSchema.mockResolvedValue({})
    renderView()
    await screen.findByText('Vex')

    await userEvent.click(screen.getByLabelText('Remove sheet'))
    await waitFor(() => expect(mockDeleteSchema).toHaveBeenCalledWith('dnd-5e'))
  })
})
