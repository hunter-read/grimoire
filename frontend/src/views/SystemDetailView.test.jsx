import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SystemDetailView from './SystemDetailView'
import api, { bulk } from '../api'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
    upload: vi.fn(() => Promise.resolve({})),
  },
  bulk: {
    addTags: vi.fn(() => Promise.resolve({ updated: [], errors: [], tags: {} })),
    update: vi.fn(() => Promise.resolve({ updated: [], errors: [] })),
    setFolderTags: vi.fn(() => Promise.resolve({ folders: [] })),
  },
  tags: { list: vi.fn(() => Promise.resolve({ tags: [] })) },
  mediaUrl: (path) => `http://localhost${path}`,
}))

// Open the shared filter modal (favourites/tags/genres live there now).
const openBookFilters = () => userEvent.click(screen.getByRole('button', { name: 'Filters' }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useParams: () => ({ systemId: 'system-1' }),
    useNavigate: () => mockNavigate,
  }
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'admin' } }),
}))

const mockIsFavorite = vi.fn(() => false)
vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: mockIsFavorite, toggleFavorite: vi.fn() }),
}))

vi.mock('../components/FavoriteButton', () => ({
  default: () => null,
}))

vi.mock('../components/DownloadArchiveModal', () => ({
  default: ({ onClose }) => (
    <div data-testid="download-modal">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

const bookEditorProps = vi.fn()
vi.mock('../components/system/BookEditor', () => ({
  default: (props) => {
    bookEditorProps(props)
    return (
      <div data-testid="book-editor">
        <button onClick={props.onClose}>Close Editor</button>
      </div>
    )
  },
}))

vi.mock('../components/system/SystemEditor', () => ({
  default: () => <div data-testid="system-editor" />,
}))

// Bulk-selection surfaces: expose minimal buttons that fire the callbacks the
// view wires up, so the bulk handlers (applyBulkTags / applyBookEdits) run.
vi.mock('../components/BulkActionBar', () => ({
  default: ({ count, applying, onApplyTags, onBulkEdit }) => (
    <div data-testid="bulk-bar">
      <span data-testid="bulk-count">{count}</span>
      <span data-testid="bulk-applying">{String(applying)}</span>
      <button onClick={() => onApplyTags(['fresh'])}>bulk-apply-tags</button>
      <button onClick={onBulkEdit}>bulk-edit</button>
    </div>
  ),
}))

vi.mock('../components/BulkEditModal', () => ({
  default: ({ items, onSaved }) => (
    <div data-testid="bulk-edit-modal">
      <button onClick={() => onSaved(Object.fromEntries(items.map((b) => [b.id, { year: 1999 }])))}>
        bulk-save
      </button>
    </div>
  ),
}))

vi.mock('../components/AddToCampaignModal', () => ({
  default: () => <div data-testid="add-to-campaign" />,
}))

// Expose the rescan scope so tests can assert which folder a rescan targets.
vi.mock('../components/RescanButton', () => ({
  default: ({ scope }) => <div data-testid="rescan" data-scope={scope ?? ''} />,
}))

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeBook(overrides = {}) {
  const id = overrides.id ?? `book-${Math.random().toString(36).slice(2)}`
  return {
    id,
    title: 'Test Book',
    category: 'core',
    page_count: 100,
    year: 2020,
    publisher: 'Publisher',
    has_thumbnail: false,
    is_explicit: false,
    is_missing: false,
    indexed: false,
    index_failed: false,
    index_error: '',
    tags: [],
    relative_path: `books/TestSystem/core/book.pdf`,
    ...overrides,
  }
}

function makeSystem(books = []) {
  return {
    id: 'system-1',
    name: 'Test System',
    slug: 'test-system',
    description: '',
    publishers: [],
    character_builder_url: '',
    tags: [],
    genre: '',
    cover_image: '',
    cover_book_id: null,
    is_explicit: false,
    books,
  }
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/library/system/system-1']}>
      <SystemDetailView />
    </MemoryRouter>
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SystemDetailView — subfolder grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFavorite.mockReturnValue(false)
    // Session-persisted view state (grouping, collapse) must not leak between tests.
    sessionStorage.clear()
  })

  describe('getBookSubfolder logic (via render)', () => {
    it('renders a flat list when no books have subfolders', async () => {
      const books = [
        makeBook({ title: 'PHB', relative_path: 'books/TestSystem/core/phb.pdf' }),
        makeBook({ title: 'DMG', relative_path: 'books/TestSystem/core/dmg.pdf' }),
      ]
      api.get.mockResolvedValue(makeSystem(books))
      renderView()

      await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())
      expect(screen.getByText('DMG')).toBeInTheDocument()
      // No folder headers rendered — books show directly
      expect(screen.queryByRole('button', { name: /monsters/i })).not.toBeInTheDocument()
    })

    it('renders BookFolderGroup headers when books have subfolders', async () => {
      const books = [
        makeBook({
          title: 'Bestiary 1',
          relative_path: 'books/TestSystem/core/monsters/Bestiary 1.pdf',
        }),
        makeBook({
          title: 'Bestiary 2',
          relative_path: 'books/TestSystem/core/monsters/Bestiary 2.pdf',
        }),
      ]
      api.get.mockResolvedValue(makeSystem(books))
      renderView()

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /monsters/i })).toBeInTheDocument()
      )
    })

    it('books in a subfolder are grouped under one folder header', async () => {
      const books = [
        makeBook({ title: 'Bestiary 1', relative_path: 'books/TestSystem/core/monsters/b1.pdf' }),
        makeBook({ title: 'Bestiary 2', relative_path: 'books/TestSystem/core/monsters/b2.pdf' }),
        makeBook({ title: 'Bestiary 3', relative_path: 'books/TestSystem/core/monsters/b3.pdf' }),
      ]
      api.get.mockResolvedValue(makeSystem(books))
      renderView()

      await waitFor(() => expect(screen.getByText('Bestiary 1')).toBeInTheDocument())
      expect(screen.getByText('Bestiary 2')).toBeInTheDocument()
      expect(screen.getByText('Bestiary 3')).toBeInTheDocument()
      // Only one "monsters" folder header
      expect(screen.getAllByRole('button', { name: /monsters/i })).toHaveLength(1)
    })

    it('ungrouped books (no subfolder) render flat above folder groups', async () => {
      const books = [
        makeBook({ title: 'Core Rulebook', relative_path: 'books/TestSystem/core/crb.pdf' }),
        makeBook({
          title: 'Bestiary',
          relative_path: 'books/TestSystem/core/monsters/Bestiary.pdf',
        }),
      ]
      api.get.mockResolvedValue(makeSystem(books))
      renderView()

      await waitFor(() => expect(screen.getByText('Core Rulebook')).toBeInTheDocument())
      expect(screen.getByText('Bestiary')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /monsters/i })).toBeInTheDocument()
    })

    it('works for adventure category subfolders', async () => {
      const books = [
        makeBook({
          title: 'Ruins of Gauntlight',
          category: 'adventure',
          relative_path: 'books/TestSystem/adventures/Abomination Vaults/rog.pdf',
        }),
        makeBook({
          title: 'Strahd AP',
          category: 'adventure',
          relative_path: 'books/TestSystem/adventures/Curse of Strahd/cos.pdf',
        }),
      ]
      api.get.mockResolvedValue(makeSystem(books))
      renderView()

      // Each AP name should appear as a folder header button (aria-expanded)
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /abomination vaults/i })).toBeInTheDocument()
      )
      expect(screen.getByRole('button', { name: /curse of strahd/i })).toBeInTheDocument()
    })

    it('two different categories can each have subfolders independently', async () => {
      const books = [
        makeBook({
          title: 'Bestiary',
          category: 'core',
          relative_path: 'books/TestSystem/core/monsters/bestiary.pdf',
        }),
        makeBook({
          title: 'Adventure AP',
          category: 'adventure',
          relative_path: 'books/TestSystem/adventures/Big AP/ap.pdf',
        }),
      ]
      api.get.mockResolvedValue(makeSystem(books))
      renderView()

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /monsters/i })).toBeInTheDocument()
      )
      expect(screen.getByRole('button', { name: /big ap/i })).toBeInTheDocument()
    })

    it('subfolder collapse toggles visibility', async () => {
      const books = [
        makeBook({
          title: 'Bestiary',
          relative_path: 'books/TestSystem/core/monsters/bestiary.pdf',
        }),
      ]
      api.get.mockResolvedValue(makeSystem(books))
      renderView()

      await waitFor(() => expect(screen.getByText('Bestiary')).toBeInTheDocument())

      // Collapse the folder
      await userEvent.click(screen.getByRole('button', { name: /monsters/i }))
      expect(screen.queryByText('Bestiary')).not.toBeInTheDocument()

      // Expand again
      await userEvent.click(screen.getByRole('button', { name: /monsters/i }))
      expect(screen.getByText('Bestiary')).toBeInTheDocument()
    })
  })

  describe('book folder tagging', () => {
    // Return folder tags for the /book-folders endpoint, the system otherwise.
    function mockWithFolders(books, folders = []) {
      api.get.mockImplementation((url) => {
        if (url.includes('/book-folders')) return Promise.resolve({ folders })
        return Promise.resolve(makeSystem(books))
      })
    }

    it('loads and shows existing book-folder tags on the folder header', async () => {
      const books = [
        makeBook({ title: 'Bestiary', relative_path: 'books/TestSystem/core/monsters/b.pdf' }),
      ]
      mockWithFolders(books, [{ path: 'system-1/core/monsters', tags: ['Gothic'] }])
      renderView()
      await waitFor(() => expect(screen.getByText('Bestiary')).toBeInTheDocument())
      expect(screen.getByText('Gothic')).toBeInTheDocument()
    })

    it('saves book-folder tags via PATCH with the full folder path', async () => {
      const books = [
        makeBook({ title: 'Bestiary', relative_path: 'books/TestSystem/core/monsters/b.pdf' }),
      ]
      mockWithFolders(books, [])
      renderView()
      await waitFor(() => expect(screen.getByText('Bestiary')).toBeInTheDocument())
      // Open the folder's tag editor; the InlineTagEditor commits on every add.
      await userEvent.click(screen.getByRole('button', { name: /add tags/i }))
      const input = await screen.findByRole('combobox', { name: /add tag/i })
      await userEvent.type(input, 'Gothic{Enter}')
      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledWith('/systems/system-1/book-folders', {
          path: 'system-1/core/monsters',
          tags: ['Gothic'],
        })
      )
    })
  })

  describe('system header', () => {
    it('renders the system name', async () => {
      api.get.mockResolvedValue(makeSystem())
      renderView()
      await waitFor(() => expect(screen.getByText('Test System')).toBeInTheDocument())
    })

    it('shows a spinner while loading', () => {
      api.get.mockReturnValue(new Promise(() => {})) // never resolves
      renderView()
      expect(document.querySelector('svg')).toBeInTheDocument() // Spinner renders an SVG
    })

    it('shows the system-metadata Edit button for a normal system', async () => {
      api.get.mockResolvedValue(makeSystem())
      renderView()
      await waitFor(() => expect(screen.getByText('Test System')).toBeInTheDocument())
      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    })

    it('prettifies the name and hides Edit for a one-page collection', async () => {
      api.get.mockResolvedValue({
        ...makeSystem(),
        name: 'one-page-rpgs',
        is_one_page: true,
      })
      renderView()
      await waitFor(() => expect(screen.getByText('One Page RPGs')).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    })

    it('hides Edit for a system-agnostic collection', async () => {
      api.get.mockResolvedValue({
        ...makeSystem(),
        name: 'system-agnostic',
        is_system_agnostic: true,
      })
      renderView()
      await waitFor(() => expect(screen.getByText('System Agnostic')).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    })
  })

  describe('category section collapse', () => {
    it('collapses a category section when its header is clicked', async () => {
      const books = [makeBook({ title: 'PHB', relative_path: 'books/TestSystem/core/phb.pdf' })]
      api.get.mockResolvedValue(makeSystem(books))
      renderView()

      await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())

      await userEvent.click(screen.getByRole('button', { name: /core rulebooks/i }))
      expect(screen.queryByText('PHB')).not.toBeInTheDocument()
    })
  })

  describe('category grouping toggle', () => {
    it('flattens the book list (hides category headers) and keeps all books', async () => {
      const books = [
        makeBook({
          title: 'PHB',
          category: 'core',
          relative_path: 'books/TestSystem/core/phb.pdf',
        }),
        makeBook({
          title: 'Strahd',
          category: 'adventure',
          relative_path: 'books/TestSystem/adventure/cos.pdf',
        }),
      ]
      api.get.mockResolvedValue(makeSystem(books))
      renderView()
      await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())
      // Grouped by default: category headers exist, the switch is on.
      expect(screen.getByRole('button', { name: /core rulebooks/i })).toBeInTheDocument()
      const groupSwitch = screen.getByRole('switch', { name: /group/i })
      expect(groupSwitch).toBeChecked()

      // Toggle to flat.
      await userEvent.click(groupSwitch)
      // Headers gone, but both books still shown.
      expect(screen.queryByRole('button', { name: /core rulebooks/i })).not.toBeInTheDocument()
      expect(groupSwitch).not.toBeChecked()
      expect(screen.getByText('PHB')).toBeInTheDocument()
      expect(screen.getByText('Strahd')).toBeInTheDocument()
    })

    it('preserves the active sort/filter when flattening', async () => {
      const books = [
        makeBook({ id: 'b1', title: 'Zeta', category: 'core', page_count: 5 }),
        makeBook({ id: 'b2', title: 'Alpha', category: 'adventure', page_count: 500 }),
      ]
      api.get.mockResolvedValue(makeSystem(books))
      renderView()
      await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())

      // Sort by page count ascending, then flatten.
      await userEvent.selectOptions(screen.getByLabelText('Sort'), 'page_count')
      await userEvent.click(screen.getByRole('switch', { name: /group/i }))
      const titles = screen.getAllByText(/Alpha|Zeta/).map((n) => n.textContent)
      expect(titles.indexOf('Zeta')).toBeLessThan(titles.indexOf('Alpha'))
    })
  })

  describe('favorites filter', () => {
    it('shows the Favorites toggle in the filter modal', async () => {
      api.get.mockResolvedValue(makeSystem([makeBook({ title: 'PHB' })]))
      renderView()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
      )
      await openBookFilters()
      expect(screen.getByRole('checkbox', { name: /Favorites/ })).toBeInTheDocument()
    })

    it('favorites filter hides non-favorite books', async () => {
      const favBook = makeBook({ id: 'fav-book', title: 'Favorite Book' })
      const otherBook = makeBook({ id: 'other-book', title: 'Other Book' })
      api.get.mockResolvedValue(makeSystem([favBook, otherBook]))
      mockIsFavorite.mockImplementation((type, id) => type === 'book' && id === 'fav-book')

      renderView()
      await waitFor(() => expect(screen.getByText('Favorite Book')).toBeInTheDocument())

      await openBookFilters()
      await userEvent.click(screen.getByRole('checkbox', { name: /Favorites/ }))

      expect(screen.getByText('Favorite Book')).toBeInTheDocument()
      expect(screen.queryByText('Other Book')).not.toBeInTheDocument()
    })

    it('shows no-favorites hint when filter active and nothing matches', async () => {
      api.get.mockResolvedValue(makeSystem([makeBook({ title: 'Unfavorited' })]))
      renderView()
      await waitFor(() => expect(screen.getByText('Unfavorited')).toBeInTheDocument())

      await openBookFilters()
      await userEvent.click(screen.getByRole('checkbox', { name: /Favorites/ }))

      expect(screen.queryByText('Unfavorited')).not.toBeInTheDocument()
      expect(screen.getByText(/no favorites here yet/i)).toBeInTheDocument()
    })
  })
})

