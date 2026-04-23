import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SystemDetailView from './SystemDetailView'
import api from '../api'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../api', () => ({
  default: { get: vi.fn(), patch: vi.fn() },
  mediaUrl: (path) => `http://localhost${path}`,
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useParams: () => ({ systemId: 'system-1' }),
    useNavigate: () => vi.fn(),
  }
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'admin' } }),
}))

vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
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

vi.mock('../components/system/BookEditor', () => ({
  default: ({ onClose }) => (
    <div data-testid="book-editor">
      <button onClick={onClose}>Close Editor</button>
    </div>
  ),
}))

vi.mock('../components/system/SystemEditor', () => ({
  default: () => <div data-testid="system-editor" />,
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
})
