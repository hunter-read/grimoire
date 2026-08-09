import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import LibraryView from './LibraryView'
import api, { bulk } from '../api'

vi.mock('../api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
  bulk: {
    addTags: vi.fn(() => Promise.resolve({ updated: [], errors: [], tags: {} })),
    update: vi.fn(() => Promise.resolve({ updated: [], errors: [] })),
    setFolderTags: vi.fn(() => Promise.resolve({ folders: [] })),
  },
  tags: { list: vi.fn(() => Promise.resolve({ tags: [] })) },
  mediaUrl: (path) => `http://localhost${path}`,
}))

// Open the shared filter modal (favourites/tags/genre live there now).
const openFilters = () => userEvent.click(screen.getByRole('button', { name: 'Filters' }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate }
})

let mockUserPrefs = { cardSize: 'comfortable', librarySort: 'az' }
vi.mock('../hooks/useUserPrefs', () => ({
  getUserPrefs: () => mockUserPrefs,
  saveUserPref: (key, value) => {
    mockUserPrefs = { ...mockUserPrefs, [key]: value }
  },
}))

let mockRecentBooks = []
const mockRemoveRecentBook = vi.fn()
vi.mock('../hooks/useBookPrefs', () => ({
  getRecentBooks: () => mockRecentBooks,
  getBookPrefs: () => ({}),
  removeRecentBook: (id) => mockRemoveRecentBook(id),
}))

// Favorites context — default: nothing is a favorite
const mockIsFavorite = vi.fn(() => false)
vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: mockIsFavorite, toggleFavorite: vi.fn() }),
}))

// Auth context — default: an admin (so bulk-edit controls are available)
let mockUser = { role: 'admin' }
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}))

vi.mock('../components/FavoriteButton', () => ({
  default: ({ type, id }) => <button data-testid={`fav-${type}-${id}`}>fav</button>,
}))

function makeSystem(overrides = {}) {
  const id = overrides.id ?? `sys-${Math.random().toString(36).slice(2)}`
  return {
    id,
    name: overrides.name ?? 'Test System',
    slug: id,
    book_count: 3,
    is_system_agnostic: false,
    cover_book_id: null,
    description: '',
    publishers: [],
    tags: [],
    is_explicit: false,
    ...overrides,
  }
}

function renderView() {
  return render(
    <MemoryRouter>
      <LibraryView />
    </MemoryRouter>
  )
}

