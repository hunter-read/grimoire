import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SystemCategorySection from './SystemCategorySection'

vi.mock('../RescanButton', () => ({ default: () => <div data-testid="rescan" /> }))

// Represent each book item / folder group by a testid so we can assert the
// flat-vs-grouped branch selection without their full render trees.
vi.mock('./CategoryBookItem', () => ({
  default: ({ book }) => <div data-testid="book-item">{book.id}</div>,
}))
vi.mock('./BookFolderGroup', () => ({
  default: ({ folder }) => <div data-testid="folder-group">{folder}</div>,
}))

const system = { id: 'sys1', name: 'D&D 5e' }

function flatBook(id) {
  // 4 segments → no subfolder (sits directly in the category dir)
  return { id, title: id, relative_path: `books/D&D 5e/adventure/${id}.pdf` }
}
function subfolderBook(id, folder) {
  // 5 segments → parts[3] is the subfolder
  return { id, title: id, relative_path: `books/D&D 5e/adventure/${folder}/${id}.pdf` }
}

function baseProps(overrides = {}) {
  return {
    cat: 'adventure',
    books: [flatBook('b1'), flatBook('b2')],
    system,
    isCollapsed: false,
    onToggleCat: vi.fn(),
    collapsedSubfolders: new Set(),
    onToggleSubfolder: vi.fn(),
    groupScope: () => 'books/D&D 5e/adventure',
    editingBookId: null,
    setEditingBookId: vi.fn(),
    allTags: [],
    existingCategories: [],
    card: false,
    compact: false,
    list: false,
    booksContainerStyle: {},
    isEditor: true,
    onOpenBook: vi.fn(),
    onSaveBook: vi.fn(),
    onDownload: vi.fn(),
    bulkMode: false,
    selectedBookIds: new Set(),
    onToggleBook: vi.fn(),
    ...overrides,
  }
}

describe('SystemCategorySection', () => {
  it('renders the category label and book count', () => {
    render(<SystemCategorySection {...baseProps()} />)
    // "adventure" resolves via i18n categories.adventure (falls back to Title Case).
    expect(screen.getByText(/adventure/i)).toBeInTheDocument()
    expect(screen.getByText('(2)')).toBeInTheDocument()
  })

  it('renders a flat book list when no book has a subfolder', () => {
    render(<SystemCategorySection {...baseProps()} />)
    expect(screen.getAllByTestId('book-item')).toHaveLength(2)
    expect(screen.queryByTestId('folder-group')).not.toBeInTheDocument()
  })

  it('renders folder groups (and ungrouped items) when subfolders exist', () => {
    render(
      <SystemCategorySection
        {...baseProps({
          books: [flatBook('loose'), subfolderBook('b3', 'Monsters')],
        })}
      />
    )
    // The loose book renders as an ungrouped item; the subfolder as a group.
    expect(screen.getByTestId('folder-group')).toHaveTextContent('Monsters')
    expect(screen.getByTestId('book-item')).toHaveTextContent('loose')
  })

  it('hides the body when collapsed', () => {
    render(<SystemCategorySection {...baseProps({ isCollapsed: true })} />)
    expect(screen.queryByTestId('book-item')).not.toBeInTheDocument()
  })

  it('toggles the category via onToggleCat', () => {
    const onToggleCat = vi.fn()
    render(<SystemCategorySection {...baseProps({ onToggleCat })} />)
    fireEvent.click(screen.getByRole('button', { expanded: true }))
    expect(onToggleCat).toHaveBeenCalled()
  })

  it('fires onDownload with the category-scoped params', () => {
    const onDownload = vi.fn()
    render(<SystemCategorySection {...baseProps({ onDownload })} />)
    fireEvent.click(screen.getByTitle(/download/i))
    expect(onDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { type: 'system_category', id: 'sys1', category: 'adventure' },
      })
    )
  })

  it('omits the rescan button for non-editors', () => {
    render(<SystemCategorySection {...baseProps({ isEditor: false })} />)
    expect(screen.queryByTestId('rescan')).not.toBeInTheDocument()
  })
})
