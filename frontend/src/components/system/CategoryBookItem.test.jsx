import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CategoryBookItem from './CategoryBookItem'

// BookRow / BookEditor have their own coverage; stub them to keep this focused
// on CategoryBookItem's wiring (edit toggle, save/close, selection).
vi.mock('./BookRow', () => ({
  default: ({ book, editing, onOpen, onEdit, onToggle, selected }) => (
    <div data-testid="book-row">
      <span>{book.title}</span>
      <span data-testid="editing">{String(editing)}</span>
      <span data-testid="selected">{String(selected)}</span>
      <button onClick={onOpen}>open</button>
      {onEdit && <button onClick={onEdit}>edit</button>}
      <button onClick={() => onToggle({ shift: true })}>toggle</button>
    </div>
  ),
}))

vi.mock('./BookEditor', () => ({
  default: ({ onSave, onClose }) => (
    <div data-testid="book-editor">
      <button onClick={() => onSave({ title: 'Saved' })}>save</button>
      <button onClick={onClose}>close</button>
    </div>
  ),
}))

const book = { id: 'b1', title: 'The Book', relative_path: '' }

function baseProps(overrides = {}) {
  return {
    book,
    card: false,
    compact: false,
    list: false,
    editingBookId: null,
    setEditingBookId: vi.fn(),
    allTags: [],
    existingCategories: [],
    isEditor: true,
    onOpenBook: vi.fn(),
    onSaveBook: vi.fn(),
    bulkMode: false,
    selectedBookIds: new Set(),
    onToggleBook: vi.fn(),
    ...overrides,
  }
}

describe('CategoryBookItem', () => {
  it('renders the BookRow and no editor when not editing', () => {
    render(<CategoryBookItem {...baseProps()} />)
    expect(screen.getByText('The Book')).toBeInTheDocument()
    expect(screen.queryByTestId('book-editor')).not.toBeInTheDocument()
    expect(screen.getByTestId('editing')).toHaveTextContent('false')
  })

  it('shows the editor when this book is being edited', () => {
    render(<CategoryBookItem {...baseProps({ editingBookId: 'b1' })} />)
    expect(screen.getByTestId('book-editor')).toBeInTheDocument()
    expect(screen.getByTestId('editing')).toHaveTextContent('true')
  })

  it('opens the book via onOpenBook', () => {
    const onOpenBook = vi.fn()
    render(<CategoryBookItem {...baseProps({ onOpenBook })} />)
    fireEvent.click(screen.getByText('open'))
    expect(onOpenBook).toHaveBeenCalledWith(book)
  })

  it('toggles the editor id when edit is clicked', () => {
    const setEditingBookId = vi.fn()
    render(<CategoryBookItem {...baseProps({ setEditingBookId })} />)
    fireEvent.click(screen.getByText('edit'))
    // Called with an updater function; applying it to null opens this book.
    const updater = setEditingBookId.mock.calls[0][0]
    expect(updater(null)).toBe('b1')
    expect(updater('b1')).toBe(null)
  })

  it('hides the edit affordance for non-editors', () => {
    render(<CategoryBookItem {...baseProps({ isEditor: false })} />)
    expect(screen.queryByText('edit')).not.toBeInTheDocument()
  })

  it('saves via onSaveBook and closes the editor', () => {
    const onSaveBook = vi.fn()
    const setEditingBookId = vi.fn()
    render(
      <CategoryBookItem {...baseProps({ editingBookId: 'b1', onSaveBook, setEditingBookId })} />
    )
    fireEvent.click(screen.getByText('save'))
    expect(onSaveBook).toHaveBeenCalledWith('b1', { title: 'Saved' })
    expect(setEditingBookId).toHaveBeenCalledWith(null)
  })

  it('reflects selection state and forwards toggle mods', () => {
    const onToggleBook = vi.fn()
    render(<CategoryBookItem {...baseProps({ selectedBookIds: new Set(['b1']), onToggleBook })} />)
    expect(screen.getByTestId('selected')).toHaveTextContent('true')
    fireEvent.click(screen.getByText('toggle'))
    expect(onToggleBook).toHaveBeenCalledWith('b1', { shift: true })
  })
})
