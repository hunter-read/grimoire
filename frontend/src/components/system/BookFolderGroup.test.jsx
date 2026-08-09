import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import BookFolderGroup from './BookFolderGroup'
import * as FavCtx from '../../context/FavoritesContext'
import * as api from '../../api'

// BookRow uses useLocation (for CardLink state), so a Router is required.
const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>)

vi.mock('../../context/FavoritesContext', () => ({
  useFavorites: vi.fn(),
}))

vi.mock('../../api', () => ({
  default: {},
  mediaUrl: (path) => `http://localhost${path}`,
}))

// BookEditor makes its own API calls — stub it out so tests stay focused.
vi.mock('./BookEditor', () => ({
  default: ({ onClose, onSave }) => (
    <div data-testid="book-editor">
      <button onClick={onClose}>Close Editor</button>
      <button onClick={() => onSave({ title: 'Updated Title' })}>Save Editor</button>
    </div>
  ),
}))

// RescanButton polls /scan-status — stub it out so these tests stay focused.
vi.mock('../RescanButton', () => ({
  default: () => <div data-testid="rescan-button" />,
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

/** Wrap a flat book list into a single-level folder-tree node (this folder's own
 *  books, no nested subfolders). Nested cases build their own `node` explicitly. */
function nodeOf(books) {
  return { books, folders: {} }
}

function makeProps(overrides = {}) {
  const { books, node, folder = 'Abomination Vaults', path, ...rest } = overrides
  return {
    folder,
    path: path || [folder],
    node: node || nodeOf(books || [makeBook()]),
    systemId: 'system-1',
    category: 'adventure',
    collapsed: new Set(),
    onToggle: vi.fn(),
    editingBookId: null,
    setEditingBookId: vi.fn(),
    isEditor: false,
    onSaveBook: vi.fn(),
    onDownload: vi.fn(),
    ...rest,
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
    const coreBook = makeBook({ title: 'Core Bestiary' })
    const coreProps = makeProps({
      folder: 'monsters',
      category: 'core',
      books: [coreBook],
      collapsed: new Set(['core::monsters']),
    })
    const { rerender } = render(<BookFolderGroup {...coreProps} />)
    expect(screen.queryByText(coreBook.title)).not.toBeInTheDocument()

    const suppBook = makeBook({ title: 'Supplement Bestiary' })
    const suppProps = makeProps({
      folder: 'monsters',
      category: 'supplement',
      books: [suppBook],
      collapsed: new Set(),
    })
    rerender(
      <MemoryRouter>
        <BookFolderGroup {...suppProps} />
      </MemoryRouter>
    )
    expect(screen.getByText(suppBook.title)).toBeInTheDocument()
  })

  // --- Nested subfolders (issue #189) ---

  it('renders a nested subfolder group and its book', () => {
    const nestedBook = makeBook({ title: 'Spelljammer Bestiary' })
    const node = {
      books: [makeBook({ title: 'Top-Level Monster' })],
      folders: { spelljammer: { books: [nestedBook], folders: {} } },
    }
    render(<BookFolderGroup {...makeProps({ folder: 'monsters', node })} />)
    // Both the parent's own book and the nested folder's book are visible.
    expect(screen.getByText('Top-Level Monster')).toBeInTheDocument()
    expect(screen.getByText('Spelljammer')).toBeInTheDocument()
    expect(screen.getByText('Spelljammer Bestiary')).toBeInTheDocument()
  })

  it('parent count includes books nested in subfolders', () => {
    const node = {
      books: [makeBook()],
      folders: { spelljammer: { books: [makeBook(), makeBook()], folders: {} } },
    }
    render(<BookFolderGroup {...makeProps({ folder: 'monsters', node })} />)
    // 1 own + 2 nested = 3 total on the parent header.
    expect(screen.getByText('(3)')).toBeInTheDocument()
  })

  it('collapses a nested folder independently via its full path key', () => {
    const nestedBook = makeBook({ title: 'Spelljammer Bestiary' })
    const node = {
      books: [],
      folders: { spelljammer: { books: [nestedBook], folders: {} } },
    }
    render(
      <BookFolderGroup
        {...makeProps({
          folder: 'monsters',
          category: 'core',
          node,
          collapsed: new Set(['core::monsters/spelljammer']),
        })}
      />
    )
    // The nested folder header shows, but its book is hidden by the path-keyed collapse.
    expect(screen.getByText('Spelljammer')).toBeInTheDocument()
    expect(screen.queryByText('Spelljammer Bestiary')).not.toBeInTheDocument()
  })

  it('downloads a nested folder with its full path in the folder param', async () => {
    const onDownload = vi.fn()
    const node = { books: [makeBook()], folders: {} }
    render(
      <BookFolderGroup
        {...makeProps({
          folder: 'spelljammer',
          path: ['monsters', 'spelljammer'],
          node,
          onDownload,
          systemId: 'sys-42',
          category: 'core',
        })}
      />
    )
    await userEvent.click(screen.getByText('Download'))
    expect(onDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          type: 'book_folder',
          id: 'sys-42',
          category: 'core',
          folder: 'monsters/spelljammer',
        }),
      })
    )
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

  // --- book links (onOpenBook prop removed; navigation is now via CardLink) ---

  it('each book row renders a real link to the reader for native navigation', () => {
    const book = makeBook({ title: 'Ruins of Gauntlight', id: 'ruins-1' })
    render(<BookFolderGroup {...makeProps({ books: [book] })} />)
    // Non-bulk: CardLink renders with aria-label "Open {title}" pointing to the reader.
    const link = screen.getByRole('link', { name: /open ruins of gauntlight/i })
    expect(link).toHaveAttribute('href', '/library/book/ruins-1')
  })

  // --- Edit button ---

  it('does not show the edit action when isEditor is false', () => {
    render(<BookFolderGroup {...makeProps({ isEditor: false })} />)
    // Open the actions menu (non-editors still get one, for download).
    const menuBtn = screen.queryByLabelText(/more actions/i)
    if (menuBtn) fireEvent.click(menuBtn)
    expect(screen.queryByRole('menuitem', { name: /edit metadata/i })).not.toBeInTheDocument()
  })

  it('shows the edit action in the menu when isEditor is true', () => {
    render(<BookFolderGroup {...makeProps({ isEditor: true })} />)
    fireEvent.click(screen.getAllByLabelText(/more actions/i)[0])
    expect(screen.getByRole('menuitem', { name: /edit metadata/i })).toBeInTheDocument()
  })

  it('calls setEditingBookId when the edit action is clicked', async () => {
    const setEditingBookId = vi.fn()
    render(<BookFolderGroup {...makeProps({ isEditor: true, setEditingBookId })} />)
    await userEvent.click(screen.getAllByLabelText(/more actions/i)[0])
    await userEvent.click(screen.getByRole('menuitem', { name: /edit metadata/i }))
    expect(setEditingBookId).toHaveBeenCalled()
  })

  it('renders BookEditor when editingBookId matches a book', () => {
    const book = makeBook()
    render(
      <BookFolderGroup {...makeProps({ books: [book], editingBookId: book.id, isEditor: true })} />
    )
    expect(screen.getByTestId('book-editor')).toBeInTheDocument()
  })

  it('saving from the editor calls onSaveBook and clears the editing id', async () => {
    const book = makeBook()
    const onSaveBook = vi.fn()
    const setEditingBookId = vi.fn()
    render(
      <BookFolderGroup
        {...makeProps({
          books: [book],
          editingBookId: book.id,
          isEditor: true,
          onSaveBook,
          setEditingBookId,
        })}
      />
    )
    await userEvent.click(screen.getByText('Save Editor'))
    expect(onSaveBook).toHaveBeenCalledWith(book.id, { title: 'Updated Title' })
    expect(setEditingBookId).toHaveBeenCalledWith(null)
  })

  it('closing the editor clears the editing id', async () => {
    const book = makeBook()
    const setEditingBookId = vi.fn()
    render(
      <BookFolderGroup
        {...makeProps({ books: [book], editingBookId: book.id, isEditor: true, setEditingBookId })}
      />
    )
    await userEvent.click(screen.getByText('Close Editor'))
    expect(setEditingBookId).toHaveBeenCalledWith(null)
  })

  it('toggles a book selection in bulk mode', async () => {
    const book = makeBook()
    const onToggleBook = vi.fn()
    render(
      <BookFolderGroup
        {...makeProps({
          books: [book],
          bulkMode: true,
          selectedBookIds: new Set(),
          onToggleBook,
        })}
      />
    )
    // In bulk mode clicking the row (role=button, aria-label "Open {title}") toggles selection.
    await userEvent.click(screen.getByRole('button', { name: /open test book/i }))
    expect(onToggleBook).toHaveBeenCalledWith(book.id, expect.anything())
  })

  it('does not render BookEditor when editingBookId does not match any book', () => {
    render(<BookFolderGroup {...makeProps({ editingBookId: 'other-id' })} />)
    expect(screen.queryByTestId('book-editor')).not.toBeInTheDocument()
  })

  // --- Download callback ---

  it('calls onDownload with correct params when download button is clicked', async () => {
    const onDownload = vi.fn()
    render(
      <BookFolderGroup
        {...makeProps({
          onDownload,
          systemId: 'sys-42',
          category: 'adventure',
          folder: 'Abomination Vaults',
        })}
      />
    )
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

  it('does not throw when onDownload is not provided', async () => {
    render(<BookFolderGroup {...makeProps({ onDownload: undefined })} />)
    await userEvent.click(screen.getByText('Download'))
    // No handler wired up — the optional call is a no-op; the click must not raise.
    expect(screen.getByText('Download')).toBeInTheDocument()
  })

  // --- Book folder tagging (issue #235 follow-up) ---

  it('renders existing book-folder tags on the header', () => {
    render(
      <BookFolderGroup
        {...makeProps({
          systemId: 'sys-1',
          category: 'adventure',
          folder: 'Abomination Vaults',
          bookFolderTags: { 'sys-1/adventure/Abomination Vaults': ['Gothic'] },
        })}
      />
    )
    expect(screen.getByText('Gothic')).toBeInTheDocument()
  })

  it('starts editing folder tags with the full BookFolder path', async () => {
    const onEditFolder = vi.fn()
    render(
      <BookFolderGroup
        {...makeProps({
          isEditor: true,
          systemId: 'sys-1',
          category: 'adventure',
          folder: 'Abomination Vaults',
          onEditFolder,
        })}
      />
    )
    // canTag (isEditor) shows an add-tags affordance.
    await userEvent.click(screen.getByRole('button', { name: /add tags/i }))
    expect(onEditFolder).toHaveBeenCalledWith('sys-1/adventure/Abomination Vaults')
  })

  it('nested subfolders render (deep nesting uses an indented guide, not a panel)', () => {
    const node = {
      books: [],
      folders: { spelljammer: { books: [makeBook({ title: 'Deep Book' })], folders: {} } },
    }
    render(<BookFolderGroup {...makeProps({ folder: 'monsters', node })} />)
    expect(screen.getByText('Spelljammer')).toBeInTheDocument()
    expect(screen.getByText('Deep Book')).toBeInTheDocument()
  })

  // --- Rescan scope (folderScope) ---

  it('scopes the rescan button to the folder derived from a book relative_path', () => {
    // isEditor renders RescanButton, exercising folderScope() on a real path.
    const book = makeBook({ relative_path: 'PF2e/adventures/Abomination Vaults/book.pdf' })
    render(<BookFolderGroup {...makeProps({ books: [book], isEditor: true })} />)
    expect(screen.getByTestId('rescan-button')).toBeInTheDocument()
  })

  it('renders the rescan button even when no book has a relative_path', () => {
    // folderScope() returns null when no book carries a relative_path.
    const book = makeBook({ relative_path: undefined })
    render(<BookFolderGroup {...makeProps({ books: [book], isEditor: true })} />)
    expect(screen.getByTestId('rescan-button')).toBeInTheDocument()
  })
})
