import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import SystemDetailView from './SystemDetailView'
import api from '../api'
import { fakeShelfGet } from '../test/fakeBrowseApi'
import { PACK, summary } from '../test/compendiumFixtures'

// The system page's Compendium tab (issue #835): when it appears, where it
// lives, and what it hands the compendium.

const mockGet = vi.mocked(api.get) as unknown as Mock
const mockCompendiumGet = vi.fn()

vi.mock('../api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
    upload: vi.fn(() => Promise.resolve({})),
  },
  bulk: {},
  tags: { list: vi.fn(() => Promise.resolve({ tags: [] })) },
  mediaUrl: (path: string) => `http://localhost${path}`,
  imageSources: { thumbUrl: () => null },
  compendium: { get: (...a: unknown[]) => mockCompendiumGet(...a) },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'player' } }),
}))
vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}))
vi.mock('../components/FavoriteButton', () => ({ default: () => null }))
vi.mock('../components/RescanButton', () => ({ default: () => null }))

const compendiumProps = vi.fn()
vi.mock('../components/compendium/SystemCompendium', () => ({
  default: (props: Record<string, unknown>) => {
    compendiumProps(props)
    return <div data-testid="compendium" />
  },
}))

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="location">{pathname}</div>
}

const SYSTEM = {
  id: 'system-1',
  name: 'Test System',
  slug: 'test-system',
  description: '',
  publishers: [],
  tags: [],
  genre: '',
  cover_image: '',
  cover_book_id: null,
  is_explicit: false,
  books: [
    {
      id: 'b1',
      title: 'Core Book',
      category: 'core',
      page_count: 10,
      tags: [],
      relative_path: 'books/Test/core/core.pdf',
    },
  ],
}

function renderAt(path: string) {
  mockGet.mockImplementation(
    fakeShelfGet({
      system: SYSTEM,
      books: SYSTEM.books,
      isFavorite: () => false,
    } as unknown as Parameters<typeof fakeShelfGet>[0])
  )
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/library/system/:systemId" element={<SystemDetailView />} />
        <Route
          path="/library/system/:systemId/compendium/:contentType?/:entryId?"
          element={<SystemDetailView />}
        />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

describe('SystemDetailView - compendium', () => {
  it('has no tabs while nothing is linked', async () => {
    mockCompendiumGet.mockResolvedValue(summary({ packs: [], sheets: [], content_types: [] }))
    renderAt('/library/system/system-1')
    expect(await screen.findByText('Core Book')).toBeInTheDocument()
    await waitFor(() => expect(mockCompendiumGet).toHaveBeenCalledWith('system-1'))
    expect(screen.queryByRole('navigation', { name: 'System sections' })).toBeNull()
  })

  it('offers a Compendium tab once a pack is linked, and follows it', async () => {
    mockCompendiumGet.mockResolvedValue(summary())
    renderAt('/library/system/system-1')
    const tab = await screen.findByRole('link', { name: 'Compendium' })
    expect(screen.getByRole('link', { name: 'Books' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(tab)
    expect(screen.getByTestId('location')).toHaveTextContent('/library/system/system-1/compendium')
    expect(await screen.findByTestId('compendium')).toBeInTheDocument()
    expect(screen.queryByText('Core Book')).toBeNull()
  })

  it('hands the compendium the type, entry and origin from the URL', async () => {
    mockCompendiumGet.mockResolvedValue(summary())
    renderAt('/library/system/system-1/compendium/spell/fireball?origin=demo-srd')
    await screen.findByTestId('compendium')
    expect(compendiumProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        systemId: 'system-1',
        contentType: 'spell',
        entryId: 'fireball',
        origin: 'demo-srd',
        summary: expect.objectContaining({ packs: [PACK] }),
      })
    )
    expect(screen.getByRole('link', { name: 'Compendium' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows the sheets it is set up with as new-character shortcuts', async () => {
    mockCompendiumGet.mockResolvedValue(
      summary({ sheets: [{ schema_id: 'demo', name: 'Demo sheet', available: true }] })
    )
    renderAt('/library/system/system-1')
    expect(await screen.findByRole('link', { name: 'Demo sheet' })).toHaveAttribute(
      'href',
      '/characters?new=demo'
    )
  })

  it('says so when the compendium cannot be read', async () => {
    mockCompendiumGet.mockImplementation(() => Promise.reject(new Error('offline')))
    renderAt('/library/system/system-1/compendium')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The compendium could not be loaded.'
    )
  })
})
