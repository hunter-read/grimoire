import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import HomebrewView from './HomebrewView'

const mockList = vi.fn()
const mockRemove = vi.fn()
const mockShare = vi.fn()
const mockImport = vi.fn()
const mockExport = vi.fn()
const mockSchemas = vi.fn()
const mockTypes = vi.fn()

vi.mock('../api', () => ({
  homebrew: {
    list: (...a) => mockList(...a),
    remove: (...a) => mockRemove(...a),
    share: (...a) => mockShare(...a),
    import: (...a) => mockImport(...a),
    export: (...a) => mockExport(...a),
    create: vi.fn(),
    update: vi.fn(),
  },
  characters: { listSchemas: (...a) => mockSchemas(...a) },
  content: { types: (...a) => mockTypes(...a) },
}))

const MINE = {
  id: 'h1',
  schema_id: 'demo',
  content_type: 'spell',
  entry_id: 'hellfire',
  name: 'Hellfire Blast',
  visibility: 'private',
  owned: true,
  owner_name: 'Alex',
  used_by: 0,
}

const SHARED = { ...MINE, id: 'h2', name: 'Borrowed Spell', owned: false, owner_name: 'Sam' }

const renderView = () =>
  render(
    <MemoryRouter>
      <HomebrewView />
    </MemoryRouter>
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockList.mockResolvedValue({ entries: [MINE, SHARED] })
  mockSchemas.mockResolvedValue({ schemas: [{ schema_id: 'demo', name: 'Demo' }] })
  mockTypes.mockResolvedValue({ content_types: [{ name: 'spell', label_plural: 'Spells' }] })
})

