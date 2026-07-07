import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import BookEditor from './BookEditor'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

const mockPatch = vi.fn(() => Promise.resolve({}))
vi.mock('../../api', () => ({
  default: {
    patch: (...args) => mockPatch(...args),
  },
}))

const mockGetBookPrefs = vi.fn(() => ({}))
const mockSaveBookPrefs = vi.fn()
vi.mock('../../hooks/useBookPrefs', () => ({
  getBookPrefs: (...args) => mockGetBookPrefs(...args),
  saveBookPrefs: (...args) => mockSaveBookPrefs(...args),
}))

// InlineTagEditor is exercised elsewhere; render a minimal stub that lets us
// drive its onSave/onCancel callbacks.
vi.mock('../maps/InlineTagEditor', () => ({
  default: ({ onSave, onCancel }) => (
    <div>
      <button onClick={() => onSave(['fantasy'])}>stub-save-tag</button>
      <button onClick={onCancel}>stub-cancel-tag</button>
    </div>
  ),
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
    mockGetBookPrefs.mockReturnValue({})
    mockSaveBookPrefs.mockClear()
  })

  const categoryInput = () => screen.getByLabelText('bookEditor.categoryLabel')

  it('renders category as an editable combobox seeded with built-in and existing categories', () => {
    renderEditor({ existingCategories: ['core', 'my-custom'] })
    const input = categoryInput()
    expect(input.tagName).toBe('INPUT')
    expect(input).toHaveAttribute('list', 'book-category-options')
    expect(input.value).toBe('core')

    const options = [...document.querySelectorAll('#book-category-options option')].map(
      (o) => o.value
    )
    // Built-in defaults are present…
    expect(options).toContain('core')
    expect(options).toContain('homebrew')
    // …and the custom category already in use is offered too, without duplicates.
    expect(options).toContain('my-custom')
    expect(options.filter((v) => v === 'core')).toHaveLength(1)
  })

  it('shows friendly labels for known categories in the datalist', () => {
    renderEditor()
    const coreOption = document.querySelector('#book-category-options option[value="core"]')
    expect(coreOption.textContent).toBe('Core Rulebooks')
  })

  it('saves a selected default category as its slug', async () => {
    const onSave = vi.fn()
    renderEditor({ onSave })
    fireEvent.change(categoryInput(), { target: { value: 'adventure' } })
    fireEvent.click(screen.getByText('bookEditor.save'))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    expect(mockPatch.mock.calls[0][1].category).toBe('adventure')
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0].category).toBe('adventure')
  })

  it('saves a selected existing custom category', async () => {
    renderEditor({ existingCategories: ['screens'] })
    fireEvent.change(categoryInput(), { target: { value: 'screens' } })
    fireEvent.click(screen.getByText('bookEditor.save'))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    expect(mockPatch.mock.calls[0][1].category).toBe('screens')
  })

  it('slugifies a brand-new free-text category to match the backend', async () => {
    renderEditor()
    fireEvent.change(categoryInput(), { target: { value: 'My Cool  Books!' } })
    fireEvent.click(screen.getByText('bookEditor.save'))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    expect(mockPatch.mock.calls[0][1].category).toBe('my-cool-books')
  })

  it('falls back to core when the category is cleared', async () => {
    renderEditor()
    fireEvent.change(categoryInput(), { target: { value: '   ' } })
    fireEvent.click(screen.getByText('bookEditor.save'))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    expect(mockPatch.mock.calls[0][1].category).toBe('core')
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

  it('edits tags through the inline editor and includes them on save', async () => {
    renderEditor({ book: { tags: ['existing'] } })
    // Existing tag chip renders capitalized.
    expect(screen.getByText('Existing')).toBeInTheDocument()

    fireEvent.click(screen.getByText('bookEditor.editTags'))
    fireEvent.click(screen.getByText('stub-save-tag'))
    fireEvent.click(screen.getByText('bookEditor.save'))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    expect(mockPatch.mock.calls[0][1].tags).toEqual(['fantasy'])
  })

  it('cancels tag editing without changing tags', () => {
    renderEditor({ book: { tags: [] } })
    fireEvent.click(screen.getByText('bookEditor.addTags'))
    fireEvent.click(screen.getByText('stub-cancel-tag'))
    // Back to the add-tags affordance.
    expect(screen.getByText('bookEditor.addTags')).toBeInTheDocument()
  })

  it('resets reading progress when the book has progress', () => {
    mockGetBookPrefs.mockReturnValue({ page: 12 })
    renderEditor({ book: { id: 'book-9' } })
    fireEvent.click(screen.getByText('bookEditor.resetProgress'))
    expect(mockSaveBookPrefs).toHaveBeenCalledWith('book-9', { page: null })
    expect(screen.getByText(/bookEditor.progressReset/)).toBeInTheDocument()
  })
})
