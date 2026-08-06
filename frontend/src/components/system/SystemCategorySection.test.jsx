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
  // Expose the immediate child folder names + path so tests can assert that a
  // nested tree (not a flattened key) is built for the top-level group.
  default: ({ folder, path, node }) => (
    <div
      data-testid="folder-group"
      data-path={(path || []).join('/')}
      data-children={Object.keys(node?.folders || {}).join(',')}
    >
      {folder}
    </div>
  ),
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
function nestedBook(id, ...segs) {
  // Arbitrary depth: books/D&D 5e/adventure/<seg1>/<seg2>/.../id.pdf
  return { id, title: id, relative_path: `books/D&D 5e/adventure/${segs.join('/')}/${id}.pdf` }
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

  it('uses the original folder name for a custom category (not the slug)', () => {
    render(
      <SystemCategorySection
        {...baseProps({
          cat: 'gm-tools',
          books: [{ id: 'b1', title: 'b1', relative_path: 'books/D&D 5e/GM Tools/screen.pdf' }],
        })}
      />
    )
    expect(screen.getByText('GM Tools')).toBeInTheDocument()
    expect(screen.queryByText(/gm-tools/i)).not.toBeInTheDocument()
  })

  describe('systems nested in a container folder', () => {
    // books/Dungeons & Dragons/5e/… — the system dir sits one level deeper, so
    // every path index shifts. `parent_id` is what marks the system as a child.
    const child = { id: 'sys-5e', name: 'Dungeons & Dragons 5e', parent_id: 'sys-dnd' }
    const childBook = (id, ...segs) => ({
      id,
      title: id,
      relative_path: `books/Dungeons & Dragons/5e/${segs.join('/')}/${id}.pdf`,
    })

    it('labels a custom category with its own folder, not the system dir', () => {
      // Previously "5e" was read as the category folder, so every custom
      // category slug produced another top-level "5e" heading.
      render(
        <SystemCategorySection
          {...baseProps({
            cat: 'monster-manuals',
            system: child,
            books: [childBook('b1', 'Monster Manuals')],
          })}
        />
      )
      expect(screen.getByText('Monster Manuals')).toBeInTheDocument()
      expect(screen.queryByText('5e')).not.toBeInTheDocument()
    })

    it('renders the category flat rather than nesting it under the system dir', () => {
      render(
        <SystemCategorySection
          {...baseProps({
            cat: 'monster-manuals',
            system: child,
            books: [childBook('b1', 'Monster Manuals'), childBook('b2', 'Monster Manuals')],
          })}
        />
      )
      // The books belong to the category directly — no subfolder group at all.
      expect(screen.queryAllByTestId('folder-group')).toHaveLength(0)
      expect(screen.getAllByTestId('book-item').map((n) => n.textContent)).toEqual(['b1', 'b2'])
    })

    it('still groups genuine subfolders below the category', () => {
      render(
        <SystemCategorySection
          {...baseProps({
            cat: 'monster-manuals',
            system: child,
            books: [childBook('b1', 'Monster Manuals', 'spelljammer')],
          })}
        />
      )
      const group = screen.getByTestId('folder-group')
      expect(group).toHaveTextContent('spelljammer')
      expect(group).toHaveAttribute('data-path', 'spelljammer')
    })
  })

  it('humanizes the slug when the book path has no category folder', () => {
    render(
      <SystemCategorySection
        {...baseProps({
          cat: 'gm-tools',
          // relative_path with no category dir → fall back to a humanized slug.
          books: [{ id: 'b1', title: 'b1', relative_path: 'books/D&D 5e/screen.pdf' }],
        })}
      />
    )
    expect(screen.getByText('GM Tools')).toBeInTheDocument()
  })

  it('labels the section "Books" for one-page RPG systems (ignoring the category)', () => {
    render(
      <SystemCategorySection
        {...baseProps({
          cat: 'uncategorized',
          system: { id: 'op', name: 'One-Page RPGs', is_one_page: true },
        })}
      />
    )
    expect(screen.getByText('Books')).toBeInTheDocument()
    expect(screen.queryByText(/uncategorized/i)).not.toBeInTheDocument()
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

  it('builds one top-level group with a nested child folder for deeply nested books (issue #189)', () => {
    render(
      <SystemCategorySection
        {...baseProps({
          books: [nestedBook('deep', 'Monsters', 'Spelljammer')],
        })}
      />
    )
    // A single top-level "Monsters" group, keyed by path, with "Spelljammer" nested
    // beneath it — the deep segment is no longer flattened away.
    const group = screen.getByTestId('folder-group')
    expect(group).toHaveTextContent('Monsters')
    expect(group).toHaveAttribute('data-path', 'Monsters')
    expect(group).toHaveAttribute('data-children', 'Spelljammer')
  })

  it('groups books sharing a top-level folder under one group', () => {
    render(
      <SystemCategorySection
        {...baseProps({
          books: [nestedBook('a', 'Monsters', 'Spelljammer'), subfolderBook('b', 'Monsters')],
        })}
      />
    )
    // Both books live under "Monsters", so there is exactly one top-level group.
    const groups = screen.getAllByTestId('folder-group')
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveTextContent('Monsters')
    expect(groups[0]).toHaveAttribute('data-children', 'Spelljammer')
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