describe('HomebrewView', () => {
  it('lists entries the user owns and those shared with them', async () => {
    renderView()
    expect(await screen.findByText('Hellfire Blast')).toBeInTheDocument()
    expect(screen.getByText('Borrowed Spell')).toBeInTheDocument()
  })

  it('offers edit and delete only on entries the user owns', async () => {
    renderView()
    await screen.findByText('Hellfire Blast')
    // Sharing grants reading, never writing — so exactly one row is editable.
    expect(screen.getAllByLabelText('Edit')).toHaveLength(1)
    expect(screen.getAllByLabelText(/Delete entry/i)).toHaveLength(1)
    expect(screen.getByText(/Shared with you/i)).toBeInTheDocument()
  })

  it('changes visibility', async () => {
    mockShare.mockResolvedValue({ ...MINE, visibility: 'public' })
    renderView()
    await screen.findByText('Hellfire Blast')
    await userEvent.selectOptions(screen.getByLabelText(/Who can see this/i), 'public')
    await waitFor(() => expect(mockShare).toHaveBeenCalledWith('h1', { visibility: 'public' }))
  })

  it('warns how many characters a deletion would affect', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    mockList.mockResolvedValue({ entries: [{ ...MINE, used_by: 2 }] })
    renderView()
    await screen.findByText('Hellfire Blast')

    await userEvent.click(screen.getByLabelText(/Delete entry/i))
    expect(confirm.mock.calls[0][0]).toMatch(/2 of your characters/i)
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it('deletes after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockRemove.mockResolvedValue({})
    renderView()
    await screen.findByText('Hellfire Blast')
    await userEvent.click(screen.getByLabelText(/Delete entry/i))
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('h1'))
  })

  it('shows how many characters use an entry', async () => {
    mockList.mockResolvedValue({ entries: [{ ...MINE, used_by: 3 }] })
    renderView()
    expect(await screen.findByText(/used by 3 characters/i)).toBeInTheDocument()
  })

  it('needs a system and type before a new entry can be written', async () => {
    renderView()
    await screen.findByText('Hellfire Blast')
    expect(screen.getByText(/New entry/i).closest('button')).toBeDisabled()
  })

  it('enables creation once both are chosen', async () => {
    renderView()
    await screen.findByText('Hellfire Blast')
    await userEvent.selectOptions(screen.getByLabelText(/System/i), 'demo')
    await waitFor(() => expect(mockTypes).toHaveBeenCalledWith('demo'))
    await userEvent.selectOptions(await screen.findByLabelText(/^Type$/i), 'spell')
    expect(screen.getByText(/New entry/i).closest('button')).not.toBeDisabled()
  })

  it('imports a pasted pack', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    mockImport.mockResolvedValue({ imported: 1, skipped: 0, renamed: 0, overwritten: 0 })
    renderView()
    await screen.findByText('Hellfire Blast')

    await userEvent.click(screen.getByText(/Import a pack/i))
    // Typed via fireEvent rather than userEvent.type: the pack is JSON, and
    // userEvent reads `{` as its own escape syntax.
    fireEvent.change(screen.getByLabelText(/Paste a homebrew pack/i), {
      target: { value: '{"schema_id":"demo","entries":{}}' },
    })
    await userEvent.click(screen.getAllByText(/Import a pack/i)[1])
    await waitFor(() => expect(mockImport).toHaveBeenCalled())
  })

  it('rejects invalid JSON without calling the API', async () => {
    renderView()
    await screen.findByText('Hellfire Blast')
    await userEvent.click(screen.getByText(/Import a pack/i))
    fireEvent.change(screen.getByLabelText(/Paste a homebrew pack/i), {
      target: { value: 'nope' },
    })
    await userEvent.click(screen.getAllByText(/Import a pack/i)[1])
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid JSON/i)
    expect(mockImport).not.toHaveBeenCalled()
  })

  it('shows an empty state', async () => {
    mockList.mockResolvedValue({ entries: [] })
    renderView()
    expect(await screen.findByText(/No homebrew yet/i)).toBeInTheDocument()
  })

  it('exports a pack as a download', async () => {
    const pack = { schema_id: 'demo', entries: {} }
    mockExport.mockResolvedValue(pack)
    global.URL.createObjectURL = vi.fn(() => 'blob:x')
    global.URL.revokeObjectURL = vi.fn()

    renderView()
    await screen.findByText('Hellfire Blast')
    await userEvent.selectOptions(screen.getByLabelText(/System/i), 'demo')

    // Only the anchor the download creates is stubbed, and only for that
    // click: a blanket createElement mock breaks Testing Library's own render.
    const click = vi.fn()
    const realCreate = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'a') return realCreate(tag)
      return { click, set href(v) {}, set download(v) {} }
    })
    await userEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(mockExport).toHaveBeenCalledWith('demo'))
    expect(click).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('surfaces an export failure', async () => {
    mockExport.mockRejectedValue(new Error('export broke'))
    renderView()
    await screen.findByText('Hellfire Blast')
    await userEvent.selectOptions(screen.getByLabelText(/System/i), 'demo')
    await userEvent.click(screen.getByText('Export'))
    expect(await screen.findByRole('alert')).toHaveTextContent('export broke')
  })

  it('surfaces a delete failure', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockRemove.mockRejectedValue(new Error('delete broke'))
    renderView()
    await screen.findByText('Hellfire Blast')
    await userEvent.click(screen.getByLabelText(/Delete entry/i))
    expect(await screen.findByRole('alert')).toHaveTextContent('delete broke')
  })

  it('surfaces a share failure', async () => {
    mockShare.mockRejectedValue(new Error('share broke'))
    renderView()
    await screen.findByText('Hellfire Blast')
    await userEvent.selectOptions(screen.getByLabelText(/Who can see this/i), 'public')
    expect(await screen.findByRole('alert')).toHaveTextContent('share broke')
  })

  it('surfaces an import failure', async () => {
    mockImport.mockRejectedValue(new Error('import broke'))
    renderView()
    await screen.findByText('Hellfire Blast')
    await userEvent.click(screen.getByText(/Import a pack/i))
    fireEvent.change(screen.getByLabelText(/Paste a homebrew pack/i), {
      target: { value: '{"schema_id":"demo","entries":{}}' },
    })
    await userEvent.click(screen.getAllByText(/Import a pack/i)[1])
    expect(await screen.findByRole('alert')).toHaveTextContent('import broke')
  })

  it('falls back to no types when the schema has none', async () => {
    mockTypes.mockRejectedValue(new Error('no types'))
    renderView()
    await screen.findByText('Hellfire Blast')
    await userEvent.selectOptions(screen.getByLabelText(/System/i), 'demo')
    await waitFor(() => expect(screen.getByLabelText(/^Type$/i)).toBeDisabled())
  })

  it('opens the editor for an owned entry', async () => {
    renderView()
    await screen.findByText('Hellfire Blast')
    await userEvent.click(screen.getByLabelText('Edit'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('surfaces a load failure', async () => {
    mockList.mockRejectedValue(new Error('boom'))
    renderView()
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })
})