describe('SystemDetailView — in-system search persistence', () => {
  const SESSION_KEY = 'grimoire:system:system-1:search-query'

  function setupSearchMock(resultTitle = 'Spell Compendium') {
    api.get.mockImplementation((url) => {
      if (url.includes('/search')) {
        return Promise.resolve({
          query: 'fireball',
          total: 1,
          results: [
            {
              id: 'b1',
              title: resultTitle,
              game_system: 'Test System',
              category: 'core',
              page_number: 7,
              snippet: 'A <mark>fireball</mark> spell.',
            },
          ],
          maps: [],
          tokens: [],
        })
      }
      return Promise.resolve(makeSystem([makeBook({ title: 'PHB' })]))
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFavorite.mockReturnValue(false)
    sessionStorage.clear()
  })

  it('persists the search query to sessionStorage as the user types', async () => {
    setupSearchMock()
    renderView()
    await waitFor(() => screen.getByLabelText(/search within/i))

    await userEvent.type(screen.getByLabelText(/search within/i), 'fi')

    await waitFor(() => expect(sessionStorage.getItem(SESSION_KEY)).toBe(JSON.stringify('fi')))
  })

  it('re-runs the search on mount when a query is stored in sessionStorage', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify('fireball'))
    setupSearchMock('Spell Compendium')
    renderView()

    await waitFor(() => expect(screen.getByText('Spell Compendium')).toBeInTheDocument())
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('q=fireball'))
  })

  it('pre-fills the search input from sessionStorage on mount', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify('fireball'))
    setupSearchMock()
    renderView()

    await waitFor(() => screen.getByLabelText(/search within/i))
    expect(screen.getByLabelText(/search within/i).value).toBe('fireball')
  })

  it('does not run a search on mount when the stored query is too short', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify('x'))
    api.get.mockResolvedValue(makeSystem([makeBook({ title: 'PHB' })]))
    renderView()

    await waitFor(() => screen.getByText('PHB'))
    const searchCalls = api.get.mock.calls.filter(([url]) => url.includes('/search'))
    expect(searchCalls).toHaveLength(0)
  })

  it('shows books matching the query above the page results', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify('fireball'))
    // System has a book whose title matches the query.
    api.get.mockImplementation((url) => {
      if (url.includes('/search')) {
        return Promise.resolve({
          query: 'fireball',
          total: 1,
          results: [
            {
              id: 'b1',
              title: 'Spell Compendium',
              game_system: 'Test System',
              category: 'core',
              page_number: 7,
              snippet: 'A <mark>fireball</mark> spell.',
            },
          ],
          maps: [],
          tokens: [],
        })
      }
      return Promise.resolve(
        makeSystem([makeBook({ id: 'fb', title: 'Fireball Grimoire' }), makeBook({ title: 'PHB' })])
      )
    })
    renderView()

    // The matching book title appears (from the book grid, not the page hit).
    await waitFor(() => expect(screen.getByText('Fireball Grimoire')).toBeInTheDocument())
    // The "matching books" heading is shown.
    expect(screen.getByText(/matching book/i)).toBeInTheDocument()
    // Page results still render below.
    expect(screen.getByText('Spell Compendium')).toBeInTheDocument()
    expect(screen.getByText(/in pages/i)).toBeInTheDocument()
  })

  it('shows no-results when neither a book nor a page matches', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify('zzznomatch'))
    api.get.mockImplementation((url) => {
      if (url.includes('/search')) {
        return Promise.resolve({
          query: 'zzznomatch',
          total: 0,
          results: [],
          maps: [],
          tokens: [],
        })
      }
      return Promise.resolve(makeSystem([makeBook({ title: 'PHB' })]))
    })
    renderView()

    await waitFor(() => expect(screen.getByText(/no results found/i)).toBeInTheDocument())
  })
})

