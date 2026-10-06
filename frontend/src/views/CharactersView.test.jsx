import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import CharactersView from './CharactersView'

const mockList = vi.fn()
const mockListSchemas = vi.fn()
const mockCreate = vi.fn()
const mockRemove = vi.fn()
const mockNavigate = vi.fn()

const mockImportCharacter = vi.fn()
const mockCampaigns = vi.fn()

vi.mock('../api', () => ({
  campaigns: { list: (...a) => mockCampaigns(...a) },
  characters: {
    portraitUrl: (id, v) => `/api/characters/${id}/portrait${v ? `?v=${v}` : ''}`,
    import: (...a) => mockImportCharacter(...a),
    list: (...a) => mockList(...a),
    listSchemas: (...a) => mockListSchemas(...a),
    create: (...a) => mockCreate(...a),
    remove: (...a) => mockRemove(...a),
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
  mockCampaigns.mockResolvedValue([{ id: 'camp1', name: 'Curse of Strahd' }])
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

  it('points at the sheet manager when no sheet is installed', async () => {
    mockList.mockResolvedValue({ characters: [] })
    mockListSchemas.mockResolvedValue({ schemas: [] })
    renderView()
    expect(await screen.findByText(/browse the catalog/i)).toBeInTheDocument()
    // The empty state's own button goes to the next step rather than a dead end.
    const buttons = screen.getAllByRole('button', { name: /Manage sheets/ })
    await userEvent.click(buttons[buttons.length - 1])
    expect(await screen.findByRole('dialog', { name: 'Manage sheets' })).toBeInTheDocument()
  })

  it('offers to create the first character from the empty state', async () => {
    mockList.mockResolvedValue({ characters: [] })
    renderView()
    await screen.findByText(/No characters yet/i)
    const buttons = screen.getAllByRole('button', { name: /New character/ })
    await userEvent.click(buttons[buttons.length - 1])
    expect(await screen.findByRole('dialog', { name: 'New character' })).toBeInTheDocument()
  })

  it('disables creation until a sheet is installed', async () => {
    mockList.mockResolvedValue({ characters: [] })
    mockListSchemas.mockResolvedValue({ schemas: [] })
    renderView()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /New character/ })).toBeDisabled()
    )
  })

  it('creates a character in a dialog and navigates to it', async () => {
    mockCreate.mockResolvedValue({ id: 'new-id' })
    renderView()
    await screen.findByText('Vex')

    await userEvent.click(screen.getByRole('button', { name: /New character/ }))
    const dialog = await screen.findByRole('dialog', { name: 'New character' })
    // The name field takes focus, so typing starts straight away.
    expect(screen.getByLabelText('Name')).toHaveFocus()
    await userEvent.type(screen.getByLabelText('Name'), 'Kael')
    // With one sheet installed it is already chosen.
    expect(screen.getByRole('radio', { name: /D&D 5e/ })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({ schema_ref: 'dnd-5e', name: 'Kael' })
    )
    expect(mockNavigate).toHaveBeenCalledWith('/characters/new-id')
  })

  it('can place a new character in a campaign', async () => {
    mockCreate.mockResolvedValue({ id: 'new-id' })
    renderView()
    await screen.findByText('Vex')
    await userEvent.click(screen.getByRole('button', { name: /New character/ }))
    await screen.findByRole('option', { name: 'Curse of Strahd' })
    await userEvent.selectOptions(screen.getByLabelText(/Campaign/), 'camp1')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        schema_ref: 'dnd-5e',
        name: 'Untitled character',
        campaign_id: 'camp1',
      })
    )
  })

  it('makes the user pick a sheet when there is more than one', async () => {
    mockListSchemas.mockResolvedValue({
      schemas: [SCHEMA, { schema_id: 'cairn', name: 'Cairn', version: '1.0.0' }],
    })
    renderView()
    await screen.findByText('Vex')
    await userEvent.click(screen.getByRole('button', { name: /New character/ }))
    const create = screen.getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: /Cairn/ }))
    expect(create).toBeEnabled()
  })

  it('shows a creation failure inside the dialog', async () => {
    mockCreate.mockRejectedValue(new Error('no such sheet'))
    renderView()
    await screen.findByText('Vex')
    await userEvent.click(screen.getByRole('button', { name: /New character/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    const dialog = screen.getByRole('dialog', { name: 'New character' })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('no such sheet')
  })

  it('closes the new character dialog without creating', async () => {
    renderView()
    await screen.findByText('Vex')
    await userEvent.click(screen.getByRole('button', { name: /New character/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'New character' })).not.toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('links each card to its character', async () => {
    renderView()
    await screen.findByText('Vex')
    expect(screen.getByRole('link', { name: 'Open Vex' })).toHaveAttribute('href', '/characters/c1')
  })

  it('shows a character\u2019s art, or their initials without it', async () => {
    mockList.mockResolvedValue({
      characters: [
        { ...CHARACTER, portrait_path: 'c1.png', portrait_version: 42 },
        { ...CHARACTER, id: 'c2', name: 'Kael Stormborn', portrait_path: null },
      ],
    })
    const { container } = renderView()
    await screen.findByText('Vex')
    // The version is in the URL, so replaced art is never served from cache.
    expect(container.querySelector('img[src="/api/characters/c1/portrait?v=42"]')).not.toBeNull()
    expect(screen.getByText('KS')).toBeInTheDocument()
  })

  it('offers no delete for a party member\u2019s character', async () => {
    mockList.mockResolvedValue({ characters: [{ ...CHARACTER, owned: false }] })
    renderView()
    await screen.findByText('Vex')
    expect(screen.getByText('party member')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
  })

  it('deletes a character after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockRemove.mockResolvedValue({})
    renderView()
    await screen.findByText('Vex')

    await userEvent.click(screen.getByRole('button', { name: 'Delete Vex' }))
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('c1'))
    await waitFor(() => expect(screen.queryByText('Vex')).not.toBeInTheDocument())
  })

  it('surfaces a failed delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockRemove.mockRejectedValue(new Error('not yours'))
    renderView()
    await screen.findByText('Vex')
    await userEvent.click(screen.getByRole('button', { name: 'Delete Vex' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not yours')
  })

  it('does not delete when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderView()
    await screen.findByText('Vex')

    await userEvent.click(screen.getByRole('button', { name: 'Delete Vex' }))
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it('flags a character whose schema is no longer installed', async () => {
    mockList.mockResolvedValue({
      characters: [{ ...CHARACTER, schema_missing: true, schema_name: '' }],
    })
    renderView()
    expect(await screen.findByText(/is not installed/i)).toBeInTheDocument()
  })

  it('opens the sheet manager from one button', async () => {
    // Sheets, rulesets, browsing and pasting were four separate buttons here.
    // They are one now, so the header does not make the user guess.
    renderView()
    await screen.findByText('Vex')
    await userEvent.click(screen.getByText('Manage sheets'))
    expect(await screen.findByRole('dialog', { name: 'Manage sheets' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sheets' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Content' })).toBeInTheDocument()
  })

  it('closes the sheet manager again', async () => {
    renderView()
    await screen.findByText('Vex')
    await userEvent.click(screen.getByText('Manage sheets'))
    await userEvent.click(screen.getByLabelText('Close'))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Manage sheets' })).not.toBeInTheDocument()
    )
  })

  it('surfaces a load failure', async () => {
    mockList.mockRejectedValue(new Error('boom'))
    renderView()
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })

  describe('importing a character file', () => {
    const fileOf = (text) => {
      const file = new File([text], 'c.json', { type: 'application/json' })
      // jsdom's File has no text(), which is what the view reads it with.
      file.text = () => Promise.resolve(text)
      return file
    }

    it('imports a file and opens the new character', async () => {
      mockImportCharacter.mockResolvedValue({ id: 'imported' })
      renderView()
      await screen.findByText('Vex')
      await userEvent.upload(
        screen.getByLabelText(/Import a character/i),
        fileOf('{"schema_id":"demo","name":"Imported"}')
      )
      await waitFor(() =>
        expect(mockImportCharacter).toHaveBeenCalledWith({
          schema_id: 'demo',
          name: 'Imported',
        })
      )
      expect(mockNavigate).toHaveBeenCalledWith('/characters/imported')
    })

    it('reports a file that is not JSON', async () => {
      renderView()
      await screen.findByText('Vex')
      await userEvent.upload(screen.getByLabelText(/Import a character/i), fileOf('nope'))
      expect(await screen.findByRole('alert')).toHaveTextContent(/not valid JSON/i)
      expect(mockImportCharacter).not.toHaveBeenCalled()
    })

    it('surfaces a rejected import', async () => {
      mockImportCharacter.mockRejectedValue(new Error('that schema is not installed'))
      renderView()
      await screen.findByText('Vex')
      await userEvent.upload(
        screen.getByLabelText(/Import a character/i),
        fileOf('{"schema_id":"ghost"}')
      )
      expect(await screen.findByRole('alert')).toHaveTextContent('not installed')
    })
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
      const button = screen.getByText('Manage sheets').closest('button')
      expect(button.style.background).toBe('var(--bg-card)')
      expect(button.className).toBe('')
    })

    it('keeps a disabled action legible so its tooltip can be read', async () => {
      mockList.mockResolvedValue({ characters: [] })
      mockListSchemas.mockResolvedValue({ schemas: [] })
      renderView()
      const button = await screen.findByRole('button', { name: /New character/ })
      expect(button).toBeDisabled()
      // Not faded: fading took the label below a readable contrast. It keeps
      // full-strength muted text and marks itself with a dashed edge instead.
      expect(button.style.opacity).toBe('')
      expect(button.style.color).toBe('var(--text-muted)')
      expect(button.style.borderStyle).toBe('dashed')
      expect(button).toHaveAttribute('title', 'Install a sheet first')
    })
  })
})
