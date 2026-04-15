import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BookFolderGroup from './BookFolderGroup'
import * as FavCtx from '../../context/FavoritesContext'
import * as api from '../../api'

vi.mock('../../context/FavoritesContext', () => ({
  useFavorites: vi.fn(),
}))

vi.mock('../../api', () => ({
  default: {},
  mediaUrl: (path) => `http://localhost${path}`,
}))

// BookEditor makes its own API calls — stub it out so tests stay focused.
vi.mock('./BookEditor', () => ({
  default: ({ onClose }) => (
    <div data-testid="book-editor">
      <button onClick={onClose}>Close Editor</button>
    </div>
  ),
}))

function makeBook(overrides = {}) {
  return {
    id: `book-${Math.random().toString(36).slice(2)}`,
    title: 'Test Book',
    category: 'adventure',
    page_count: 200,
    year: 2021,
    publisher: 'Paizo',
    has_thumbnail: false,
    is_explicit: false,
    is_missing: false,
    indexed: false,
    index_failed: false,
    index_error: '',
    tags: [],
    relative_path: 'books/PF2e/adventures/Abomination Vaults/book.pdf',
    ...overrides,
  }
}

function makeProps(overrides = {}) {
  return {
    folder: 'Abomination Vaults',
    books: [makeBook()],
    systemId: 'system-1',
    category: 'adventure',
    collapsed: new Set(),
    onToggle: vi.fn(),
    editingBookId: null,
    setEditingBookId: vi.fn(),
    onOpenBook: vi.fn(),
    isEditor: false,
    onSaveBook: vi.fn(),
    onDownload: vi.fn(),
    ...overrides,
  }
}

describe('BookFolderGroup', () => {
  beforeEach(() => {
    FavCtx.useFavorites.mockReturnValue({
      isFavorite: () => false,
      toggleFavorite: vi.fn(),
    })
  })

  // --- Folder header ---

  it('renders the folder name in the header', () => {
    render(<BookFolderGroup {...makeProps()} />)
    expect(screen.getByText('Abomination Vaults')).toBeInTheDocument()
  })

  it('renders the book count in the header', () => {
    const books = [makeBook(), makeBook()]
    render(<BookFolderGroup {...makeProps({ books })} />)
    expect(screen.getByText('(2)')).toBeInTheDocument()
  })

  it('renders a download button', () => {
    render(<BookFolderGroup {...makeProps()} />)
    expect(screen.getByText('Download')).toBeInTheDocument()
  })

  // --- Expand / collapse ---

  it('shows book rows when folder is expanded', () => {
    const book = makeBook({ title: 'Ruins of Gauntlight' })
    render(<BookFolderGroup {...makeProps({ books: [book] })} />)
    expect(screen.getByText('Ruins of Gauntlight')).toBeInTheDocument()
  })

  it('hides book rows when folder key is in collapsed set', () => {
    const book = makeBook({ title: 'Ruins of Gauntlight' })
    const collapsed = new Set(['adventure::Abomination Vaults'])
    render(<BookFolderGroup {...makeProps({ books: [book], collapsed })} />)
    expect(screen.queryByText('Ruins of Gauntlight')).not.toBeInTheDocument()
  })

  it('calls onToggle with category::folder key when header is clicked', async () => {
    const onToggle = vi.fn()
    render(<BookFolderGroup {...makeProps({ onToggle })} />)
    await userEvent.click(screen.getByRole('button', { name: /abomination vaults/i }))
    expect(onToggle).toHaveBeenCalledWith('adventure::Abomination Vaults')
  })

  // --- Collapse key is namespaced by category ---

  it('uses category::folder as the collapse key, so same name in different categories collapses independently', () => {
    // A "monsters" folder under core should collapse independently from one under supplement
    const coreProps = makeProps({ folder: 'monsters', category: 'core', collapsed: new Set(['core::monsters']) })
    const { rerender } = render(<BookFolderGroup {...coreProps} />)
    expect(screen.queryByText(coreProps.books[0].title)).not.toBeInTheDocument()

    const suppProps = makeProps({ folder: 'monsters', category: 'supplement', collapsed: new Set() })
    rerender(<BookFolderGroup {...suppProps} />)
    expect(screen.getByText(suppProps.books[0].title)).toBeInTheDocument()
  })

  // --- Multiple books ---

  it('renders all books in the folder', () => {
    const books = [
      makeBook({ title: 'Ruins of Gauntlight' }),
      makeBook({ title: 'Hands of the Devil' }),
      makeBook({ title: 'Eyes of Empty Death' }),
    ]
    render(<BookFolderGroup {...makeProps({ books })} />)
    expect(screen.getByText('Ruins of Gauntlight')).toBeInTheDocument()
    expect(screen.getByText('Hands of the Devil')).toBeInTheDocument()
    expect(screen.getByText('Eyes of Empty Death')).toBeInTheDocument()
  })

  // --- onOpenBook callback ---

  it('calls onOpenBook when a book row is clicked', async () => {
    const onOpenBook = vi.fn()
    const book = makeBook({ title: 'Ruins of Gauntlight' })
    render(<BookFolderGroup {...makeProps({ books: [book], onOpenBook })} />)
    await userEvent.click(screen.getByRole('button', { name: /ruins of gauntlight/i }))
    expect(onOpenBook).toHaveBeenCalledWith(book)
  })

  // --- Edit button ---

  it('does not show edit button when isEditor is false', () => {
    render(<BookFolderGroup {...makeProps({ isEditor: false })} />)
    expect(screen.queryByLabelText(/edit metadata/i)).not.toBeInTheDocument()
  })

  it('shows edit button when isEditor is true', () => {
    render(<BookFolderGroup {...makeProps({ isEditor: true })} />)
    expect(screen.getByLabelText(/edit metadata/i)).toBeInTheDocument()
  })

  it('calls setEditingBookId when edit button is clicked', async () => {
    const setEditingBookId = vi.fn()
    render(<BookFolderGroup {...makeProps({ isEditor: true, setEditingBookId })} />)
    await userEvent.click(screen.getByLabelText(/edit metadata/i))
    expect(setEditingBookId).toHaveBeenCalled()
  })

  it('renders BookEditor when editingBookId matches a book', () => {
    const book = makeBook()
    render(<BookFolderGroup {...makeProps({ books: [book], editingBookId: book.id, isEditor: true })} />)
    expect(screen.getByTestId('book-editor')).toBeInTheDocument()
  })

  it('does not render BookEditor when editingBookId does not match any book', () => {
    render(<BookFolderGroup {...makeProps({ editingBookId: 'other-id' })} />)
    expect(screen.queryByTestId('book-editor')).not.toBeInTheDocument()
  })

  // --- Download callback ---

  it('calls onDownload with correct params when download button is clicked', async () => {
    const onDownload = vi.fn()
    render(<BookFolderGroup {...makeProps({ onDownload, systemId: 'sys-42', category: 'adventure', folder: 'Abomination Vaults' })} />)
    await userEvent.click(screen.getByText('Download'))
    expect(onDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          type: 'book_folder',
          id: 'sys-42',
          category: 'adventure',
          folder: 'Abomination Vaults',
        }),
      })
    )
  })
})