describe('SystemDetailView — book view mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    localStorage.clear()
    mockIsFavorite.mockReturnValue(false)
  })

  it('defaults books to list view and cycles list → card → compact via the toggle', async () => {
    api.get.mockResolvedValue(makeSystem([makeBook({ title: 'PHB' })]))
    renderView()
    await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())

    const toggle = screen.getByRole('button', { name: /change view/i })
    expect(toggle).toHaveAccessibleName(/list/i)

    await userEvent.click(toggle)
    expect(toggle).toHaveAccessibleName(/cards/i)
    expect(sessionStorage.getItem('grimoire:view-mode:book')).toBe('card')

    await userEvent.click(toggle)
    expect(toggle).toHaveAccessibleName(/compact/i)
    // Books still render in card/compact grid layouts.
    expect(screen.getByText('PHB')).toBeInTheDocument()
  })
})

describe('SystemDetailView — book editor categories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFavorite.mockReturnValue(false)
  })

  it('passes the distinct set of in-use categories to the book editor', async () => {
    const books = [
      makeBook({ id: 'b1', title: 'PHB', category: 'core' }),
      makeBook({ id: 'b2', title: 'CoS', category: 'adventure' }),
      makeBook({ id: 'b3', title: 'Homebrew Doc', category: 'my-custom' }),
      makeBook({ id: 'b4', title: 'DMG', category: 'core' }), // duplicate slug
    ]
    api.get.mockResolvedValue(makeSystem(books))
    renderView()
    await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())

    // Open the editor for the first book via its actions menu → Edit metadata.
    fireEvent.click(screen.getAllByRole('button', { name: /more actions/i })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: /edit metadata/i }))
    await waitFor(() => expect(screen.getByTestId('book-editor')).toBeInTheDocument())

    const props = bookEditorProps.mock.calls.at(-1)[0]
    expect(props.existingCategories).toEqual(['adventure', 'core', 'my-custom'])
  })
})

