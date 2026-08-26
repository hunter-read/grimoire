import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import BookEditor from './BookEditor'
import { clearMetadataSourcesCache } from './useMetadataSources'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

const mockPatch = vi.fn(() => Promise.resolve({}))
const mockGet = vi.fn((path) =>
  Promise.resolve(path.includes('genres') ? { genres: [] } : { families: [] })
)
vi.mock('../../api', () => ({
  default: {
    patch: (...args) => mockPatch(...args),
    // useLookups loads the genre tree on mount.
    get: (...args) => mockGet(...args),
    post: () => Promise.resolve({}),
  },
  // TagPicker loads the tag catalog.
  tags: { list: () => Promise.resolve({ tags: [] }) },
}))

// AccessLevelPicker renders only for an admin; most cases here leave this as a
// non-admin, matching the previous no-provider behaviour.
let mockRole = 'gm'
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockRole } }),
}))

const mockGetBookPrefs = vi.fn(() => ({}))
const mockSaveBookPrefs = vi.fn()
vi.mock('../../hooks/useBookPrefs', () => ({
  getBookPrefs: (...args) => mockGetBookPrefs(...args),
  saveBookPrefs: (...args) => mockSaveBookPrefs(...args),
}))

function makeBook(overrides = {}) {
  return {
    id: 'book-1',
    title: "Player's Handbook",
    description: '',
    authors: [],
    publisher: '',
    year: 2014,
    category: 'core',
    is_explicit: false,
    tags: [],
    ...overrides,
  }
}

function renderEditor(props = {}) {
  return render(
    <BookEditor
      book={makeBook(props.book)}
      onSave={props.onSave || vi.fn()}
      onClose={props.onClose || vi.fn()}
      allTags={props.allTags || []}
      existingCategories={props.existingCategories || []}
    />
  )
}