describe('LibraryView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFavorite.mockReturnValue(false)
    sessionStorage.clear()
    mockUserPrefs = { cardSize: 'comfortable', librarySort: 'az' }
    mockRecentBooks = []
    mockUser = { role: 'admin' }
  })

  it('renders system cards after loading', async () => {
    api.get.mockResolvedValue([makeSystem({ name: 'D&D 5e' })])
    renderView()
    await waitFor(() => expect(screen.getByText('D&D 5e')).toBeInTheDocument())
  })

  it('shows a spinner while loading', () => {
    api.get.mockReturnValue(new Promise(() => {}))
    renderView()
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('shows the favorites filter toggle in the filter modal', async () => {
    api.get.mockResolvedValue([makeSystem()])
    renderView()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument())
    await openFilters()
    expect(screen.getByRole('checkbox', { name: /Favorites/ })).toBeInTheDocument()
  })

  it('favorites toggle hides non-favorite systems', async () => {
    api.get.mockResolvedValue([
      makeSystem({ id: 'sys-fav', name: 'Favorite System' }),
      makeSystem({ id: 'sys-other', name: 'Other System' }),
    ])
    mockIsFavorite.mockImplementation((type, id) => type === 'system' && id === 'sys-fav')

    renderView()
    await waitFor(() => expect(screen.getByText('Favorite System')).toBeInTheDocument())

    await openFilters()
    await userEvent.click(screen.getByRole('checkbox', { name: /Favorites/ }))

    expect(screen.getByText('Favorite System')).toBeInTheDocument()
    expect(screen.queryByText('Other System')).not.toBeInTheDocument()
  })

  it('toggling favorites off restores all systems', async () => {
    api.get.mockResolvedValue([
      makeSystem({ id: 'sys-fav', name: 'Favorite System' }),
      makeSystem({ id: 'sys-other', name: 'Other System' }),
    ])
    mockIsFavorite.mockImplementation((type, id) => type === 'system' && id === 'sys-fav')

    renderView()
    await waitFor(() => expect(screen.getByText('Other System')).toBeInTheDocument())

    await openFilters()
    const toggle = screen.getByRole('checkbox', { name: /Favorites/ })
    await userEvent.click(toggle)
    expect(screen.queryByText('Other System')).not.toBeInTheDocument()

    await userEvent.click(toggle)
    expect(screen.getByText('Other System')).toBeInTheDocument()
  })

  it('view-mode toggle cycles card → compact → list → card', async () => {
    sessionStorage.clear()
    api.get.mockResolvedValue([makeSystem()])
    renderView()
    await waitFor(() => expect(screen.getByText('Test System')).toBeInTheDocument())

    // Starts on Cards (the persisted default from the mocked prefs). The toggle
    // is icon-only; the current mode is exposed via its accessible name.
    const toggle = screen.getByRole('button', { name: /change view/i })
    expect(toggle).toHaveAccessibleName(/cards/i)

    await userEvent.click(toggle)
    expect(toggle).toHaveAccessibleName(/compact/i)

    await userEvent.click(toggle)
    expect(toggle).toHaveAccessibleName(/list/i)
    // The system still renders in list mode.
    expect(screen.getByText('Test System')).toBeInTheDocument()

    await userEvent.click(toggle)
    expect(toggle).toHaveAccessibleName(/cards/i)
  })

  it('renders the favorite button on system cards in compact mode', async () => {
    sessionStorage.clear()
    api.get.mockResolvedValue([makeSystem({ id: 'sys-1', name: 'Test System' })])
    renderView()
    await waitFor(() => expect(screen.getByText('Test System')).toBeInTheDocument())

    // Switch to compact mode.
    await userEvent.click(screen.getByRole('button', { name: /change view/i }))

    expect(screen.getByTestId('fav-system-sys-1')).toBeInTheDocument()
  })

  it('view-mode override is stored in sessionStorage, not user prefs', async () => {
    sessionStorage.clear()
    api.get.mockResolvedValue([makeSystem()])
    renderView()
    await waitFor(() => expect(screen.getByText('Test System')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /change view/i }))

    expect(sessionStorage.getItem('grimoire:view-mode:system')).toBe('compact')
    // The persisted user-prefs store is never written by the toggle.
    expect(localStorage.getItem('grimoire:user-prefs')).toBeNull()
  })

  it('shows empty hint when favorites filter is on but nothing is favorited', async () => {
    api.get.mockResolvedValue([makeSystem({ name: 'Unfavorited System' })])
    mockIsFavorite.mockReturnValue(false)

    renderView()
    await waitFor(() => expect(screen.getByText('Unfavorited System')).toBeInTheDocument())

    await openFilters()
    await userEvent.click(screen.getByRole('checkbox', { name: /Favorites/ }))

    expect(screen.queryByText('Unfavorited System')).not.toBeInTheDocument()
    expect(screen.getByText(/no favorites here yet/i)).toBeInTheDocument()
  })

  describe('tag filtering', () => {
    // Tags live in a searchable multiselect dropdown inside the filter modal;
    // open the modal, then the "Tags" dropdown, to reach the checkboxes.
    const openTags = async () => {
      await openFilters()
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    }

    it('lists every tag present across systems in the Tags dropdown', async () => {
      api.get.mockResolvedValue([
        makeSystem({ id: 's1', name: 'Alpha', tags: ['osr', 'fantasy'] }),
        makeSystem({ id: 's2', name: 'Beta', tags: ['pbta'] }),
      ])
      renderView()
      await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())

      await openTags()
      expect(screen.getByRole('checkbox', { name: /^osr$/i })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: /^fantasy$/i })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: /^pbta$/i })).toBeInTheDocument()
    })

    it('filters systems to those carrying a selected tag', async () => {
      api.get.mockResolvedValue([
        makeSystem({ id: 's1', name: 'OSR System', tags: ['osr'] }),
        makeSystem({ id: 's2', name: 'PbtA System', tags: ['pbta'] }),
      ])
      renderView()
      await waitFor(() => expect(screen.getByText('OSR System')).toBeInTheDocument())

      await openTags()
      await userEvent.click(screen.getByRole('checkbox', { name: /^osr$/i }))

      expect(screen.getByText('OSR System')).toBeInTheDocument()
      expect(screen.queryByText('PbtA System')).not.toBeInTheDocument()
    })

    it('ANDs multiple selected tags', async () => {
      api.get.mockResolvedValue([
        makeSystem({ id: 's1', name: 'Both System', tags: ['osr', 'grim'] }),
        makeSystem({ id: 's2', name: 'OSR Only', tags: ['osr'] }),
      ])
      renderView()
      await waitFor(() => expect(screen.getByText('Both System')).toBeInTheDocument())

      await openTags()
      await userEvent.click(screen.getByRole('checkbox', { name: /^osr$/i }))
      await userEvent.click(screen.getByRole('checkbox', { name: /^grim$/i }))

      // Only the system carrying BOTH tags survives.
      expect(screen.getByText('Both System')).toBeInTheDocument()
      expect(screen.queryByText('OSR Only')).not.toBeInTheDocument()
    })

    it('shows an empty-match message when the tag + favorites combo matches nothing', async () => {
      // Only the non-favorite system carries "osr"; with favorites on and the
      // osr tag selected, nothing matches.
      api.get.mockResolvedValue([
        makeSystem({ id: 'fav', name: 'Fav System', tags: ['pbta'] }),
        makeSystem({ id: 'osr', name: 'OSR System', tags: ['osr'] }),
      ])
      mockIsFavorite.mockImplementation((type, id) => type === 'system' && id === 'fav')
      renderView()
      await waitFor(() => expect(screen.getByText('OSR System')).toBeInTheDocument())

      await openFilters()
      await userEvent.click(screen.getByRole('checkbox', { name: /Favorites/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      await userEvent.click(screen.getByRole('checkbox', { name: /^osr$/i }))

      expect(screen.queryByText('OSR System')).not.toBeInTheDocument()
      expect(screen.getByText(/no systems match the selected tags/i)).toBeInTheDocument()
    })

    it('clicking a tag on a card navigates to the tags page (issue #235.7)', async () => {
      api.get.mockResolvedValue([
        makeSystem({ id: 's1', name: 'Alpha', tags: ['osr'] }),
        makeSystem({ id: 's2', name: 'Beta', tags: ['pbta'] }),
      ])
      renderView()
      await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())

      // Card tag chips are now real <Link> anchors to the tags page (not buttons).
      // Middle-click / ctrl-click opens in a new tab natively — no JS needed.
      const tagLink = screen.getByRole('link', { name: 'Osr' })
      expect(tagLink).toHaveAttribute('href', '/tags?tag=osr')
    })
  })

  describe('bulk actions', () => {
    it('only shows the Select button to admins and GMs', async () => {
      mockUser = { role: 'player' }
      api.get.mockResolvedValue([makeSystem()])
      renderView()
      await waitFor(() => expect(screen.getByText('Test System')).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: /select/i })).not.toBeInTheDocument()
    })

    it('enters bulk mode and applies tags to selected systems', async () => {
      api.get.mockResolvedValue([
        makeSystem({ id: 's1', name: 'Alpha', tags: ['osr'] }),
        makeSystem({ id: 's2', name: 'Beta', tags: [] }),
      ])
      renderView()
      await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())

      await userEvent.click(screen.getByRole('button', { name: /select/i }))
      await userEvent.click(screen.getByText('Alpha'))

      const input = screen.getByLabelText(/tags to add/i)
      await userEvent.type(input, 'grim')
      await userEvent.click(screen.getByRole('button', { name: /add tags/i }))

      // Issue #270: one bulk request for the selection, not one PATCH per system.
      // The server merges the new tags onto each item's existing ones.
      await waitFor(() => expect(bulk.addTags).toHaveBeenCalledWith('system', ['s1'], ['grim']))
      expect(bulk.addTags).toHaveBeenCalledTimes(1)
      expect(api.patch).not.toHaveBeenCalled()
    })

    it('opens the bulk edit modal for the selected systems', async () => {
      api.get.mockResolvedValue([makeSystem({ id: 's1', name: 'Alpha' })])
      renderView()
      await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())

      await userEvent.click(screen.getByRole('button', { name: /select/i }))
      await userEvent.click(screen.getByText('Alpha'))
      await userEvent.click(screen.getByRole('button', { name: /bulk edit/i }))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText(/edit 1 item/i)).toBeInTheDocument()
    })

    // Bulk tag/edit are undefined for a container (it holds systems, not books).
    it('never sweeps a parent container into a shift-click range', async () => {
      api.get.mockResolvedValue([
        makeSystem({ id: 's1', name: 'Alpha' }),
        makeSystem({
          id: 'ctr',
          name: 'Dungeons & Dragons',
          container_kind: 'parent',
          book_count: 0,
          child_count: 3,
        }),
        makeSystem({ id: 's2', name: 'Beta' }),
      ])
      renderView()
      await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())

      await userEvent.click(screen.getByRole('button', { name: /select/i }))
      await userEvent.click(screen.getByText('Alpha'))
      // Shift-click the far end: the range spans the container in display order.
      await userEvent.click(screen.getByText('Beta'), { shiftKey: true })
      await userEvent.click(screen.getByRole('button', { name: /bulk edit/i }))

      // Both ordinary systems, and only those two.
      expect(screen.getByText(/edit 2 items/i)).toBeInTheDocument()
    })

    it('leaves a parent container clickable as a link in bulk mode', async () => {
      api.get.mockResolvedValue([
        makeSystem({ id: 's1', name: 'Alpha' }),
        makeSystem({
          id: 'ctr',
          name: 'Dungeons & Dragons',
          container_kind: 'parent',
          book_count: 0,
          child_count: 3,
        }),
      ])
      renderView()
      await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())

      await userEvent.click(screen.getByRole('button', { name: /select/i }))
      expect(screen.getByRole('link', { name: 'Dungeons & Dragons' })).toHaveAttribute(
        'href',
        '/library/system/ctr'
      )
    })
  })

  describe('recently opened', () => {
    beforeEach(() => {
      mockRecentBooks = [{ id: 'b1', title: 'Recent Book', has_thumbnail: false, page_count: 10 }]
    })

    it('always shows the remove button for recent books', async () => {
      api.get.mockResolvedValue([makeSystem()])
      renderView()
      await waitFor(() => expect(screen.getByText('Recent Book')).toBeInTheDocument())

      const removeBtn = screen.getByRole('button', { name: /remove from recently opened/i })
      // Always visible — not gated behind hover (no opacity:0).
      expect(removeBtn).toBeInTheDocument()
      expect(removeBtn.style.opacity).not.toBe('0')

      await userEvent.click(removeBtn)
      expect(mockRemoveRecentBook).toHaveBeenCalledWith('b1')
    })

    it('collapses and expands the recently opened section', async () => {
      api.get.mockResolvedValue([makeSystem()])
      renderView()
      await waitFor(() => expect(screen.getByText('Recent Book')).toBeInTheDocument())

      const header = screen.getByRole('button', { name: /^recently opened$/i })
      expect(header).toHaveAttribute('aria-expanded', 'true')

      await userEvent.click(header)
      expect(header).toHaveAttribute('aria-expanded', 'false')
      expect(mockUserPrefs.recentCollapsed).toBe(true)
    })

    it('starts collapsed when the pref is set', async () => {
      mockUserPrefs = { ...mockUserPrefs, recentCollapsed: true }
      api.get.mockResolvedValue([makeSystem()])
      renderView()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^recently opened$/i })).toBeInTheDocument()
      )
      expect(screen.getByRole('button', { name: /^recently opened$/i })).toHaveAttribute(
        'aria-expanded',
        'false'
      )
    })
  })

  describe('sort/filter and special collections', () => {
    beforeEach(() => {
      mockUserPrefs = { cardSize: 'comfortable' }
    })

    it('groups one-page systems with the special collection section', async () => {
      api.get.mockResolvedValue([
        makeSystem({ id: 'normal', name: 'Normal System' }),
        makeSystem({ id: 'onepage', name: 'Tiny RPGs', is_one_page: true }),
        makeSystem({ id: 'agnostic', name: 'Zines', is_system_agnostic: true }),
      ])
      renderView()
      // Special section heading (agnosticTitle) renders when specials exist.
      await waitFor(() => expect(screen.getByText('Tiny RPGs')).toBeInTheDocument())
      expect(screen.getByText('Zines')).toBeInTheDocument()
    })

    it('renders the sort control and reorders by name descending', async () => {
      api.get.mockResolvedValue([
        makeSystem({ id: 'a', name: 'Aardvark' }),
        makeSystem({ id: 'z', name: 'Zebra' }),
      ])
      renderView()
      await waitFor(() => expect(screen.getByText('Aardvark')).toBeInTheDocument())
      // Flip the order toggle; both systems still render, now Zebra first.
      const orderBtn = screen.getByLabelText(/ascending|descending/i)
      await userEvent.click(orderBtn)
      const names = screen.getAllByText(/Aardvark|Zebra/).map((n) => n.textContent)
      expect(names.indexOf('Zebra')).toBeLessThan(names.indexOf('Aardvark'))
    })

    it('offers genre and family filter options derived from systems', async () => {
      api.get.mockResolvedValue([
        makeSystem({ id: 'g', name: 'GenreSys', genres: ['Fantasy'], system_family: 'Fate' }),
      ])
      renderView()
      await waitFor(() => expect(screen.getByText('GenreSys')).toBeInTheDocument())
      // The derived filter options appear in the modal's selects (real i18n
      // labels: "Genre" / "System family").
      await openFilters()
      const genreSelect = screen.getByLabelText('Genre')
      expect(genreSelect.querySelector('option[value="Fantasy"]')).toBeTruthy()
      const familySelect = screen.getByLabelText('System family')
      expect(familySelect.querySelector('option[value="Fate"]')).toBeTruthy()
    })
  })
  describe('system containers (issues #261, #262)', () => {
    it('shows a parent-system container that has no books of its own', async () => {
      api.get.mockResolvedValue([
        makeSystem({
          id: 'ctr',
          name: 'Dungeons & Dragons',
          container_kind: 'parent',
          book_count: 0,
          child_count: 3,
        }),
      ])
      renderView()
      await waitFor(() => expect(screen.getByText('Dungeons & Dragons')).toBeInTheDocument())
    })

    it('still hides an ordinary system with no books', async () => {
      api.get.mockResolvedValue([makeSystem({ id: 'empty', name: 'Empty System', book_count: 0 })])
      renderView()
      // An all-empty library falls back to the "0 game systems" empty state.
      await waitFor(() =>
        expect(screen.getByText('0 game systems in your library')).toBeInTheDocument()
      )
      expect(screen.queryByText('Empty System')).not.toBeInTheDocument()
    })

    it('hides a container that has no children yet', async () => {
      api.get.mockResolvedValue([
        makeSystem({
          id: 'ctr-empty',
          name: 'Empty Container',
          container_kind: 'parent',
          book_count: 0,
          child_count: 0,
        }),
      ])
      renderView()
      await waitFor(() =>
        expect(screen.getByText('0 game systems in your library')).toBeInTheDocument()
      )
      expect(screen.queryByText('Empty Container')).not.toBeInTheDocument()
    })

    it('puts a one-page container in the special collections strip', async () => {
      api.get.mockResolvedValue([
        makeSystem({
          id: 'op',
          name: 'one-page-rpgs',
          is_one_page: true,
          container_kind: 'one-page',
          book_count: 0,
          child_count: 7,
        }),
      ])
      renderView()
      await waitFor(() => expect(screen.getByText('One Page RPGs')).toBeInTheDocument())
      expect(screen.getByText('Special Collections')).toBeInTheDocument()
    })
  })
})