describe('SystemDetailView — header, tag filter, and bulk actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFavorite.mockReturnValue(false)
    api.patch.mockResolvedValue({})
  })

  it('renders publisher links and plain-text publishers in the header', async () => {
    const system = makeSystem([makeBook({ title: 'PHB' })])
    system.publishers = [{ name: 'WotC', url: 'https://wotc.com' }, { name: 'TSR' }]
    api.get.mockResolvedValue(system)
    renderView()

    await waitFor(() => expect(screen.getByText('Published by')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'WotC' })).toHaveAttribute('href', 'https://wotc.com')
    expect(screen.getByText('TSR', { exact: false })).toBeInTheDocument()
  })

  it('toggles a tag filter (from the modal) and hides books lacking that tag', async () => {
    api.get.mockResolvedValue(
      makeSystem([
        makeBook({ id: 'b1', title: 'Tagged', tags: ['spooky'] }),
        makeBook({ id: 'b2', title: 'Untagged', tags: [] }),
      ])
    )
    renderView()
    await waitFor(() => expect(screen.getByText('Tagged')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /^spooky$/i }))
    expect(screen.getByText('Tagged')).toBeInTheDocument()
    expect(screen.queryByText('Untagged')).not.toBeInTheDocument()
  })

  it('lists all system tags as filter options in the modal', async () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag-${String(i).padStart(2, '0')}`)
    api.get.mockResolvedValue(makeSystem([makeBook({ title: 'PHB', tags })]))
    renderView()
    await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    // All tags are available as checkboxes in the dropdown (scrolls; no cap).
    expect(screen.getByRole('checkbox', { name: /^tag-19$/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /^tag-00$/i })).toBeInTheDocument()
  })

  it('filters books by genre from the modal', async () => {
    api.get.mockResolvedValue(
      makeSystem([
        makeBook({ id: 'b1', title: 'Fantasy Book', genres: ['Fantasy'] }),
        makeBook({ id: 'b2', title: 'Horror Book', genres: ['Horror'] }),
      ])
    )
    renderView()
    await waitFor(() => expect(screen.getByText('Fantasy Book')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.click(screen.getByRole('button', { name: 'Genre' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Fantasy' }))
    expect(screen.getByText('Fantasy Book')).toBeInTheDocument()
    expect(screen.queryByText('Horror Book')).not.toBeInTheDocument()
  })

  it('re-sorts books when the sort control changes', async () => {
    api.get.mockResolvedValue(
      makeSystem([
        makeBook({ id: 'b1', title: 'Zeta', page_count: 5 }),
        makeBook({ id: 'b2', title: 'Alpha', page_count: 500 }),
      ])
    )
    renderView()
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())
    // Default sort is title asc → Alpha before Zeta.
    let titles = screen.getAllByText(/Alpha|Zeta/).map((n) => n.textContent)
    expect(titles.indexOf('Alpha')).toBeLessThan(titles.indexOf('Zeta'))
    // Sort by page count ascending → Zeta (5) before Alpha (500).
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'page_count')
    titles = screen.getAllByText(/Alpha|Zeta/).map((n) => n.textContent)
    expect(titles.indexOf('Zeta')).toBeLessThan(titles.indexOf('Alpha'))
  })

  it('saves a books filter preset via the modal', async () => {
    api.get.mockResolvedValue(makeSystem([makeBook({ title: 'PHB' })]))
    renderView()
    await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.type(screen.getByLabelText('Name this filter'), 'My Books View')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/saved-filters',
        expect.objectContaining({ scope: 'books', name: 'My Books View' })
      )
    )
  })

  it('applies the default books preset on load', async () => {
    api.get.mockImplementation((url) => {
      if (url.includes('/saved-filters')) {
        return Promise.resolve({
          filters: [
            {
              id: 'd1',
              scope: 'books',
              name: 'Default',
              is_default: true,
              state: { sort: 'title', order: 'asc', filters: { explicit: true } },
            },
          ],
        })
      }
      return Promise.resolve(
        makeSystem([
          makeBook({ id: 'b1', title: 'Clean', is_explicit: false }),
          makeBook({ id: 'b2', title: 'Spicy', is_explicit: true }),
        ])
      )
    })
    renderView()
    // The default filter (explicit only) is applied on load, hiding "Clean".
    await waitFor(() => expect(screen.getByText('Spicy')).toBeInTheDocument())
    expect(screen.queryByText('Clean')).not.toBeInTheDocument()
  })

  it('applies bulk tags to the selected books', async () => {
    api.get.mockResolvedValue(
      makeSystem([
        makeBook({ id: 'b1', title: 'PHB', tags: ['old'] }),
        makeBook({ id: 'b2', title: 'DMG', tags: [] }),
      ])
    )
    renderView()
    await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /select/i }))
    fireEvent.click(screen.getByRole('button', { name: /open phb/i }))
    fireEvent.click(screen.getByRole('button', { name: /open dmg/i }))
    expect(screen.getByTestId('bulk-count').textContent).toBe('2')

    fireEvent.click(screen.getByText('bulk-apply-tags'))

    // Issue #270: both books go in one request rather than a PATCH each; the
    // server merges the new tag onto each book's existing tags.
    await waitFor(() => expect(bulk.addTags).toHaveBeenCalledTimes(1))
    expect(bulk.addTags).toHaveBeenCalledWith('book', ['b1', 'b2'], ['fresh'])
    expect(api.patch).not.toHaveBeenCalled()
    // Selection is cleared after applying (count resets to 0).
    await waitFor(() => expect(screen.getByTestId('bulk-count').textContent).toBe('0'))
  })

  it('applies bulk edits from the bulk edit modal', async () => {
    api.get.mockResolvedValue(makeSystem([makeBook({ id: 'b1', title: 'PHB', year: 2014 })]))
    renderView()
    await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /select/i }))
    fireEvent.click(screen.getByRole('button', { name: /open phb/i }))
    fireEvent.click(screen.getByText('bulk-edit'))
    expect(screen.getByTestId('bulk-edit-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByText('bulk-save'))
    // Edits merge into the book and the bulk UI closes.
    await waitFor(() => expect(screen.queryByTestId('bulk-edit-modal')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByTestId('bulk-bar')).not.toBeInTheDocument())
  })
})

describe('SystemDetailView — system containers (issues #261, #262)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    mockIsFavorite.mockReturnValue(false)
  })

  const makeContainer = (over = {}) => ({
    ...makeSystem([]),
    id: 'system-1',
    name: 'one-page-rpgs',
    is_one_page: true,
    container_kind: 'one-page',
    children: [
      { id: 'c1', name: 'Honey Heist', book_count: 1, tags: [], genres: [] },
      { id: 'c2', name: 'Lasers And Feelings', book_count: 1, tags: [], genres: [] },
    ],
    ...over,
  })

  it('renders the container children as systems instead of a book list', async () => {
    api.get.mockResolvedValue(makeContainer())
    renderView()
    await waitFor(() => expect(screen.getByText('Honey Heist')).toBeInTheDocument())
    expect(screen.getByText('Lasers And Feelings')).toBeInTheDocument()
  })

  it('prettifies the container name in the heading', async () => {
    api.get.mockResolvedValue(makeContainer())
    renderView()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'One Page RPGs' })).toBeInTheDocument()
    )
  })

  it('navigates into a child system when its card is clicked', async () => {
    api.get.mockResolvedValue(makeContainer())
    renderView()
    await waitFor(() => expect(screen.getByText('Honey Heist')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Honey Heist'))
    expect(mockNavigate).toHaveBeenCalledWith('/library/system/c1')
  })

  it('navigates back to the library from a container', async () => {
    api.get.mockResolvedValue(makeContainer())
    renderView()
    await waitFor(() => expect(screen.getByText('Honey Heist')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Back to Library'))
    expect(mockNavigate).toHaveBeenCalledWith('/library')
  })

  it('counts the nested systems rather than books', async () => {
    api.get.mockResolvedValue(makeContainer())
    renderView()
    await waitFor(() =>
      expect(screen.getByText('2 systems in this collection')).toBeInTheDocument()
    )
  })

  it('falls back to the normal book view when a container has no children yet', async () => {
    api.get.mockResolvedValue({
      ...makeSystem([makeBook({ title: 'Loose Book' })]),
      container_kind: 'parent',
      children: [],
    })
    renderView()
    await waitFor(() => expect(screen.getByText('Loose Book')).toBeInTheDocument())
  })

  it('renders an ordinary system as a book list', async () => {
    api.get.mockResolvedValue(makeSystem([makeBook({ title: 'PHB' })]))
    renderView()
    await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())
  })
  it('reflects a container cover upload without leaving the view', async () => {
    api.get.mockResolvedValue(makeContainer())
    api.upload.mockResolvedValue({ cover_image: 'system-1.png' })
    renderView()
    await waitFor(() => expect(screen.getByText('Honey Heist')).toBeInTheDocument())

    await userEvent.click(screen.getByText('Cover image'))
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'c.png', { type: 'image/png' })
    await userEvent.upload(screen.getByTestId('cover-upload-input'), file)

    await waitFor(() => expect(api.upload).toHaveBeenCalledWith('/systems/system-1/cover', file))
    // Still on the container view, now showing the uploaded art.
    expect(screen.getByText('Honey Heist')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('cover-preview')).toBeInTheDocument())
  })
})

describe('SystemDetailView — collapse and expand all categories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    mockIsFavorite.mockReturnValue(false)
  })

  const twoCategories = () =>
    makeSystem([
      makeBook({ title: 'PHB', category: 'core', relative_path: 'books/TestSystem/core/phb.pdf' }),
      makeBook({
        title: 'Strahd',
        category: 'adventure',
        relative_path: 'books/TestSystem/adventure/cos.pdf',
      }),
    ])

  it('hides every category body on collapse all, and restores it on expand all', async () => {
    api.get.mockResolvedValue(twoCategories())
    renderView()
    await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())
    expect(screen.getByText('Strahd')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /collapse all/i }))
    expect(screen.queryByText('PHB')).not.toBeInTheDocument()
    expect(screen.queryByText('Strahd')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /expand all/i }))
    expect(screen.getByText('PHB')).toBeInTheDocument()
    expect(screen.getByText('Strahd')).toBeInTheDocument()
  })
})

describe('SystemDetailView — category depth for a system inside a container', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    mockIsFavorite.mockReturnValue(false)
  })

  // books/Dungeons & Dragons/5e/… — one level deeper than a top-level system,
  // so both the category tree and the rescan scope shift by the container dir.
  const childBook = (over = {}) =>
    makeBook({
      category: 'monster-manuals',
      relative_path: 'books/Dungeons & Dragons/5e/Monster Manuals/mm.pdf',
      ...over,
    })
  const childSystem = (books) => ({
    ...makeSystem(books),
    name: 'Dungeons & Dragons 5e',
    parent_id: 'container-dnd',
    parent_name: 'Dungeons & Dragons',
  })

  it('heads a custom category with its own folder, not the system dir', async () => {
    // Previously "5e" was read as the category folder, so each custom category
    // slug produced another top-level "5e" heading with the real category
    // nested beneath it as a subfolder.
    api.get.mockResolvedValue(childSystem([childBook({ title: 'Monster Manual' })]))
    renderView()
    await waitFor(() => expect(screen.getByText('Monster Manual')).toBeInTheDocument())

    expect(screen.getByText('Monster Manuals')).toBeInTheDocument()
    expect(screen.queryByText('5e')).not.toBeInTheDocument()
  })

  it('scopes a rescan to the system folder, not the whole container', async () => {
    // A scope of "books/Dungeons & Dragons" would re-scan every edition in the
    // container rather than just this one.
    api.get.mockResolvedValue(childSystem([childBook({ title: 'Monster Manual' })]))
    renderView()
    await waitFor(() => expect(screen.getByText('Monster Manual')).toBeInTheDocument())

    const scopes = screen.getAllByTestId('rescan').map((n) => n.getAttribute('data-scope'))
    expect(scopes).toContain('books/Dungeons & Dragons/5e')
    expect(scopes).not.toContain('books/Dungeons & Dragons')
  })

  it('leaves a top-level system scoped to its own folder', async () => {
    api.get.mockResolvedValue(makeSystem([makeBook({ title: 'PHB' })]))
    renderView()
    await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())

    const scopes = screen.getAllByTestId('rescan').map((n) => n.getAttribute('data-scope'))
    expect(scopes).toContain('books/TestSystem')
  })
})

describe('SystemDetailView — back navigation from a nested system', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    mockIsFavorite.mockReturnValue(false)
  })

  it('returns to the parent system rather than the library root', async () => {
    api.get.mockResolvedValue({
      ...makeSystem([makeBook({ title: 'PHB' })]),
      parent_id: 'container-9',
      parent_name: 'Dungeons & Dragons',
      parent_is_one_page: false,
    })
    renderView()
    await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())

    await userEvent.click(screen.getByText('Back to Dungeons & Dragons'))
    expect(mockNavigate).toHaveBeenCalledWith('/library/system/container-9')
  })

  it('prettifies a one-page collection name in the back label', async () => {
    api.get.mockResolvedValue({
      ...makeSystem([makeBook({ title: 'Honey Heist' })]),
      parent_id: 'container-op',
      parent_name: 'one-page-rpgs',
      parent_is_one_page: true,
    })
    renderView()
    await waitFor(() => expect(screen.getByText('Honey Heist')).toBeInTheDocument())

    expect(screen.getByText('Back to One Page RPGs')).toBeInTheDocument()
  })

  it('a top-level system still goes back to the library', async () => {
    api.get.mockResolvedValue(makeSystem([makeBook({ title: 'PHB' })]))
    renderView()
    await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())

    await userEvent.click(screen.getByText('Back to Library'))
    expect(mockNavigate).toHaveBeenCalledWith('/library')
  })
})