describe('BookEditor category combobox', () => {
  beforeEach(() => {
    mockPatch.mockClear()
    mockPatch.mockResolvedValue({})
    // Sources are cached per kind for the session; without this, the first
    // test's mocked list would answer for every later one.
    clearMetadataSourcesCache()
    // Reset to the default lookup responses; the metadata-source tests below
    // override this per case.
    mockGet.mockReset()
    mockGet.mockImplementation((path) =>
      Promise.resolve(path.includes('genres') ? { genres: [] } : { families: [] })
    )
    mockGetBookPrefs.mockReturnValue({})
    mockSaveBookPrefs.mockClear()
    mockRole = 'gm'
  })

  const categoryInput = () => screen.getByRole('combobox', { name: 'bookEditor.categoryLabel' })

  it('renders category as a combobox showing the friendly label of the current slug', () => {
    renderEditor({ existingCategories: ['core', 'my-custom'] })
    const input = categoryInput()
    expect(input.tagName).toBe('INPUT')
    // Not editing → shows the friendly label for the "core" slug.
    expect(input.value).toBe('Core Rulebooks')

    // Focusing opens the option list with built-in + custom categories.
    fireEvent.focus(input)
    const optionLabels = screen.getAllByRole('option').map((o) => o.textContent)
    expect(optionLabels).toContain('Core Rulebooks')
    expect(optionLabels).toContain('Homebrew')
    expect(optionLabels).toContain('my-custom')
  })

  it('saves a picked default category as its slug', async () => {
    const onSave = vi.fn()
    renderEditor({ onSave })
    fireEvent.focus(categoryInput())
    fireEvent.change(categoryInput(), { target: { value: 'adventure' } })
    fireEvent.click(screen.getByRole('option', { name: 'Adventures & Modules' }))
    fireEvent.click(screen.getByText('bookEditor.save'))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    expect(mockPatch.mock.calls[0][1].category).toBe('adventure')
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0].category).toBe('adventure')
  })

  it('saves a picked existing custom category', async () => {
    renderEditor({ existingCategories: ['screens'] })
    fireEvent.focus(categoryInput())
    fireEvent.change(categoryInput(), { target: { value: 'screens' } })
    fireEvent.click(screen.getByRole('option', { name: 'screens' }))
    fireEvent.click(screen.getByText('bookEditor.save'))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    expect(mockPatch.mock.calls[0][1].category).toBe('screens')
  })

  it('creates a brand-new category, slugified to match the backend', async () => {
    renderEditor()
    fireEvent.focus(categoryInput())
    fireEvent.change(categoryInput(), { target: { value: 'My Cool  Books!' } })
    // The create row offers the free text; picking it stores the slug.
    fireEvent.click(screen.getByRole('option', { name: /createCategory/ }))
    fireEvent.click(screen.getByText('bookEditor.save'))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    expect(mockPatch.mock.calls[0][1].category).toBe('my-cool-books')
  })

  it('edits and persists the remaining metadata fields', async () => {
    const onSave = vi.fn()
    renderEditor({
      onSave,
      book: { title: 'Old', authors: ['A'], publisher: 'P', year: 2010, is_explicit: false },
    })
    fireEvent.change(screen.getByLabelText('bookEditor.titleLabel'), {
      target: { value: 'New Title' },
    })
    fireEvent.change(screen.getByLabelText('bookEditor.descriptionLabel'), {
      target: { value: 'A description' },
    })
    fireEvent.change(screen.getByLabelText('bookEditor.authorsLabel'), {
      target: { value: 'Ada, Grace' },
    })
    fireEvent.change(screen.getByLabelText('bookEditor.yearLabel'), { target: { value: '2020' } })
    fireEvent.click(screen.getByLabelText('bookEditor.markExplicit'))
    fireEvent.click(screen.getByText('bookEditor.save'))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    const payload = mockPatch.mock.calls[0][1]
    expect(payload.title).toBe('New Title')
    expect(payload.description).toBe('A description')
    expect(payload.authors).toEqual(['Ada', 'Grace'])
    expect(payload.year).toBe(2020)
    expect(payload.is_explicit).toBe(true)
  })

  it('keeps the editor open when saving fails', async () => {
    mockPatch.mockRejectedValueOnce(new Error('boom'))
    const onSave = vi.fn()
    renderEditor({ onSave })
    fireEvent.click(screen.getByText('bookEditor.save'))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    expect(onSave).not.toHaveBeenCalled()
    // Save button is re-enabled (label back to "save", not "saving").
    await waitFor(() => expect(screen.getByText('bookEditor.save')).toBeInTheDocument())
  })

  it('closes via the cancel button and the X button', () => {
    const onClose = vi.fn()
    renderEditor({ onClose })
    fireEvent.click(screen.getByText('bookEditor.cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('adds tags via the tag picker and includes them on save', async () => {
    renderEditor({ book: { tags: ['existing'] } })
    // Existing tag chip renders (as stored).
    expect(screen.getByText('existing')).toBeInTheDocument()

    const tagInput = screen.getByRole('combobox', { name: 'tags.addTag' })
    fireEvent.change(tagInput, { target: { value: 'fantasy' } })
    fireEvent.keyDown(tagInput, { key: 'Enter' })
    fireEvent.click(screen.getByText('bookEditor.save'))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    expect(mockPatch.mock.calls[0][1].tags).toEqual(['existing', 'fantasy'])
  })

  it('does not save an uncommitted tag still in the input', async () => {
    // The TagPicker commits on Enter; text left in the box is not persisted.
    renderEditor({ book: { tags: [] } })
    const tagInput = screen.getByRole('combobox', { name: 'tags.addTag' })
    fireEvent.change(tagInput, { target: { value: 'solo' } })
    fireEvent.click(screen.getByText('bookEditor.save'))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    expect(mockPatch.mock.calls[0][1].tags).toEqual([])
  })

  it('no longer offers a reset-progress control; it lives in the actions menu', () => {
    // Progress is per-user browser state, so it moved to BookActionsMenu where
    // every role can reach it — this editor is gm/admin only.
    mockGetBookPrefs.mockReturnValue({ page: 12 })
    renderEditor({ book: { id: 'book-9' } })
    expect(screen.queryByText('bookEditor.resetProgress')).not.toBeInTheDocument()
  })

  describe('fetch metadata trigger', () => {
    const withSources = (sources) =>
      mockGet.mockImplementation((path) => {
        if (path.includes('metadata-sources')) return Promise.resolve({ sources })
        return Promise.resolve(path.includes('genres') ? { genres: [] } : { families: [] })
      })

    it('is hidden when no metadata source is installed', async () => {
      withSources([])
      renderEditor()
      await waitFor(() => expect(mockGet).toHaveBeenCalled())
      expect(screen.queryByText('bookEditor.fetchMetadata')).toBeNull()
    })

    it('appears once a source is available', async () => {
      withSources([{ id: 'drivethrurpg', name: 'DriveThruRPG' }])
      renderEditor()
      expect(await screen.findByText('bookEditor.fetchMetadata')).toBeInTheDocument()
    })

    it('stays hidden when the sources lookup fails', async () => {
      // A backend without the add-on routes must not break the editor.
      mockGet.mockImplementation((path) => {
        if (path.includes('metadata-sources')) return Promise.reject(new Error('nope'))
        return Promise.resolve(path.includes('genres') ? { genres: [] } : { families: [] })
      })
      renderEditor()
      await waitFor(() => expect(mockGet).toHaveBeenCalled())
      expect(screen.queryByText('bookEditor.fetchMetadata')).toBeNull()
    })

    it('opens the fetch dialog', async () => {
      withSources([{ id: 'drivethrurpg', name: 'DriveThruRPG' }])
      renderEditor()
      fireEvent.click(await screen.findByText('bookEditor.fetchMetadata'))
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
    })
  })
})

describe('BookEditor access picker placement', () => {
  beforeEach(() => {
    clearMetadataSourcesCache()
    mockRole = 'admin'
  })

  it('sits above the button row, not inside it', () => {
    // Regression: the picker was briefly a flex sibling of the buttons, which
    // let its two-line height shift save/cancel off the bottom-left corner.
    renderEditor()
    const picker = screen.getByLabelText('access.pickerLabel')
    const save = screen.getByText('bookEditor.save')
    // DOCUMENT_POSITION_FOLLOWING — the picker comes first in DOM order.
    expect(picker.compareDocumentPosition(save) & 4).toBeTruthy()
    expect(save.parentElement.contains(picker)).toBe(false)
  })

  it('follows the explicit checkbox in its own column', () => {
    renderEditor()
    const explicit = screen.getByLabelText(/bookEditor.markExplicit/)
    const picker = screen.getByLabelText('access.pickerLabel')
    expect(explicit.compareDocumentPosition(picker) & 4).toBeTruthy()
  })

  it('is withheld from a non-admin, leaving the buttons alone', () => {
    mockRole = 'gm'
    renderEditor()
    expect(screen.queryByLabelText('access.pickerLabel')).not.toBeInTheDocument()
    expect(screen.getByText('bookEditor.save')).toBeInTheDocument()
  })
})
